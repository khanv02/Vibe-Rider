use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use crate::path_guard::is_link_or_reparse;
use crate::workspace::{WorkspaceError, WorkspaceSnapshot, WorkspaceState};

const MAX_SESSIONS: usize = 100;
const MAX_EVENTS_PER_SESSION: usize = 2_000;
const MAX_SESSION_BYTES: u64 = 2 * 1024 * 1024;
const MAX_EVENT_SUMMARY_CHARS: usize = 240;
const MAX_EVENT_DETAIL_CHARS: usize = 8 * 1024;
const MAX_TITLE_CHARS: usize = 120;
const STORAGE_DIRECTORY: &str = "activity-sessions";
const TRASH_EXTENSION: &str = "trashed";

#[derive(Default)]
pub struct ActivityService {
    active: Mutex<HashSet<(String, String)>>,
    next_id: AtomicU64,
    file_lock: Mutex<()>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ActivitySessionStatus {
    Active,
    Ended,
    Interrupted,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySessionSummary {
    pub session_id: String,
    pub workspace_id: String,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub status: ActivitySessionStatus,
    pub event_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEvent {
    pub sequence: u64,
    pub at: u64,
    pub kind: String,
    pub summary: String,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySessionDetail {
    pub session: ActivitySessionSummary,
    pub events: Vec<ActivityEvent>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivitySessionRequest {
    pub workspace_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityStartRequest {
    pub workspace_id: String,
    pub title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityAppendRequest {
    pub workspace_id: String,
    pub session_id: String,
    pub kind: String,
    pub summary: String,
    pub detail: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityDeleteRequest {
    pub workspace_id: String,
    pub session_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionHeader {
    session_id: String,
    workspace_id: String,
    workspace_key: String,
    title: String,
    created_at: u64,
    updated_at: u64,
    status: ActivitySessionStatus,
    event_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ActivityRecord {
    Session {
        session: SessionHeader,
    },
    Event {
        event: ActivityEvent,
    },
    End {
        at: u64,
        status: ActivitySessionStatus,
    },
}

impl ActivityService {
    pub fn close_all_for_shutdown(&self, app: &AppHandle) {
        let active = self
            .active
            .lock()
            .map(|sessions| sessions.iter().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for (workspace_id, session_id) in active {
            let _ = self.finish(
                app,
                &workspace_id,
                &session_id,
                ActivitySessionStatus::Interrupted,
            );
        }
    }

    fn mark_active(&self, workspace_id: &str, session_id: &str) -> Result<(), WorkspaceError> {
        self.active
            .lock()
            .map_err(|_| WorkspaceError::new("ACTIVITY_STATE", "Activity state không khả dụng."))?
            .insert((workspace_id.to_owned(), session_id.to_owned()));
        Ok(())
    }

    fn unmark_active(&self, workspace_id: &str, session_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&(workspace_id.to_owned(), session_id.to_owned()));
        }
    }

    fn is_active(&self, workspace_id: &str, session_id: &str) -> bool {
        self.active
            .lock()
            .map(|active| active.contains(&(workspace_id.to_owned(), session_id.to_owned())))
            .unwrap_or(false)
    }

    fn lock_file<'a>(
        &'a self,
        _path: &Path,
    ) -> Result<std::sync::MutexGuard<'a, ()>, WorkspaceError> {
        self.file_lock.lock().map_err(|_| {
            WorkspaceError::new("ACTIVITY_STATE", "Activity file lock không khả dụng.")
        })
    }

    fn create_session(
        &self,
        app: &AppHandle,
        snapshot: &WorkspaceSnapshot,
        title: Option<String>,
    ) -> Result<ActivitySessionSummary, WorkspaceError> {
        let directory = storage_directory(app, &snapshot.root)?;
        let _guard = self.lock_file(&directory)?;
        fs::create_dir_all(&directory)
            .map_err(|error| io_error("tạo activity directory", error))?;

        let title = sanitize_text(
            title.as_deref().unwrap_or("Workspace activity"),
            MAX_TITLE_CHARS,
        );
        let title = if title.is_empty() {
            "Workspace activity".to_string()
        } else {
            title
        };
        let now = now_millis()?;
        let sequence = self.next_id.fetch_add(1, Ordering::Relaxed);
        let seed = format!(
            "{}:{}:{}:{}",
            snapshot.id,
            now,
            sequence,
            std::process::id()
        );
        let session_id = hex_digest(seed.as_bytes());
        let path = session_path(&directory, &session_id)?;
        let header = SessionHeader {
            session_id: session_id.clone(),
            workspace_id: snapshot.id.clone(),
            workspace_key: workspace_key(&snapshot.root),
            title,
            created_at: now,
            updated_at: now,
            status: ActivitySessionStatus::Active,
            event_count: 0,
        };
        let record = ActivityRecord::Session {
            session: header.clone(),
        };
        let bytes = serialize_record(&record)?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| io_error("tạo activity session", error))?;
        if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
            let _ = fs::remove_file(&path);
            return Err(io_error("ghi activity session", error));
        }
        self.mark_active(&snapshot.id, &session_id)?;
        Ok(summary_from_header(header, &snapshot.id))
    }

    fn append(
        &self,
        app: &AppHandle,
        snapshot: &WorkspaceSnapshot,
        request: ActivityAppendRequest,
    ) -> Result<ActivityEvent, WorkspaceError> {
        validate_session_id(&request.session_id)?;
        validate_event_kind(&request.kind)?;
        if !self.is_active(&snapshot.id, &request.session_id) {
            return Err(WorkspaceError::new(
                "ACTIVITY_NOT_ACTIVE",
                "Activity session không còn active; session cũ chỉ được đọc.",
            ));
        }
        let directory = storage_directory(app, &snapshot.root)?;
        let path = session_path(&directory, &request.session_id)?;
        let _guard = self.lock_file(&path)?;
        let (header, events, status) = read_session_file(&path, &workspace_key(&snapshot.root))?;
        if status != ActivitySessionStatus::Active {
            return Err(WorkspaceError::new(
                "ACTIVITY_NOT_ACTIVE",
                "Activity session không còn active; session cũ chỉ được đọc.",
            ));
        }
        if events.len() >= MAX_EVENTS_PER_SESSION {
            return Err(WorkspaceError::new(
                "ACTIVITY_LIMIT",
                "Activity session đã đạt giới hạn event.",
            ));
        }
        let event = ActivityEvent {
            sequence: header.event_count as u64 + 1,
            at: now_millis()?,
            kind: request.kind,
            summary: sanitize_text(&request.summary, MAX_EVENT_SUMMARY_CHARS),
            detail: request
                .detail
                .as_deref()
                .map(|value| sanitize_text(value, MAX_EVENT_DETAIL_CHARS))
                .filter(|value| !value.is_empty()),
        };
        if event.summary.is_empty() {
            return Err(WorkspaceError::new(
                "ACTIVITY_INVALID",
                "Activity summary không được rỗng.",
            ));
        }
        let record = ActivityRecord::Event {
            event: event.clone(),
        };
        let bytes = serialize_record(&record)?;
        let current_size = fs::metadata(&path)
            .map_err(|error| io_error("đọc activity session", error))?
            .len();
        if current_size.saturating_add(bytes.len() as u64) > MAX_SESSION_BYTES {
            return Err(WorkspaceError::new(
                "ACTIVITY_LIMIT",
                "Activity session đã đạt giới hạn dung lượng.",
            ));
        }
        append_record(&path, &bytes)?;
        Ok(event)
    }

    fn finish(
        &self,
        app: &AppHandle,
        workspace_id: &str,
        session_id: &str,
        status: ActivitySessionStatus,
    ) -> Result<(), WorkspaceError> {
        validate_session_id(session_id)?;
        let snapshot = active_snapshot_for_workspace(app, workspace_id)?;
        let directory = storage_directory(app, &snapshot.root)?;
        let path = session_path(&directory, session_id)?;
        let _guard = self.lock_file(&path)?;
        let (_, _, current_status) = read_session_file(&path, &workspace_key(&snapshot.root))?;
        if current_status == ActivitySessionStatus::Active {
            append_record(
                &path,
                &serialize_record(&ActivityRecord::End {
                    at: now_millis()?,
                    status,
                })?,
            )?;
        }
        self.unmark_active(workspace_id, session_id);
        Ok(())
    }

    fn list(
        &self,
        app: &AppHandle,
        snapshot: &WorkspaceSnapshot,
    ) -> Result<Vec<ActivitySessionSummary>, WorkspaceError> {
        let directory = storage_directory(app, &snapshot.root)?;
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let _guard = self.lock_file(&directory)?;
        let mut sessions = Vec::new();
        for entry in
            fs::read_dir(&directory).map_err(|error| io_error("đọc activity directory", error))?
        {
            let entry = entry.map_err(|error| io_error("đọc activity entry", error))?;
            let path = entry.path();
            if !path.is_file()
                || is_link_or_reparse(
                    &entry
                        .metadata()
                        .map_err(|error| io_error("đọc activity metadata", error))?,
                )
            {
                continue;
            }
            if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
                continue;
            }
            if let Ok((header, events, status)) =
                read_session_file(&path, &workspace_key(&snapshot.root))
            {
                let mut summary = summary_from_header(header, &snapshot.id);
                summary.event_count = events.len();
                summary.status = if status == ActivitySessionStatus::Active
                    && !self.is_active(&snapshot.id, &summary.session_id)
                {
                    ActivitySessionStatus::Interrupted
                } else {
                    status
                };
                summary.updated_at = events
                    .last()
                    .map(|event| event.at)
                    .unwrap_or(summary.created_at);
                sessions.push(summary);
            }
        }
        sessions.sort_by_key(|session| std::cmp::Reverse(session.updated_at));
        sessions.truncate(MAX_SESSIONS);
        Ok(sessions)
    }

    fn list_trash(
        &self,
        app: &AppHandle,
        snapshot: &WorkspaceSnapshot,
    ) -> Result<Vec<ActivitySessionSummary>, WorkspaceError> {
        let directory = storage_directory(app, &snapshot.root)?;
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let _guard = self.lock_file(&directory)?;
        let mut sessions = Vec::new();
        for entry in fs::read_dir(&directory).map_err(|error| io_error("read Activity Trash", error))? {
            let entry = entry.map_err(|error| io_error("read Activity Trash entry", error))?;
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some(TRASH_EXTENSION) {
                continue;
            }
            if let Ok((header, events, status)) = read_session_file(&path, &workspace_key(&snapshot.root)) {
                let mut summary = summary_from_header(header, &snapshot.id);
                summary.event_count = events.len();
                summary.status = status;
                summary.updated_at = events.last().map(|event| event.at).unwrap_or(summary.created_at);
                sessions.push(summary);
            }
        }
        sessions.sort_by_key(|session| std::cmp::Reverse(session.updated_at));
        sessions.truncate(MAX_SESSIONS);
        Ok(sessions)
    }

    fn read(
        &self,
        app: &AppHandle,
        snapshot: &WorkspaceSnapshot,
        session_id: &str,
    ) -> Result<ActivitySessionDetail, WorkspaceError> {
        validate_session_id(session_id)?;
        let directory = storage_directory(app, &snapshot.root)?;
        let path = session_path(&directory, session_id)?;
        let _guard = self.lock_file(&path)?;
        let (header, events, status) = read_session_file(&path, &workspace_key(&snapshot.root))?;
        let mut summary = summary_from_header(header, &snapshot.id);
        summary.event_count = events.len();
        summary.status = if status == ActivitySessionStatus::Active
            && !self.is_active(&snapshot.id, session_id)
        {
            ActivitySessionStatus::Interrupted
        } else {
            status
        };
        summary.updated_at = events
            .last()
            .map(|event| event.at)
            .unwrap_or(summary.created_at);
        Ok(ActivitySessionDetail {
            session: summary,
            events,
        })
    }

    #[allow(dead_code)]
    fn delete(
        &self,
        app: &AppHandle,
        snapshot: &WorkspaceSnapshot,
        session_id: &str,
    ) -> Result<(), WorkspaceError> {
        validate_session_id(session_id)?;
        if self.is_active(&snapshot.id, session_id) {
            return Err(WorkspaceError::new(
                "ACTIVITY_ACTIVE",
                "Không thể xoá activity session đang active.",
            ));
        }
        let directory = storage_directory(app, &snapshot.root)?;
        let path = session_path(&directory, session_id)?;
        let _guard = self.lock_file(&path)?;
        let metadata =
            fs::symlink_metadata(&path).map_err(|error| io_error("đọc activity session", error))?;
        if is_link_or_reparse(&metadata) || !metadata.is_file() {
            return Err(WorkspaceError::new(
                "ACTIVITY_INVALID",
                "Activity session không hợp lệ.",
            ));
        }
        fs::remove_file(&path).map_err(|error| io_error("xoá activity session", error))
    }
}

impl ActivityService {
    fn move_to_trash(
        &self,
        app: &AppHandle,
        snapshot: &WorkspaceSnapshot,
        session_id: &str,
    ) -> Result<(), WorkspaceError> {
        validate_session_id(session_id)?;
        if self.is_active(&snapshot.id, session_id) {
            return Err(WorkspaceError::new("ACTIVITY_ACTIVE", "The active Activity session cannot be deleted."));
        }
        let directory = storage_directory(app, &snapshot.root)?;
        let path = session_path(&directory, session_id)?;
        let _guard = self.lock_file(&path)?;
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| io_error("read Activity session", error))?;
        if is_link_or_reparse(&metadata) || !metadata.is_file() {
            return Err(WorkspaceError::new("ACTIVITY_INVALID", "The Activity session is invalid."));
        }
        let (_, events, _) = read_session_file(&path, &workspace_key(&snapshot.root))?;
        if events.is_empty() {
            return fs::remove_file(&path).map_err(|error| io_error("remove empty Activity session", error));
        }
        let trash_path = trashed_session_path(&directory, session_id)?;
        if trash_path.exists() {
            return Err(WorkspaceError::new("ACTIVITY_EXISTS", "An Activity session with this ID is already in Trash."));
        }
        fs::rename(&path, &trash_path).map_err(|error| io_error("move Activity session to Trash", error))
    }

    fn restore_from_trash(
        &self,
        app: &AppHandle,
        snapshot: &WorkspaceSnapshot,
        session_id: &str,
    ) -> Result<ActivitySessionSummary, WorkspaceError> {
        validate_session_id(session_id)?;
        let directory = storage_directory(app, &snapshot.root)?;
        let trash_path = trashed_session_path(&directory, session_id)?;
        let path = session_path(&directory, session_id)?;
        let _guard = self.lock_file(&directory)?;
        let metadata = fs::symlink_metadata(&trash_path)
            .map_err(|error| io_error("read Activity Trash session", error))?;
        if is_link_or_reparse(&metadata) || !metadata.is_file() {
            return Err(WorkspaceError::new("ACTIVITY_INVALID", "The Activity Trash entry is invalid."));
        }
        let (header, events, status) = read_session_file(&trash_path, &workspace_key(&snapshot.root))?;
        if path.exists() {
            return Err(WorkspaceError::new("ACTIVITY_EXISTS", "An Activity session with this ID already exists."));
        }
        fs::rename(&trash_path, &path).map_err(|error| io_error("restore Activity session", error))?;
        let mut summary = summary_from_header(header, &snapshot.id);
        summary.event_count = events.len();
        summary.status = status;
        summary.updated_at = events.last().map(|event| event.at).unwrap_or(summary.created_at);
        Ok(summary)
    }
}

#[tauri::command]
pub fn activity_session_start(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    activity: State<'_, ActivityService>,
    request: ActivityStartRequest,
) -> Result<ActivitySessionSummary, WorkspaceError> {
    let snapshot = active_snapshot_for_request(&state, &request.workspace_id)?;
    activity.create_session(&app, &snapshot, request.title)
}

#[tauri::command]
pub fn activity_session_list(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    activity: State<'_, ActivityService>,
    request: ActivitySessionRequest,
) -> Result<Vec<ActivitySessionSummary>, WorkspaceError> {
    let snapshot = active_snapshot_for_request(&state, &request.workspace_id)?;
    activity.list(&app, &snapshot)
}

#[tauri::command]
pub fn activity_session_trash_list(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    activity: State<'_, ActivityService>,
    request: ActivitySessionRequest,
) -> Result<Vec<ActivitySessionSummary>, WorkspaceError> {
    let snapshot = active_snapshot_for_request(&state, &request.workspace_id)?;
    activity.list_trash(&app, &snapshot)
}

#[tauri::command]
pub fn activity_session_read(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    activity: State<'_, ActivityService>,
    request: ActivityDeleteRequest,
) -> Result<ActivitySessionDetail, WorkspaceError> {
    let snapshot = active_snapshot_for_request(&state, &request.workspace_id)?;
    activity.read(&app, &snapshot, &request.session_id)
}

#[tauri::command]
pub fn activity_session_append(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    activity: State<'_, ActivityService>,
    request: ActivityAppendRequest,
) -> Result<ActivityEvent, WorkspaceError> {
    let snapshot = active_snapshot_for_request(&state, &request.workspace_id)?;
    activity.append(&app, &snapshot, request)
}

#[tauri::command]
pub fn activity_session_end(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    activity: State<'_, ActivityService>,
    request: ActivityDeleteRequest,
) -> Result<(), WorkspaceError> {
    let snapshot = active_snapshot_for_request(&state, &request.workspace_id)?;
    activity.finish(
        &app,
        &snapshot.id,
        &request.session_id,
        ActivitySessionStatus::Ended,
    )
}

#[tauri::command]
pub fn activity_session_delete(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    activity: State<'_, ActivityService>,
    request: ActivityDeleteRequest,
) -> Result<(), WorkspaceError> {
    let snapshot = active_snapshot_for_request(&state, &request.workspace_id)?;
    activity.move_to_trash(&app, &snapshot, &request.session_id)
}

#[tauri::command]
pub fn activity_session_restore(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    activity: State<'_, ActivityService>,
    request: ActivityDeleteRequest,
) -> Result<ActivitySessionSummary, WorkspaceError> {
    let snapshot = active_snapshot_for_request(&state, &request.workspace_id)?;
    activity.restore_from_trash(&app, &snapshot, &request.session_id)
}

fn active_snapshot_for_request(
    state: &WorkspaceState,
    workspace_id: &str,
) -> Result<WorkspaceSnapshot, WorkspaceError> {
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

fn active_snapshot_for_workspace(
    app: &AppHandle,
    workspace_id: &str,
) -> Result<WorkspaceSnapshot, WorkspaceError> {
    app.state::<WorkspaceState>()
        .active_snapshot()?
        .filter(|snapshot| snapshot.id == workspace_id)
        .ok_or_else(|| WorkspaceError::new("STALE_WORKSPACE", "Workspace đã thay đổi."))
}

fn storage_directory(app: &AppHandle, root: &Path) -> Result<PathBuf, WorkspaceError> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| WorkspaceError::new("ACTIVITY_PATH", error.to_string()))?;
    let canonical_base = prepare_directory(&base)?;
    let key = workspace_key(root);
    let directory = canonical_base.join(STORAGE_DIRECTORY).join(key);
    prepare_directory(&directory)
}

fn prepare_directory(path: &Path) -> Result<PathBuf, WorkspaceError> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if is_link_or_reparse(&metadata) || !metadata.is_dir() {
            return Err(WorkspaceError::new(
                "ACTIVITY_PATH",
                "Activity storage path không hợp lệ.",
            ));
        }
    } else {
        fs::create_dir_all(path).map_err(|error| io_error("tạo activity storage", error))?;
    }
    fs::canonicalize(path).map_err(|error| io_error("xác thực activity storage", error))
}

