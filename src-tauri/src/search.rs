use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Condvar, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use crate::path_guard::{is_link_or_reparse, is_within, resolve_directory, validate_relative_path};
use crate::workspace::{WorkspaceError, WorkspaceState};

const MAX_QUERY_BYTES: usize = 4 * 1024;
const MAX_SEARCH_SECONDS: u64 = 15;
const MAX_CANDIDATES: usize = 20_000;
const MAX_DEPTH: usize = 64;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_MATCHES: usize = 500;
const MAX_SUGGESTIONS: usize = 24;
const MAX_RANGES_PER_MATCH: usize = 32;
const MAX_STDOUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const MAX_SNIPPET_BYTES: usize = 1024;
const MAX_BATCH_FILES: usize = 128;
const MAX_BATCH_UTF16_UNITS: usize = 24_000;
const MAX_JOBS: usize = 8;

#[derive(Clone, Default)]
pub struct SearchService {
    inner: Arc<SearchInner>,
}

#[derive(Default)]
struct SearchInner {
    next_id: AtomicU64,
    jobs: Mutex<HashMap<u64, Arc<SearchJob>>>,
}

struct SearchJob {
    id: u64,
    owner: String,
    workspace_id: String,
    cancelled: AtomicBool,
    result: Mutex<Option<SearchResult>>,
    ready: Condvar,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchStartRequest {
    pub(crate) workspace_id: String,
    pub(crate) query: String,
    pub(crate) relative_directory: String,
    pub(crate) case_sensitive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchJobRequest {
    workspace_id: String,
    search_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStartResult {
    pub workspace_id: String,
    pub search_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub workspace_id: String,
    pub search_id: String,
    pub status: String,
    pub matches: Vec<SearchMatch>,
    pub suggestions: Vec<SearchSuggestion>,
    pub partial_reason: Option<String>,
    pub warnings: Vec<String>,
    pub duration_ms: u128,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSuggestion {
    pub relative_path: String,
    pub kind: String,
    pub score: u32,
    pub exact: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub relative_path: String,
    pub line: u32,
    pub column: u32,
    pub end_column: u32,
    pub snippet: String,
    pub snippet_start: u32,
    pub ranges: Vec<SearchRange>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRange {
    pub start_column: u32,
    pub end_column: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchError {
    pub code: String,
    pub message: String,
}

impl SearchError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl From<WorkspaceError> for SearchError {
    fn from(error: WorkspaceError) -> Self {
        Self::new(error.code, error.message)
    }
}

impl SearchService {
    pub fn start(
        &self,
        owner: String,
        workspace_id: String,
        root: PathBuf,
        request: SearchStartRequest,
    ) -> Result<SearchStartResult, SearchError> {
        validate_request(&request)?;
        let mut jobs = self.inner.jobs.lock().map_err(|_| {
            SearchError::new("STATE_UNAVAILABLE", "Không thể đọc trạng thái Search.")
        })?;
        if jobs.len() >= MAX_JOBS {
            return Err(SearchError::new(
                "SEARCH_BUSY",
                "Có quá nhiều Search đang chạy. Hãy huỷ một Search trước.",
            ));
        }
        let id = self
            .inner
            .next_id
            .fetch_add(1, Ordering::Relaxed)
            .saturating_add(1);
        let job = Arc::new(SearchJob {
            id,
            owner: owner.clone(),
            workspace_id: workspace_id.clone(),
            cancelled: AtomicBool::new(false),
            result: Mutex::new(None),
            ready: Condvar::new(),
        });
        jobs.insert(id, Arc::clone(&job));
        drop(jobs);

        let inner = Arc::clone(&self.inner);
        let worker_workspace_id = workspace_id.clone();
        if thread::Builder::new()
            .name(format!("vibe-rider-search-{id}"))
            .spawn(move || {
                let started = Instant::now();
                let result = run_search(
                    &root,
                    &worker_workspace_id,
                    id,
                    &request,
                    Arc::clone(&job),
                    started,
                );
                if let Ok(mut slot) = job.result.lock() {
                    *slot = Some(result);
                    job.ready.notify_all();
                }
                if let Ok(mut jobs) = inner.jobs.lock() {
                    // Keep a completed result available to search_result. It is
                    // removed after the consumer takes it or during shutdown.
                    if let Some(current) = jobs.get(&id) {
                        if !Arc::ptr_eq(current, &job) {
                            jobs.remove(&id);
                        }
                    }
                }
            })
            .is_err()
        {
            if let Ok(mut jobs) = self.inner.jobs.lock() {
                jobs.remove(&id);
            }
            return Err(SearchError::new(
                "SEARCH_START_FAILED",
                "Không thể khởi động Search worker.",
            ));
        }

        Ok(SearchStartResult {
            workspace_id,
            search_id: id.to_string(),
        })
    }

    fn get(
        &self,
        owner: &str,
        workspace_id: &str,
        search_id: &str,
    ) -> Result<Arc<SearchJob>, SearchError> {
        let id = search_id
            .parse::<u64>()
            .map_err(|_| SearchError::new("INVALID_SEARCH", "Search ID không hợp lệ."))?;
        let jobs = self.inner.jobs.lock().map_err(|_| {
            SearchError::new("STATE_UNAVAILABLE", "Không thể đọc trạng thái Search.")
        })?;
        let job = jobs.get(&id).cloned().ok_or_else(|| {
            SearchError::new(
                "SEARCH_NOT_FOUND",
                "Search không còn tồn tại hoặc đã hết hạn.",
            )
        })?;
        if job.owner != owner || job.workspace_id != workspace_id {
            return Err(SearchError::new(
                "INVALID_SEARCH_OWNER",
                "Search không thuộc window/workspace này.",
            ));
        }
        Ok(job)
    }

    fn cancel(
        &self,
        owner: &str,
        workspace_id: &str,
        search_id: &str,
    ) -> Result<bool, SearchError> {
        let job = match self.get(owner, workspace_id, search_id) {
            Ok(job) => job,
            Err(error) if error.code == "SEARCH_NOT_FOUND" => return Ok(false),
            Err(error) => return Err(error),
        };
        job.cancelled.store(true, Ordering::Release);
        Ok(true)
    }

    fn take_result(&self, id: u64) {
        if let Ok(mut jobs) = self.inner.jobs.lock() {
            jobs.remove(&id);
        }
    }

    pub(crate) fn wait_result(
        &self,
        owner: &str,
        workspace_id: &str,
        search_id: &str,
    ) -> Result<SearchResult, SearchError> {
        let job = self.get(owner, workspace_id, search_id)?;
        let mut slot = job
            .result
            .lock()
            .map_err(|_| SearchError::new("STATE_UNAVAILABLE", "Không thể đọc kết quả Search."))?;
        while slot.is_none() {
            slot = job.ready.wait(slot).map_err(|_| {
                SearchError::new("STATE_UNAVAILABLE", "Search worker không khả dụng.")
            })?;
        }
        let result = slot
            .take()
            .ok_or_else(|| SearchError::new("SEARCH_EMPTY", "Search không trả về kết quả."))?;
        self.take_result(job.id);
        Ok(result)
    }

    pub fn close_all_for_shutdown(&self) {
        let jobs = self
            .inner
            .jobs
            .lock()
            .map(|jobs| jobs.values().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for job in jobs {
            job.cancelled.store(true, Ordering::Release);
        }
    }
}

#[tauri::command]
pub async fn search_start(
    state: State<'_, WorkspaceState>,
    service: State<'_, SearchService>,
    window: WebviewWindow,
    request: SearchStartRequest,
) -> Result<SearchStartResult, SearchError> {
    let snapshot = state
        .active_snapshot()
        .map_err(SearchError::from)?
        .ok_or_else(|| SearchError::new("NO_WORKSPACE", "Hãy mở workspace trước."))?;
    if snapshot.id != request.workspace_id {
        return Err(SearchError::new(
            "STALE_WORKSPACE",
            "Workspace đã thay đổi.",
        ));
    }
    let _ = resolve_directory(&snapshot.root, &request.relative_directory)
        .map_err(SearchError::from)?;
    service.start(
        window.label().to_owned(),
        snapshot.id,
        snapshot.root,
        request,
    )
}

#[tauri::command]
pub async fn search_result(
    state: State<'_, WorkspaceState>,
    service: State<'_, SearchService>,
    window: WebviewWindow,
    request: SearchJobRequest,
) -> Result<SearchResult, SearchError> {
    let job = service.get(window.label(), &request.workspace_id, &request.search_id)?;
    let id = job.id;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut slot = job
            .result
            .lock()
            .map_err(|_| SearchError::new("STATE_UNAVAILABLE", "Không thể đọc kết quả Search."))?;
        while slot.is_none() {
            slot = job.ready.wait(slot).map_err(|_| {
                SearchError::new("STATE_UNAVAILABLE", "Search worker không khả dụng.")
            })?;
        }
        slot.take()
            .ok_or_else(|| SearchError::new("SEARCH_EMPTY", "Search không trả về kết quả."))
    })
    .await
    .map_err(|error| SearchError::new("SEARCH_WORKER_FAILED", error.to_string()))??;
    service.take_result(id);
    if !state
        .active_snapshot()
        .map_err(SearchError::from)?
        .is_some_and(|active| active.id == result.workspace_id)
    {
        return Err(SearchError::new(
            "STALE_WORKSPACE",
            "Workspace đã thay đổi trong lúc Search.",
        ));
    }
    Ok(result)
}

#[tauri::command]
pub fn search_cancel(
    service: State<'_, SearchService>,
    window: WebviewWindow,
    request: SearchJobRequest,
) -> Result<bool, SearchError> {
    service.cancel(window.label(), &request.workspace_id, &request.search_id)
}

fn validate_request(request: &SearchStartRequest) -> Result<(), SearchError> {
    if request.query.trim().is_empty() {
        return Err(SearchError::new(
            "INVALID_QUERY",
            "Search query không được rỗng.",
        ));
    }
    if request.query.len() > MAX_QUERY_BYTES {
        return Err(SearchError::new(
            "QUERY_TOO_LARGE",
            format!("Search query vượt quá {MAX_QUERY_BYTES} bytes."),
        ));
    }
    if request.query.contains(['\0', '\r', '\n']) {
        return Err(SearchError::new(
            "INVALID_QUERY",
            "Search query không được chứa NUL hoặc xuống dòng.",
        ));
    }
    validate_relative_path(&request.relative_directory)
        .map(|_| ())
        .map_err(SearchError::from)
}

fn run_search(
    root: &Path,
    workspace_id: &str,
    id: u64,
    request: &SearchStartRequest,
    job: Arc<SearchJob>,
    started: Instant,
) -> SearchResult {
    let deadline = started + Duration::from_secs(MAX_SEARCH_SECONDS);
    let mut warnings = Vec::new();
    let mut partial_reason = None;
    let mut matches = Vec::new();
    let candidate_result =
        match collect_candidates(root, &request.relative_directory, &job, deadline) {
            Ok(result) => {
                if let Some(reason) = result.partial_reason.as_ref() {
                    partial_reason = Some(reason.clone());
                }
                result
            }
            Err(error) => {
                return SearchResult {
                    workspace_id: workspace_id.to_owned(),
                    search_id: id.to_string(),
                    status: if job.cancelled.load(Ordering::Acquire) {
                        "cancelled".to_owned()
                    } else {
                        "error".to_owned()
                    },
                    matches,
                    suggestions: Vec::new(),
                    partial_reason: Some(error.message),
                    warnings,
                    duration_ms: started.elapsed().as_millis(),
                };
            }
        };
    let suggestions = rank_suggestions(
        &candidate_result.entries,
        &request.query,
        request.case_sensitive,
    );
    let candidates = candidate_result.files;

    if candidates.is_empty() {
        return result(
            workspace_id,
            id,
            if job.cancelled.load(Ordering::Acquire) {
                "cancelled"
            } else {
                "noMatch"
            },
            matches,
            suggestions,
            partial_reason,
            warnings,
            started,
        );
    }

    let executable = match resolve_rg(root) {
        Ok(path) => path,
        Err(error) => {
            return result(
                workspace_id,
                id,
                "error",
                matches,
                suggestions,
                Some(error.message),
                warnings,
                started,
            );
        }
    };

    for batch in batches(candidates) {
        if job.cancelled.load(Ordering::Acquire) {
            partial_reason = Some("cancelled".to_owned());
            break;
        }
        if Instant::now() >= deadline {
            partial_reason = Some("timeout".to_owned());
            break;
        }
        match run_batch(&executable, root, &batch, request, &job, deadline) {
            Ok(batch_result) => {
                matches.extend(batch_result.matches);
                if batch_result.warning.is_some() {
                    warnings.extend(batch_result.warning);
                }
                if batch_result.partial_reason.is_some() {
                    partial_reason = batch_result.partial_reason;
                    break;
                }
                if matches.len() >= MAX_MATCHES {
                    matches.truncate(MAX_MATCHES);
                    partial_reason = Some("resultLimit".to_owned());
                    break;
                }
            }
            Err(error) => {
                partial_reason = Some(error.message);
                break;
            }
        }
    }

    let status = if job.cancelled.load(Ordering::Acquire) {
        "cancelled"
    } else if partial_reason.is_some() {
        "partial"
    } else if matches.is_empty() {
        "noMatch"
    } else {
        "ready"
    };
    result(
        workspace_id,
        id,
        status,
        matches,
        suggestions,
        partial_reason,
        warnings,
        started,
    )
}

#[allow(clippy::too_many_arguments)]
fn result(
    workspace_id: &str,
    id: u64,
    status: &str,
    matches: Vec<SearchMatch>,
    suggestions: Vec<SearchSuggestion>,
    partial_reason: Option<String>,
    warnings: Vec<String>,
    started: Instant,
) -> SearchResult {
    SearchResult {
        workspace_id: workspace_id.to_owned(),
        search_id: id.to_string(),
        status: status.to_owned(),
        matches,
        suggestions,
        partial_reason,
        warnings,
        duration_ms: started.elapsed().as_millis(),
    }
}

struct CandidateResult {
    files: Vec<PathBuf>,
    entries: Vec<SuggestionCandidate>,
    partial_reason: Option<String>,
}

struct SuggestionCandidate {
    relative_path: PathBuf,
    kind: &'static str,
}

fn collect_candidates(
    root: &Path,
    relative_directory: &str,
    job: &SearchJob,
    deadline: Instant,
) -> Result<CandidateResult, SearchError> {
    let scope = resolve_directory(root, relative_directory).map_err(SearchError::from)?;
    let canonical_root = fs::canonicalize(root).map_err(|error| io_error("workspace", error))?;
    let canonical_scope = fs::canonicalize(&scope).map_err(|error| io_error("scope", error))?;
    if !is_within(&canonical_root, &canonical_scope) {
        return Err(SearchError::new(
            "OUTSIDE_WORKSPACE",
            "Search scope nằm ngoài workspace.",
        ));
    }
    let scope_relative = scope
        .strip_prefix(root)
        .map_err(|_| SearchError::new("OUTSIDE_WORKSPACE", "Search scope nằm ngoài workspace."))?
        .to_path_buf();
    let mut files = Vec::new();
    let mut entries = Vec::new();
    let mut stack = vec![(scope, scope_relative.to_path_buf(), 0usize)];
    let mut seen = HashSet::new();
    while let Some((directory, relative, depth)) = stack.pop() {
        if job.cancelled.load(Ordering::Acquire) {
            return Ok(CandidateResult {
                files,
                entries,
                partial_reason: Some("cancelled".to_owned()),
            });
        }
        if Instant::now() >= deadline {
            return Ok(CandidateResult {
                files,
                entries,
                partial_reason: Some("timeout".to_owned()),
            });
        }
        if depth > MAX_DEPTH {
            return Ok(CandidateResult {
                files,
                entries,
                partial_reason: Some("depthLimit".to_owned()),
            });
        }
        for entry in fs::read_dir(&directory).map_err(|error| io_error("directory", error))? {
            if files.len() >= MAX_CANDIDATES {
                return Ok(CandidateResult {
                    files,
                    entries,
                    partial_reason: Some("candidateLimit".to_owned()),
                });
            }
            let entry = entry.map_err(|error| io_error("directory entry", error))?;
            let name = entry.file_name();
            let name_text = name.to_str().ok_or_else(|| {
                SearchError::new("UNSUPPORTED_PATH_ENCODING", "Tên file không phải Unicode.")
            })?;
            if name_text == ".git" || (name_text.starts_with('.') && !is_ignore_file(name_text)) {
                continue;
            }
            if matches!(name_text, "node_modules" | "target" | "dist" | "build") {
                continue;
            }
            let path = entry.path();
            let metadata =
                fs::symlink_metadata(&path).map_err(|error| io_error("metadata", error))?;
            if is_link_or_reparse(&metadata) {
                continue;
            }
            let canonical = fs::canonicalize(&path).map_err(|error| io_error("path", error))?;
            if !is_within(&canonical_root, &canonical) {
                continue;
            }
            let child_relative = if relative.as_os_str().is_empty() {
                PathBuf::from(name_text)
            } else {
                relative.join(name_text)
            };
            if metadata.is_dir() {
                entries.push(SuggestionCandidate {
                    relative_path: child_relative.clone(),
                    kind: "directory",
                });
                if seen.insert(canonical) {
                    stack.push((path, child_relative, depth + 1));
                }
                continue;
            }
            if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
                continue;
            }
            if child_relative.to_str().is_none() {
                continue;
            }
            entries.push(SuggestionCandidate {
                relative_path: child_relative.clone(),
                kind: "file",
            });
            files.push(child_relative);
        }
    }
    files.sort_by(|left, right| left.to_string_lossy().cmp(&right.to_string_lossy()));
    Ok(CandidateResult {
        files,
        entries,
        partial_reason: None,
    })
}

fn is_ignore_file(name: &str) -> bool {
    matches!(name, ".gitignore" | ".ignore" | ".rgignore")
}

fn rank_suggestions(
    entries: &[SuggestionCandidate],
    query: &str,
    case_sensitive: bool,
) -> Vec<SearchSuggestion> {
    let query = normalize_suggestion_text(query, case_sensitive);
    let mut suggestions = entries
        .iter()
        .filter_map(|entry| {
            let relative_path = entry.relative_path.to_string_lossy().replace('\\', "/");
            let (score, exact) = suggestion_score(&relative_path, &query, case_sensitive)?;
            Some(SearchSuggestion {
                relative_path,
                kind: entry.kind.to_owned(),
                score,
                exact,
            })
        })
        .collect::<Vec<_>>();
    suggestions.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.relative_path.len().cmp(&right.relative_path.len()))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    suggestions.truncate(MAX_SUGGESTIONS);
    suggestions
}

fn suggestion_score(path: &str, query: &str, case_sensitive: bool) -> Option<(u32, bool)> {
    let path = normalize_suggestion_text(path, case_sensitive);
    let basename = path.rsplit('/').next().unwrap_or(path.as_str());
    if path == query {
        return Some((1_000, true));
    }
    if basename == query {
        return Some((980, true));
    }
    if basename.starts_with(query) {
        return Some((930, false));
    }
    if path.starts_with(query) {
        return Some((880, false));
    }
    if let Some(gap) = subsequence_gap(basename, query) {
        return Some((700u32.saturating_sub((gap as u32).saturating_mul(4)), false));
    }
    subsequence_gap(&path, query)
        .map(|gap| (520u32.saturating_sub((gap as u32).saturating_mul(3)), false))
}

fn normalize_suggestion_text(value: &str, case_sensitive: bool) -> String {
    let normalized = value.trim().replace('\\', "/").trim_matches('/').to_owned();
    if case_sensitive {
        normalized
    } else {
        normalized.to_lowercase()
    }
}

fn subsequence_gap(candidate: &str, query: &str) -> Option<usize> {
    let candidate = candidate.chars().collect::<Vec<_>>();
    let query = query.chars().collect::<Vec<_>>();
    if query.is_empty() {
        return None;
    }
    let mut cursor = 0usize;
    let mut gap = 0usize;
    for wanted in query {
        let offset = candidate[cursor..]
            .iter()
            .position(|value| *value == wanted)?;
        gap = gap.saturating_add(offset);
        cursor = cursor.saturating_add(offset + 1);
    }
    Some(gap)
}

struct BatchResult {
    matches: Vec<SearchMatch>,
    partial_reason: Option<String>,
    warning: Option<String>,
}

fn batches(files: Vec<PathBuf>) -> Vec<Vec<PathBuf>> {
    let mut result = Vec::new();
    let mut current = Vec::new();
    let mut units = 0usize;
    for file in files {
        let file_units = file.to_string_lossy().encode_utf16().count();
        if !current.is_empty()
            && (current.len() >= MAX_BATCH_FILES || units + file_units > MAX_BATCH_UTF16_UNITS)
        {
            result.push(current);
            current = Vec::new();
            units = 0;
        }
        current.push(file);
        units += file_units;
    }
    if !current.is_empty() {
        result.push(current);
    }
    result
}

fn run_batch(
    executable: &Path,
    root: &Path,
    files: &[PathBuf],
    request: &SearchStartRequest,
    job: &SearchJob,
    deadline: Instant,
) -> Result<BatchResult, SearchError> {
    let mut command = Command::new(executable);
    command
        .current_dir(root)
        .args([
            "--no-config",
            "--json",
            "--fixed-strings",
            "--no-heading",
            "--line-number",
            "--column",
            "--no-follow",
            "--encoding",
            "none",
            "--max-filesize",
            "2M",
        ])
        .arg(if request.case_sensitive {
            "--case-sensitive"
        } else {
            "--ignore-case"
        })
        .arg("-e")
        .arg(&request.query)
        .arg("--")
        .args(files);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_window(&mut command);
    let mut child = command.spawn().map_err(|error| {
        SearchError::new(
            "SEARCH_START_FAILED",
            format!("Không thể chạy ripgrep: {error}"),
        )
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| SearchError::new("SEARCH_IO_ERROR", "Không thể mở stdout của ripgrep."))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| SearchError::new("SEARCH_IO_ERROR", "Không thể mở stderr của ripgrep."))?;
    let (stdout_handle, stdout_buffer) = read_pipe(stdout, MAX_STDOUT_BYTES);
    let (stderr_handle, stderr_buffer) = read_pipe(stderr, MAX_STDERR_BYTES);
    let mut stop_reason = None;
    loop {
        if job.cancelled.load(Ordering::Acquire) {
            stop_reason = Some("cancelled".to_owned());
            terminate(&mut child);
            break;
        }
        if Instant::now() >= deadline {
            stop_reason = Some("timeout".to_owned());
            terminate(&mut child);
            break;
        }
        if stdout_buffer.1.load(Ordering::Acquire) || stderr_buffer.1.load(Ordering::Acquire) {
            stop_reason = Some("outputLimit".to_owned());
            terminate(&mut child);
            break;
        }
        if child
            .try_wait()
            .map_err(|error| io_error("ripgrep", error))?
            .is_some()
        {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    let exit = child.wait().map_err(|error| io_error("ripgrep", error))?;
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();
    if stop_reason.is_some() {
        return Ok(BatchResult {
            matches: parse_matches(
                &stdout_buffer
                    .0
                    .lock()
                    .map(|bytes| bytes.clone())
                    .unwrap_or_default(),
            )?,
            partial_reason: stop_reason,
            warning: stderr_text(&stderr_buffer.0),
        });
    }
    let stdout = stdout_buffer
        .0
        .lock()
        .map(|bytes| bytes.clone())
        .unwrap_or_default();
    let stderr = stderr_text(&stderr_buffer.0);
    let matches = parse_matches(&stdout)?;
    match exit.code() {
        Some(0) | Some(1) => Ok(BatchResult {
            matches,
            partial_reason: None,
            warning: stderr,
        }),
        Some(code) => Err(SearchError::new(
            "SEARCH_FAILED",
            format!(
                "ripgrep kết thúc với mã {code}: {}",
                stderr.unwrap_or_default()
            ),
        )),
        None => Err(SearchError::new(
            "SEARCH_FAILED",
            "ripgrep bị kết thúc bất thường.",
        )),
    }
}

type PipeState = (Arc<Mutex<Vec<u8>>>, Arc<AtomicBool>);

fn read_pipe<R: Read + Send + 'static>(
    mut reader: R,
    limit: usize,
) -> (thread::JoinHandle<()>, PipeState) {
    let bytes = Arc::new(Mutex::new(Vec::new()));
    let over_limit = Arc::new(AtomicBool::new(false));
    let output = Arc::clone(&bytes);
    let over = Arc::clone(&over_limit);
    let handle = thread::spawn(move || {
        let mut buffer = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    if let Ok(mut target) = output.lock() {
                        if target.len() + count > limit {
                            over.store(true, Ordering::Release);
                            let remaining = limit.saturating_sub(target.len());
                            target.extend_from_slice(&buffer[..remaining]);
                        } else {
                            target.extend_from_slice(&buffer[..count]);
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });
    (handle, (bytes, over_limit))
}

fn parse_matches(raw: &[u8]) -> Result<Vec<SearchMatch>, SearchError> {
    let mut matches = Vec::new();
    let reader = BufReader::new(raw);
    for line in reader.split(b'\n') {
        let line = line.map_err(|error| io_error("Search output", error))?;
        if line.is_empty() {
            continue;
        }
        let value: serde_json::Value = serde_json::from_slice(&line).map_err(|_| {
            SearchError::new(
                "SEARCH_PARSE_FAILED",
                "ripgrep trả JSON record không hợp lệ.",
            )
        })?;
        if value.get("type").and_then(serde_json::Value::as_str) != Some("match") {
            continue;
        }
        let data = value
            .get("data")
            .ok_or_else(|| SearchError::new("SEARCH_PARSE_FAILED", "Match record thiếu data."))?;
        let path = text_field(data.get("path"))?.ok_or_else(|| {
            SearchError::new(
                "UNSUPPORTED_PATH_ENCODING",
                "Search path không phải Unicode.",
            )
        })?;
        let line_number = data
            .get("line_number")
            .and_then(serde_json::Value::as_u64)
            .ok_or_else(|| SearchError::new("SEARCH_PARSE_FAILED", "Match record thiếu line."))?;
        let line_text = text_field(data.get("lines"))?.unwrap_or_default();
        let clean_line = line_text.trim_end_matches(['\r', '\n']);
        let mut ranges = Vec::new();
        if let Some(submatches) = data.get("submatches").and_then(serde_json::Value::as_array) {
            for submatch in submatches.iter().take(MAX_RANGES_PER_MATCH) {
                let start = submatch
                    .get("start")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0) as usize;
                let end = submatch
                    .get("end")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(start as u64) as usize;
                ranges.push(SearchRange {
                    start_column: byte_to_utf16_column(clean_line, start),
                    end_column: byte_to_utf16_column(clean_line, end),
                });
            }
        }
        let column = ranges.first().map(|range| range.start_column).unwrap_or(1);
        let end_column = ranges
            .first()
            .map(|range| range.end_column)
            .unwrap_or(column);
        let snippet = truncate_utf8(clean_line, MAX_SNIPPET_BYTES);
        matches.push(SearchMatch {
            relative_path: normalize_output_path(&path),
            line: line_number as u32,
            column,
            end_column,
            snippet,
            snippet_start: 0,
            ranges,
        });
        if matches.len() >= MAX_MATCHES {
            break;
        }
    }
    Ok(matches)
}

fn text_field(value: Option<&serde_json::Value>) -> Result<Option<String>, SearchError> {
    let Some(value) = value else {
        return Ok(None);
    };
    if let Some(text) = value.get("text").and_then(serde_json::Value::as_str) {
        return Ok(Some(text.to_owned()));
    }
    if value.get("bytes").is_some() {
        return Ok(None);
    }
    Ok(None)
}

fn normalize_output_path(path: &str) -> String {
    path.replace('\\', "/").trim_start_matches("./").to_owned()
}

fn byte_to_utf16_column(line: &str, byte_offset: usize) -> u32 {
    let bounded = byte_offset.min(line.len());
    let boundary = (0..=bounded)
        .rev()
        .find(|offset| line.is_char_boundary(*offset))
        .unwrap_or(0);
    line[..boundary].encode_utf16().count() as u32 + 1
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_owned()
}

fn resolve_rg(root: &Path) -> Result<PathBuf, SearchError> {
    let current = std::env::current_dir()
        .ok()
        .and_then(|path| path.canonicalize().ok());
    let mut candidates = Vec::<(PathBuf, Option<PathBuf>)>::new();
    if let Some(path_value) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path_value) {
            if directory.as_os_str().is_empty() {
                continue;
            }
            for name in ["rg.exe", "rg"] {
                candidates.push((directory.join(name), None));
            }
        }
    }

    candidates.extend(trusted_install_candidates());
    let mut seen = HashSet::new();
    for (candidate, trusted_root) in candidates {
        let metadata = match fs::symlink_metadata(&candidate) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if is_link_or_reparse(&metadata) {
            continue;
        }
        let canonical = match candidate.canonicalize() {
            Ok(path) => path,
            Err(_) => continue,
        };
        if let Some(trusted_root) = trusted_root {
            let trusted_root = match trusted_root.canonicalize() {
                Ok(path) => path,
                Err(_) => continue,
            };
            if !is_within(&trusted_root, &canonical) {
                continue;
            }
        }
        if !canonical.is_file() || !seen.insert(canonical.clone()) {
            continue;
        }
        if is_within(root, &canonical)
            || current
                .as_ref()
                .is_some_and(|path| is_within(path, &canonical))
        {
            continue;
        }
        return Ok(canonical);
    }
    Err(SearchError::new(
        "SEARCH_TOOL_MISSING",
        "Không tìm thấy ripgrep (rg.exe) trong PATH hoặc installation path đáng tin cậy.",
    ))
}

fn trusted_install_candidates() -> Vec<(PathBuf, Option<PathBuf>)> {
    let mut candidates = Vec::new();

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(directory) = current_exe.parent() {
            for name in ["rg.exe", "rg"] {
                candidates.push((directory.join(name), Some(directory.to_path_buf())));
                candidates.push((
                    directory.join("resources").join(name),
                    Some(directory.join("resources")),
                ));
            }
        }
    }

    #[cfg(windows)]
    {
        if let Some(user_profile) = std::env::var_os("USERPROFILE") {
            let releases = PathBuf::from(user_profile)
                .join(".codex")
                .join("packages")
                .join("app-server-daemon")
                .join("releases");
            if let Ok(entries) = fs::read_dir(releases) {
                for entry in entries.flatten() {
                    let release = entry.path();
                    candidates.push((release.join("codex-path").join("rg.exe"), Some(release)));
                }
            }
        }

        if let Some(app_data) = std::env::var_os("APPDATA") {
            let vendor = PathBuf::from(app_data)
                .join("npm")
                .join("node_modules")
                .join("@openai")
                .join("codex")
                .join("node_modules")
                .join("@openai")
                .join("codex-win32-x64")
                .join("vendor")
                .join("x86_64-pc-windows-msvc")
                .join("codex-path");
            candidates.push((vendor.join("rg.exe"), Some(vendor)));
        }
    }

    candidates
}

fn io_error(operation: &str, error: std::io::Error) -> SearchError {
    SearchError::new("SEARCH_IO_ERROR", format!("Không thể {operation}: {error}"))
}

fn stderr_text(bytes: &Arc<Mutex<Vec<u8>>>) -> Option<String> {
    let value = bytes.lock().ok()?.clone();
    let text = String::from_utf8_lossy(&value).trim().to_owned();
    (!text.is_empty()).then_some(text)
}

fn terminate(child: &mut Child) {
    let _ = child.kill();
}

fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{
        byte_to_utf16_column, normalize_output_path, parse_matches, rank_suggestions,
        truncate_utf8, validate_request, SearchStartRequest, SuggestionCandidate,
    };

    #[test]
    fn validates_literal_queries_and_paths() {
        assert!(validate_request(&SearchStartRequest {
            workspace_id: "w".into(),
            query: "hello".into(),
            relative_directory: "src".into(),
            case_sensitive: true,
        })
        .is_ok());
        assert!(validate_request(&SearchStartRequest {
            workspace_id: "w".into(),
            query: "  ".into(),
            relative_directory: "".into(),
            case_sensitive: true,
        })
        .is_err());
        assert!(validate_request(&SearchStartRequest {
            workspace_id: "w".into(),
            query: "x".into(),
            relative_directory: "../".into(),
            case_sensitive: true,
        })
        .is_err());
    }

    #[test]
    fn maps_utf8_offsets_to_monaco_utf16_columns() {
        assert_eq!(byte_to_utf16_column("a😀b", 1), 2);
        assert_eq!(byte_to_utf16_column("a😀b", 5), 4);
    }

    #[test]
    fn normalizes_and_bounds_result_text() {
        assert_eq!(normalize_output_path(".\\src\\main.rs"), "src/main.rs");
        assert_eq!(truncate_utf8("😀😀", 5), "😀");
    }

    #[test]
    fn parses_ripgrep_json_and_preserves_utf16_ranges() {
        let raw = r#"{"type":"match","data":{"path":{"text":"src/main.ts"},"lines":{"text":"const value = \"😀\";\n"},"line_number":3,"submatches":[{"match":{"text":"😀"},"start":15,"end":19}]}}"#;
        let matches = parse_matches(raw.as_bytes()).expect("JSON match should parse");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].relative_path, "src/main.ts");
        assert_eq!(matches[0].line, 3);
        assert_eq!(matches[0].ranges[0].start_column, 16);
        assert_eq!(matches[0].ranges[0].end_column, 18);
    }

    #[test]
    fn ranks_exact_path_and_basename_before_fuzzy_suggestions() {
        let entries = vec![
            SuggestionCandidate {
                relative_path: PathBuf::from("src/readme.md"),
                kind: "file",
            },
            SuggestionCandidate {
                relative_path: PathBuf::from("src/reader.ts"),
                kind: "file",
            },
            SuggestionCandidate {
                relative_path: PathBuf::from("docs/reference"),
                kind: "directory",
            },
        ];
        let suggestions = rank_suggestions(&entries, "readme.md", false);
        assert_eq!(suggestions[0].relative_path, "src/readme.md");
        assert!(suggestions[0].exact);
        let fuzzy = rank_suggestions(&entries, "rdr", false);
        assert!(fuzzy
            .iter()
            .any(|item| item.relative_path == "src/reader.ts"));
    }
}
