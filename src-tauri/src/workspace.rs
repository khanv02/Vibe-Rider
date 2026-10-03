use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::git::GitService;
use crate::terminal::TerminalManager;

#[derive(Default)]
pub struct WorkspaceState {
    active: Mutex<Option<WorkspaceRecord>>,
    next_id: AtomicU64,
    activity: Arc<Mutex<WorkspaceActivity>>,
}

#[derive(Default)]
struct WorkspaceActivity {
    mutation: bool,
    transition: bool,
}

// A lease records activity without keeping the workspace mutex locked while
// filesystem/process work runs. Lock order when acquiring: activity -> active.
pub(crate) struct WorkspaceMutationLease {
    activity: Arc<Mutex<WorkspaceActivity>>,
    pub snapshot: WorkspaceSnapshot,
}

pub(crate) struct WorkspaceTransitionLease {
    activity: Arc<Mutex<WorkspaceActivity>>,
}

impl Drop for WorkspaceMutationLease {
    fn drop(&mut self) {
        if let Ok(mut activity) = self.activity.lock() {
            activity.mutation = false;
        }
    }
}

impl Drop for WorkspaceTransitionLease {
    fn drop(&mut self) {
        if let Ok(mut activity) = self.activity.lock() {
            activity.transition = false;
        }
    }
}

struct WorkspaceRecord {
    descriptor: WorkspaceDescriptor,
    root: PathBuf,
}

#[derive(Clone, Debug)]
pub(crate) struct WorkspaceSnapshot {
    pub id: String,
    pub root: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDescriptor {
    pub id: String,
    pub name: String,
    pub root_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceError {
    pub code: String,
    pub message: String,
}

impl WorkspaceError {
    pub(crate) fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

fn io_error(code: &str, operation: &str, error: std::io::Error) -> WorkspaceError {
    WorkspaceError::new(code, format!("Không thể {operation}: {error}"))
}

#[tauri::command]
pub async fn open_workspace(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, WorkspaceState>,
) -> Result<Option<WorkspaceDescriptor>, WorkspaceError> {
    let selected = app.dialog().file().blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };

    let selected_path = selected
        .into_path()
        .map_err(|error| WorkspaceError::new("INVALID_PATH", error.to_string()))?;
    let root = std::fs::canonicalize(&selected_path)
        .map_err(|error| io_error("INVALID_WORKSPACE", "xác thực workspace", error))?;

    let metadata = std::fs::metadata(&root)
        .map_err(|error| io_error("INVALID_WORKSPACE", "đọc workspace", error))?;
    if !metadata.is_dir() {
        return Err(WorkspaceError::new(
            "NOT_DIRECTORY",
            "Đường dẫn đã chọn không phải là thư mục.",
        ));
    }

    std::fs::read_dir(&root)
        .map_err(|error| io_error("PERMISSION_DENIED", "đọc workspace", error))?;

    let git = app.state::<GitService>();
    activate_workspace(&app, window.label(), &state, &git, root).map(Some)
}

pub(crate) fn activate_workspace(
    app: &AppHandle,
    window_label: &str,
    state: &WorkspaceState,
    git: &GitService,
    root: PathBuf,
) -> Result<WorkspaceDescriptor, WorkspaceError> {
    let root_path = root.to_str().ok_or_else(|| {
        WorkspaceError::new(
            "UNSUPPORTED_PATH_ENCODING",
            "Đường dẫn workspace không thể biểu diễn bằng Unicode.",
        )
    })?;
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| root_path.to_owned());
    let id = state
        .next_id
        .fetch_add(1, Ordering::Relaxed)
        .saturating_add(1)
        .to_string();
    let descriptor = WorkspaceDescriptor {
        id,
        name,
        root_path: root_path.to_owned(),
    };

    // Revalidate activity after the picker. A busy operation must not have its
    // terminals torn down before the workspace swap is rejected.
    if let Some(previous) = state.active_snapshot()? {
        git.ensure_workspace_idle(&previous.id)
            .map_err(|error| WorkspaceError::new(error.code, error.message))?;
    }
    let _transition = state.begin_transition()?;
    if let Some(previous) = state.active_snapshot()? {
        app.state::<TerminalManager>()
            .close_workspace(&previous.id, window_label)
            .map_err(|error| WorkspaceError::new(error.code, error.message))?;
    }

    let mut active = state.active.lock().map_err(|_| {
        WorkspaceError::new(
            "STATE_UNAVAILABLE",
            "Không thể cập nhật workspace hiện tại.",
        )
    })?;
    *active = Some(WorkspaceRecord {
        descriptor: descriptor.clone(),
        root,
    });

    Ok(descriptor)
}

impl WorkspaceState {
    pub(crate) fn begin_mutation(
        &self,
        workspace_id: &str,
    ) -> Result<WorkspaceMutationLease, WorkspaceError> {
        let mut activity = self.activity.lock().map_err(|_| {
            WorkspaceError::new(
                "STATE_UNAVAILABLE",
                "Không thể kiểm tra workspace activity.",
            )
        })?;
        if activity.transition || activity.mutation {
            return Err(WorkspaceError::new(
                "WORKSPACE_BUSY",
                "Workspace đang chuyển hoặc có thao tác ghi. Hãy chờ hoặc huỷ thao tác đó.",
            ));
        }
        let snapshot = self
            .active_snapshot()?
            .ok_or_else(|| WorkspaceError::new("NO_WORKSPACE", "Hãy mở workspace trước."))?;
        if snapshot.id != workspace_id {
            return Err(WorkspaceError::new(
                "STALE_WORKSPACE",
                "Workspace đã thay đổi.",
            ));
        }
        activity.mutation = true;
        Ok(WorkspaceMutationLease {
            activity: Arc::clone(&self.activity),
            snapshot,
        })
    }

