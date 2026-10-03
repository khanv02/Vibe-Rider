use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use super::{
    process::{GitOutput, GitRunner, Limits},
    repository, status, GitError, GitService,
};
use crate::workspace::{WorkspaceSnapshot, WorkspaceState};

const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;
const MAX_COMMIT_MESSAGE_BYTES: usize = 64 * 1024;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitStatusRequest {
    pub workspace_id: String,
    pub request_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitDiffRequest {
    pub workspace_id: String,
    pub entry_id: String,
    pub scope: String,
    pub status_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitEntriesRequest {
    pub workspace_id: String,
    pub entry_ids: Vec<String>,
    pub status_token: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitRestoreSelection {
    pub entry_id: String,
    pub restore_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitRestoreRequest {
    pub workspace_id: String,
    pub selections: Vec<GitRestoreSelection>,
    pub status_token: String,
    pub mode: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitCommitRequest {
    pub workspace_id: String,
    pub message: String,
    pub status_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitPushRequest {
    pub workspace_id: String,
    pub status_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitBranchRequest {
    pub workspace_id: String,
    pub branch_name: String,
    pub status_token: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMutationResult {
    pub operation_id: String,
    pub affected_paths: Vec<String>,
    pub commit_id: Option<String>,
    pub target: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffSnapshot {
    pub workspace_id: String,
    pub repository_id: String,
    pub preview_id: String,
    pub entry_id: String,
    pub scope: String,
    pub relative_path: String,
    pub original_path: Option<String>,
    pub original: String,
    pub modified: String,
    pub original_label: String,
    pub modified_label: String,
    pub original_bytes: usize,
    pub modified_bytes: usize,
    pub binary: bool,
    pub unsupported_reason: Option<String>,
}

struct Context {
    workspace: WorkspaceSnapshot,
    repository: repository::GitRepository,
    status: status::StatusSnapshot,
    runner: GitRunner,
}

#[tauri::command]
pub async fn git_status(
    service: State<'_, GitService>,
    state: State<'_, WorkspaceState>,
    window: WebviewWindow,
    request: GitStatusRequest,
) -> Result<status::GitStatus, GitError> {
    let workspace = active_workspace(state.inner(), &request.workspace_id)?;
    let service = service.inner().clone();
    let workspace_lease = state
        .begin_mutation(&workspace.id)
        .map_err(GitError::from)?;
    let lease = service.begin(window.label(), &workspace.id, "status", false)?;
    let workspace_id = workspace.id.clone();
    let request_id = request.request_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _workspace_lease = workspace_lease;
        let _lease = lease;
        let runner = service.runner(&workspace.root)?;
        let repository =
            repository::inspect(&workspace.id, &workspace.root, &runner, &_lease.control)?;
        status::read(
            &workspace.id,
            &repository.repository_id,
            &workspace.root,
            &runner,
            &_lease.control,
            request_id,
        )
        .map(|snapshot| (repository, snapshot))
    })
    .await
    .map_err(|error| {
        GitError::new(
            "GIT_WORKER_FAILED",
            "status",
            format!("Git worker: {error}"),
        )
    })??;
    ensure_active(state.inner(), &workspace_id)?;
    Ok(result.1.status)
}

#[tauri::command]
pub async fn git_diff(
    service: State<'_, GitService>,
    state: State<'_, WorkspaceState>,
    window: WebviewWindow,
    request: GitDiffRequest,
) -> Result<GitDiffSnapshot, GitError> {
    let workspace = active_workspace(state.inner(), &request.workspace_id)?;
    let service = service.inner().clone();
    let workspace_lease = state
        .begin_mutation(&workspace.id)
        .map_err(GitError::from)?;
    let lease = service.begin(window.label(), &workspace.id, "diff", false)?;
    let workspace_id = workspace.id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _workspace_lease = workspace_lease;
        let _lease = lease;
        let runner = service.runner(&workspace.root)?;
        let context = fresh_context(&workspace, &runner, &_lease.control, None)?;
        if context.status.status.status_token != request.status_token {
            return Err(stale_status());
        }
        let entry = context
            .status
            .status
            .entries
            .iter()
            .find(|entry| entry.entry_id == request.entry_id)
            .cloned()
            .ok_or_else(|| GitError::new("STALE_STATUS", "diff", "Git entry đã thay đổi."))?;
        let snapshot = build_diff(&context, &entry, &request.scope, &_lease.control)?;
        let after = status::read(
            &workspace.id,
            &context.repository.repository_id,
            &workspace.root,
            &context.runner,
            &_lease.control,
            None,
        )?;
        if after.status.status_token != request.status_token {
            return Err(stale_status());
        }
        Ok(snapshot)
    })
    .await
    .map_err(|error| {
        GitError::new("GIT_WORKER_FAILED", "diff", format!("Git worker: {error}"))
    })??;
    ensure_active(state.inner(), &workspace_id)?;
    Ok(result)
}

#[tauri::command]
pub async fn git_add(
    service: State<'_, GitService>,
    state: State<'_, WorkspaceState>,
    window: WebviewWindow,
    request: GitEntriesRequest,
) -> Result<GitMutationResult, GitError> {
    mutate_entries(
        service,
        state,
        window,
        request,
        "add",
        |context, entries, control| {
            let paths = selected_paths(entries)?;
            let mut args = vec![
                OsString::from("add"),
                OsString::from("-A"),
                OsString::from("--"),
            ];
            args.extend(paths.iter().map(OsString::from));
            run_args(
                &context.runner,
                "add",
                &args,
                None,
                Limits::mutation(),
                control,
            )?
            .checked("add")?;
            Ok(paths)
        },
    )
    .await
}

#[tauri::command]
pub async fn git_restore(
    service: State<'_, GitService>,
    state: State<'_, WorkspaceState>,
    window: WebviewWindow,
    request: GitRestoreRequest,
) -> Result<GitMutationResult, GitError> {
    let mode = request.mode.clone();
    let selections = request.selections.clone();
    let workspace = active_workspace(state.inner(), &request.workspace_id)?;
    let workspace_id = workspace.id.clone();
    let service_clone = service.inner().clone();
    let lease = state
        .begin_mutation(&workspace.id)
        .map_err(GitError::from)?;
    let operation_lease = service_clone.begin(window.label(), &workspace.id, "restore", true)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _workspace_lease = lease;
        let _operation_lease = operation_lease;
        let runner = service_clone.runner(&workspace.root)?;
        let context = fresh_context(&workspace, &runner, &_operation_lease.control, None)?;
        if context.status.status.status_token != request.status_token {
            return Err(stale_status());
        }
        let entries = select_entries(&context, &selections)?;
        let paths = selected_paths(&entries)?;
        if mode == "worktree" {
            for (selection, entry) in selections.iter().zip(entries.iter()) {
                if entry.untracked || entry.conflict || entry.kind == "rename" {
                    return Err(GitError::new(
                        "UNSUPPORTED_RESTORE",
                        "restore",
                        "Chỉ restore working tree cho tracked regular file, không áp dụng cho conflict/rename/untracked.",
                    ));
                }
                if selection.restore_token.as_deref() != Some(entry.restore_token.as_str()) {
                    return Err(GitError::new(
                        "STALE_RESTORE_CONFIRMATION",
                        "restore",
                        "File trên disk đã thay đổi sau bước review; cần review lại.",
                    ));
                }
            }
            let mut args = vec![OsString::from("restore"), OsString::from("--worktree"), OsString::from("--")];
            args.extend(paths.iter().map(OsString::from));
            run_args(&context.runner, "restore", &args, None, Limits::mutation(), &_operation_lease.control)?.checked("restore")?;
        } else if mode == "unstage" {
            let mut head_paths = Vec::new();
            let mut index_only_paths = Vec::new();
            let head_exists = has_head(&context.runner, &_operation_lease.control)?;
            for entry in &entries {
                if !entry.staged && entry.index_status == " " {
                    continue;
                }
                if head_exists {
                    if head_blob(&context.runner, &entry.current_path, &_operation_lease.control)?.is_some() {
                        head_paths.push(entry.current_path.clone());
                    } else {
                        index_only_paths.push(entry.current_path.clone());
                    }
                    if let Some(original) = &entry.original_path {
                        if head_blob(&context.runner, original, &_operation_lease.control)?.is_some() {
                            head_paths.push(original.clone());
                        } else {
                            index_only_paths.push(original.clone());
                        }
                    }
                } else {
                    index_only_paths.push(entry.current_path.clone());
                }
            }
            if !head_paths.is_empty() {
                let mut args = vec![OsString::from("restore"), OsString::from("--source=HEAD"), OsString::from("--staged"), OsString::from("--")];
                args.extend(dedup_paths(head_paths).iter().map(OsString::from));
                run_args(&context.runner, "unstage", &args, None, Limits::mutation(), &_operation_lease.control)?.checked("unstage")?;
            }
            if !index_only_paths.is_empty() {
                let mut args = vec![OsString::from("update-index"), OsString::from("--force-remove"), OsString::from("--")];
                args.extend(dedup_paths(index_only_paths).iter().map(OsString::from));
                run_args(&context.runner, "unstage", &args, None, Limits::mutation(), &_operation_lease.control)?.checked("unstage")?;
            }
        } else {
            return Err(GitError::new("INVALID_MODE", "restore", "Restore mode phải là unstage hoặc worktree."));
        }
        Ok(GitMutationResult {
            operation_id: _operation_lease.id().to_string(),
            affected_paths: paths,
            commit_id: None,
            target: None,
        })
    })
    .await
    .map_err(|error| GitError::new("GIT_WORKER_FAILED", "restore", format!("Git worker: {error}")))??;
    ensure_active(state.inner(), &workspace_id)?;
    Ok(result)
}

#[tauri::command]
pub async fn git_commit(
    service: State<'_, GitService>,
    state: State<'_, WorkspaceState>,
    window: WebviewWindow,
    request: GitCommitRequest,
) -> Result<GitMutationResult, GitError> {
    let workspace = active_workspace(state.inner(), &request.workspace_id)?;
    if request.message.trim().is_empty()
        || request.message.len() > MAX_COMMIT_MESSAGE_BYTES
        || request.message.contains('\0')
    {
        return Err(GitError::new(
            "INVALID_COMMIT_MESSAGE",
            "commit",
            "Commit message phải có nội dung, không chứa NUL và không quá 64 KiB.",
        ));
    }
    let workspace_id = workspace.id.clone();
    let service = service.inner().clone();
    let workspace_lease = state
        .begin_mutation(&workspace.id)
        .map_err(GitError::from)?;
    let operation_lease = service.begin(window.label(), &workspace.id, "commit", true)?;
    let message = request.message.into_bytes();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _workspace_lease = workspace_lease;
        let _operation_lease = operation_lease;
        let runner = service.runner(&workspace.root)?;
        let context = fresh_context(&workspace, &runner, &_operation_lease.control, None)?;
        if context.status.status.status_token != request.status_token {
            return Err(stale_status());
        }
        if !context
            .status
            .status
            .entries
            .iter()
            .any(|entry| entry.staged)
        {
            return Err(GitError::new(
                "NOTHING_STAGED",
                "commit",
                "Không có staged change để commit.",
            ));
        }
        if context
            .status
            .status
            .entries
            .iter()
            .any(|entry| entry.conflict)
        {
            return Err(GitError::new(
                "CONFLICT_UNSUPPORTED",
                "commit",
                "Không commit khi repository còn conflict; hãy giải quyết trong terminal trước.",
            ));
        }
        let args = [OsString::from("commit"), OsString::from("--file=-")];
        run_args(
            &context.runner,
            "commit",
            &args,
            Some(message),
            Limits::mutation(),
            &_operation_lease.control,
        )?
        .checked("commit")?;
        let output = context
            .runner
            .read(
                "commit-id",
                &["rev-parse", "HEAD"],
                &_operation_lease.control,
            )?
            .checked("commit-id")?;
        let commit_id = utf8_line(output.stdout, "commit-id")?;
        Ok(GitMutationResult {
            operation_id: _operation_lease.id().to_string(),
            affected_paths: context
                .status
                .status
                .entries
                .iter()
                .filter(|entry| entry.staged)
                .map(|entry| entry.current_path.clone())
                .collect(),
            commit_id: Some(commit_id),
            target: None,
        })
    })
    .await
    .map_err(|error| {
        GitError::new(
            "GIT_WORKER_FAILED",
            "commit",
            format!("Git worker: {error}"),
        )
    })??;
    ensure_active(state.inner(), &workspace_id)?;
    Ok(result)
}

#[tauri::command]
pub async fn git_push(
    service: State<'_, GitService>,
    state: State<'_, WorkspaceState>,
    window: WebviewWindow,
    request: GitPushRequest,
) -> Result<GitMutationResult, GitError> {
    let workspace = active_workspace(state.inner(), &request.workspace_id)?;
    let workspace_id = workspace.id.clone();
    let service = service.inner().clone();
    let workspace_lease = state
        .begin_mutation(&workspace.id)
        .map_err(GitError::from)?;
    let operation_lease = service.begin(window.label(), &workspace.id, "push", true)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _workspace_lease = workspace_lease;
        let _operation_lease = operation_lease;
        let runner = service.runner(&workspace.root)?;
        let context = fresh_context(&workspace, &runner, &_operation_lease.control, None)?;
        if context.status.status.status_token != request.status_token {
            return Err(stale_status());
        }
        let branch = &context.status.status.branch;
        let head = branch.head.as_deref().ok_or_else(|| {
            GitError::new(
                "NO_BRANCH",
                "push",
                "Push yêu cầu current branch, không phải detached HEAD.",
            )
        })?;
        let upstream = branch.upstream.as_deref().ok_or_else(|| {
            GitError::new(
                "NO_UPSTREAM",
                "push",
                "Branch chưa có configured upstream; Phase 6 không tự tạo upstream.",
            )
        })?;
        let (remote, target_branch) = upstream.split_once('/').ok_or_else(|| {
            GitError::new(
                "INVALID_UPSTREAM",
                "push",
                "Configured upstream không phải remote branch hợp lệ.",
            )
        })?;
        validate_ref_component(remote)?;
        validate_ref_component(target_branch)?;
        let args = [
            OsString::from("push"),
            OsString::from("--porcelain"),
            OsString::from(remote),
            OsString::from(format!("HEAD:{target_branch}")),
        ];
        run_args(
            &context.runner,
            "push",
            &args,
            None,
            Limits::push(),
            &_operation_lease.control,
        )?
        .checked("push")?;
        Ok(GitMutationResult {
            operation_id: _operation_lease.id().to_string(),
            affected_paths: Vec::new(),
            commit_id: None,
            target: Some(format!("{head} → {upstream}")),
        })
    })
    .await
    .map_err(|error| {
        GitError::new("GIT_WORKER_FAILED", "push", format!("Git worker: {error}"))
    })??;
    ensure_active(state.inner(), &workspace_id)?;
    Ok(result)
}

