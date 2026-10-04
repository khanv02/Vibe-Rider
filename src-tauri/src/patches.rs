use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{State, WebviewWindow};

use crate::file_editor::{
    read_file_from_disk, write_file_to_disk, TextFileSnapshot, WriteFileResult,
};
use crate::workspace::{WorkspaceError, WorkspaceState};

const MAX_PROPOSAL_BYTES: usize = 2 * 1024 * 1024;
const PROPOSAL_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Default)]
pub struct PatchService {
    next_id: AtomicU64,
    proposals: Mutex<HashMap<String, PatchRecord>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchProposalRequest {
    pub workspace_id: String,
    pub relative_path: String,
    pub expected_revision: String,
    pub original: String,
    pub proposed: String,
    pub source: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchApplyRequest {
    pub workspace_id: String,
    pub proposal_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchRejectRequest {
    pub workspace_id: String,
    pub proposal_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchProposal {
    pub proposal_id: String,
    pub workspace_id: String,
    pub relative_path: String,
    pub expected_revision: String,
    pub original: String,
    pub proposed: String,
    pub content_digest: String,
    pub source: Option<String>,
    pub state: PatchState,
    pub created_at: u64,
    pub expires_at: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PatchState {
    Pending,
    Applying,
    Applied,
    Rejected,
    Stale,
    Failed,
    Expired,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchApplyResult {
    pub proposal_id: String,
    pub state: PatchState,
    pub write_result: Option<WriteFileResult>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchRejectResult {
    pub proposal_id: String,
    pub state: PatchState,
}

struct PatchRecord {
    proposal: PatchProposal,
    owner: String,
}

#[tauri::command]
pub async fn patch_propose(
    window: WebviewWindow,
    state: State<'_, WorkspaceState>,
    patches: State<'_, PatchService>,
    request: PatchProposalRequest,
) -> Result<PatchProposal, WorkspaceError> {
    let workspace = active_workspace(&state, &request.workspace_id)?;
    validate_text(&request.original, "original")?;
    validate_text(&request.proposed, "proposed")?;
    if request.original == request.proposed {
        return Err(WorkspaceError::new(
            "EMPTY_PATCH",
            "Proposal phải có thay đổi thực sự.",
        ));
    }

    let relative_path = request.relative_path.clone();
    let workspace_id = request.workspace_id.clone();
    let snapshot = tauri::async_runtime::spawn_blocking(move || {
        read_file_from_disk(&workspace_id, &workspace.root, &relative_path)
    })
    .await
    .map_err(|error| WorkspaceError::new("IO_ERROR", format!("File worker failed: {error}")))??;

    ensure_snapshot_matches(&snapshot, &request.expected_revision, &request.original)?;
    if !snapshot.writable {
        return Err(WorkspaceError::new("READ_ONLY", "File không cho phép ghi."));
    }
    if snapshot.eol == "mixed" || snapshot.eol == "cr" {
        return Err(WorkspaceError::new(
            "UNSUPPORTED_EOL",
            "Không thể tạo proposal cho file có mixed EOL hoặc bare CR.",
        ));
    }

    let now = unix_ms();
    let normalized_path = snapshot.relative_path.clone();
    let proposed = request.proposed.clone();
    let proposal_id = format!(
        "patch-{}-{}",
        now,
        patches
            .next_id
            .fetch_add(1, Ordering::Relaxed)
            .saturating_add(1)
    );
    let proposal = PatchProposal {
        proposal_id: proposal_id.clone(),
        workspace_id: request.workspace_id,
        relative_path: normalized_path.clone(),
        expected_revision: request.expected_revision,
        original: request.original,
        proposed,
        content_digest: digest(&normalized_path, &request.proposed),
        source: request.source,
        state: PatchState::Pending,
        created_at: now,
        expires_at: now.saturating_add(PROPOSAL_TTL.as_millis() as u64),
    };
    let mut records = patches
        .proposals
        .lock()
        .map_err(|_| WorkspaceError::new("STATE_UNAVAILABLE", "Không thể lưu patch proposal."))?;
    records.insert(
        proposal_id,
        PatchRecord {
            proposal: proposal.clone(),
            owner: window.label().to_owned(),
        },
    );
    Ok(proposal)
}

#[tauri::command]
pub async fn patch_apply(
    window: WebviewWindow,
    state: State<'_, WorkspaceState>,
    patches: State<'_, PatchService>,
    request: PatchApplyRequest,
) -> Result<PatchApplyResult, WorkspaceError> {
    let proposal = {
        let mut records = patches.proposals.lock().map_err(|_| {
            WorkspaceError::new("STATE_UNAVAILABLE", "Không thể đọc patch proposal.")
        })?;
        let record = records.get_mut(&request.proposal_id).ok_or_else(|| {
            WorkspaceError::new("PROPOSAL_NOT_FOUND", "Proposal không còn tồn tại.")
        })?;
        if record.owner != window.label() {
            return Err(WorkspaceError::new(
                "PROPOSAL_OWNER_MISMATCH",
                "Proposal thuộc cửa sổ workspace khác.",
            ));
        }
        if record.proposal.workspace_id != request.workspace_id {
            return Err(WorkspaceError::new(
                "STALE_WORKSPACE",
                "Workspace đã thay đổi.",
            ));
        }
        if record.proposal.expires_at <= unix_ms() {
            record.proposal.state = PatchState::Expired;
            return Err(WorkspaceError::new(
                "PROPOSAL_EXPIRED",
                "Proposal đã hết hạn; hãy tạo proposal mới.",
            ));
        }
        if record.proposal.state != PatchState::Pending {
            return Err(WorkspaceError::new(
                "PROPOSAL_NOT_PENDING",
                "Proposal không còn ở trạng thái chờ duyệt.",
            ));
        }
        record.proposal.state = PatchState::Applying;
        record.proposal.clone()
    };

    let lease = match state.begin_mutation(&request.workspace_id) {
        Ok(lease) => lease,
        Err(error) => {
            mark_failed(&patches, &request.proposal_id, PatchState::Failed);
            return Err(error);
        }
    };
    let workspace_root = lease.snapshot.root.clone();
    let proposal_for_worker = proposal.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        let current = read_file_from_disk(
            &proposal_for_worker.workspace_id,
            &workspace_root,
            &proposal_for_worker.relative_path,
        )?;
        ensure_snapshot_matches(
            &current,
            &proposal_for_worker.expected_revision,
            &proposal_for_worker.original,
        )?;
        write_file_to_disk(
            &proposal_for_worker.workspace_id,
            &workspace_root,
            &proposal_for_worker.relative_path,
            &proposal_for_worker.expected_revision,
            &proposal_for_worker.proposed,
        )
    })
    .await
    .map_err(|error| WorkspaceError::new("IO_ERROR", format!("Patch worker failed: {error}")))?;

    match result {
        Ok(write_result) => {
            let mut records = patches.proposals.lock().map_err(|_| {
                WorkspaceError::new("STATE_UNAVAILABLE", "Không thể cập nhật patch state.")
            })?;
            if let Some(record) = records.get_mut(&request.proposal_id) {
                record.proposal.state = PatchState::Applied;
            }
            Ok(PatchApplyResult {
                proposal_id: request.proposal_id,
                state: PatchState::Applied,
                write_result: Some(write_result),
            })
        }
        Err(error) => {
            let state = if error.code == "FILE_CONFLICT" || error.code == "STALE_WORKSPACE" {
                PatchState::Stale
            } else {
                PatchState::Failed
            };
            mark_failed(&patches, &request.proposal_id, state);
            Err(error)
        }
    }
}

#[tauri::command]
pub fn patch_reject(
    window: WebviewWindow,
    patches: State<'_, PatchService>,
    request: PatchRejectRequest,
) -> Result<PatchRejectResult, WorkspaceError> {
    let mut records = patches
        .proposals
        .lock()
        .map_err(|_| WorkspaceError::new("STATE_UNAVAILABLE", "Không thể đọc patch proposal."))?;
    let record = records
        .get(&request.proposal_id)
        .ok_or_else(|| WorkspaceError::new("PROPOSAL_NOT_FOUND", "Proposal không còn tồn tại."))?;
    if record.owner != window.label() || record.proposal.workspace_id != request.workspace_id {
        return Err(WorkspaceError::new(
            "PROPOSAL_OWNER_MISMATCH",
            "Proposal không thuộc workspace hiện tại.",
        ));
    }
    if record.proposal.state != PatchState::Pending {
        return Err(WorkspaceError::new(
            "PROPOSAL_NOT_PENDING",
            "Chỉ có thể reject proposal đang chờ duyệt.",
        ));
    }
    records.remove(&request.proposal_id);
    Ok(PatchRejectResult {
        proposal_id: request.proposal_id,
        state: PatchState::Rejected,
    })
}

impl PatchService {
    pub fn close_all_for_shutdown(&self) {
        if let Ok(mut records) = self.proposals.lock() {
            records.clear();
        }
    }
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

fn ensure_snapshot_matches(
    snapshot: &TextFileSnapshot,
    expected_revision: &str,
    original: &str,
) -> Result<(), WorkspaceError> {
    if snapshot.revision != expected_revision {
        return Err(WorkspaceError::new(
            "FILE_CONFLICT",
            "File đã thay đổi trên đĩa; proposal không còn an toàn.",
        ));
    }
    if snapshot.content != original {
        return Err(WorkspaceError::new(
            "PROPOSAL_SOURCE_MISMATCH",
            "Nội dung gốc của proposal không khớp file hiện tại.",
        ));
    }
    Ok(())
}

fn validate_text(value: &str, label: &str) -> Result<(), WorkspaceError> {
    if value.len() > MAX_PROPOSAL_BYTES {
        return Err(WorkspaceError::new(
            "PATCH_TOO_LARGE",
            format!("Nội dung {label} vượt quá giới hạn Editor."),
        ));
    }
    if value.chars().any(|character| {
        character == '\0'
            || (character.is_control()
                && character != '\n'
                && character != '\r'
                && character != '\t')
    }) {
        return Err(WorkspaceError::new(
            "INVALID_PATCH_TEXT",
            format!("Nội dung {label} có ký tự không hợp lệ."),
        ));
    }
    Ok(())
}

fn digest(path: &str, content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher.update([0]);
    hasher.update(content.as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

fn mark_failed(service: &PatchService, proposal_id: &str, state: PatchState) {
    if let Ok(mut records) = service.proposals.lock() {
        if let Some(record) = records.get_mut(proposal_id) {
            record.proposal.state = state;
        }
    }
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_is_stable_and_changes_with_content() {
        assert_eq!(digest("src/main.rs", "one"), digest("src/main.rs", "one"));
        assert_ne!(digest("src/main.rs", "one"), digest("src/main.rs", "two"));
    }

    #[test]
    fn patch_text_rejects_binary_controls() {
        assert!(validate_text("hello\nworld", "candidate").is_ok());
        assert_eq!(
            validate_text("bad\0text", "candidate").unwrap_err().code,
            "INVALID_PATCH_TEXT"
        );
    }
}