    pub(crate) fn begin_transition(&self) -> Result<WorkspaceTransitionLease, WorkspaceError> {
        let mut activity = self.activity.lock().map_err(|_| {
            WorkspaceError::new(
                "STATE_UNAVAILABLE",
                "Không thể kiểm tra workspace activity.",
            )
        })?;
        if activity.mutation || activity.transition {
            return Err(WorkspaceError::new(
                "WORKSPACE_BUSY",
                "Chờ hoặc huỷ thao tác ghi/Git đang chạy trước khi đổi workspace.",
            ));
        }
        activity.transition = true;
        Ok(WorkspaceTransitionLease {
            activity: Arc::clone(&self.activity),
        })
    }

    pub(crate) fn active_snapshot(&self) -> Result<Option<WorkspaceSnapshot>, WorkspaceError> {
        let active = self.active.lock().map_err(|_| {
            WorkspaceError::new("STATE_UNAVAILABLE", "Không thể đọc workspace hiện tại.")
        })?;

        Ok(active.as_ref().map(|workspace| WorkspaceSnapshot {
            id: workspace.descriptor.id.clone(),
            root: workspace.root.clone(),
        }))
    }

    pub(crate) fn while_workspace_is_active<T>(
        &self,
        workspace_id: &str,
        operation: impl FnOnce() -> T,
    ) -> Result<Option<T>, WorkspaceError> {
        let active = self.active.lock().map_err(|_| {
            WorkspaceError::new(
                "STATE_UNAVAILABLE",
                "Không thể kiểm tra workspace hiện tại.",
            )
        })?;

        if active
            .as_ref()
            .is_some_and(|workspace| workspace.descriptor.id == workspace_id)
        {
            Ok(Some(operation()))
        } else {
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> WorkspaceState {
        let state = WorkspaceState::default();
        *state.active.lock().unwrap() = Some(WorkspaceRecord {
            descriptor: WorkspaceDescriptor {
                id: "fixture".into(),
                name: "fixture".into(),
                root_path: "fixture".into(),
            },
            root: PathBuf::from("fixture"),
        });
        state
    }

    #[test]
    fn mutation_lease_blocks_save_and_switch_but_does_not_lock_snapshot() {
        let state = state();
        let lease = state.begin_mutation("fixture").unwrap();
        assert_eq!(lease.snapshot.id, "fixture");
        assert!(state.active_snapshot().unwrap().is_some());
        assert_eq!(
            state.begin_mutation("fixture").err().unwrap().code,
            "WORKSPACE_BUSY"
        );
        assert_eq!(
            state.begin_transition().err().unwrap().code,
            "WORKSPACE_BUSY"
        );
        drop(lease);
        assert!(state.begin_transition().is_ok());
    }

    #[test]
    fn transition_blocks_new_mutations_and_release_is_recoverable() {
        let state = state();
        let transition = state.begin_transition().unwrap();
        assert_eq!(
            state.begin_mutation("fixture").err().unwrap().code,
            "WORKSPACE_BUSY"
        );
        drop(transition);
        assert!(state.begin_mutation("fixture").is_ok());
    }

    #[test]
    fn stale_mutation_does_not_reserve_workspace() {
        let state = state();
        assert_eq!(
            state.begin_mutation("old").err().unwrap().code,
            "STALE_WORKSPACE"
        );
        assert!(state.begin_mutation("fixture").is_ok());
        assert_eq!(
            WorkspaceState::default()
                .begin_mutation("old")
                .err()
                .unwrap()
                .code,
            "NO_WORKSPACE"
        );
    }
}
