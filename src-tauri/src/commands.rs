use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

#[cfg(windows)]
use crate::git::windows::ProcessTree;
use crate::path_guard::resolve_directory;
use crate::workspace::{WorkspaceCommandLease, WorkspaceError, WorkspaceState};

#[cfg(not(windows))]
struct ProcessTree;

#[cfg(not(windows))]
impl ProcessTree {
    fn spawn(command: &mut Command) -> std::io::Result<(std::process::Child, Arc<Self>)> {
        command.spawn().map(|child| (child, Arc::new(Self)))
    }

    fn terminate(&self) {}
}

const DEFAULT_TIMEOUT_MS: u64 = 120_000;
const MAX_TIMEOUT_MS: u64 = 10 * 60 * 1000;
const MAX_OUTPUT_BYTES: usize = 1024 * 1024;

#[derive(Clone, Default)]
pub struct CommandService {
    inner: Arc<CommandInner>,
}

#[derive(Default)]
struct CommandInner {
    next_id: AtomicU64,
    proposals: Mutex<HashMap<String, CommandRecord>>,
    runs: Mutex<HashMap<String, Arc<CommandControl>>>,
    shutting_down: AtomicBool,
}

struct CommandRecord {
    proposal: CommandProposal,
    owner: String,
}

struct CommandControl {
    cancelled: AtomicBool,
    output_limit: AtomicBool,
    owner: String,
    workspace_id: String,
    tree: Mutex<Option<Arc<ProcessTree>>>,
}

