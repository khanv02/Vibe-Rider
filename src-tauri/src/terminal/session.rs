use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};

use portable_pty::{
    native_pty_system, ChildKiller, CommandBuilder, ExitStatus, MasterPty, PtySize,
};
use tauri::ipc::Channel;

use super::shell::ResolvedShell;
use super::{TerminalError, TerminalEvent, TerminalSession};

pub(crate) const MAX_IN_FLIGHT_BYTES: usize = 512 * 1024;
pub(crate) const MAX_INPUT_BYTES: usize = 16 * 1024;
const READ_CHUNK_BYTES: usize = 16 * 1024;

pub(crate) struct RunningSession {
    descriptor: TerminalSession,
    owner_label: String,
    master: Option<Arc<Mutex<Box<dyn MasterPty + Send>>>>,
    writer: Option<Arc<Mutex<Box<dyn Write + Send>>>>,
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    lifecycle: Arc<Mutex<Lifecycle>>,
    output_flow: Arc<OutputFlow>,
    output_gate: Arc<(Mutex<bool>, Condvar)>,
    exit_signal: Arc<ExitSignal>,
    reader_thread: Option<JoinHandle<()>>,
    waiter_thread: Option<JoinHandle<()>>,
    closed: bool,
}

pub(crate) struct SessionIo {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    lifecycle: Arc<Mutex<Lifecycle>>,
    output_flow: Arc<OutputFlow>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LifecycleState {
    Starting,
    Running,
    Closing,
    Exited,
}

struct Lifecycle {
    state: LifecycleState,
    close_requested: bool,
}

#[derive(Clone, Debug)]
struct ExitInfo {
    code: Option<i32>,
    reason: String,
}

struct ExitSignal {
    value: Mutex<Option<ExitInfo>>,
    wake: Condvar,
}

impl ExitSignal {
    fn new() -> Self {
        Self {
            value: Mutex::new(None),
            wake: Condvar::new(),
        }
    }

    fn set(&self, value: ExitInfo) {
        if let Ok(mut status) = self.value.lock() {
            *status = Some(value);
            self.wake.notify_all();
        }
    }

    fn wait(&self) -> ExitInfo {
        let mut status = self.value.lock().expect("exit signal lock poisoned");
        loop {
            if let Some(value) = status.clone() {
                return value;
            }
            status = self.wake.wait(status).expect("exit signal lock poisoned");
        }
    }
}

struct OutputFlow {
    state: Mutex<OutputFlowState>,
    wake: Condvar,
}

struct OutputFlowState {
    next_sequence: u64,
    last_ack: u64,
    in_flight_bytes: usize,
    pending: BTreeMap<u64, usize>,
    closed: bool,
}

impl OutputFlow {
    fn new() -> Self {
        Self {
            state: Mutex::new(OutputFlowState {
                next_sequence: 0,
                last_ack: 0,
                in_flight_bytes: 0,
                pending: BTreeMap::new(),
                closed: false,
            }),
            wake: Condvar::new(),
        }
    }

    fn reserve(&self, bytes: usize) -> Result<u64, ()> {
        let mut state = self.state.lock().map_err(|_| ())?;
        while !state.closed && state.in_flight_bytes.saturating_add(bytes) > MAX_IN_FLIGHT_BYTES {
            state = self.wake.wait(state).map_err(|_| ())?;
        }

        if state.closed {
            return Err(());
        }

        state.next_sequence = state.next_sequence.saturating_add(1);
        let sequence = state.next_sequence;
        state.pending.insert(sequence, bytes);
        state.in_flight_bytes = state.in_flight_bytes.saturating_add(bytes);
        Ok(sequence)
    }

