mod session;
mod shell;

use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};

use portable_pty::PtySize;
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle, Manager, WebviewWindow};

use self::session::{RunningSession, SessionIo, TerminalSessionState};
use self::shell::{resolve_powershell, ShellKind};
use crate::workspace::{WorkspaceSnapshot, WorkspaceState};

const MIN_TERMINAL_DIMENSION: u16 = 1;
const MAX_TERMINAL_DIMENSION: u16 = 1_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSpawnRequest {
    workspace_id: String,
    rows: u16,
    cols: u16,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    session_id: String,
    workspace_id: String,
    shell: ShellKind,
    pid: Option<u32>,
    state: TerminalSessionState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalError {
    code: String,
    message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum TerminalEvent {
    Started {
        session: TerminalSession,
    },
    Data {
        session_id: String,
        workspace_id: String,
        sequence: u64,
        data: Vec<u8>,
    },
    Exited {
        session_id: String,
        workspace_id: String,
        exit_code: Option<i32>,
        reason: String,
    },
    Error {
        session_id: String,
        workspace_id: String,
        code: String,
        message: String,
    },
}

impl TerminalError {
    pub(crate) fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Default)]
pub struct TerminalManager {
    active: Mutex<Option<TerminalSlot>>,
    next_id: AtomicU64,
}

enum TerminalSlot {
    Starting {
        session_id: String,
        workspace_id: String,
        owner_label: String,
    },
    Running(RunningSession),
}

impl TerminalManager {
    fn reserve(&self, workspace_id: &str, owner_label: &str) -> Result<String, TerminalError> {
        let stale = {
            let mut active = self.lock_active()?;
            if matches!(active.as_ref(), Some(TerminalSlot::Running(session)) if session.is_exited())
            {
                active.take()
            } else if active.is_some() {
                return Err(TerminalError::new(
                    "SESSION_ACTIVE",
                    "Đã có một terminal đang khởi động hoặc đang chạy.",
                ));
            } else {
                None
            }
        };
        if let Some(TerminalSlot::Running(session)) = stale {
            let _ = session.close();
        }

        let mut active = self.lock_active()?;
        if active.is_some() {
            return Err(TerminalError::new(
                "SESSION_ACTIVE",
                "Terminal đang được sử dụng.",
            ));
        }

        let sequence = self
            .next_id
            .fetch_add(1, Ordering::Relaxed)
            .saturating_add(1);
        let session_id = format!("terminal-{sequence}");
        *active = Some(TerminalSlot::Starting {
            session_id: session_id.clone(),
            workspace_id: workspace_id.to_owned(),
            owner_label: owner_label.to_owned(),
        });
        Ok(session_id)
    }

    fn start_output(&self, session_id: &str) -> Result<(), TerminalError> {
        let active = self.lock_active()?;
        match active.as_ref() {
            Some(TerminalSlot::Running(session)) if session.session_id() == session_id => {
                session.start_output();
                Ok(())
            }
            _ => Err(TerminalError::new(
                "SESSION_NOT_FOUND",
                "Terminal session không tồn tại hoặc không còn active.",
            )),
        }
    }

    fn session_io(
        &self,
        session_id: &str,
        workspace_id: &str,
        owner_label: &str,
    ) -> Result<SessionIo, TerminalError> {
        let active = self.lock_active()?;
        match active.as_ref() {
            Some(TerminalSlot::Running(session))
                if session.session_id() == session_id
                    && session.owner_label() == owner_label
                    && session.descriptor().workspace_id == workspace_id =>
            {
                session.io_handles()
            }
            _ => Err(TerminalError::new(
                "SESSION_NOT_FOUND",
                "Terminal session không tồn tại hoặc không còn active.",
            )),
        }
    }

    fn publish(
        &self,
        session: RunningSession,
    ) -> Result<TerminalSession, Box<(TerminalError, RunningSession)>> {
        let mut active = match self.active.lock() {
            Ok(active) => active,
            Err(_) => {
                return Err(Box::new((
                    TerminalError::new("STATE_UNAVAILABLE", "Terminal state không khả dụng."),
                    session,
                )))
            }
        };
        let reservation_matches = matches!(
            active.as_ref(),
            Some(TerminalSlot::Starting { session_id, workspace_id, owner_label })
                if session_id == session.session_id()
                    && workspace_id == &session.descriptor().workspace_id
                    && owner_label == session.owner_label()
        );

        if !reservation_matches {
            return Err(Box::new((
                TerminalError::new("SESSION_CLOSED", "Terminal đã bị hủy trong lúc khởi động."),
                session,
            )));
        }

        let descriptor = session.descriptor();
        *active = Some(TerminalSlot::Running(session));
        Ok(descriptor)
    }

    fn rollback(&self, session_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            let should_clear = matches!(
                active.as_ref(),
                Some(TerminalSlot::Starting { session_id: reserved, .. }) if reserved == session_id
            );
            if should_clear {
                *active = None;
            }
        }
    }

    fn close(&self, session_id: &str, owner_label: &str) -> Result<(), TerminalError> {
        let slot = {
            let mut active = self.lock_active()?;
            match active.as_ref() {
                Some(TerminalSlot::Starting {
                    session_id: active_id,
                    owner_label: active_owner,
                    ..
                }) if active_id == session_id && active_owner == owner_label => active.take(),
                Some(TerminalSlot::Running(session))
                    if session.session_id() == session_id
                        && session.owner_label() == owner_label =>
                {
                    active.take()
                }
                None => return Ok(()),
                _ => {
                    return Err(TerminalError::new(
                        "SESSION_NOT_FOUND",
                        "Terminal session không tồn tại hoặc không còn active.",
                    ))
                }
            }
        };

        match slot {
            Some(TerminalSlot::Running(session)) => session.close(),
            Some(TerminalSlot::Starting { .. }) | None => Ok(()),
        }
    }

    pub(crate) fn close_active_for_shutdown(&self) {
        let slot = self.active.lock().ok().and_then(|mut active| active.take());
        if let Some(TerminalSlot::Running(session)) = slot {
            let _ = session.close();
        }
    }

    fn lock_active(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, Option<TerminalSlot>>, TerminalError> {
        self.active
            .lock()
            .map_err(|_| TerminalError::new("STATE_UNAVAILABLE", "Terminal state không khả dụng."))
    }
}

#[tauri::command]
pub async fn terminal_spawn(
    app: AppHandle,
    window: WebviewWindow,
    request: TerminalSpawnRequest,
    on_event: Channel<TerminalEvent>,
) -> Result<TerminalSession, TerminalError> {
    let owner_label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        spawn_terminal(&app, &owner_label, request, on_event)
    })
    .await
    .map_err(|error| {
        TerminalError::new(
            "SPAWN_FAILED",
            format!("Terminal worker kết thúc ngoài dự kiến: {error}"),
        )
    })?
}

