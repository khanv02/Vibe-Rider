use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{State, WebviewWindow};

use crate::file_editor::{read_file_from_disk, TextFileSnapshot};
use crate::filesystem::{list_directory, DirectoryListing};
use crate::git::{git_diff, git_status, GitDiffRequest, GitService, GitStatusRequest};
use crate::github_auth::GitHubAuthService;
use crate::path_guard::resolve_regular_file;
use crate::search::{SearchResult, SearchService, SearchStartRequest};
use crate::workspace::{WorkspaceError, WorkspaceState};

const MAX_TOOL_LINES: usize = 200;
const MAX_TOOL_BYTES: usize = 64 * 1024;
const MAX_TOOL_RESULTS: usize = 100;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadOnlyToolRequest {
    pub call_id: String,
    pub workspace_id: String,
    pub tool: String,
    pub args: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadOnlyToolResult {
    pub call_id: String,
    pub workspace_id: String,
    pub tool: String,
    pub status: String,
    pub data: Option<Value>,
    pub error: Option<ToolError>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadFileArgs {
    relative_path: String,
    start_line: Option<u32>,
    end_line: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListDirectoryArgs {
    relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SearchTextArgs {
    query: String,
    relative_directory: String,
    case_sensitive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GitStatusArgs {
    request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GitDiffArgs {
    entry_id: String,
    scope: String,
    status_token: String,
}

#[tauri::command]
pub async fn read_only_tool(
    state: State<'_, WorkspaceState>,
    search: State<'_, SearchService>,
    git: State<'_, GitService>,
    github_auth: State<'_, GitHubAuthService>,
    window: WebviewWindow,
    request: ReadOnlyToolRequest,
) -> Result<ReadOnlyToolResult, ToolError> {
    let snapshot = state
        .active_snapshot()
        .map_err(tool_error)?
        .ok_or_else(|| ToolError::new("NO_WORKSPACE", "Hãy mở workspace trước."))?;
    if snapshot.id != request.workspace_id {
        return Err(ToolError::new("STALE_WORKSPACE", "Workspace đã thay đổi."));
    }

    match request.tool.as_str() {
        "read_file" => {
            let args: ReadFileArgs = parse_args(request.args.clone())?;
            let (path, _) =
                resolve_regular_file(&snapshot.root, &args.relative_path).map_err(tool_error)?;
            let workspace_id = request.workspace_id.clone();
            let relative_path = args.relative_path.clone();
            let file = tauri::async_runtime::spawn_blocking(move || {
                read_file_from_disk(&workspace_id, &snapshot.root, &relative_path)
            })
            .await
            .map_err(|error| ToolError::new("TOOL_WORKER_FAILED", error.to_string()))?
            .map_err(tool_error)?;
            let _ = path;
            let (data, truncated) = bounded_file(file, args.start_line, args.end_line)?;
            Ok(success(request, data, truncated))
        }
        "list_directory" => {
            let args: ListDirectoryArgs = parse_args(request.args.clone())?;
            let listing =
                list_directory(&request.workspace_id, &snapshot.root, &args.relative_path)
                    .map_err(tool_error)?;
            let (data, truncated) = bounded_directory(listing);
            Ok(success(request, data, truncated))
        }
        "search_text" => {
            let args: SearchTextArgs = parse_args(request.args.clone())?;
            let started = search
                .start(
                    window.label().to_owned(),
                    request.workspace_id.clone(),
                    snapshot.root,
                    SearchStartRequest {
                        workspace_id: request.workspace_id.clone(),
                        query: args.query,
                        relative_directory: args.relative_directory,
                        case_sensitive: args.case_sensitive,
                    },
                )
                .map_err(|error| ToolError::new(error.code, error.message))?;
            let result = tauri::async_runtime::spawn_blocking({
                let search = search.inner().clone();
                let owner = window.label().to_owned();
                let workspace_id = request.workspace_id.clone();
                let search_id = started.search_id.clone();
                move || search.wait_result(&owner, &workspace_id, &search_id)
            })
            .await
            .map_err(|error| ToolError::new("TOOL_WORKER_FAILED", error.to_string()))?
            .map_err(|error| ToolError::new(error.code, error.message))?;
            let limited = limit_search_result(result);
            Ok(success(
                request,
                serde_json::to_value(limited).map_err(serialize_error)?,
                true,
            ))
        }
        "git_status" => {
            let args: GitStatusArgs = parse_args(request.args.clone())?;
            let status = git_status(
                git,
                state,
                github_auth,
                window,
                GitStatusRequest {
                    workspace_id: request.workspace_id.clone(),
                    request_id: args.request_id,
                },
            )
            .await
            .map_err(|error| ToolError::new(error.code, error.message))?;
            Ok(success(
                request,
                serde_json::to_value(status).map_err(serialize_error)?,
                false,
            ))
        }
        "git_diff" => {
            let args: GitDiffArgs = parse_args(request.args.clone())?;
            let diff = git_diff(
                git,
                state,
                github_auth,
                window,
                GitDiffRequest {
                    workspace_id: request.workspace_id.clone(),
                    entry_id: args.entry_id,
                    scope: args.scope,
                    status_token: args.status_token,
                },
            )
            .await
            .map_err(|error| ToolError::new(error.code, error.message))?;
            Ok(success(
                request,
                serde_json::to_value(diff).map_err(serialize_error)?,
                false,
            ))
        }
        _ => Err(ToolError::new(
            "UNKNOWN_TOOL",
            "Tool không thuộc read-only registry.",
        )),
    }
}

impl ToolError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

fn parse_args<T: for<'de> Deserialize<'de>>(args: Value) -> Result<T, ToolError> {
    serde_json::from_value(args)
        .map_err(|error| ToolError::new("INVALID_TOOL_ARGS", error.to_string()))
}

fn tool_error(error: WorkspaceError) -> ToolError {
    ToolError::new(error.code, error.message)
}

fn serialize_error(error: serde_json::Error) -> ToolError {
    ToolError::new("TOOL_SERIALIZE_FAILED", error.to_string())
}

fn success(request: ReadOnlyToolRequest, data: Value, truncated: bool) -> ReadOnlyToolResult {
    ReadOnlyToolResult {
        call_id: request.call_id,
        workspace_id: request.workspace_id,
        tool: request.tool,
        status: "success".to_owned(),
        data: Some(data),
        error: None,
        truncated,
    }
}

fn bounded_file(
    file: TextFileSnapshot,
    start_line: Option<u32>,
    end_line: Option<u32>,
) -> Result<(Value, bool), ToolError> {
    let start = start_line.unwrap_or(1).max(1) as usize;
    let requested_end = end_line
        .unwrap_or(start as u32 + MAX_TOOL_LINES as u32 - 1)
        .max(start as u32) as usize;
    let end = requested_end.min(start + MAX_TOOL_LINES - 1);
    let lines = file.content.lines().collect::<Vec<_>>();
    let actual_end = end.min(lines.len().max(1));
    let content = if lines.is_empty() || start > lines.len() {
        String::new()
    } else {
        lines[start - 1..actual_end].join("\n")
    };
    let mut truncated = requested_end > end || actual_end < end;
    let content = if content.len() > MAX_TOOL_BYTES {
        truncated = true;
        truncate_utf8(&content, MAX_TOOL_BYTES)
    } else {
        content
    };
    let data = serde_json::json!({
        "workspaceId": file.workspace_id,
        "fileId": file.file_id,
        "relativePath": file.relative_path,
        "revision": file.revision,
        "startLine": start,
        "endLine": actual_end,
        "content": content,
        "encoding": file.encoding,
        "eol": file.eol,
        "truncated": truncated,
    });
    Ok((data, truncated))
}

fn bounded_directory(listing: DirectoryListing) -> (Value, bool) {
    let truncated = listing.entries.len() > MAX_TOOL_RESULTS;
    let entries = listing
        .entries
        .into_iter()
        .take(MAX_TOOL_RESULTS)
        .collect::<Vec<_>>();
    (
        serde_json::json!({
            "workspaceId": listing.workspace_id,
            "relativePath": listing.relative_path,
            "entries": entries,
            "truncated": truncated,
        }),
        truncated,
    )
}

fn limit_search_result(mut result: SearchResult) -> SearchResult {
    result.matches.truncate(MAX_TOOL_RESULTS);
    result
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

#[cfg(test)]
mod tests {
    use super::{bounded_file, parse_args, ReadFileArgs};
    use crate::file_editor::TextFileSnapshot;

    #[test]
    fn read_tool_bounds_lines_and_bytes() {
        let snapshot = TextFileSnapshot {
            workspace_id: "w".into(),
            file_id: "src/main.rs".into(),
            relative_path: "src/main.rs".into(),
            content: "one\ntwo\nthree".into(),
            revision: "r1".into(),
            byte_length: 13,
            encoding: "utf8".into(),
            bom: false,
            eol: "lf".into(),
            writable: true,
        };
        let (value, truncated) = bounded_file(snapshot, Some(2), Some(99)).unwrap();
        assert!(truncated);
        assert_eq!(value["startLine"], 2);
        assert_eq!(value["content"], "two\nthree");
    }

    #[test]
    fn tool_args_reject_unknown_fields() {
        let error = parse_args::<ReadFileArgs>(serde_json::json!({
            "relativePath": "src/main.rs",
            "unexpected": true
        }))
        .expect_err("unknown tool fields must be rejected");
        assert_eq!(error.code, "INVALID_TOOL_ARGS");
    }
}