    fn ack(&self, sequence: u64) -> Result<(), TerminalError> {
        let mut state = self.state.lock().map_err(|_| {
            TerminalError::new("STATE_UNAVAILABLE", "Output flow state không khả dụng.")
        })?;

        if sequence > state.next_sequence {
            return Err(TerminalError::new(
                "INVALID_ACK",
                "ACK vượt quá output sequence đã gửi.",
            ));
        }

        if sequence <= state.last_ack {
            return Ok(());
        }

        let pending_sequences: Vec<u64> = state
            .pending
            .range(..=sequence)
            .map(|(sequence, _)| *sequence)
            .collect();
        for pending_sequence in pending_sequences {
            if let Some(bytes) = state.pending.remove(&pending_sequence) {
                state.in_flight_bytes = state.in_flight_bytes.saturating_sub(bytes);
            }
        }
        state.last_ack = sequence;
        self.wake.notify_all();
        Ok(())
    }

    fn abort(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.closed = true;
            state.pending.clear();
            state.in_flight_bytes = 0;
            self.wake.notify_all();
        }
    }

    #[cfg(test)]
    fn in_flight_bytes(&self) -> usize {
        self.state
            .lock()
            .expect("output flow lock poisoned")
            .in_flight_bytes
    }
}

impl RunningSession {
    pub fn spawn(
        session_id: String,
        workspace_id: String,
        owner_label: String,
        workspace_root: &Path,
        shell: ResolvedShell,
        size: PtySize,
        channel: Channel<TerminalEvent>,
    ) -> Result<Self, TerminalError> {
        let pair = native_pty_system().openpty(size).map_err(|error| {
            TerminalError::new("PTY_UNAVAILABLE", format!("Không thể tạo PTY: {error}"))
        })?;

        let mut reader = pair.master.try_clone_reader().map_err(|error| {
            TerminalError::new(
                "PTY_UNAVAILABLE",
                format!("Không thể mở PTY output: {error}"),
            )
        })?;
        let writer = pair.master.take_writer().map_err(|error| {
            TerminalError::new(
                "PTY_UNAVAILABLE",
                format!("Không thể mở PTY input: {error}"),
            )
        })?;

        let command = shell_command(&shell, workspace_root);
        let mut child = pair.slave.spawn_command(command).map_err(|error| {
            TerminalError::new(
                "SPAWN_FAILED",
                format!("Không thể khởi động PowerShell: {error}"),
            )
        })?;
        let pid = child.process_id();
        let killer = child.clone_killer();
        drop(pair.slave);

        let lifecycle = Arc::new(Mutex::new(Lifecycle {
            state: LifecycleState::Starting,
            close_requested: false,
        }));
        let output_flow = Arc::new(OutputFlow::new());
        let output_gate = Arc::new((Mutex::new(false), Condvar::new()));
        let exit_signal = Arc::new(ExitSignal::new());

        let waiter_lifecycle = Arc::clone(&lifecycle);
        let waiter_exit_signal = Arc::clone(&exit_signal);
        let waiter_thread = thread::spawn(move || {
            let result = child.wait();
            let close_requested = waiter_lifecycle
                .lock()
                .map(|lifecycle| lifecycle.close_requested)
                .unwrap_or(true);
            let info = match result {
                Ok(status) => exit_info(status, close_requested),
                Err(error) => ExitInfo {
                    code: None,
                    reason: format!("wait_error: {error}"),
                },
            };
            waiter_exit_signal.set(info);
        });

        let reader_session_id = session_id.clone();
        let reader_workspace_id = workspace_id.clone();
        let reader_channel = channel.clone();
        let reader_flow = Arc::clone(&output_flow);
        let reader_gate = Arc::clone(&output_gate);
        let reader_exit_signal = Arc::clone(&exit_signal);
        let reader_lifecycle = Arc::clone(&lifecycle);
        let reader_killer = Arc::new(Mutex::new(killer));
        let reader_killer_for_thread = Arc::clone(&reader_killer);
        let reader_thread = match thread::Builder::new()
            .name(format!("terminal-{session_id}-reader"))
            .spawn(move || {
                wait_for_output_gate(&reader_gate);
                read_output(
                    &mut reader,
                    &reader_session_id,
                    &reader_workspace_id,
                    &reader_channel,
                    &reader_flow,
                    &reader_killer_for_thread,
                );
                let exit = reader_exit_signal.wait();
                if let Ok(mut lifecycle) = reader_lifecycle.lock() {
                    lifecycle.state = LifecycleState::Exited;
                }
                let _ = reader_channel.send(TerminalEvent::Exited {
                    session_id: reader_session_id,
                    workspace_id: reader_workspace_id,
                    exit_code: exit.code,
                    reason: exit.reason,
                });
            }) {
            Ok(handle) => handle,
            Err(error) => {
                output_flow.abort();
                let mut killer = reader_killer.lock().map_err(|_| {
                    TerminalError::new("SPAWN_FAILED", "Không thể kết thúc process waiter.")
                })?;
                let _ = killer.kill();
                let _ = waiter_thread.join();
                return Err(TerminalError::new(
                    "SPAWN_FAILED",
                    format!("Không thể khởi động PTY reader: {error}"),
                ));
            }
        };

        Ok(Self {
            descriptor: TerminalSession {
                session_id,
                workspace_id,
                shell: shell.kind,
                pid,
                state: TerminalSessionState::Running,
            },
            owner_label,
            master: Some(Arc::new(Mutex::new(pair.master))),
            writer: Some(Arc::new(Mutex::new(writer))),
            killer: reader_killer,
            lifecycle,
            output_flow,
            output_gate,
            exit_signal,
            reader_thread: Some(reader_thread),
            waiter_thread: Some(waiter_thread),
            closed: false,
        })
    }