fn spawn_terminal(
    app: &AppHandle,
    owner_label: &str,
    request: TerminalSpawnRequest,
    on_event: Channel<TerminalEvent>,
) -> Result<TerminalSession, TerminalError> {
    let size = validated_size(request.rows, request.cols)?;
    let workspace_state = app.state::<WorkspaceState>();
    let snapshot = workspace_state
        .active_snapshot()
        .map_err(|error| TerminalError::new(error.code, error.message))?
        .ok_or_else(|| TerminalError::new("NO_WORKSPACE", "Hãy mở workspace trước."))?;

    if snapshot.id != request.workspace_id {
        return Err(TerminalError::new(
            "STALE_WORKSPACE",
            "Workspace đã thay đổi. Hãy thử mở terminal lại.",
        ));
    }

    let manager = app.state::<TerminalManager>();
    spawn_reserved(
        &workspace_state,
        &manager,
        snapshot,
        owner_label,
        size,
        on_event,
    )
}

fn spawn_reserved(
    workspace_state: &WorkspaceState,
    manager: &TerminalManager,
    snapshot: WorkspaceSnapshot,
    owner_label: &str,
    size: PtySize,
    on_event: Channel<TerminalEvent>,
) -> Result<TerminalSession, TerminalError> {
    let session_id = manager.reserve(&snapshot.id, owner_label)?;
    let spawn_result = (|| {
        let shell = resolve_powershell()?;
        let session = RunningSession::spawn(
            session_id.clone(),
            snapshot.id.clone(),
            owner_label.to_owned(),
            &snapshot.root,
            shell,
            size,
            on_event.clone(),
        )?;

        let mut pending_session = Some(session);
        let publish_result = workspace_state
            .while_workspace_is_active(&snapshot.id, || {
                manager.publish(
                    pending_session
                        .take()
                        .expect("pending terminal must exist while publishing"),
                )
            })
            .map_err(|error| TerminalError::new(error.code, error.message))?;

        match publish_result {
            Some(Ok(descriptor)) => {
                on_event
                    .send(TerminalEvent::Started {
                        session: descriptor.clone(),
                    })
                    .map_err(|_| {
                        let _ = manager.close(&descriptor.session_id, owner_label);
                        TerminalError::new("STREAM_FAILED", "Không thể mở stream terminal.")
                    })?;
                manager.start_output(&descriptor.session_id)?;
                Ok(descriptor)
            }
            Some(Err(failure)) => {
                let (error, session) = *failure;
                let _ = session.close();
                Err(error)
            }
            None => {
                if let Some(session) = pending_session.take() {
                    let _ = session.close();
                }
                Err(TerminalError::new(
                    "STALE_WORKSPACE",
                    "Workspace đã thay đổi trong lúc terminal khởi động.",
                ))
            }
        }
    })();

    if spawn_result.is_err() {
        manager.rollback(&session_id);
    }
    spawn_result
}

