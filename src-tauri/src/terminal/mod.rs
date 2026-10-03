mod session;
mod shell;

use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, MutexGuard,
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
    pane_id: TerminalPaneId,
    rows: u16,
    cols: u16,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
pub enum TerminalPaneId {
    T1,
    T2,
    T3,
    T4,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    session_id: String,
    workspace_id: String,
    pane_id: TerminalPaneId,
    shell: ShellKind,
    pid: Option<u32>,
    state: TerminalSessionState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalError {
    pub(crate) code: String,
    pub(crate) message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum TerminalEvent {
    Started {
        session: TerminalSession,
    },
    Data {
        session_id: String,
        workspace_id: String,
        pane_id: TerminalPaneId,
        sequence: u64,
        data: Vec<u8>,
    },
    Exited {
        session_id: String,
        workspace_id: String,
        pane_id: TerminalPaneId,
        exit_code: Option<i32>,
        reason: String,
    },
    Error {
        session_id: String,
        workspace_id: String,
        pane_id: TerminalPaneId,
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

const MAX_TERMINAL_SESSIONS: usize = 4;

#[derive(Default)]
pub struct TerminalManager {
    active: Mutex<HashMap<String, TerminalSlot>>,
    next_id: AtomicU64,
}

enum TerminalSlot {
    Starting {
        session_id: String,
        workspace_id: String,
        pane_id: TerminalPaneId,
        owner_label: String,
    },
    Running(RunningSession),
    Closing {
        session_id: String,
        workspace_id: String,
        pane_id: TerminalPaneId,
        owner_label: String,
    },
}

impl TerminalManager {
    fn reserve(
        &self,
        workspace_id: &str,
        pane_id: TerminalPaneId,
        owner_label: &str,
    ) -> Result<String, TerminalError> {
        let stale = {
            let mut active = self.lock_active()?;
            let stale_ids = active
                .iter()
                .filter_map(|(session_id, slot)| match slot {
                    TerminalSlot::Running(session) if session.is_exited() => {
                        Some(session_id.clone())
                    }
                    _ => None,
                })
                .collect::<Vec<_>>();
            stale_ids
                .into_iter()
                .filter_map(|session_id| match active.remove(&session_id) {
                    Some(TerminalSlot::Running(session)) => Some(session),
                    _ => None,
                })
                .collect::<Vec<_>>()
        };
        for session in stale {
            let _ = session.close();
        }

        let mut active = self.lock_active()?;
        if active.len() >= MAX_TERMINAL_SESSIONS {
            return Err(TerminalError::new(
                "SESSION_LIMIT_REACHED",
                "Đã đạt giới hạn bốn terminal session.",
            ));
        }
        if active.values().any(|slot| match slot {
            TerminalSlot::Starting {
                workspace_id: active_workspace,
                pane_id: active_pane,
                owner_label: active_owner,
                ..
            }
            | TerminalSlot::Closing {
                workspace_id: active_workspace,
                pane_id: active_pane,
                owner_label: active_owner,
                ..
            } => {
                active_workspace == workspace_id
                    && *active_pane == pane_id
                    && active_owner == owner_label
            }
            TerminalSlot::Running(session) => {
                let descriptor = session.descriptor();
                descriptor.workspace_id == workspace_id
                    && descriptor.pane_id == pane_id
                    && session.owner_label() == owner_label
            }
        }) {
            return Err(TerminalError::new(
                "PANE_ACTIVE",
                "Pane này đã có một session đang khởi động, chạy hoặc đóng.",
            ));
        }
        let sequence = self
            .next_id
            .fetch_add(1, Ordering::Relaxed)
            .saturating_add(1);
        let session_id = format!("terminal-{sequence}");
        active.insert(
            session_id.clone(),
            TerminalSlot::Starting {
                session_id: session_id.clone(),
                workspace_id: workspace_id.to_owned(),
                pane_id,
                owner_label: owner_label.to_owned(),
            },
        );
        Ok(session_id)
    }

    fn start_output(&self, session_id: &str) -> Result<(), TerminalError> {
        let active = self.lock_active()?;
        match active.get(session_id) {
            Some(TerminalSlot::Running(session)) => {
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
        match active.get(session_id) {
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
        let descriptor = session.descriptor();
        let reservation_matches = matches!(
            active.get(session.session_id()),
            Some(TerminalSlot::Starting { session_id, workspace_id, pane_id, owner_label })
                if session_id == session.session_id()
                    && workspace_id == &descriptor.workspace_id
                    && pane_id == &descriptor.pane_id
                    && owner_label == session.owner_label()
        );

        if !reservation_matches {
            return Err(Box::new((
                TerminalError::new("SESSION_CLOSED", "Terminal đã bị hủy trong lúc khởi động."),
                session,
            )));
        }

        active.insert(
            session.session_id().to_owned(),
            TerminalSlot::Running(session),
        );
        Ok(descriptor)
    }

    fn rollback(&self, session_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            if matches!(active.get(session_id), Some(TerminalSlot::Starting { .. })) {
                active.remove(session_id);
            }
        }
    }

    fn close(&self, session_id: &str, owner_label: &str) -> Result<(), TerminalError> {
        let slot = {
            let mut active = self.lock_active()?;
            match active.remove(session_id) {
                Some(TerminalSlot::Starting {
                    owner_label: active_owner,
                    ..
                }) if active_owner == owner_label => None,
                Some(TerminalSlot::Running(session))
                    if session.session_id() == session_id
                        && session.owner_label() == owner_label =>
                {
                    active.insert(
                        session_id.to_owned(),
                        TerminalSlot::Closing {
                            session_id: session_id.to_owned(),
                            workspace_id: session.descriptor().workspace_id.clone(),
                            pane_id: session.descriptor().pane_id,
                            owner_label: owner_label.to_owned(),
                        },
                    );
                    Some(TerminalSlot::Running(session))
                }
                Some(TerminalSlot::Closing { .. }) => return Ok(()),
                None => return Ok(()),
                Some(slot) => {
                    active.insert(session_id.to_owned(), slot);
                    return Err(TerminalError::new(
                        "SESSION_NOT_FOUND",
                        "Terminal session không tồn tại hoặc không còn active.",
                    ));
                }
            }
        };

        let close_result = match slot {
            Some(TerminalSlot::Running(session)) => session.close(),
            Some(TerminalSlot::Starting { .. }) | Some(TerminalSlot::Closing { .. }) | None => {
                Ok(())
            }
        };
        if let Ok(mut active) = self.active.lock() {
            if matches!(active.get(session_id), Some(TerminalSlot::Closing { .. })) {
                active.remove(session_id);
            }
        }
        close_result
    }

    pub(crate) fn close_all_for_shutdown(&self) {
        let sessions = self
            .active
            .lock()
            .ok()
            .map(|active| {
                active
                    .iter()
                    .map(|(session_id, slot)| {
                        let owner = match slot {
                            TerminalSlot::Starting { owner_label, .. }
                            | TerminalSlot::Closing { owner_label, .. } => owner_label.clone(),
                            TerminalSlot::Running(session) => session.owner_label().to_owned(),
                        };
                        (session_id.clone(), owner)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for (session_id, owner_label) in sessions {
            let _ = self.close(&session_id, &owner_label);
        }
    }

    pub(crate) fn close_workspace(
        &self,
        workspace_id: &str,
        owner_label: &str,
    ) -> Result<(), TerminalError> {
        let session_ids = self
            .lock_active()?
            .iter()
            .filter_map(|(session_id, slot)| match slot {
                TerminalSlot::Starting {
                    workspace_id: active_workspace,
                    owner_label: active_owner,
                    ..
                }
                | TerminalSlot::Closing {
                    workspace_id: active_workspace,
                    owner_label: active_owner,
                    ..
                } if active_workspace == workspace_id && active_owner == owner_label => {
                    Some(session_id.clone())
                }
                TerminalSlot::Running(session)
                    if session.descriptor().workspace_id == workspace_id
                        && session.owner_label() == owner_label =>
                {
                    Some(session_id.clone())
                }
                _ => None,
            })
            .collect::<Vec<_>>();

        let mut first_error = None;
        for session_id in session_ids {
            if let Err(error) = self.close(&session_id, owner_label) {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    pub(crate) fn list(
        &self,
        workspace_id: &str,
        owner_label: &str,
    ) -> Result<Vec<TerminalSlotSnapshot>, TerminalError> {
        Ok(self
            .lock_active()?
            .values()
            .filter_map(|slot| match slot {
                TerminalSlot::Starting {
                    session_id,
                    workspace_id: active_workspace,
                    pane_id,
                    owner_label: active_owner,
                } if active_workspace == workspace_id && active_owner == owner_label => Some(
                    TerminalSlotSnapshot::new(session_id, active_workspace, *pane_id, "starting"),
                ),
                TerminalSlot::Running(session)
                    if session.descriptor().workspace_id == workspace_id
                        && session.owner_label() == owner_label =>
                {
                    let descriptor = session.descriptor();
                    Some(TerminalSlotSnapshot::new(
                        &descriptor.session_id,
                        &descriptor.workspace_id,
                        descriptor.pane_id,
                        "running",
                    ))
                }
                TerminalSlot::Closing {
                    session_id,
                    workspace_id: active_workspace,
                    pane_id,
                    owner_label: active_owner,
                } if active_workspace == workspace_id && active_owner == owner_label => Some(
                    TerminalSlotSnapshot::new(session_id, active_workspace, *pane_id, "closing"),
                ),
                _ => None,
            })
            .collect())
    }

    fn lock_active(&self) -> Result<MutexGuard<'_, HashMap<String, TerminalSlot>>, TerminalError> {
        self.active
            .lock()
            .map_err(|_| TerminalError::new("STATE_UNAVAILABLE", "Terminal state không khả dụng."))
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSlotSnapshot {
    session_id: String,
    workspace_id: String,
    pane_id: TerminalPaneId,
    state: String,
}

impl TerminalSlotSnapshot {
    fn new(session_id: &str, workspace_id: &str, pane_id: TerminalPaneId, state: &str) -> Self {
        Self {
            session_id: session_id.to_owned(),
            workspace_id: workspace_id.to_owned(),
            pane_id,
            state: state.to_owned(),
        }
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
        request.pane_id,
        size,
        on_event,
    )
}

fn spawn_reserved(
    workspace_state: &WorkspaceState,
    manager: &TerminalManager,
    snapshot: WorkspaceSnapshot,
    owner_label: &str,
    pane_id: TerminalPaneId,
    size: PtySize,
    on_event: Channel<TerminalEvent>,
) -> Result<TerminalSession, TerminalError> {
    let session_id = manager.reserve(&snapshot.id, pane_id, owner_label)?;
    let spawn_result = (|| {
        let shell = resolve_powershell()?;
        let session = RunningSession::spawn(
            session_id.clone(),
            snapshot.id.clone(),
            pane_id,
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
pub async fn terminal_list(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
) -> Result<Vec<TerminalSlotSnapshot>, TerminalError> {
    let owner_label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<TerminalManager>()
            .list(&workspace_id, &owner_label)
    })
    .await
    .map_err(|error| {
        TerminalError::new(
            "STATE_UNAVAILABLE",
            format!("Terminal list worker lỗi: {error}"),
        )
    })?
}

#[tauri::command]
pub async fn terminal_close_workspace(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
) -> Result<(), TerminalError> {
    let owner_label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<TerminalManager>()
            .close_workspace(&workspace_id, &owner_label)
    })
    .await
    .map_err(|error| {
        TerminalError::new(
            "CLOSE_FAILED",
            format!("Workspace terminal cleanup worker lỗi: {error}"),
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
    use super::{validated_size, TerminalEvent, TerminalManager, TerminalPaneId};

    #[test]
    fn validates_terminal_dimensions() {
        let size = validated_size(24, 80).expect("80 x 24 should be valid");
        assert_eq!(size.rows, 24);
        assert_eq!(size.cols, 80);

        let error = validated_size(0, 80).expect_err("zero rows must be rejected");
        assert_eq!(error.code, "INVALID_SIZE");
    }

    #[test]
    fn allows_four_distinct_pane_reservations() {
        let manager = TerminalManager::default();
        let panes = [
            TerminalPaneId::T1,
            TerminalPaneId::T2,
            TerminalPaneId::T3,
            TerminalPaneId::T4,
        ];
        let ids = panes
            .into_iter()
            .map(|pane| {
                manager
                    .reserve("workspace-1", pane, "main")
                    .expect("reservation")
            })
            .collect::<Vec<_>>();
        let error = manager
            .reserve("workspace-1", TerminalPaneId::T1, "main")
            .expect_err("fifth reservation must fail");
        assert_eq!(error.code, "SESSION_LIMIT_REACHED");
        for id in ids {
            manager.rollback(&id);
        }
    }

    #[test]
    fn a_different_window_cannot_close_a_starting_session() {
        let manager = TerminalManager::default();
        let session_id = manager
            .reserve("workspace-1", TerminalPaneId::T1, "main")
            .expect("reservation should succeed");

        let error = manager
            .close(&session_id, "secondary")
            .expect_err("another window must not own this session");
        assert_eq!(error.code, "SESSION_NOT_FOUND");

        manager
            .close(&session_id, "main")
            .expect("the owner can cancel its starting session");
    }

    #[test]
    fn rejects_duplicate_pane_before_capacity_is_full() {
        let manager = TerminalManager::default();
        manager
            .reserve("workspace-1", TerminalPaneId::T1, "main")
            .expect("first pane reservation");
        let error = manager
            .reserve("workspace-1", TerminalPaneId::T1, "main")
            .expect_err("duplicate pane must be rejected");
        assert_eq!(error.code, "PANE_ACTIVE");
    }

    #[test]
    fn terminal_event_fields_are_camel_case() {
        let event = TerminalEvent::Exited {
            session_id: "terminal-1".to_owned(),
            workspace_id: "workspace-1".to_owned(),
            pane_id: TerminalPaneId::T2,
            exit_code: Some(7),
            reason: "exited".to_owned(),
        };
        let value = serde_json::to_value(event).expect("event should serialize");
        assert_eq!(value["type"], "exited");
        assert_eq!(value["sessionId"], "terminal-1");
        assert_eq!(value["workspaceId"], "workspace-1");
        assert_eq!(value["paneId"], "T2");
        assert_eq!(value["exitCode"], 7);
    }
}
