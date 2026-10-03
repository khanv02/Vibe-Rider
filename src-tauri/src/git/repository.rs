use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{process::GitRunner, GitError, OperationControl};
use crate::path_guard::{is_link_or_reparse, is_within, validate_relative_path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepository {
    pub workspace_id: String,
    pub repository_id: String,
    pub root_path: String,
    pub git_version: String,
}

pub(super) fn inspect(
    workspace_id: &str,
    root: &Path,
    runner: &GitRunner,
    control: &Arc<OperationControl>,
) -> Result<GitRepository, GitError> {
    let root = root
        .canonicalize()
        .map_err(|error| GitError::io("repository", error))?;
    let git_dir = root.join(".git");
    let metadata = match fs::symlink_metadata(&git_dir) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let bare = root.join("HEAD").is_file() && root.join("objects").is_dir();
            return Err(GitError::new(
                if bare {
                    "UNSUPPORTED_REPOSITORY"
                } else {
                    "NOT_REPOSITORY"
                },
                "repository",
                "Hãy mở repository root có .git directory. Không tự tìm repo ở parent.",
            ));
        }
        Err(error) => return Err(GitError::io("repository", error)),
    };
    if is_link_or_reparse(&metadata) || !metadata.is_dir() {
        return Err(GitError::new(
            "UNSUPPORTED_REPOSITORY",
            "repository",
            "Linked worktree, .git pointer hoặc reparse directory chưa được hỗ trợ.",
        ));
    }
    for path in ["HEAD", "config", "index", "objects", "refs"] {
        if fs::symlink_metadata(git_dir.join(path))
            .is_ok_and(|metadata| is_link_or_reparse(&metadata))
        {
            return Err(GitError::new(
                "UNSUPPORTED_REPOSITORY",
                "repository",
                "Git metadata có symbolic link/reparse point.",
            ));
        }
    }
    if git_dir.join("objects/info/alternates").exists()
        || git_dir.join("objects/info/http-alternates").exists()
    {
        return Err(GitError::new(
            "UNSUPPORTED_REPOSITORY",
            "repository",
            "External Git object stores chưa được hỗ trợ.",
        ));
    }
    let top = output_line(
        runner
            .read("repository", &["rev-parse", "--show-toplevel"], control)?
            .checked("repository")?
            .stdout,
    )?;
    let top = PathBuf::from(top)
        .canonicalize()
        .map_err(|error| GitError::io("repository", error))?;
    if top != root {
        return Err(GitError::new(
            "OUTSIDE_WORKSPACE",
            "repository",
            "Repository top-level không trùng workspace root.",
        ));
    }
    let actual_git_dir = output_line(
        runner
            .read("repository", &["rev-parse", "--absolute-git-dir"], control)?
            .checked("repository")?
            .stdout,
    )?;
    let common = output_line(
        runner
            .read(
                "repository",
                &["rev-parse", "--path-format=absolute", "--git-common-dir"],
                control,
            )?
            .checked("repository")?
            .stdout,
    )?;
    if PathBuf::from(actual_git_dir).canonicalize().ok().as_ref() != Some(&git_dir)
        || PathBuf::from(common).canonicalize().ok().as_ref() != Some(&git_dir)
    {
        return Err(GitError::new(
            "OUTSIDE_WORKSPACE",
            "repository",
            "Git directory/common directory nằm ngoài workspace.",
        ));
    }
    let sparse = runner.read(
        "repository",
        &["config", "--bool", "--get", "core.sparseCheckout"],
        control,
    )?;
    match sparse.exit_code {
        Some(1) => {}
        Some(0) if output_line(sparse.stdout.clone())? == "false" => {}
        Some(0) => {
            return Err(GitError::new(
                "UNSUPPORTED_REPOSITORY",
                "repository",
                "Sparse checkout chưa được hỗ trợ.",
            ))
        }
        _ => {
            sparse.checked("repository")?;
        }
    }
    let version = output_line(
        runner
            .read("repository", &["--version"], control)?
            .checked("repository")?
            .stdout,
    )?;
    let root_path = root
        .to_str()
        .ok_or_else(|| {
            GitError::new(
                "UNSUPPORTED_PATH_ENCODING",
                "repository",
                "Workspace path không phải Unicode.",
            )
        })?
        .to_owned();
    let mut identity = Sha256::new();
    identity.update(workspace_id.as_bytes());
    identity.update([0]);
    identity.update(root_path.as_bytes());
    Ok(GitRepository {
        workspace_id: workspace_id.into(),
        repository_id: format!("{:x}", identity.finalize()),
        root_path,
        git_version: version,
    })
}