#[tauri::command]
pub async fn terminal_close(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
) -> Result<(), TerminalError> {
    let owner_label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let manager = app.state::<TerminalManager>();
        manager.close(&session_id, &owner_label)
    })
    .await
    .map_err(|error| {
        TerminalError::new(
            "CLOSE_FAILED",
            format!("Terminal close worker kết thúc ngoài dự kiến: {error}"),
        )
    })?
}

#[tauri::command]
pub async fn terminal_write(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), TerminalError> {
    let owner_label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let io =
            app.state::<TerminalManager>()
                .session_io(&session_id, &workspace_id, &owner_label)?;
        io.write_input(&data)
    })
    .await
    .map_err(|error| {
        TerminalError::new(
            "WRITE_FAILED",
            format!("Terminal write worker lỗi: {error}"),
        )
    })?
}

#[tauri::command]
pub async fn terminal_resize(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), TerminalError> {
    let owner_label = window.label().to_owned();
    let size = validated_size(rows, cols)?;
    tauri::async_runtime::spawn_blocking(move || {
        let io =
            app.state::<TerminalManager>()
                .session_io(&session_id, &workspace_id, &owner_label)?;
        io.resize(size)
    })
    .await
    .map_err(|error| {
        TerminalError::new(
            "RESIZE_FAILED",
            format!("Terminal resize worker lỗi: {error}"),
        )
    })?
}

#[tauri::command]
pub async fn terminal_ack(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    session_id: String,
    sequence: u64,
) -> Result<(), TerminalError> {
    let owner_label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let io =
            app.state::<TerminalManager>()
                .session_io(&session_id, &workspace_id, &owner_label)?;
        io.acknowledge(sequence)
    })
    .await
    .map_err(|error| {
        TerminalError::new("ACK_FAILED", format!("Terminal ACK worker lỗi: {error}"))
    })?
}

fn validated_size(rows: u16, cols: u16) -> Result<PtySize, TerminalError> {
    if !(MIN_TERMINAL_DIMENSION..=MAX_TERMINAL_DIMENSION).contains(&rows)
        || !(MIN_TERMINAL_DIMENSION..=MAX_TERMINAL_DIMENSION).contains(&cols)
    {
        return Err(TerminalError::new(
            "INVALID_SIZE",
            format!(
                "Kích thước terminal phải nằm trong khoảng {MIN_TERMINAL_DIMENSION}–{MAX_TERMINAL_DIMENSION}."
            ),
        ));
    }

    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::{validated_size, TerminalManager};

    #[test]
    fn validates_terminal_dimensions() {
        let size = validated_size(24, 80).expect("80 x 24 should be valid");
        assert_eq!(size.rows, 24);
        assert_eq!(size.cols, 80);

        let error = validated_size(0, 80).expect_err("zero rows must be rejected");
        assert_eq!(error.code, "INVALID_SIZE");
    }

    #[test]
    fn allows_only_one_active_reservation() {
        let manager = TerminalManager::default();
        let session_id = manager
            .reserve("workspace-1", "main")
            .expect("first reservation");

        let error = manager
            .reserve("workspace-1", "main")
            .expect_err("second reservation must fail");
        assert_eq!(error.code, "SESSION_ACTIVE");

        manager.rollback(&session_id);
        assert!(manager.reserve("workspace-1", "main").is_ok());
    }

    #[test]
    fn a_different_window_cannot_close_a_starting_session() {
        let manager = TerminalManager::default();
        let session_id = manager
            .reserve("workspace-1", "main")
            .expect("reservation should succeed");

        let error = manager
            .close(&session_id, "secondary")
            .expect_err("another window must not own this session");
        assert_eq!(error.code, "SESSION_NOT_FOUND");

        manager
            .close(&session_id, "main")
            .expect("the owner can cancel its starting session");
    }
}