#[tauri::command]
pub async fn git_create_branch(
    service: State<'_, GitService>,
    state: State<'_, WorkspaceState>,
    window: WebviewWindow,
    request: GitBranchRequest,
) -> Result<GitMutationResult, GitError> {
    change_branch(service, state, window, request, true).await
}

#[tauri::command]
pub async fn git_switch_branch(
    service: State<'_, GitService>,
    state: State<'_, WorkspaceState>,
    window: WebviewWindow,
    request: GitBranchRequest,
) -> Result<GitMutationResult, GitError> {
    change_branch(service, state, window, request, false).await
}

async fn change_branch(
    service: State<'_, GitService>,
    state: State<'_, WorkspaceState>,
    window: WebviewWindow,
    request: GitBranchRequest,
    create: bool,
) -> Result<GitMutationResult, GitError> {
    let operation = if create {
        "branch-create"
    } else {
        "branch-switch"
    };
    let branch_name = request.branch_name.trim().to_owned();
    if branch_name.is_empty() || branch_name.len() > 255 || branch_name.contains('\0') {
        return Err(GitError::new(
            "INVALID_BRANCH_NAME",
            operation,
            "Tên branch không được rỗng, chứa NUL hoặc dài quá 255 bytes.",
        ));
    }
    let workspace = active_workspace(state.inner(), &request.workspace_id)?;
    let workspace_id = workspace.id.clone();
    let status_token = request.status_token;
    let service = service.inner().clone();
    let workspace_lease = state
        .begin_mutation(&workspace.id)
        .map_err(GitError::from)?;
    let operation_lease = service.begin(window.label(), &workspace.id, operation, true)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _workspace_lease = workspace_lease;
        let _operation_lease = operation_lease;
        let runner = service.runner(&workspace.root)?;
        let context = fresh_context(&workspace, &runner, &_operation_lease.control, None)?;
        if context.status.status.status_token != status_token {
            return Err(stale_status());
        }
        validate_branch_name(&context.runner, &branch_name, &_operation_lease.control)?;
        if !create && !context.status.status.entries.is_empty() {
            return Err(GitError::new(
                "WORKTREE_DIRTY",
                "branch-switch",
                "Không thể đổi branch khi working tree còn thay đổi chưa commit.",
            ));
        }
        let args = if create {
            vec![
                OsString::from("switch"),
                OsString::from("-c"),
                OsString::from(&branch_name),
            ]
        } else {
            vec![OsString::from("switch"), OsString::from(&branch_name)]
        };
        run_args(
            &context.runner,
            operation,
            &args,
            None,
            Limits::mutation(),
            &_operation_lease.control,
        )?
        .checked(operation)?;
        Ok(GitMutationResult {
            operation_id: _operation_lease.id().to_string(),
            affected_paths: Vec::new(),
            commit_id: None,
            target: Some(branch_name),
        })
    })
    .await
    .map_err(|error| {
        GitError::new(
            "GIT_WORKER_FAILED",
            operation,
            format!("Git worker: {error}"),
        )
    })??;
    ensure_active(state.inner(), &workspace_id)?;
    Ok(result)
}

