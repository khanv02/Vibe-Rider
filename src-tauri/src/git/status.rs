use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{process::GitRunner, repository, GitError, OperationControl};

const MAX_STATUS_ENTRIES: usize = 5_000;
const MAX_FINGERPRINT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub head: Option<String>,
    pub oid: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub detached: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    pub entry_id: String,
    pub current_path: String,
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub kind: String,
    pub conflict: bool,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub restore_token: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub workspace_id: String,
    pub repository_id: String,
    pub request_id: Option<String>,
    pub status_token: String,
    pub branch: GitBranch,
    pub entries: Vec<GitStatusEntry>,
}

#[derive(Clone, Debug)]
pub(super) struct StatusSnapshot {
    pub status: GitStatus,
}

pub(super) fn read(
    workspace_id: &str,
    repository_id: &str,
    root: &Path,
    runner: &GitRunner,
    control: &Arc<OperationControl>,
    request_id: Option<String>,
) -> Result<StatusSnapshot, GitError> {
    let output = runner
        .read(
            "status",
            &[
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=all",
            ],
            control,
        )?
        .checked("status")?;
    let raw = output.stdout;
    let status = parse(&raw, workspace_id, repository_id, root, request_id)?;
    Ok(StatusSnapshot { status })
}

fn parse(
    raw: &[u8],
    workspace_id: &str,
    repository_id: &str,
    root: &Path,
    request_id: Option<String>,
) -> Result<GitStatus, GitError> {
    let mut branch = GitBranch::default();
    let mut entries = Vec::new();
    let mut records = raw.split(|byte| *byte == 0).peekable();
    while let Some(record) = records.next() {
        if record.is_empty() {
            continue;
        }
        if record[0] == b'#' {
            parse_header(record, &mut branch)?;
            continue;
        }

        let text = String::from_utf8(record.to_vec()).map_err(|_| {
            GitError::new(
                "UNSUPPORTED_PATH_ENCODING",
                "status",
                "Git status chứa path không phải UTF-8.",
            )
        })?;
        let (kind, index_status, worktree_status, current_path, original_path) = match record[0] {
            b'1' => {
                let fields = text.splitn(9, ' ').collect::<Vec<_>>();
                if fields.len() != 9 || fields[1].len() != 2 {
                    return malformed_status();
                }
                (
                    "tracked",
                    fields[1].chars().next().unwrap_or(' '),
                    fields[1].chars().nth(1).unwrap_or(' '),
                    fields[8].to_owned(),
                    None,
                )
            }
            b'2' => {
                let fields = text.splitn(10, ' ').collect::<Vec<_>>();
                let original = records.next().ok_or_else(|| {
                    GitError::new(
                        "GIT_STATUS_MALFORMED",
                        "status",
                        "Rename record bị thiếu path cũ.",
                    )
                })?;
                let original = String::from_utf8(original.to_vec()).map_err(|_| {
                    GitError::new(
                        "UNSUPPORTED_PATH_ENCODING",
                        "status",
                        "Git rename path không phải UTF-8.",
                    )
                })?;
                if fields.len() != 10 || fields[1].len() != 2 {
                    return malformed_status();
                }
                (
                    "rename",
                    fields[1].chars().next().unwrap_or(' '),
                    fields[1].chars().nth(1).unwrap_or(' '),
                    fields[9].to_owned(),
                    Some(original),
                )
            }
            b'u' => {
                let fields = text.splitn(11, ' ').collect::<Vec<_>>();
                if fields.len() != 11 || fields[1].len() != 2 {
                    return malformed_status();
                }
                (
                    "conflict",
                    fields[1].chars().next().unwrap_or('U'),
                    fields[1].chars().nth(1).unwrap_or('U'),
                    fields[11].to_owned(),
                    None,
                )
            }
            b'?' => {
                let path = text.strip_prefix("? ").ok_or_else(|| {
                    GitError::new(
                        "GIT_STATUS_MALFORMED",
                        "status",
                        "Untracked record không hợp lệ.",
                    )
                })?;
                ("untracked", '?', '?', path.to_owned(), None)
            }
            b'!' => continue,
            _ => {
                return Err(GitError::new(
                    "GIT_STATUS_MALFORMED",
                    "status",
                    "Git status chứa record không được hỗ trợ.",
                ))
            }
        };

        repository::validate_path(root, &current_path)?;
        if let Some(original) = &original_path {
            repository::validate_path(root, original)?;
        }
        let conflict = kind == "conflict";
        let staged = index_status != ' ' && kind != "untracked";
        let unstaged = worktree_status != ' ' && kind != "untracked";
        let untracked = kind == "untracked";
        let entry_id = digest(&[
            repository_id,
            &current_path,
            original_path.as_deref().unwrap_or(""),
            &index_status.to_string(),
            &worktree_status.to_string(),
            kind,
        ]);
        let restore_token = restore_digest(root, &current_path, repository_id, &entry_id);
        entries.push(GitStatusEntry {
            entry_id,
            current_path,
            original_path,
            index_status: index_status.to_string(),
            worktree_status: worktree_status.to_string(),
            kind: kind.to_owned(),
            conflict,
            staged,
            unstaged,
            untracked,
            restore_token,
        });
        if entries.len() > MAX_STATUS_ENTRIES {
            return Err(GitError::new(
                "STATUS_LIMIT",
                "status",
                "Repository có quá nhiều status entry để hiển thị an toàn.",
            ));
        }
    }

    let mut token_parts = vec![repository_id.as_bytes(), raw];
    token_parts.extend(entries.iter().map(|entry| entry.restore_token.as_bytes()));
    let status_token = digest_bytes(&token_parts);
    Ok(GitStatus {
        workspace_id: workspace_id.to_owned(),
        repository_id: repository_id.to_owned(),
        request_id,
        status_token,
        branch,
        entries,
    })
}

