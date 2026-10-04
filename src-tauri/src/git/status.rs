use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{process::GitRunner, repository, GitError, OperationControl};

const MAX_STATUS_ENTRIES: usize = 5_000;
const MAX_FINGERPRINT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_BRANCHES: usize = 2_000;

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
pub struct GitBranchInfo {
    pub name: String,
    pub upstream: Option<String>,
    pub current: bool,
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
    pub local_branches: Vec<GitBranchInfo>,
    pub remote_branches: Vec<String>,
    pub identity: GitIdentity,
    pub remote: Option<GitRemoteInfo>,
    pub entries: Vec<GitStatusEntry>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteInfo {
    pub name: String,
    pub host: Option<String>,
    pub provider: String,
    pub repository_url: Option<String>,
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
    let mut status = parse(&raw, workspace_id, repository_id, root, request_id)?;
    status.local_branches = read_local_branches(runner, control)?;
    status.remote_branches = read_remote_branches(runner, control)?;
    status.identity = read_identity(runner, control)?;
    status.remote = read_remote(runner, control, status.branch.upstream.as_deref())?;
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
        local_branches: Vec::new(),
        remote_branches: Vec::new(),
        identity: GitIdentity::default(),
        remote: None,
        entries,
    })
}

fn read_local_branches(
    runner: &GitRunner,
    control: &Arc<OperationControl>,
) -> Result<Vec<GitBranchInfo>, GitError> {
    let output = runner
        .read(
            "branches",
            &[
                "for-each-ref",
                "--format=%(refname:short)%09%(upstream:short)%09%(HEAD)",
                "refs/heads",
            ],
            control,
        )?
        .checked("branches")?;
    let text = String::from_utf8(output.stdout).map_err(|_| {
        GitError::new(
            "GIT_BRANCH_INVALID",
            "branches",
            "Git branch output không phải UTF-8.",
        )
    })?;
    let mut branches = Vec::new();
    for line in text.lines().filter(|line| !line.is_empty()) {
        let mut fields = line.splitn(3, '\t');
        let Some(name) = fields.next().filter(|name| !name.is_empty()) else {
            continue;
        };
        if branches.len() >= MAX_BRANCHES {
            return Err(GitError::new(
                "BRANCH_LIMIT",
                "branches",
                "Repository có quá nhiều local branch để hiển thị an toàn.",
            ));
        }
        branches.push(GitBranchInfo {
            name: name.to_owned(),
            upstream: fields
                .next()
                .filter(|value| !value.is_empty())
                .map(str::to_owned),
            current: fields.next().is_some_and(|value| value == "*"),
        });
    }
    Ok(branches)
}

fn read_remote_branches(
    runner: &GitRunner,
    control: &Arc<OperationControl>,
) -> Result<Vec<String>, GitError> {
    let output = runner
        .read(
            "branches",
            &["for-each-ref", "--format=%(refname:short)", "refs/remotes"],
            control,
        )?
        .checked("branches")?;
    let text = String::from_utf8(output.stdout).map_err(|_| {
        GitError::new(
            "GIT_BRANCH_INVALID",
            "branches",
            "Git branch output không phải UTF-8.",
        )
    })?;
    let mut branches = Vec::new();
    for name in text.lines().map(str::trim).filter(|name| !name.is_empty()) {
        if name.ends_with("/HEAD") {
            continue;
        }
        if branches.len() >= MAX_BRANCHES {
            return Err(GitError::new(
                "BRANCH_LIMIT",
                "branches",
                "Repository có quá nhiều remote branch để hiển thị an toàn.",
            ));
        }
        branches.push(name.to_owned());
    }
    Ok(branches)
}

fn read_identity(
    runner: &GitRunner,
    control: &Arc<OperationControl>,
) -> Result<GitIdentity, GitError> {
    Ok(GitIdentity {
        name: config_value(runner, control, &["config", "--get", "user.name"])?,
        email: config_value(runner, control, &["config", "--get", "user.email"])?,
    })
}