async fn mutate_entries<F>(
    service: State<'_, GitService>,
    state: State<'_, WorkspaceState>,
    window: WebviewWindow,
    request: GitEntriesRequest,
    operation: &'static str,
    action: F,
) -> Result<GitMutationResult, GitError>
where
    F: FnOnce(
            &Context,
            &[status::GitStatusEntry],
            &Arc<super::OperationControl>,
        ) -> Result<Vec<String>, GitError>
        + Send
        + 'static,
{
    let workspace = active_workspace(state.inner(), &request.workspace_id)?;
    let workspace_id = workspace.id.clone();
    let service = service.inner().clone();
    let workspace_lease = state
        .begin_mutation(&workspace.id)
        .map_err(GitError::from)?;
    let operation_lease = service.begin(window.label(), &workspace.id, operation, true)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _workspace_lease = workspace_lease;
        let _operation_lease = operation_lease;
        let runner = service.runner(&workspace.root)?;
        let context = fresh_context(&workspace, &runner, &_operation_lease.control, None)?;
        if context.status.status.status_token != request.status_token {
            return Err(stale_status());
        }
        let entries = select_entries_by_id(&context.status.status.entries, &request.entry_ids)?;
        let paths = action(&context, &entries, &_operation_lease.control)?;
        Ok(GitMutationResult {
            operation_id: _operation_lease.id().to_string(),
            affected_paths: paths,
            commit_id: None,
            target: None,
        })
    })
    .await
    .map_err(|error| {
        GitError::new(
            "GIT_WORKER_FAILED",
            operation,
            format!("Git worker: {error}"),
        )
    })??;
    ensure_active(state.inner(), &workspace_id)?;
    Ok(result)
}