fn parse_header(record: &[u8], branch: &mut GitBranch) -> Result<(), GitError> {
    let text = String::from_utf8(record.to_vec()).map_err(|_| {
        GitError::new(
            "GIT_STATUS_MALFORMED",
            "status",
            "Git branch header không hợp lệ.",
        )
    })?;
    let mut fields = text.splitn(3, ' ');
    let _hash = fields.next();
    let Some(key) = fields.next() else {
        return Ok(());
    };
    let value = fields.next().unwrap_or_default();
    match key {
        "branch.oid" => branch.oid = Some(value.to_owned()),
        "branch.head" => {
            branch.detached = value == "(detached)";
            branch.head = (!branch.detached && value != "(unknown)").then(|| value.to_owned());
        }
        "branch.upstream" => branch.upstream = Some(value.to_owned()),
        "branch.ab" => {
            let values = value.split_whitespace().collect::<Vec<_>>();
            if values.len() == 2 {
                branch.ahead = values[0].trim_start_matches('+').parse().map_err(|_| {
                    GitError::new(
                        "GIT_STATUS_MALFORMED",
                        "status",
                        "Ahead count không hợp lệ.",
                    )
                })?;
                branch.behind = values[1].trim_start_matches('-').parse().map_err(|_| {
                    GitError::new(
                        "GIT_STATUS_MALFORMED",
                        "status",
                        "Behind count không hợp lệ.",
                    )
                })?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn malformed_status<T>() -> Result<T, GitError> {
    Err(GitError::new(
        "GIT_STATUS_MALFORMED",
        "status",
        "Git status tracked record không hợp lệ.",
    ))
}

fn digest(parts: &[&str]) -> String {
    digest_bytes(&parts.iter().map(|part| part.as_bytes()).collect::<Vec<_>>())
}

fn digest_bytes(parts: &[&[u8]]) -> String {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update(part.len().to_le_bytes());
        hash.update(part);
    }
    format!("sha256:{:x}", hash.finalize())
}

fn restore_digest(root: &Path, path: &str, repository_id: &str, entry_id: &str) -> String {
    let target = root.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
    let mut hash = Sha256::new();
    hash.update(repository_id.as_bytes());
    hash.update(entry_id.as_bytes());
    if let Ok(metadata) = fs::metadata(&target) {
        hash.update(metadata.len().to_le_bytes());
        if metadata.len() <= MAX_FINGERPRINT_BYTES {
            if let Ok(mut file) = fs::File::open(target) {
                let mut bytes = Vec::new();
                let _ = file.read_to_end(&mut bytes);
                hash.update(bytes);
            }
        } else if let Ok(modified) = metadata.modified() {
            if let Ok(elapsed) = modified.duration_since(std::time::UNIX_EPOCH) {
                hash.update(elapsed.as_nanos().to_le_bytes());
            }
        }
    } else {
        hash.update(b"missing");
    }
    format!("sha256:{:x}", hash.finalize())
}

#[cfg(test)]
mod tests {
    use super::parse;
    use std::path::Path;

    #[test]
    fn parses_nul_paths_and_split_staged_worktree_state() {
        let raw = b"# branch.oid abc\0# branch.head main\0# branch.ab +2 -1\0";
        let raw = [
            raw.as_slice(),
            b"1 M. N... 100644 100644 100644 abc def file with spaces.txt\0",
            b"? new [file].txt\0",
        ]
        .concat();
        let status = parse(&raw, "workspace", "repo", Path::new("."), None).unwrap();
        assert_eq!(status.branch.head.as_deref(), Some("main"));
        assert_eq!(status.branch.ahead, 2);
        assert_eq!(status.entries.len(), 2);
        assert_eq!(status.entries[0].current_path, "file with spaces.txt");
        assert_eq!(status.entries[1].current_path, "new [file].txt");
    }

    #[test]
    fn parses_rename_with_original_path_as_next_nul_record() {
        let raw = [
            b"# branch.head main\0".as_slice(),
            b"2 R. N... 100644 100644 100644 abc def R100 new name.txt\0",
            b"old name.txt\0",
        ]
        .concat();
        let status = parse(&raw, "workspace", "repo", Path::new("."), None).unwrap();
        assert_eq!(status.entries[0].kind, "rename");
        assert_eq!(
            status.entries[0].original_path.as_deref(),
            Some("old name.txt")
        );
    }
}