fn session_path(directory: &Path, session_id: &str) -> Result<PathBuf, WorkspaceError> {
    validate_session_id(session_id)?;
    Ok(directory.join(format!("session-{session_id}.jsonl")))
}

fn trashed_session_path(directory: &Path, session_id: &str) -> Result<PathBuf, WorkspaceError> {
    validate_session_id(session_id)?;
    Ok(directory.join(format!("session-{session_id}.{TRASH_EXTENSION}")))
}

fn read_session_file(
    path: &Path,
    expected_workspace_key: &str,
) -> Result<(SessionHeader, Vec<ActivityEvent>, ActivitySessionStatus), WorkspaceError> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| io_error("đọc activity session", error))?;
    if is_link_or_reparse(&metadata) || !metadata.is_file() {
        return Err(WorkspaceError::new(
            "ACTIVITY_INVALID",
            "Activity session không hợp lệ.",
        ));
    }
    if metadata.len() > MAX_SESSION_BYTES {
        return Err(WorkspaceError::new(
            "ACTIVITY_LIMIT",
            "Activity session vượt giới hạn dung lượng.",
        ));
    }
    let file = File::open(path).map_err(|error| io_error("mở activity session", error))?;
    let mut lines = BufReader::new(file).lines();
    let first = lines
        .next()
        .ok_or_else(|| WorkspaceError::new("ACTIVITY_INVALID", "Activity session rỗng."))?
        .map_err(|error| io_error("đọc activity session", error))?;
    let ActivityRecord::Session { session: header } = serde_json::from_str(&first)
        .map_err(|_| WorkspaceError::new("ACTIVITY_INVALID", "Activity session không hợp lệ."))?
    else {
        return Err(WorkspaceError::new(
            "ACTIVITY_INVALID",
            "Activity session thiếu header.",
        ));
    };
    if header.workspace_key != expected_workspace_key {
        return Err(WorkspaceError::new(
            "STALE_WORKSPACE",
            "Activity session thuộc workspace khác.",
        ));
    }
    let mut events = Vec::new();
    let mut status = ActivitySessionStatus::Active;
    for _ in 0..=MAX_EVENTS_PER_SESSION + 1 {
        let Some(line) = lines.next() else {
            break;
        };
        let line = line.map_err(|error| io_error("đọc activity event", error))?;
        let record: ActivityRecord = serde_json::from_str(&line)
            .map_err(|_| WorkspaceError::new("ACTIVITY_INVALID", "Activity event không hợp lệ."))?;
        match record {
            ActivityRecord::Event { event } => events.push(event),
            ActivityRecord::End { status: ended, .. } => status = ended,
            ActivityRecord::Session { .. } => {
                return Err(WorkspaceError::new(
                    "ACTIVITY_INVALID",
                    "Activity session có header lặp.",
                ));
            }
        }
    }
    if lines.next().is_some() {
        return Err(WorkspaceError::new(
            "ACTIVITY_LIMIT",
            "Activity session có quá nhiều event.",
        ));
    }
    Ok((header, events, status))
}