fn active_workspace(
    state: &WorkspaceState,
    workspace_id: &str,
) -> Result<WorkspaceSnapshot, GitError> {
    let snapshot = state
        .active_snapshot()
        .map_err(GitError::from)?
        .ok_or_else(|| GitError::new("NO_WORKSPACE", "workspace", "Hãy mở workspace trước."))?;
    if snapshot.id != workspace_id {
        return Err(GitError::new(
            "STALE_WORKSPACE",
            "workspace",
            "Workspace đã thay đổi.",
        ));
    }
    Ok(snapshot)
}

fn ensure_active(state: &WorkspaceState, workspace_id: &str) -> Result<(), GitError> {
    if state
        .active_snapshot()
        .map_err(GitError::from)?
        .is_some_and(|snapshot| snapshot.id == workspace_id)
    {
        Ok(())
    } else {
        Err(GitError::new(
            "STALE_WORKSPACE",
            "workspace",
            "Workspace đã thay đổi trong lúc Git đang chạy.",
        ))
    }
}

fn fresh_context(
    workspace: &WorkspaceSnapshot,
    runner: &GitRunner,
    control: &Arc<super::OperationControl>,
    request_id: Option<String>,
) -> Result<Context, GitError> {
    let repository = repository::inspect(&workspace.id, &workspace.root, runner, control)?;
    let status = status::read(
        &workspace.id,
        &repository.repository_id,
        &workspace.root,
        runner,
        control,
        request_id,
    )?;
    Ok(Context {
        workspace: workspace.clone(),
        repository,
        status,
        runner: GitRunner::new(
            runner.executable_path().to_path_buf(),
            runner.root_path().to_path_buf(),
        ),
    })
}