    pub fn descriptor(&self) -> TerminalSession {
        self.descriptor.clone()
    }

    pub fn session_id(&self) -> &str {
        &self.descriptor.session_id
    }

    pub fn owner_label(&self) -> &str {
        &self.owner_label
    }

    pub(crate) fn io_handles(&self) -> Result<SessionIo, TerminalError> {
        Ok(SessionIo {
            writer: self
                .writer
                .as_ref()
                .ok_or_else(|| {
                    TerminalError::new("WRITE_FAILED", "PTY writer không còn khả dụng.")
                })?
                .clone(),
            master: self
                .master
                .as_ref()
                .ok_or_else(|| {
                    TerminalError::new("RESIZE_FAILED", "PTY master không còn khả dụng.")
                })?
                .clone(),
            lifecycle: Arc::clone(&self.lifecycle),
            output_flow: Arc::clone(&self.output_flow),
        })
    }

    pub fn is_exited(&self) -> bool {
        self.lifecycle
            .lock()
            .map(|lifecycle| lifecycle.state == LifecycleState::Exited)
            .unwrap_or(true)
    }

    pub fn start_output(&self) {
        if let Ok(mut lifecycle) = self.lifecycle.lock() {
            if lifecycle.state == LifecycleState::Starting {
                lifecycle.state = LifecycleState::Running;
            }
        }
        let (gate, wake) = &*self.output_gate;
        if let Ok(mut started) = gate.lock() {
            *started = true;
            wake.notify_all();
        }
    }

    pub fn close(mut self) -> Result<(), TerminalError> {
        self.cleanup()
    }
}

impl SessionIo {
    pub(crate) fn write_input(&self, data: &[u8]) -> Result<(), TerminalError> {
        if data.is_empty() {
            return Ok(());
        }
        if data.len() > MAX_INPUT_BYTES {
            return Err(TerminalError::new(
                "INVALID_INPUT",
                format!("Input tối đa là {MAX_INPUT_BYTES} bytes mỗi lần gửi."),
            ));
        }
        ensure_running_state(&self.lifecycle)?;
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| TerminalError::new("WRITE_FAILED", "PTY writer không khả dụng."))?;
        writer
            .write_all(data)
            .and_then(|_| writer.flush())
            .map_err(|error| {
                TerminalError::new("WRITE_FAILED", format!("Không thể ghi vào PTY: {error}"))
            })
    }

    pub(crate) fn resize(&self, size: PtySize) -> Result<(), TerminalError> {
        ensure_running_state(&self.lifecycle)?;
        let master = self
            .master
            .lock()
            .map_err(|_| TerminalError::new("RESIZE_FAILED", "PTY master không khả dụng."))?;
        master.resize(size).map_err(|error| {
            TerminalError::new("RESIZE_FAILED", format!("Không thể resize PTY: {error}"))
        })
    }

    pub(crate) fn acknowledge(&self, sequence: u64) -> Result<(), TerminalError> {
        self.output_flow.ack(sequence)
    }
}

