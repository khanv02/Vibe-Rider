use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::workspace::WorkspaceError;

#[cfg(windows)]
use std::os::windows::fs::MetadataExt;

#[cfg(windows)]
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;

pub(crate) fn validate_relative_path(relative_path: &str) -> Result<PathBuf, WorkspaceError> {
    if relative_path.is_empty() {
        return Ok(PathBuf::new());
    }

    if relative_path.contains('\0') {
        return Err(invalid_path("Path không được chứa NUL."));
    }

    let mut normalized = PathBuf::new();
    for component in Path::new(relative_path).components() {
        match component {
            Component::Prefix(_) | Component::RootDir | Component::ParentDir => {
                return Err(invalid_path(
                    "Directory path phải là đường dẫn tương đối bên trong workspace.",
                ));
            }
            Component::CurDir => {}
            Component::Normal(value) => {
                if value.to_string_lossy().contains(':') {
                    return Err(invalid_path(
                        "Directory path không hỗ trợ drive prefix hoặc alternate data stream.",
                    ));
                }
                normalized.push(value);
            }
        }
    }

    Ok(normalized)
}

pub(crate) fn resolve_directory(
    root: &Path,
    relative_path: &str,
) -> Result<PathBuf, WorkspaceError> {
    let relative = validate_relative_path(relative_path)?;
    let candidate = root.join(&relative);

    let mut cursor = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(value) = component else {
            continue;
        };

        cursor.push(value);
        let metadata =
            fs::symlink_metadata(&cursor).map_err(|error| map_io_error("đọc path", error))?;
        if is_link_or_reparse(&metadata) {
            return Err(WorkspaceError::new(
                "LINK_NOT_SUPPORTED",
                "Không thể duyệt xuyên symbolic link hoặc junction trong Phase 1.",
            ));
        }
    }

    let canonical_target =
        fs::canonicalize(&candidate).map_err(|error| map_io_error("xác thực directory", error))?;
    let canonical_root =
        fs::canonicalize(root).map_err(|error| map_io_error("xác thực workspace", error))?;

    if !is_within(&canonical_root, &canonical_target) {
        return Err(WorkspaceError::new(
            "OUTSIDE_WORKSPACE",
            "Directory nằm ngoài workspace hiện tại.",
        ));
    }

    let metadata =
        fs::metadata(&canonical_target).map_err(|error| map_io_error("đọc directory", error))?;
    if !metadata.is_dir() {
        return Err(WorkspaceError::new(
            "NOT_DIRECTORY",
            "Path được yêu cầu không phải là directory.",
        ));
    }

    Ok(canonical_target)
}

pub(crate) fn resolve_regular_file(
    root: &Path,
    relative_path: &str,
) -> Result<(PathBuf, String), WorkspaceError> {
    if relative_path.is_empty() {
        return Err(invalid_path("File path không được rỗng."));
    }

    let relative = validate_relative_path(relative_path)?;
    let candidate = root.join(&relative);
    let mut cursor = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(value) = component else {
            continue;
        };

        cursor.push(value);
        let metadata =
            fs::symlink_metadata(&cursor).map_err(|error| map_io_error("đọc file path", error))?;
        if is_link_or_reparse(&metadata) {
            return Err(WorkspaceError::new(
                "LINK_NOT_SUPPORTED",
                "Không thể đọc xuyên symbolic link hoặc junction trong workspace.",
            ));
        }
    }

    let canonical_root =
        fs::canonicalize(root).map_err(|error| map_io_error("xác thực workspace", error))?;
    let canonical_target =
        fs::canonicalize(&candidate).map_err(|error| map_io_error("xác thực file", error))?;
    if !is_within(&canonical_root, &canonical_target) {
        return Err(WorkspaceError::new(
            "OUTSIDE_WORKSPACE",
            "File nằm ngoài workspace hiện tại.",
        ));
    }

    let metadata =
        fs::metadata(&canonical_target).map_err(|error| map_io_error("đọc file", error))?;
    if !metadata.is_file() {
        return Err(WorkspaceError::new(
            "NOT_FILE",
            "Path được yêu cầu không phải là file.",
        ));
    }

    let normalized = relative
        .components()
        .map(|component| {
            component
                .as_os_str()
                .to_str()
                .map(ToOwned::to_owned)
                .ok_or_else(|| {
                    WorkspaceError::new(
                        "UNSUPPORTED_PATH_ENCODING",
                        "File path không thể biểu diễn bằng Unicode.",
                    )
                })
        })
        .collect::<Result<Vec<_>, _>>()?
        .join("/");

    Ok((canonical_target, normalized))
}

pub(crate) fn is_within(root: &Path, target: &Path) -> bool {
    target == root || target.starts_with(root)
}

pub(crate) fn is_link_or_reparse(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }

    #[cfg(windows)]
    {
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }

    #[cfg(not(windows))]
    {
        false
    }
}

fn invalid_path(message: &str) -> WorkspaceError {
    WorkspaceError::new("INVALID_PATH", message)
}

fn map_io_error(operation: &str, error: std::io::Error) -> WorkspaceError {
    let code = match error.kind() {
        std::io::ErrorKind::NotFound => "NOT_FOUND",
        std::io::ErrorKind::PermissionDenied => "PERMISSION_DENIED",
        _ => "IO_ERROR",
    };
    WorkspaceError::new(code, format!("Không thể {operation}: {error}"))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::{is_within, resolve_directory, validate_relative_path};

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

    struct TempDirectory(PathBuf);

    impl TempDirectory {
        fn new() -> Self {
            let sequence = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "vibe-rider-phase1-path-{}-{sequence}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("fixture directory should be created");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn accepts_root_and_nested_relative_paths() {
        let fixture = TempDirectory::new();
        fs::create_dir(fixture.path().join("src")).expect("src should exist");

        assert!(validate_relative_path("")
            .expect("root should be valid")
            .as_os_str()
            .is_empty());
        assert_eq!(
            resolve_directory(fixture.path(), "src")
                .expect("nested directory should resolve")
                .file_name()
                .and_then(|name| name.to_str()),
            Some("src")
        );
    }

    #[test]
    fn rejects_traversal_and_absolute_forms() {
        for value in [
            "../outside",
            "..\\outside",
            "/rooted",
            "C:\\absolute",
            "C:relative",
        ] {
            assert!(
                validate_relative_path(value).is_err(),
                "path should be rejected: {value}"
            );
        }
        assert!(validate_relative_path("folder:file").is_err());
        assert!(validate_relative_path("folder\0file").is_err());
    }

    #[test]
    fn component_containment_does_not_use_string_prefixes() {
        let fixture = TempDirectory::new();
        let root = fixture.path().join("repo");
        let sibling = fixture.path().join("repo-other");
        fs::create_dir(&root).expect("root should exist");
        fs::create_dir(&sibling).expect("sibling should exist");

        let root = fs::canonicalize(root).expect("root should canonicalize");
        let sibling = fs::canonicalize(sibling).expect("sibling should canonicalize");
        assert!(!is_within(&root, &sibling));
    }

    #[cfg(windows)]
    #[test]
    fn rejects_unc_and_rooted_windows_paths() {
        for value in [r"\\server\share", r"\\?\C:\workspace", r"\rooted"] {
            assert!(
                validate_relative_path(value).is_err(),
                "path should be rejected: {value}"
            );
        }
    }
}