fn select_entries(
    context: &Context,
    selections: &[GitRestoreSelection],
) -> Result<Vec<status::GitStatusEntry>, GitError> {
    let ids = selections
        .iter()
        .map(|selection| selection.entry_id.clone())
        .collect::<Vec<_>>();
    select_entries_by_id(&context.status.status.entries, &ids)
}

fn select_entries_by_id(
    entries: &[status::GitStatusEntry],
    ids: &[String],
) -> Result<Vec<status::GitStatusEntry>, GitError> {
    if ids.is_empty() {
        return Err(GitError::new(
            "EMPTY_SELECTION",
            "mutation",
            "Hãy chọn ít nhất một file.",
        ));
    }
    let mut selected = Vec::with_capacity(ids.len());
    for id in ids {
        let entry = entries
            .iter()
            .find(|entry| entry.entry_id == *id)
            .ok_or_else(stale_status)?;
        if selected
            .iter()
            .any(|item: &status::GitStatusEntry| item.entry_id == entry.entry_id)
        {
            continue;
        }
        selected.push(entry.clone());
    }
    Ok(selected)
}

fn selected_paths(entries: &[status::GitStatusEntry]) -> Result<Vec<String>, GitError> {
    let mut paths = Vec::new();
    for entry in entries {
        if entry.conflict {
            return Err(GitError::new(
                "CONFLICT_UNSUPPORTED",
                "mutation",
                "Conflict cần được giải quyết trong terminal trước.",
            ));
        }
        paths.push(entry.current_path.clone());
        if let Some(original) = &entry.original_path {
            paths.push(original.clone());
        }
    }
    Ok(dedup_paths(paths))
}

