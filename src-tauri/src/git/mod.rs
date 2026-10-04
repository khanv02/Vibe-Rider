mod operations;
mod process;
mod repository;
mod status;
#[cfg(test)]
mod tests;
#[cfg(windows)]
pub(crate) mod windows;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Condvar, Mutex, OnceLock,
};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use crate::workspace::{WorkspaceError, WorkspaceState};
#[cfg(windows)]
use windows::ProcessTree;

#[cfg(not(windows))]
struct ProcessTree;
#[cfg(not(windows))]
impl ProcessTree {
    fn spawn(_: &mut std::process::Command) -> std::io::Result<(std::process::Child, Arc<Self>)> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "Git process containment hiện chỉ hỗ trợ Windows.",
        ))
    }
    fn terminate(&self) {}
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitError {
    pub code: String,
    pub operation: String,
    pub message: String,
    pub exit_code: Option<i32>,
}

impl GitError {
    fn new(code: &str, operation: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            operation: operation.into(),
            message: message.into(),
            exit_code: None,
        }
    }
    fn io(operation: &str, error: std::io::Error) -> Self {
        Self::new(
            "GIT_IO_ERROR",
            operation,
            format!("Git process I/O: {error}"),
        )
    }
}

impl From<WorkspaceError> for GitError {
    fn from(error: WorkspaceError) -> Self {
        Self::new(&error.code, "workspace", error.message)
    }
}

#[derive(Clone, Default)]
pub struct GitService {
    inner: Arc<ServiceInner>,
}

#[derive(Default)]
struct ServiceInner {
    next_id: AtomicU64,
    operations: Mutex<HashMap<u64, Arc<OperationControl>>>,
    idle: Condvar,
    executable: OnceLock<Result<PathBuf, GitError>>,
    shutting_down: AtomicBool,
}

struct OperationControl {
    cancelled: AtomicBool,
    output_limit: AtomicBool,
    window: String,
    workspace_id: String,
    operation: String,
    mutation: bool,
    tree: Mutex<Option<Arc<ProcessTree>>>,
}

impl OperationControl {
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        if let Ok(tree) = self.tree.lock() {
            if let Some(tree) = tree.as_ref() {
                tree.terminate();
            }
        }
    }
}

struct OperationLease {
    id: u64,
    control: Arc<OperationControl>,
    service: Arc<ServiceInner>,
}

impl OperationLease {
    pub(crate) fn id(&self) -> u64 {
        self.id
    }
}

