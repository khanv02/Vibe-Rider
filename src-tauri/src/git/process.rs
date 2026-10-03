use std::collections::VecDeque;
use std::ffi::OsStr;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{atomic::Ordering, Arc};
use std::thread;
use std::time::{Duration, Instant};

use super::{GitError, OperationControl, ProcessTree};

pub(super) const MAX_STREAM_BYTES: usize = 4 * 1024 * 1024;

pub(super) struct GitRunner {
    executable: PathBuf,
    root: PathBuf,
}

#[derive(Clone, Copy)]
pub(super) struct Limits {
    pub timeout: Duration,
    pub bytes: usize,
    pub machine: bool,
}

impl Limits {
    pub fn read() -> Self {
        Self {
            timeout: Duration::from_secs(15),
            bytes: MAX_STREAM_BYTES,
            machine: true,
        }
    }

    pub fn mutation() -> Self {
        Self {
            timeout: Duration::from_secs(60),
            bytes: MAX_STREAM_BYTES,
            machine: false,
        }
    }

    pub fn push() -> Self {
        Self {
            timeout: Duration::from_secs(120),
            bytes: MAX_STREAM_BYTES,
            machine: false,
        }
    }
}

pub(super) struct GitOutput {
    pub exit_code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub truncated: bool,
}

impl GitOutput {
    pub fn checked(self, operation: &str) -> Result<Self, GitError> {
        if self.exit_code == Some(0) {
            return Ok(self);
        }
        let mut error = GitError::new(
            "GIT_FAILED",
            operation,
            format!(
                "Git {operation} thất bại: {}{}",
                redact(&String::from_utf8_lossy(&self.stderr)),
                if self.truncated {
                    " (output đã rút gọn)"
                } else {
                    ""
                }
            ),
        );
        error.exit_code = self.exit_code;
        Err(error)
    }
}

pub(super) fn resolve_git() -> Result<PathBuf, GitError> {
    let name = if cfg!(windows) { "git.exe" } else { "git" };
    let current = std::env::current_dir()
        .ok()
        .and_then(|path| path.canonicalize().ok());
    for directory in std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
    {
        // Empty/relative PATH entries implicitly trust the current directory.
        if !directory.is_absolute() {
            continue;
        }
        let candidate = directory.join(name);
        let Ok(candidate) = candidate.canonicalize() else {
            continue;
        };
        if candidate.is_file()
            && !current
                .as_ref()
                .is_some_and(|root| candidate.starts_with(root))
        {
            return Ok(candidate);
        }
    }
    Err(GitError::new(
        "GIT_NOT_FOUND",
        "repository",
        "Không tìm thấy Git trong PATH. Cài Git rồi mở lại ứng dụng.",
    ))
}

impl GitRunner {
    pub fn new(executable: PathBuf, root: PathBuf) -> Self {
        Self { executable, root }
    }

    pub(super) fn executable_path(&self) -> &Path {
        &self.executable
    }

    pub(super) fn root_path(&self) -> &Path {
        &self.root
    }