fn dedup_paths(paths: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn run_args(
    runner: &GitRunner,
    operation: &str,
    args: &[OsString],
    input: Option<Vec<u8>>,
    limits: Limits,
    control: &Arc<super::OperationControl>,
) -> Result<GitOutput, GitError> {
    let refs = args
        .iter()
        .map(OsString::as_os_str)
        .collect::<Vec<&OsStr>>();
    runner.run(operation, &refs, input, limits, control)
}

fn stale_status() -> GitError {
    GitError::new(
        "STALE_STATUS",
        "mutation",
        "Git status đã thay đổi; hãy refresh và review lại.",
    )
}

fn has_head(runner: &GitRunner, control: &Arc<super::OperationControl>) -> Result<bool, GitError> {
    Ok(runner
        .read("head", &["rev-parse", "--verify", "HEAD"], control)?
        .exit_code
        == Some(0))
}

fn build_diff(
    context: &Context,
    entry: &status::GitStatusEntry,
    scope: &str,
    control: &Arc<super::OperationControl>,
) -> Result<GitDiffSnapshot, GitError> {
    let (original_path, original, modified, original_label, modified_label) = match scope {
        "staged" => {
            let old_path = entry
                .original_path
                .as_deref()
                .unwrap_or(&entry.current_path);
            let original = head_blob(&context.runner, old_path, control)?.unwrap_or_default();
            let modified =
                index_blob(&context.runner, &entry.current_path, control)?.unwrap_or_default();
            (
                entry.original_path.clone(),
                original,
                modified,
                "HEAD".to_owned(),
                "Index".to_owned(),
            )
        }
        "unstaged" => {
            let original =
                index_blob(&context.runner, &entry.current_path, control)?.unwrap_or_default();
            let modified = disk_bytes(&context.workspace.root, &entry.current_path)?;
            (
                entry.original_path.clone(),
                original,
                modified,
                "Index".to_owned(),
                "Working tree".to_owned(),
            )
        }
        _ => {
            return Err(GitError::new(
                "INVALID_SCOPE",
                "diff",
                "Diff scope phải là staged hoặc unstaged.",
            ))
        }
    };
    let original_content = decode_diff(&original, "original")?;
    let modified_content = decode_diff(&modified, "modified")?;
    let preview_id = format!(
        "{}:{}:{}",
        context.repository.repository_id, entry.entry_id, scope
    );
    Ok(GitDiffSnapshot {
        workspace_id: context.workspace.id.clone(),
        repository_id: context.repository.repository_id.clone(),
        preview_id,
        entry_id: entry.entry_id.clone(),
        scope: scope.to_owned(),
        relative_path: entry.current_path.clone(),
        original_path,
        original: original_content.text,
        modified: modified_content.text,
        original_label,
        modified_label,
        original_bytes: original.len(),
        modified_bytes: modified.len(),
        binary: original_content.binary || modified_content.binary,
        unsupported_reason: original_content.reason.or(modified_content.reason),
    })
}

struct DecodedDiff {
    text: String,
    binary: bool,
    reason: Option<String>,
}

fn decode_diff(bytes: &[u8], side: &str) -> Result<DecodedDiff, GitError> {
    if bytes.len() > MAX_DIFF_BYTES {
        return Ok(DecodedDiff {
            text: String::new(),
            binary: true,
            reason: Some(format!("{side} vượt quá 2 MiB.")),
        });
    }
    let text = match std::str::from_utf8(bytes) {
        Ok(text)
            if !text.chars().any(|character| {
                character == '\0'
                    || (character.is_control()
                        && character != '\n'
                        && character != '\r'
                        && character != '\t')
            }) =>
        {
            text.to_owned()
        }
        _ => {
            return Ok(DecodedDiff {
                text: String::new(),
                binary: true,
                reason: Some(format!("{side} là binary hoặc không phải UTF-8.")),
            })
        }
    };
    Ok(DecodedDiff {
        text: text.replace("\r\n", "\n"),
        binary: false,
        reason: None,
    })
}

fn head_blob(
    runner: &GitRunner,
    path: &str,
    control: &Arc<super::OperationControl>,
) -> Result<Option<Vec<u8>>, GitError> {
    if !has_head(runner, control)? {
        return Ok(None);
    }
    let args = [
        OsString::from("ls-tree"),
        OsString::from("-z"),
        OsString::from("HEAD"),
        OsString::from("--"),
        OsString::from(path),
    ];
    let output = run_args(runner, "head-tree", &args, None, Limits::read(), control)?
        .checked("head-tree")?;
    let Some(oid) = parse_tree_oid(&output.stdout, path)? else {
        return Ok(None);
    };
    cat_blob(runner, &oid, control)
}

fn index_blob(
    runner: &GitRunner,
    path: &str,
    control: &Arc<super::OperationControl>,
) -> Result<Option<Vec<u8>>, GitError> {
    let args = [
        OsString::from("ls-files"),
        OsString::from("-s"),
        OsString::from("-z"),
        OsString::from("--"),
        OsString::from(path),
    ];
    let output = run_args(runner, "index-tree", &args, None, Limits::read(), control)?
        .checked("index-tree")?;
    let Some(oid) = parse_index_oid(&output.stdout, path)? else {
        return Ok(None);
    };
    cat_blob(runner, &oid, control)
}

fn cat_blob(
    runner: &GitRunner,
    oid: &str,
    control: &Arc<super::OperationControl>,
) -> Result<Option<Vec<u8>>, GitError> {
    if oid.len() < 4 || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(GitError::new(
            "GIT_OBJECT_INVALID",
            "diff",
            "Git object ID không hợp lệ.",
        ));
    }
    let args = [
        OsString::from("cat-file"),
        OsString::from("blob"),
        OsString::from(oid),
    ];
    let output =
        run_args(runner, "cat-blob", &args, None, Limits::read(), control)?.checked("cat-blob")?;
    Ok(Some(output.stdout))
}

