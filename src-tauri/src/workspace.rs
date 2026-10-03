use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct WorkspaceState {
    active: Mutex<Option<WorkspaceRecord>>,
    next_id: AtomicU64,
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

    Ok(Some(descriptor))
}

impl WorkspaceState {
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