fn ensure_running_state(lifecycle_state: &Arc<Mutex<Lifecycle>>) -> Result<(), TerminalError> {
    let lifecycle = lifecycle_state
        .lock()
        .map_err(|_| TerminalError::new("STATE_UNAVAILABLE", "Terminal state không khả dụng."))?;
    if lifecycle.state != LifecycleState::Running {
        return Err(TerminalError::new(
            "SESSION_CLOSED",
            "Terminal không còn ở trạng thái running.",
        ));
    }
    Ok(())
}

impl RunningSession {
    fn cleanup(&mut self) -> Result<(), TerminalError> {
        if self.closed {
            return Ok(());
        }
        self.closed = true;
        if let Ok(mut lifecycle) = self.lifecycle.lock() {
            lifecycle.state = LifecycleState::Closing;
            lifecycle.close_requested = true;
        }
        self.output_flow.abort();
        let (gate, wake) = &*self.output_gate;
        if let Ok(mut started) = gate.lock() {
            *started = true;
            wake.notify_all();
        }

        let kill_result = self
            .killer
            .lock()
            .map_err(|_| "PTY killer lock poisoned".to_owned())
            .and_then(|mut killer| killer.kill().map_err(|error| error.to_string()));

        let waiter_result = self
            .waiter_thread
            .take()
            .map(|thread| {
                thread
                    .join()
                    .map_err(|_| "process waiter panicked".to_owned())
            })
            .transpose();

        self.writer.take();
        self.master.take();

        let reader_result = self
            .reader_thread
            .take()
            .map(|thread| thread.join().map_err(|_| "PTY reader panicked".to_owned()))
            .transpose();

        if let Some(error) = waiter_result.err().or_else(|| reader_result.err()) {
            return Err(TerminalError::new("CLOSE_FAILED", error));
        }
        if let Err(error) = kill_result {
            if self
                .exit_signal
                .value
                .lock()
                .ok()
                .and_then(|status| status.clone())
                .is_none()
            {
                return Err(TerminalError::new(
                    "CLOSE_FAILED",
                    format!("Không thể kết thúc PowerShell: {error}"),
                ));
            }
        }
        Ok(())
    }
}

impl Drop for RunningSession {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

fn wait_for_output_gate(gate: &Arc<(Mutex<bool>, Condvar)>) {
    let (started, wake) = &**gate;
    let mut is_started = started.lock().expect("output gate lock poisoned");
    while !*is_started {
        is_started = wake.wait(is_started).expect("output gate lock poisoned");
    }
}

fn read_output(
    reader: &mut dyn Read,
    session_id: &str,
    workspace_id: &str,
    channel: &Channel<TerminalEvent>,
    flow: &OutputFlow,
    killer: &Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
) {
    let mut buffer = [0_u8; READ_CHUNK_BYTES];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(bytes_read) => {
                let sequence = match flow.reserve(bytes_read) {
                    Ok(sequence) => sequence,
                    Err(()) => break,
                };
                let event = TerminalEvent::Data {
                    session_id: session_id.to_owned(),
                    workspace_id: workspace_id.to_owned(),
                    sequence,
                    data: buffer[..bytes_read].to_vec(),
                };
                if channel.send(event).is_err() {
                    flow.abort();
                    if let Ok(mut killer) = killer.lock() {
                        let _ = killer.kill();
                    }
                    break;
                }
            }
            Err(error) => {
                flow.abort();
                let _ = channel.send(TerminalEvent::Error {
                    session_id: session_id.to_owned(),
                    workspace_id: workspace_id.to_owned(),
                    code: "STREAM_FAILED".to_owned(),
                    message: format!("PTY reader error: {error}"),
                });
                if let Ok(mut killer) = killer.lock() {
                    let _ = killer.kill();
                }
                break;
            }
        }
    }
}