fn parse_tree_oid(bytes: &[u8], path: &str) -> Result<Option<String>, GitError> {
    for record in bytes.split(|byte| *byte == 0) {
        let Some((metadata, record_path)) = split_once_byte(record, b'\t') else {
            continue;
        };
        if record_path != path.as_bytes() {
            continue;
        }
        let fields = metadata.split(|byte| *byte == b' ').collect::<Vec<_>>();
        if fields.len() == 3 && fields[1] == b"blob" {
            return Ok(Some(String::from_utf8_lossy(fields[2]).into_owned()));
        }
        return Err(GitError::new(
            "UNSUPPORTED_GIT_ENTRY",
            "diff",
            "Diff chỉ hỗ trợ regular file, không hỗ trợ Git tree/gitlink.",
        ));
    }
    Ok(None)
}

fn parse_index_oid(bytes: &[u8], path: &str) -> Result<Option<String>, GitError> {
    for record in bytes.split(|byte| *byte == 0) {
        let Some((metadata, record_path)) = split_once_byte(record, b'\t') else {
            continue;
        };
        if record_path != path.as_bytes() {
            continue;
        }
        let fields = metadata.split(|byte| *byte == b' ').collect::<Vec<_>>();
        if fields.len() >= 3 && fields[2] == b"0" {
            return Ok(Some(String::from_utf8_lossy(fields[1]).into_owned()));
        }
        return Err(GitError::new(
            "CONFLICT_UNSUPPORTED",
            "diff",
            "Conflict index chưa có stage-0 blob để review.",
        ));
    }
    Ok(None)
}

fn split_once_byte(bytes: &[u8], delimiter: u8) -> Option<(&[u8], &[u8])> {
    let index = bytes.iter().position(|byte| *byte == delimiter)?;
    Some((&bytes[..index], &bytes[index + 1..]))
}

fn disk_bytes(root: &Path, path: &str) -> Result<Vec<u8>, GitError> {
    let target = repository::validate_path(root, path)?;
    match fs::File::open(target) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take((MAX_DIFF_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|error| GitError::io("diff", error))?;
            Ok(bytes)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(GitError::io("diff", error)),
    }
}

fn utf8_line(bytes: Vec<u8>, operation: &str) -> Result<String, GitError> {
    String::from_utf8(bytes)
        .map_err(|_| {
            GitError::new(
                "UNSUPPORTED_PATH_ENCODING",
                operation,
                "Git output không phải UTF-8.",
            )
        })
        .map(|value| value.trim().to_owned())
}

fn validate_ref_component(value: &str) -> Result<(), GitError> {
    if value.is_empty()
        || value.starts_with('-')
        || value.contains('\0')
        || value.contains(' ')
        || value.contains("..")
        || value.contains("//")
    {
        return Err(GitError::new(
            "INVALID_UPSTREAM",
            "push",
            "Configured upstream chứa ref không an toàn.",
        ));
    }
    Ok(())
}