    pub fn run(
        &self,
        operation: &str,
        args: &[&OsStr],
        input: Option<Vec<u8>>,
        limits: Limits,
        control: &Arc<OperationControl>,
    ) -> Result<GitOutput, GitError> {
        if control.cancelled.load(Ordering::Acquire) {
            return Err(GitError::new(
                "CANCELLED",
                operation,
                "Đã huỷ Git operation.",
            ));
        }
        let mut command = self.command(args, input.is_some());
        let (child, tree) =
            ProcessTree::spawn(&mut command).map_err(|error| GitError::io(operation, error))?;
        let mut managed = ManagedChild {
            child,
            tree: Arc::clone(&tree),
        };
        *control.tree.lock().map_err(|_| {
            GitError::new(
                "STATE_UNAVAILABLE",
                operation,
                "Không thể đăng ký Git process.",
            )
        })? = Some(tree);
        let stdout = managed
            .child
            .stdout
            .take()
            .ok_or_else(|| GitError::new("GIT_IO_ERROR", operation, "Thiếu stdout pipe."))?;
        let stderr = managed
            .child
            .stderr
            .take()
            .ok_or_else(|| GitError::new("GIT_IO_ERROR", operation, "Thiếu stderr pipe."))?;
        let out_control = Arc::clone(control);
        let out = thread::spawn(move || drain(stdout, limits, &out_control));
        let err_control = Arc::clone(control);
        let err = thread::spawn(move || drain(stderr, limits, &err_control));
        let stdin = managed.child.stdin.take();
        let writer = thread::spawn(move || -> std::io::Result<()> {
            if let (Some(mut stdin), Some(input)) = (stdin, input) {
                stdin.write_all(&input)?;
            }
            Ok(()) // Closing stdin also terminates any attempted terminal prompt.
        });
        let deadline = Instant::now() + limits.timeout;
        let mut stopped = None;
        let mut exit_code = None;
        loop {
            if control.cancelled.load(Ordering::Acquire) {
                stopped = Some("CANCELLED");
                break;
            }
            if control.output_limit.load(Ordering::Acquire) {
                stopped = Some("OUTPUT_LIMIT");
                break;
            }
            if Instant::now() >= deadline {
                stopped = Some("TIMEOUT");
                break;
            }
            match managed.child.try_wait() {
                Ok(Some(status)) => {
                    exit_code = status.code();
                    break;
                }
                Ok(None) => thread::sleep(Duration::from_millis(10)),
                Err(error) => {
                    stopped = Some("GIT_IO_ERROR");
                    let _ = error;
                    break;
                }
            }
        }
        // Kill descendants even when the parent exited successfully: a helper
        // holding a pipe open must not block reader joins forever.
        managed.tree.terminate();
        if stopped.is_some() {
            let _ = managed.child.kill();
        }
        let wait = managed.child.wait();
        if exit_code.is_none() {
            exit_code = wait.as_ref().ok().and_then(|status| status.code());
        }
        let stdout = out.join().map_err(|_| {
            GitError::new(
                "GIT_WORKER_FAILED",
                operation,
                "Git stdout reader panicked.",
            )
        })?;
        let stderr = err.join().map_err(|_| {
            GitError::new(
                "GIT_WORKER_FAILED",
                operation,
                "Git stderr reader panicked.",
            )
        })?;
        let written = writer.join().map_err(|_| {
            GitError::new("GIT_WORKER_FAILED", operation, "Git stdin writer panicked.")
        })?;
        if let Ok(mut tree) = control.tree.lock() {
            *tree = None;
        }
        if stopped.is_none() && control.output_limit.load(Ordering::Acquire) {
            stopped = Some("OUTPUT_LIMIT");
        }
        if let Some(code) = stopped {
            return Err(GitError::new(
                code,
                operation,
                format!("Git {operation}: {code}. Kiểm tra lại trạng thái trước khi thử lại."),
            ));
        }
        wait.map_err(|error| GitError::io(operation, error))?;
        let (stdout, out_truncated) = stdout.map_err(|error| GitError::io(operation, error))?;
        let (stderr, err_truncated) = stderr.map_err(|error| GitError::io(operation, error))?;
        // BrokenPipe is expected if Git rejects a request before reading stdin.
        if exit_code == Some(0) {
            written.map_err(|error| GitError::io(operation, error))?;
        }
        Ok(GitOutput {
            exit_code,
            stdout,
            stderr,
            truncated: out_truncated || err_truncated,
        })
    }

    pub fn read(
        &self,
        operation: &str,
        args: &[&str],
        control: &Arc<OperationControl>,
    ) -> Result<GitOutput, GitError> {
        let args = args.iter().map(OsStr::new).collect::<Vec<_>>();
        self.run(operation, &args, None, Limits::read(), control)
    }