impl CommandControl {
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        if let Ok(tree) = self.tree.lock() {
            if let Some(tree) = tree.as_ref() {
                tree.terminate();
            }
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandProposalRequest {
    pub workspace_id: String,
    pub executable: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub timeout_ms: Option<u64>,
    pub source: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandRunRequest {
    pub workspace_id: String,
    pub proposal_id: String,
    pub run_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandCancelRequest {
    pub workspace_id: String,
    pub run_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandProposal {
    pub proposal_id: String,
    pub workspace_id: String,
    pub executable: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub timeout_ms: u64,
    pub source: Option<String>,
    pub state: CommandState,
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CommandState {
    Pending,
    Running,
    Finished,
    Cancelled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRunResult {
    pub run_id: String,
    pub proposal_id: String,
    pub outcome: CommandOutcome,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CommandOutcome {
    Success,
    Failed,
    Cancelled,
    TimedOut,
    OutputLimit,
    SpawnFailed,
}

#[tauri::command]
pub fn command_propose(
    state: State<'_, WorkspaceState>,
    service: State<'_, CommandService>,
    window: WebviewWindow,
    request: CommandProposalRequest,
) -> Result<CommandProposal, WorkspaceError> {
    let workspace = active_workspace(&state, &request.workspace_id)?;
    validate_command(&request.executable, &request.args)?;
    let cwd = request.cwd.clone().unwrap_or_default();
    resolve_directory(&workspace.root, &cwd)?;
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(1_000, MAX_TIMEOUT_MS);
    let now = unix_ms();
    let proposal_id = format!(
        "command-{}-{}",
        now,
        service
            .inner
            .next_id
            .fetch_add(1, Ordering::Relaxed)
            .saturating_add(1)
    );
    let proposal = CommandProposal {
        proposal_id: proposal_id.clone(),
        workspace_id: request.workspace_id,
        executable: request.executable,
        args: request.args,
        cwd,
        timeout_ms,
        source: request.source,
        state: CommandState::Pending,
        created_at: now,
    };
    let mut proposals =
        service.inner.proposals.lock().map_err(|_| {
            WorkspaceError::new("STATE_UNAVAILABLE", "Không thể lưu command proposal.")
        })?;
    proposals.insert(
        proposal_id,
        CommandRecord {
            proposal: proposal.clone(),
            owner: window.label().to_owned(),
        },
    );
    Ok(proposal)
}

#[tauri::command]
pub async fn command_run(
    state: State<'_, WorkspaceState>,
    service: State<'_, CommandService>,
    window: WebviewWindow,
    request: CommandRunRequest,
) -> Result<CommandRunResult, WorkspaceError> {
    let proposal = {
        let mut proposals = service.inner.proposals.lock().map_err(|_| {
            WorkspaceError::new("STATE_UNAVAILABLE", "Không thể đọc command proposal.")
        })?;
        let record = proposals.get_mut(&request.proposal_id).ok_or_else(|| {
            WorkspaceError::new("COMMAND_NOT_FOUND", "Command proposal không còn tồn tại.")
        })?;
        if record.owner != window.label() || record.proposal.workspace_id != request.workspace_id {
            return Err(WorkspaceError::new(
                "COMMAND_OWNER_MISMATCH",
                "Command không thuộc workspace/window hiện tại.",
            ));
        }
        if record.proposal.state != CommandState::Pending {
            return Err(WorkspaceError::new(
                "COMMAND_NOT_PENDING",
                "Command không còn ở trạng thái chờ chạy.",
            ));
        }
        record.proposal.state = CommandState::Running;
        record.proposal.clone()
    };

    let lease = match state.begin_command(&request.workspace_id) {
        Ok(lease) => lease,
        Err(error) => {
            if let Ok(mut proposals) = service.inner.proposals.lock() {
                if let Some(record) = proposals.get_mut(&request.proposal_id) {
                    record.proposal.state = CommandState::Pending;
                }
            }
            return Err(error);
        }
    };
    let control = Arc::new(CommandControl {
        cancelled: AtomicBool::new(false),
        output_limit: AtomicBool::new(false),
        owner: window.label().to_owned(),
        workspace_id: request.workspace_id.clone(),
        tree: Mutex::new(None),
    });
    let run_id = request.run_id.unwrap_or_else(|| {
        format!(
            "run-{}-{}",
            unix_ms(),
            service
                .inner
                .next_id
                .fetch_add(1, Ordering::Relaxed)
                .saturating_add(1)
        )
    });
    service
        .inner
        .runs
        .lock()
        .map_err(|_| WorkspaceError::new("STATE_UNAVAILABLE", "Không thể đăng ký command run."))?
        .insert(run_id.clone(), Arc::clone(&control));

    let root = lease.snapshot.root.clone();
    let service_inner = Arc::clone(&service.inner);
    let run_id_for_worker = run_id.clone();
    let proposal_for_worker = proposal.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_command(run_id_for_worker, proposal_for_worker, root, control, lease)
    })
    .await
    .map_err(|error| {
        WorkspaceError::new(
            "COMMAND_WORKER_FAILED",
            format!("Command worker failed: {error}"),
        )
    })?;

    service_inner
        .runs
        .lock()
        .map_err(|_| WorkspaceError::new("STATE_UNAVAILABLE", "Không thể dọn command run."))?
        .remove(&run_id);
    if let Ok(mut proposals) = service_inner.proposals.lock() {
        if let Some(record) = proposals.get_mut(&request.proposal_id) {
            record.proposal.state = match &result.outcome {
                CommandOutcome::Cancelled => CommandState::Cancelled,
                _ => CommandState::Finished,
            };
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn command_cancel(
    service: State<'_, CommandService>,
    window: WebviewWindow,
    request: CommandCancelRequest,
) -> Result<bool, WorkspaceError> {
    let runs = service
        .inner
        .runs
        .lock()
        .map_err(|_| WorkspaceError::new("STATE_UNAVAILABLE", "Không thể đọc command run."))?;
    let Some(control) = runs.get(&request.run_id) else {
        return Ok(false);
    };
    if control.owner != window.label() || control.workspace_id != request.workspace_id {
        return Err(WorkspaceError::new(
            "COMMAND_OWNER_MISMATCH",
            "Command không thuộc workspace/window hiện tại.",
        ));
    }
    control.cancel();
    Ok(true)
}

impl CommandService {
    pub(crate) fn close_all_for_shutdown(&self) {
        self.inner.shutting_down.store(true, Ordering::Release);
        if let Ok(runs) = self.inner.runs.lock() {
            for control in runs.values() {
                control.cancel();
            }
        }
        if let Ok(mut proposals) = self.inner.proposals.lock() {
            proposals.clear();
        }
    }
}

fn run_command(
    run_id: String,
    proposal: CommandProposal,
    root: PathBuf,
    control: Arc<CommandControl>,
    _lease: WorkspaceCommandLease,
) -> CommandRunResult {
    let started = Instant::now();
    let cwd = match resolve_directory(&root, &proposal.cwd) {
        Ok(path) => path,
        Err(error) => {
            return failed_result(
                run_id,
                &proposal,
                error.message,
                started,
                CommandOutcome::SpawnFailed,
            )
        }
    };
    let mut command = Command::new(&proposal.executable);
    command
        .args(&proposal.args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let (mut child, tree) = match ProcessTree::spawn(&mut command) {
        Ok(value) => value,
        Err(error) => {
            return failed_result(
                run_id,
                &proposal,
                redact(&error.to_string()),
                started,
                CommandOutcome::SpawnFailed,
            )
        }
    };
    if let Ok(mut current) = control.tree.lock() {
        *current = Some(Arc::clone(&tree));
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let output_control = Arc::clone(&control);
    let out = thread::spawn(move || drain(stdout, &output_control));
    let error_control = Arc::clone(&control);
    let err = thread::spawn(move || drain(stderr, &error_control));
    let deadline = Instant::now() + Duration::from_millis(proposal.timeout_ms);
    let mut timed_out = false;
    let mut stopped = false;
    let mut exit_code = None;
    loop {
        if control.cancelled.load(Ordering::Acquire) {
            stopped = true;
            break;
        }
        if control.output_limit.load(Ordering::Acquire) {
            stopped = true;
            break;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            stopped = true;
            break;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                exit_code = status.code();
                break;
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                stopped = true;
                break;
            }
        }
    }
    tree.terminate();
    if stopped {
        let _ = child.kill();
    }
    if exit_code.is_none() {
        exit_code = child.wait().ok().and_then(|status| status.code());
    }
    let stdout = out.join().unwrap_or_default();
    let stderr = err.join().unwrap_or_default();
    if let Ok(mut current) = control.tree.lock() {
        *current = None;
    }
    let outcome = if control.cancelled.load(Ordering::Acquire) {
        CommandOutcome::Cancelled
    } else if control.output_limit.load(Ordering::Acquire) {
        CommandOutcome::OutputLimit
    } else if timed_out {
        CommandOutcome::TimedOut
    } else if exit_code == Some(0) {
        CommandOutcome::Success
    } else {
        CommandOutcome::Failed
    };
    CommandRunResult {
        run_id,
        proposal_id: proposal.proposal_id,
        outcome,
        exit_code,
        stdout: redact(&String::from_utf8_lossy(&stdout)),
        stderr: redact(&String::from_utf8_lossy(&stderr)),
        truncated: control.output_limit.load(Ordering::Acquire),
        duration_ms: started.elapsed().as_millis() as u64,
    }
}

fn drain<R: Read>(reader: Option<R>, control: &CommandControl) -> Vec<u8> {
    let Some(mut reader) = reader else {
        return Vec::new();
    };
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(size) => {
                if output.len().saturating_add(size) > MAX_OUTPUT_BYTES {
                    let remaining = MAX_OUTPUT_BYTES.saturating_sub(output.len());
                    output.extend_from_slice(&buffer[..remaining]);
                    control.output_limit.store(true, Ordering::Release);
                    break;
                }
                output.extend_from_slice(&buffer[..size]);
            }
            Err(_) => break,
        }
    }
    output
}

fn validate_command(executable: &str, args: &[String]) -> Result<(), WorkspaceError> {
    if args.len() > 64 || args.iter().map(String::len).sum::<usize>() > 16 * 1024 {
        return Err(WorkspaceError::new(
            "COMMAND_TOO_LARGE",
            "Command có quá nhiều arguments hoặc vượt quá 16 KiB.",
        ));
    }
    if args.iter().any(|arg| arg.contains('\0')) {
        return Err(WorkspaceError::new(
            "INVALID_COMMAND",
            "Argument không được chứa NUL.",
        ));
    }
    let name = executable
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(executable)
        .to_ascii_lowercase();
    match name.as_str() {
        "npm" | "npm.cmd" => {
            if args.first().map(String::as_str) != Some("run")
                || !matches!(args.get(1).map(String::as_str), Some("test" | "build"))
                || args.len() != 2
            {
                return Err(WorkspaceError::new(
                    "COMMAND_NOT_ALLOWED",
                    "Chỉ cho phép npm run test/build trong verification workflow.",
                ));
            }
        }
        "cargo" | "cargo.exe" => {
            if !matches!(args.first().map(String::as_str), Some("check" | "test")) {
                return Err(WorkspaceError::new(
                    "COMMAND_NOT_ALLOWED",
                    "Chỉ cho phép cargo check/test trong verification workflow.",
                ));
            }
            for (index, arg) in args.iter().enumerate() {
                if arg == "--config" || arg.starts_with("--config=") {
                    return Err(WorkspaceError::new(
                        "COMMAND_NOT_ALLOWED",
                        "cargo config không được phép trong verification workflow.",
                    ));
                }
                if arg == "--manifest-path"
                    && args.get(index + 1).map(String::as_str) != Some("Cargo.toml")
                {
                    return Err(WorkspaceError::new(
                        "COMMAND_NOT_ALLOWED",
                        "cargo manifest phải là Cargo.toml trong cwd đã duyệt.",
                    ));
                }
                if let Some(value) = arg.strip_prefix("--manifest-path=") {
                    if value != "Cargo.toml" {
                        return Err(WorkspaceError::new(
                            "COMMAND_NOT_ALLOWED",
                            "cargo manifest phải là Cargo.toml trong cwd đã duyệt.",
                        ));
                    }
                }
                if (arg.starts_with('/')
                    || arg.contains(':')
                    || arg.contains('\\')
                    || arg.contains(".."))
                    && arg != "Cargo.toml"
                {
                    return Err(WorkspaceError::new(
                        "COMMAND_NOT_ALLOWED",
                        "Argument path phải nằm trong cwd đã duyệt.",
                    ));
                }
            }
        }
        _ => {
            return Err(WorkspaceError::new(
                "COMMAND_NOT_ALLOWED",
                "Executable không nằm trong allowlist verification.",
            ))
        }
    }
    if executable.contains(':') || executable.contains('"') {
        return Err(WorkspaceError::new(
            "INVALID_COMMAND",
            "Executable không hợp lệ.",
        ));
    }
    Ok(())
}

fn active_workspace(
    state: &WorkspaceState,
    workspace_id: &str,
) -> Result<crate::workspace::WorkspaceSnapshot, WorkspaceError> {
    let snapshot = state
        .active_snapshot()?
        .ok_or_else(|| WorkspaceError::new("NO_WORKSPACE", "Hãy mở workspace trước."))?;
    if snapshot.id != workspace_id {
        return Err(WorkspaceError::new(
            "STALE_WORKSPACE",
            "Workspace đã thay đổi.",
        ));
    }
    Ok(snapshot)
}

fn failed_result(
    run_id: String,
    proposal: &CommandProposal,
    message: String,
    started: Instant,
    outcome: CommandOutcome,
) -> CommandRunResult {
    CommandRunResult {
        run_id,
        proposal_id: proposal.proposal_id.clone(),
        outcome,
        exit_code: None,
        stdout: String::new(),
        stderr: message,
        truncated: false,
        duration_ms: started.elapsed().as_millis() as u64,
    }
}

fn redact(value: &str) -> String {
    value
        .lines()
        .map(|line| {
            if line.contains("TOKEN=") || line.contains("API_KEY=") || line.contains("SECRET=") {
                "[redacted]"
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(not(windows))]
mod platform {
    // Kept empty deliberately: the production target uses the Windows Job
    // Object implementation shared with Git. Cargo still type-checks the
    // command service on non-Windows hosts through git's fallback type.
}

#[cfg(test)]
mod tests {
    use super::validate_command;

    #[test]
    fn allowlist_only_accepts_verification_commands() {
        assert!(validate_command("npm.cmd", &["run".into(), "test".into()]).is_ok());
        assert!(validate_command("cargo", &["check".into()]).is_ok());
        assert!(validate_command("powershell", &["-Command".into(), "dir".into()]).is_err());
        assert!(validate_command("npm", &["run".into(), "dev".into()]).is_err());
        assert!(validate_command(
            "cargo",
            &[
                "check".into(),
                "--manifest-path".into(),
                "..\\Cargo.toml".into()
            ]
        )
        .is_err());
    }
}