impl Drop for OperationLease {
    fn drop(&mut self) {
        if let Ok(mut operations) = self.service.operations.lock() {
            operations.remove(&self.id);
            self.service.idle.notify_all();
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationInfo {
    pub operation_id: String,
    pub workspace_id: String,
    pub operation: String,
    pub mutation: bool,
    pub cancellation_requested: bool,
}

impl GitService {
    pub(crate) fn ensure_workspace_idle(&self, workspace_id: &str) -> Result<(), GitError> {
        let operations = self.inner.operations.lock().map_err(|_| {
            GitError::new(
                "STATE_UNAVAILABLE",
                "workspace-transition",
                "KhÃ´ng thá»ƒ Ä‘á»c Git operation state.",
            )
        })?;
        if operations
            .values()
            .any(|control| control.workspace_id == workspace_id)
        {
            return Err(GitError::new(
                "GIT_BUSY",
                "workspace-transition",
                "Git operation Ä‘ang cháº¡y. HÃ£y chá» hoáº·c huá»· trÆ°á»›c khi Ä‘á»•i workspace.",
            ));
        }
        Ok(())
    }

    fn begin(
        &self,
        window: &str,
        workspace_id: &str,
        operation: &str,
        mutation: bool,
    ) -> Result<OperationLease, GitError> {
        let mut operations = self.inner.operations.lock().map_err(|_| {
            GitError::new(
                "STATE_UNAVAILABLE",
                operation,
                "Không thể đọc Git operation state.",
            )
        })?;
        if self.inner.shutting_down.load(Ordering::Acquire) {
            return Err(GitError::new(
                "GIT_SHUTTING_DOWN",
                operation,
                "Ứng dụng đang đóng.",
            ));
        }
        if operations.len() >= 16
            || (mutation
                && operations
                    .values()
                    .any(|control| control.workspace_id == workspace_id && control.mutation))
        {
            return Err(GitError::new(
                "GIT_BUSY",
                operation,
                "Chờ Git operation đang chạy.",
            ));
        }
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let control = Arc::new(OperationControl {
            cancelled: AtomicBool::new(false),
            output_limit: AtomicBool::new(false),
            window: window.into(),
            workspace_id: workspace_id.into(),
            operation: operation.into(),
            mutation,
            tree: Mutex::new(None),
        });
        operations.insert(id, Arc::clone(&control));
        Ok(OperationLease {
            id,
            control,
            service: Arc::clone(&self.inner),
        })
    }

    fn runner(&self, root: &std::path::Path) -> Result<process::GitRunner, GitError> {
        let executable = self
            .inner
            .executable
            .get_or_init(process::resolve_git)
            .clone()?;
        if executable.starts_with(root) {
            return Err(GitError::new(
                "UNSAFE_EXECUTABLE",
                "repository",
                "Không chạy Git executable nằm trong workspace.",
            ));
        }
        Ok(process::GitRunner::new(executable, root.to_path_buf()))
    }

    fn operations(
        &self,
        window: &str,
        workspace_id: &str,
    ) -> Result<Vec<GitOperationInfo>, GitError> {
        let operations = self.inner.operations.lock().map_err(|_| {
            GitError::new(
                "STATE_UNAVAILABLE",
                "operations",
                "Không thể đọc Git operation state.",
            )
        })?;
        Ok(operations
            .iter()
            .filter(|(_, c)| c.window == window && c.workspace_id == workspace_id)
            .map(|(id, c)| GitOperationInfo {
                operation_id: id.to_string(),
                workspace_id: c.workspace_id.clone(),
                operation: c.operation.clone(),
                mutation: c.mutation,
                cancellation_requested: c.cancelled.load(Ordering::Acquire),
            })
            .collect())
    }

    fn cancel(&self, window: &str, workspace_id: &str, id: &str) -> Result<bool, GitError> {
        let id = id.parse::<u64>().map_err(|_| {
            GitError::new(
                "INVALID_OPERATION",
                "cancel",
                "Git operation ID không hợp lệ.",
            )
        })?;
        let operations = self.inner.operations.lock().map_err(|_| {
            GitError::new(
                "STATE_UNAVAILABLE",
                "cancel",
                "Không thể đọc Git operation state.",
            )
        })?;
        let Some(control) = operations.get(&id) else {
            return Ok(false);
        };
        if control.window != window || control.workspace_id != workspace_id {
            return Err(GitError::new(
                "INVALID_OPERATION_OWNER",
                "cancel",
                "Operation không thuộc window/workspace này.",
            ));
        }
        control.cancel();
        Ok(true)
    }

    pub(crate) fn close_all_for_shutdown(&self) {
        self.inner.shutting_down.store(true, Ordering::Release);
        let Ok(mut operations) = self.inner.operations.lock() else {
            return;
        };
        for operation in operations.values() {
            operation.cancel();
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while !operations.is_empty() {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                break;
            };
            match self.inner.idle.wait_timeout(operations, remaining) {
                Ok((next, _)) => operations = next,
                Err(_) => return,
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitWorkspaceRequest {
    workspace_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitCancelRequest {
    workspace_id: String,
    operation_id: String,
}

#[tauri::command]
pub async fn git_repository(
    service: State<'_, GitService>,
    state: State<'_, WorkspaceState>,
    window: WebviewWindow,
    request: GitWorkspaceRequest,
) -> Result<repository::GitRepository, GitError> {
    let snapshot = state
        .active_snapshot()?
        .ok_or_else(|| GitError::new("NO_WORKSPACE", "repository", "Hãy mở workspace trước."))?;
    if snapshot.id != request.workspace_id {
        return Err(GitError::new(
            "STALE_WORKSPACE",
            "repository",
            "Workspace đã thay đổi.",
        ));
    }
    let workspace_lease = state.begin_mutation(&snapshot.id).map_err(GitError::from)?;
    let service = service.inner().clone();
    let lease = service.begin(window.label(), &snapshot.id, "repository", false)?;
    let workspace_id = snapshot.id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _workspace_lease = workspace_lease;
        let runner = service.runner(&snapshot.root)?;
        repository::inspect(&snapshot.id, &snapshot.root, &runner, &lease.control)
    })
    .await
    .map_err(|error| {
        GitError::new(
            "GIT_WORKER_FAILED",
            "repository",
            format!("Git worker: {error}"),
        )
    })??;
    if !state
        .active_snapshot()?
        .is_some_and(|active| active.id == workspace_id)
    {
        return Err(GitError::new(
            "STALE_WORKSPACE",
            "repository",
            "Workspace đã thay đổi.",
        ));
    }
    Ok(result)
}

#[tauri::command]
pub fn git_operations(
    service: State<'_, GitService>,
    window: WebviewWindow,
    request: GitWorkspaceRequest,
) -> Result<Vec<GitOperationInfo>, GitError> {
    service.operations(window.label(), &request.workspace_id)
}

#[tauri::command]
pub fn git_cancel(
    service: State<'_, GitService>,
    window: WebviewWindow,
    request: GitCancelRequest,
) -> Result<bool, GitError> {
    service.cancel(window.label(), &request.workspace_id, &request.operation_id)
}

pub use operations::{
    git_add, git_commit, git_create_branch, git_diff, git_push, git_restore, git_status,
    git_switch_branch, GitDiffRequest, GitStatusRequest,
};