fn read_remote(
    runner: &GitRunner,
    control: &Arc<OperationControl>,
    upstream: Option<&str>,
) -> Result<Option<GitRemoteInfo>, GitError> {
    let configured = if let Some(remote_name) =
        upstream.and_then(|value| value.split_once('/').map(|pair| pair.0))
    {
        let key = format!("remote.{remote_name}.url");
        config_value(runner, control, &["config", "--get", &key])?
            .map(|url| (remote_name.to_owned(), url))
    } else {
        config_value(
            runner,
            control,
            &["config", "--get-regexp", r"^remote\..+\.url$"],
        )?
        .and_then(|value| {
            let mut fields = value.split_whitespace();
            let key = fields.next()?;
            let url = fields.next()?.to_owned();
            let remote_name = key.strip_prefix("remote.")?.strip_suffix(".url")?;
            Some((remote_name.to_owned(), url))
        })
    };
    let Some((remote_name, url)) = configured else {
        return Ok(None);
    };
    let host = remote_host(&url);
    let provider = match host.as_deref() {
        Some("github.com") => "github",
        Some("gitlab.com") => "gitlab",
        Some("bitbucket.org") => "bitbucket",
        _ => "other",
    };
    Ok(Some(GitRemoteInfo {
        name: remote_name.to_owned(),
        host,
        provider: provider.to_owned(),
        repository_url: remote_web_url(&url),
    }))
}

fn config_value(
    runner: &GitRunner,
    control: &Arc<OperationControl>,
    args: &[&str],
) -> Result<Option<String>, GitError> {
    let output = runner.read("config", args, control)?;
    if output.exit_code != Some(0) {
        return Ok(None);
    }
    let value = String::from_utf8(output.stdout).map_err(|_| {
        GitError::new(
            "GIT_CONFIG_INVALID",
            "status",
            "Git config chứa giá trị không phải UTF-8.",
        )
    })?;
    let value = value.trim();
    Ok((!value.is_empty()).then(|| value.to_owned()))
}

fn remote_host(url: &str) -> Option<String> {
    let without_scheme = url.split_once("://").map(|pair| pair.1).unwrap_or(url);
    let without_user = without_scheme
        .rsplit_once('@')
        .map(|pair| pair.1)
        .unwrap_or(without_scheme);
    let host = without_user
        .split(['/', ':'])
        .next()
        .unwrap_or_default()
        .trim();
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

fn remote_web_url(url: &str) -> Option<String> {
    let without_query = url
        .split(['?', '#'])
        .next()
        .unwrap_or(url)
        .trim_end_matches('/');
    let (host, path) = if let Some(value) = without_query.strip_prefix("https://") {
        value.split_once('/')?
    } else if let Some(value) = without_query.strip_prefix("http://") {
        value.split_once('/')?
    } else if let Some(value) = without_query.strip_prefix("ssh://") {
        let value = value.split_once('@').map(|pair| pair.1).unwrap_or(value);
        value.split_once('/')?
    } else {
        let value = without_query.split_once('@').map(|pair| pair.1)?;
        value.split_once(':')?
    };
    let host = host.split(':').next().unwrap_or(host).to_ascii_lowercase();
    if !matches!(host.as_str(), "github.com" | "gitlab.com" | "bitbucket.org") {
        return None;
    }
    let path = path
        .trim_matches('/')
        .strip_suffix(".git")
        .unwrap_or(path.trim_matches('/'));
    let mut parts = path.split('/').filter(|part| !part.is_empty());
    let owner = parts.next()?;
    let repository = parts.next()?;
    if parts.next().is_some() || owner.contains(['?', '#']) || repository.contains(['?', '#']) {
        return None;
    }
    Some(format!("https://{host}/{owner}/{repository}"))
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
    use super::{parse, remote_web_url};
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

    #[test]
    fn normalizes_supported_remote_urls_to_repository_pages() {
        assert_eq!(
            remote_web_url("git@github.com:owner/project.git").as_deref(),
            Some("https://github.com/owner/project")
        );
        assert_eq!(
            remote_web_url("https://gitlab.com/group/project.git").as_deref(),
            Some("https://gitlab.com/group/project")
        );
        assert_eq!(remote_web_url("https://example.com/owner/project"), None);
    }
}