    fn command(&self, args: &[&OsStr], piped_input: bool) -> Command {
        let mut command = Command::new(&self.executable);
        command
            .current_dir(&self.root)
            .args(["--no-pager", "--literal-pathspecs", "--no-optional-locks"])
            .args(args)
            .stdin(if piped_input {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        sanitize_environment(&mut command);
        command
    }
}

pub(super) fn sanitize_environment(command: &mut Command) {
    let overrides = command
        .get_envs()
        .map(|(key, _)| key.to_owned())
        .chain(std::env::vars_os().map(|(key, _)| key))
        .filter(|key| redirects_repository(key))
        .collect::<Vec<_>>();
    for key in overrides {
        command.env_remove(key);
    }
    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never");
}

fn redirects_repository(key: &OsStr) -> bool {
    let key = key.to_string_lossy().to_ascii_uppercase();
    key.starts_with("GIT_CONFIG")
        || matches!(
            key.as_str(),
            "GIT_DIR"
                | "GIT_WORK_TREE"
                | "GIT_INDEX_FILE"
                | "GIT_COMMON_DIR"
                | "GIT_OBJECT_DIRECTORY"
                | "GIT_ALTERNATE_OBJECT_DIRECTORIES"
                | "GIT_QUARANTINE_PATH"
                | "GIT_NAMESPACE"
                | "GIT_CEILING_DIRECTORIES"
                | "GIT_DISCOVERY_ACROSS_FILESYSTEM"
        )
}

struct ManagedChild {
    child: Child,
    tree: Arc<ProcessTree>,
}
impl Drop for ManagedChild {
    fn drop(&mut self) {
        self.tree.terminate();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn drain(
    mut stream: impl Read,
    limits: Limits,
    control: &OperationControl,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut captured = VecDeque::new();
    let mut buffer = [0; 8192];
    let mut truncated = false;
    loop {
        let count = match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        if captured.len() + count > limits.bytes {
            truncated = true;
            if limits.machine {
                control.output_limit.store(true, Ordering::Release);
                let room = limits.bytes.saturating_sub(captured.len());
                captured.extend(&buffer[..room.min(count)]);
                continue;
            }
            let discard = (captured.len() + count)
                .saturating_sub(limits.bytes)
                .min(captured.len());
            captured.drain(..discard);
        }
        let start = count.saturating_sub(limits.bytes);
        captured.extend(&buffer[start..count]);
    }
    Ok((captured.into(), truncated))
}

fn redact(message: &str) -> String {
    // Git often echoes remote URLs. Redact userinfo/query credentials before
    // diagnostics cross IPC; never log command environments or file contents.
    message
        .split_whitespace()
        .map(|word| {
            if let Some((scheme, rest)) = word.split_once("://") {
                let rest = rest.rsplit_once('@').map_or(rest, |(_, host)| host);
                let rest = rest.split(['?', '#']).next().unwrap_or("");
                format!("{scheme}://{rest}")
            } else if word.to_ascii_lowercase().contains("authorization")
                || word.to_ascii_lowercase().starts_with("token=")
            {
                "[redacted]".into()
            } else {
                word.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::io::Cursor;
    use std::path::Path;

    #[test]
    fn machine_output_limit_rejects_instead_of_parsing_partial_bytes() {
        let service = super::super::GitService::default();
        let lease = service
            .begin("window", "workspace", "fixture", false)
            .unwrap();
        let limits = Limits {
            timeout: Duration::from_secs(1),
            bytes: 4,
            machine: true,
        };
        let (bytes, truncated) = drain(Cursor::new(b"0123456789"), limits, &lease.control).unwrap();
        assert_eq!(bytes, b"0123");
        assert!(truncated && lease.control.output_limit.load(Ordering::Acquire));
    }

    #[test]
    fn mutation_diagnostics_keep_bounded_tail_and_continue_draining() {
        let service = super::super::GitService::default();
        let lease = service
            .begin("window", "workspace", "fixture", true)
            .unwrap();
        let limits = Limits {
            timeout: Duration::from_secs(1),
            bytes: 4,
            machine: false,
        };
        let (bytes, truncated) = drain(Cursor::new(b"0123456789"), limits, &lease.control).unwrap();
        assert_eq!(bytes, b"6789");
        assert!(truncated && !lease.control.output_limit.load(Ordering::Acquire));
    }

    #[test]
    fn environment_redirects_and_remote_credentials_are_not_exposed() {
        for key in [
            "GIT_DIR",
            "git_index_file",
            "GIT_CONFIG_KEY_1",
            "GIT_NAMESPACE",
        ] {
            assert!(redirects_repository(OsStr::new(key)));
        }
        assert!(!redirects_repository(OsStr::new("PATH")));
        assert!(!redirects_repository(OsStr::new("SSH_AUTH_SOCK")));
        let diagnostic = redact("fatal https://user:secret@example.com/repo?token=hidden rejected");
        assert!(!diagnostic.contains("secret") && !diagnostic.contains("hidden"));
        assert!(diagnostic.contains("example.com/repo"));
    }

    #[test]
    fn commands_keep_paths_in_literal_argument_vector() {
        let runner = GitRunner::new(PathBuf::from("git"), PathBuf::from("repo"));
        let command = runner.command(
            &[
                OsStr::new("add"),
                OsStr::new("--"),
                OsStr::new("-file [1].txt"),
            ],
            false,
        );
        let args = command.get_args().map(OsString::from).collect::<Vec<_>>();
        assert_eq!(args.last().unwrap(), "-file [1].txt");
        assert_eq!(args[1], "--literal-pathspecs");
        assert_eq!(command.get_current_dir(), Some(Path::new("repo")));
    }
}