fn exit_info(status: ExitStatus, close_requested: bool) -> ExitInfo {
    ExitInfo {
        code: Some(status.exit_code() as i32),
        reason: if close_requested {
            "closed".to_owned()
        } else if status.success() {
            "exited".to_owned()
        } else if let Some(signal) = status.signal() {
            format!("signal:{signal}")
        } else {
            "exited".to_owned()
        },
    }
}

fn shell_command(shell: &ResolvedShell, workspace_root: &Path) -> CommandBuilder {
    let mut command = CommandBuilder::new(&shell.executable);
    command.arg("-NoLogo");
    command.arg("-NoProfile");
    command.cwd(workspace_root);
    command
}

#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum TerminalSessionState {
    Running,
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use portable_pty::PtySize;

    use super::{shell_command, OutputFlow, RunningSession, MAX_IN_FLIGHT_BYTES};
    use crate::terminal::shell::{ResolvedShell, ShellKind};

    #[test]
    fn shell_command_uses_the_workspace_as_its_cwd() {
        let root = PathBuf::from(r"C:\workspace with spaces\unicode-việt");
        let shell = ResolvedShell {
            kind: ShellKind::Powershell,
            executable: PathBuf::from("powershell.exe"),
        };

        let command = shell_command(&shell, &root);
        assert_eq!(command.get_cwd().map(PathBuf::from), Some(root));
    }

    #[test]
    fn output_ack_releases_bounded_credit() {
        let flow = OutputFlow::new();
        let first = flow.reserve(MAX_IN_FLIGHT_BYTES / 2).expect("first chunk");
        let second = flow.reserve(MAX_IN_FLIGHT_BYTES / 2).expect("second chunk");
        assert_eq!(flow.in_flight_bytes(), MAX_IN_FLIGHT_BYTES);
        assert!(flow.ack(first).is_ok());
        assert!(flow.in_flight_bytes() < MAX_IN_FLIGHT_BYTES);
        assert!(flow.ack(second).is_ok());
        assert_eq!(flow.in_flight_bytes(), 0);
    }

    #[cfg(windows)]
    #[test]
    fn native_powershell_pty_round_trips_input_and_output() {
        use std::sync::{Arc, Mutex};
        use std::time::{Duration, Instant};
        use tauri::ipc::{Channel, InvokeResponseBody};

        use crate::terminal::shell::resolve_powershell;
        use crate::terminal::TerminalEvent;

        let shell = resolve_powershell().expect("PowerShell is required on Windows");
        let root = std::env::current_dir().expect("test working directory");
        let events = Arc::new(Mutex::new(Vec::<TerminalEvent>::new()));
        let events_for_channel = Arc::clone(&events);
        let channel: Channel<TerminalEvent> = Channel::new(move |body: InvokeResponseBody| {
            if let InvokeResponseBody::Json(json) = body {
                if let Ok(event) = serde_json::from_str::<TerminalEvent>(&json) {
                    events_for_channel.lock().expect("event lock").push(event);
                }
            }
            Ok(())
        });
        let session = RunningSession::spawn(
            "terminal-test".to_owned(),
            "workspace-test".to_owned(),
            "main".to_owned(),
            &root,
            shell,
            PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            },
            channel,
        )
        .expect("native PTY should spawn");

        assert!(session.descriptor().pid.is_some());
        session.start_output();
        let io = session
            .io_handles()
            .expect("native PTY handles should exist");
        io.write_input(b"\x1b[1;1R")
            .expect("native PTY should accept terminal response");
        io.write_input(b"Write-Output __VIBE_RIDER_TERMINAL_TEST__\r")
            .expect("native PTY should accept input");
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut saw_marker = false;
        while Instant::now() < deadline {
            let output = events
                .lock()
                .expect("event lock")
                .iter()
                .filter_map(|event| match event {
                    TerminalEvent::Data { data, .. } => {
                        Some(String::from_utf8_lossy(data).to_string())
                    }
                    _ => None,
                })
                .collect::<String>();
            if output.contains("__VIBE_RIDER_TERMINAL_TEST__") {
                saw_marker = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(saw_marker, "PTY output should contain the command marker");
        session.close().expect("native PTY should close");
    }
}