fn serialize_record(record: &ActivityRecord) -> Result<Vec<u8>, WorkspaceError> {
    let mut bytes = serde_json::to_vec(record)
        .map_err(|error| WorkspaceError::new("ACTIVITY_SERIALIZE", error.to_string()))?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn append_record(path: &Path, bytes: &[u8]) -> Result<(), WorkspaceError> {
    let mut file = OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|error| io_error("mở activity session để ghi", error))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| io_error("ghi activity session", error))
}

fn summary_from_header(header: SessionHeader, workspace_id: &str) -> ActivitySessionSummary {
    ActivitySessionSummary {
        session_id: header.session_id,
        workspace_id: workspace_id.to_owned(),
        title: header.title,
        created_at: header.created_at,
        updated_at: header.updated_at,
        status: header.status,
        event_count: header.event_count,
    }
}

fn workspace_key(root: &Path) -> String {
    hex_digest(root.to_string_lossy().as_bytes())
}

fn validate_session_id(value: &str) -> Result<(), WorkspaceError> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(WorkspaceError::new(
            "ACTIVITY_INVALID",
            "Activity session id không hợp lệ.",
        ));
    }
    Ok(())
}

fn validate_event_kind(value: &str) -> Result<(), WorkspaceError> {
    if matches!(
        value,
        "checkpoint" | "terminal" | "search" | "tool" | "system" | "cli"
    ) {
        Ok(())
    } else {
        Err(WorkspaceError::new(
            "ACTIVITY_INVALID",
            "Activity event kind không được hỗ trợ.",
        ))
    }
}