fn validate_branch_name(
    runner: &GitRunner,
    branch_name: &str,
    control: &Arc<super::OperationControl>,
) -> Result<(), GitError> {
    if branch_name.starts_with('-') || branch_name.contains('\0') {
        return Err(GitError::new(
            "INVALID_BRANCH_NAME",
            "branch",
            "Tên branch không hợp lệ.",
        ));
    }
    runner
        .read(
            "branch-check",
            &["check-ref-format", "--branch", branch_name],
            control,
        )?
        .checked("branch")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[cfg(windows)]
    #[test]
    fn real_diff_restore_and_commit_use_head_index_and_disk_separately() {
        static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);
        let sequence = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "vibe-rider-phase6-operations-{}-{sequence}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let executable = super::super::process::resolve_git().unwrap();
        let run_fixture = |args: &[&str]| {
            let mut command = Command::new(&executable);
            command.current_dir(&root).args(args);
            super::super::process::sanitize_environment(&mut command);
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
            let output = command.output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        run_fixture(&["init", "--initial-branch=main", "--template="]);
        run_fixture(&["config", "core.autocrlf", "false"]);
        run_fixture(&["config", "core.eol", "lf"]);
        run_fixture(&["config", "user.name", "Phase Six"]);
        run_fixture(&["config", "user.email", "phase6@example.invalid"]);
        std::fs::write(root.join("note.txt"), b"one\n").unwrap();
        run_fixture(&["add", "--", "note.txt"]);
        run_fixture(&["commit", "-m", "initial"]);
        std::fs::write(root.join("note.txt"), b"two\n").unwrap();

        let service = GitService::default();
        let lease = service
            .begin("main", "fixture", "operations-test", true)
            .unwrap();
        let runner = GitRunner::new(executable.clone(), root.clone());
        let workspace = WorkspaceSnapshot {
            id: "fixture".into(),
            root: root.clone(),
        };
        let context = fresh_context(&workspace, &runner, &lease.control, None).unwrap();
        let entry = context.status.status.entries.first().unwrap().clone();
        let unstaged = build_diff(&context, &entry, "unstaged", &lease.control).unwrap();
        assert_eq!(unstaged.original, "one\n");
        assert_eq!(unstaged.modified, "two\n");

        let add_args = [
            OsString::from("add"),
            OsString::from("-A"),
            OsString::from("--"),
            OsString::from("note.txt"),
        ];
        run_args(
            &runner,
            "add",
            &add_args,
            None,
            Limits::mutation(),
            &lease.control,
        )
        .unwrap()
        .checked("add")
        .unwrap();
        std::fs::write(root.join("note.txt"), b"three\n").unwrap();
        let context = fresh_context(&workspace, &runner, &lease.control, None).unwrap();
        let entry = context.status.status.entries.first().unwrap().clone();
        let staged = build_diff(&context, &entry, "staged", &lease.control).unwrap();
        assert_eq!(staged.original, "one\n");
        assert_eq!(staged.modified, "two\n");
        let unstaged = build_diff(&context, &entry, "unstaged", &lease.control).unwrap();
        assert_eq!(unstaged.original, "two\n");
        assert_eq!(unstaged.modified, "three\n");

        let restore_args = [
            OsString::from("restore"),
            OsString::from("--worktree"),
            OsString::from("--"),
            OsString::from("note.txt"),
        ];
        run_args(
            &runner,
            "restore",
            &restore_args,
            None,
            Limits::mutation(),
            &lease.control,
        )
        .unwrap()
        .checked("restore")
        .unwrap();
        assert_eq!(std::fs::read(root.join("note.txt")).unwrap(), b"two\n");
        let context = fresh_context(&workspace, &runner, &lease.control, None).unwrap();
        let commit_args = [OsString::from("commit"), OsString::from("--file=-")];
        run_args(
            &runner,
            "commit",
            &commit_args,
            Some(b"phase six\nmultiline\n".to_vec()),
            Limits::mutation(),
            &lease.control,
        )
        .unwrap()
        .checked("commit")
        .unwrap();
        let head = context
            .runner
            .read("head", &["rev-parse", "HEAD"], &lease.control)
            .unwrap()
            .checked("head")
            .unwrap();
        assert!(!utf8_line(head.stdout, "head").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn real_push_uses_configured_upstream_as_one_explicit_ref() {
        static NEXT_PUSH_FIXTURE: AtomicU64 = AtomicU64::new(0);
        let sequence = NEXT_PUSH_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "vibe-rider-phase6-push-{}-{sequence}",
            std::process::id()
        ));
        let remote = std::env::temp_dir().join(format!(
            "vibe-rider-phase6-push-remote-{}-{sequence}.git",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let executable = super::super::process::resolve_git().unwrap();
        let run_at = |directory: &Path, args: &[&str]| {
            let mut command = Command::new(&executable);
            command.current_dir(directory).args(args);
            super::super::process::sanitize_environment(&mut command);
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
            let output = command.output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        run_at(&root, &["init", "--initial-branch=main", "--template="]);
        run_at(&root, &["config", "core.autocrlf", "false"]);
        run_at(&root, &["config", "user.name", "Phase Six"]);
        run_at(&root, &["config", "user.email", "phase6@example.invalid"]);
        std::fs::write(root.join("push.txt"), b"one\n").unwrap();
        run_at(&root, &["add", "--", "push.txt"]);
        run_at(&root, &["commit", "-m", "initial"]);
        run_at(&root, &["init", "--bare", remote.to_str().unwrap()]);
        run_at(
            &root,
            &["remote", "add", "origin", remote.to_str().unwrap()],
        );
        run_at(&root, &["push", "-u", "origin", "main"]);
        std::fs::write(root.join("push.txt"), b"two\n").unwrap();
        run_at(&root, &["add", "--", "push.txt"]);
        run_at(&root, &["commit", "-m", "second"]);

        let service = GitService::default();
        let lease = service.begin("main", "fixture", "push-test", true).unwrap();
        let runner = GitRunner::new(executable.clone(), root.clone());
        let workspace = WorkspaceSnapshot {
            id: "fixture".into(),
            root: root.clone(),
        };
        let context = fresh_context(&workspace, &runner, &lease.control, None).unwrap();
        assert_eq!(
            context.status.status.branch.upstream.as_deref(),
            Some("origin/main")
        );
        let args = [
            OsString::from("push"),
            OsString::from("--porcelain"),
            OsString::from("origin"),
            OsString::from("HEAD:main"),
        ];
        run_args(&runner, "push", &args, None, Limits::push(), &lease.control)
            .unwrap()
            .checked("push")
            .unwrap();
        run_at(&remote, &["show-ref", "--verify", "refs/heads/main"]);
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(remote);
    }
}