fn output_line(bytes: Vec<u8>) -> Result<String, GitError> {
    let text = String::from_utf8(bytes).map_err(|_| {
        GitError::new(
            "UNSUPPORTED_PATH_ENCODING",
            "repository",
            "Git path output không phải UTF-8.",
        )
    })?;
    let text = text.strip_suffix('\n').unwrap_or(&text);
    Ok(text.strip_suffix('\r').unwrap_or(text).to_owned())
}

/// Validate a Git file path even when the leaf was removed. HEAD/index
/// membership and modes are checked by each operation before this resolver.
#[allow(dead_code)]
pub(super) fn validate_path(root: &Path, relative_path: &str) -> Result<PathBuf, GitError> {
    let relative = validate_relative_path(relative_path)?;
    if relative.as_os_str().is_empty() {
        return Err(GitError::new(
            "INVALID_PATH",
            "path",
            "Không thao tác trên workspace root.",
        ));
    }
    for component in relative.components() {
        let Component::Normal(value) = component else {
            continue;
        };
        let value = value.to_str().ok_or_else(|| {
            GitError::new(
                "UNSUPPORTED_PATH_ENCODING",
                "path",
                "Git file path không phải Unicode.",
            )
        })?;
        let base = value
            .split('.')
            .next()
            .unwrap_or(value)
            .to_ascii_uppercase();
        let reserved_device = matches!(
            base.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        ) || ["COM", "LPT"].iter().any(|prefix| {
            base.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
        if value.eq_ignore_ascii_case(".git") || value.ends_with(['.', ' ']) || reserved_device {
            return Err(GitError::new(
                "INVALID_PATH",
                "path",
                "Không thao tác Git metadata hoặc Windows path alias.",
            ));
        }
    }
    let root = root
        .canonicalize()
        .map_err(|error| GitError::io("path", error))?;
    let mut cursor = root.clone();
    let target = root.join(&relative);
    for component in relative.components() {
        cursor.push(component);
        let metadata = match fs::symlink_metadata(&cursor) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if let Some(parent) = cursor.parent() {
                    if fs::symlink_metadata(parent)
                        .map(|metadata| !metadata.is_dir())
                        .unwrap_or(false)
                    {
                        return Err(GitError::new(
                            "NOT_FILE",
                            "path",
                            "Git path đi qua một ancestor không phải regular directory.",
                        ));
                    }
                }
                return Ok(target);
            }
            Err(error) => return Err(GitError::io("path", error)),
        };
        if is_link_or_reparse(&metadata) {
            return Err(GitError::new(
                "LINK_NOT_SUPPORTED",
                "path",
                "Git path đi qua symbolic link/junction/reparse point.",
            ));
        }
        let canonical = cursor
            .canonicalize()
            .map_err(|error| GitError::io("path", error))?;
        if !is_within(&root, &canonical) {
            return Err(GitError::new(
                "OUTSIDE_WORKSPACE",
                "path",
                "Git path nằm ngoài workspace.",
            ));
        }
        if canonical.strip_prefix(&root).is_ok_and(|relative| {
            relative.components().any(|component| {
                component
                    .as_os_str()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(".git")
            })
        }) {
            return Err(GitError::new(
                "INVALID_PATH",
                "path",
                "Git path alias trỏ vào Git metadata.",
            ));
        }
        if metadata.is_dir() && cursor.join(".git").exists() {
            return Err(GitError::new(
                "UNSUPPORTED_REPOSITORY",
                "path",
                "Không thao tác xuyên nested repository.",
            ));
        }
        if cursor == target && !metadata.is_file() {
            return Err(GitError::new(
                "NOT_FILE",
                "path",
                "Git selected path phải là regular file.",
            ));
        }
    }
    Ok(target)
}