fn sanitize_text(value: &str, max_chars: usize) -> String {
    let mut result = String::new();
    let mut redact_next = false;
    for token in value.split_whitespace() {
        let lower = token.to_ascii_lowercase();
        let is_sensitive_key = sensitive_key(&lower);
        if redact_next {
            result.push_str("[REDACTED]");
            redact_next = false;
        } else if is_sensitive_key && (lower.contains('=') || lower.ends_with(':')) {
            let key = token.split(['=', ':']).next().unwrap_or("secret");
            result.push_str(key);
            result.push_str("=[REDACTED]");
        } else if is_sensitive_key {
            result.push_str(token);
            result.push(' ');
            redact_next = true;
            continue;
        } else if looks_like_url_credential(token) {
            result.push_str("[REDACTED_URL]");
        } else if contains_known_secret(&lower) {
            result.push_str("[REDACTED]");
        } else {
            result.push_str(token);
        }
        result.push(' ');
    }
    result.truncate(
        result
            .char_indices()
            .nth(max_chars)
            .map(|(index, _)| index)
            .unwrap_or(result.len()),
    );
    result.trim().to_string()
}

fn contains_known_secret(value: &str) -> bool {
    value.contains("sk-")
        || value.contains("ghp_")
        || value.contains("github_pat_")
        || value.contains("xoxb-")
        || value.contains("aiza")
        || value.starts_with("-----begin")
}

fn looks_like_url_credential(value: &str) -> bool {
    let Some(scheme_end) = value.find("://") else {
        return false;
    };
    let authority = &value[scheme_end + 3..];
    let Some(at) = authority.find('@') else {
        return false;
    };
    authority[..at].contains(':')
}

fn sensitive_key(value: &str) -> bool {
    let key = value
        .trim_matches(|character: char| {
            !character.is_ascii_alphanumeric() && character != '_' && character != '-'
        })
        .trim_start_matches('-');
    let key = key.split(['=', ':']).next().unwrap_or(key);
    [
        "api_key",
        "apikey",
        "api-key",
        "token",
        "secret",
        "password",
        "passwd",
        "authorization",
        "cookie",
        "bearer",
    ]
    .iter()
    .any(|needle| key == *needle || key.contains(needle))
}

fn now_millis() -> Result<u64, WorkspaceError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .map_err(|_| WorkspaceError::new("ACTIVITY_CLOCK", "System clock không hợp lệ."))
}

fn hex_digest(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn io_error(operation: &str, error: std::io::Error) -> WorkspaceError {
    WorkspaceError::new("ACTIVITY_IO", format!("Không thể {operation}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{sanitize_text, validate_event_kind, validate_session_id};

    #[test]
    fn redacts_common_secret_forms_and_bounds_text() {
        let value = sanitize_text(
            "--token=sk-live-123 password hunter2 AWS_SECRET_ACCESS_KEY=abc hello",
            120,
        );
        assert!(value.contains("--token=[REDACTED]"));
        assert!(value.contains("password [REDACTED]"));
        assert!(!value.contains("hunter2"));
        assert!(!value.contains("AWS_SECRET_ACCESS_KEY=abc"));
        assert!(!sanitize_text("https://user:password@example.test", 120).contains("password"));

        let bounded = sanitize_text(&"x".repeat(200), 20);
        assert_eq!(bounded.chars().count(), 20);
    }

    #[test]
    fn rejects_path_injection_through_session_id() {
        assert!(validate_session_id("../session").is_err());
        assert!(validate_session_id(&"a".repeat(64)).is_ok());
    }

    #[test]
    fn allowlists_event_kinds() {
        assert!(validate_event_kind("checkpoint").is_ok());
        assert!(validate_event_kind("shell-command").is_err());
    }
}
