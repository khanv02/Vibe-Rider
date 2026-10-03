use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::path_guard::resolve_regular_file;
use crate::workspace::{WorkspaceError, WorkspaceState};

const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
static NEXT_TEMP_FILE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileRequest {
    workspace_id: String,
    relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileRequest {
    workspace_id: String,
    relative_path: String,
    expected_revision: String,
    content: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileSnapshot {
    pub workspace_id: String,
    pub file_id: String,
    pub relative_path: String,
    pub content: String,
    pub revision: String,
    pub byte_length: usize,
    pub encoding: String,
    pub bom: bool,
    pub eol: String,
    pub writable: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileResult {
    pub workspace_id: String,
    pub file_id: String,
    pub relative_path: String,
    pub revision: String,
    pub byte_length: usize,
}

#[tauri::command]
pub async fn read_file(
    state: State<'_, WorkspaceState>,
    request: ReadFileRequest,
) -> Result<TextFileSnapshot, WorkspaceError> {
    let snapshot = active_workspace(&state, &request.workspace_id)?;
    let workspace_id = request.workspace_id.clone();
    let relative_path = request.relative_path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        read_file_from_disk(&workspace_id, &snapshot.root, &relative_path)
    })
    .await
    .map_err(|error| {
        WorkspaceError::new(
            "IO_ERROR",
            format!("File worker kết thúc ngoài dự kiến: {error}"),
        )
    })??;

    ensure_active(&state, &result.workspace_id)?;
    Ok(result)
}

#[tauri::command]
pub async fn write_file(
    state: State<'_, WorkspaceState>,
    request: WriteFileRequest,
) -> Result<WriteFileResult, WorkspaceError> {
    let lease = state.begin_mutation(&request.workspace_id)?;
    let snapshot = lease.snapshot.clone();
    let workspace_id = request.workspace_id.clone();
    let relative_path = request.relative_path.clone();
    let expected_revision = request.expected_revision.clone();
    let content = request.content.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        write_file_to_disk(
            &workspace_id,
            &snapshot.root,
            &relative_path,
            &expected_revision,
            &content,
        )
    })
    .await
    .map_err(|error| {
        WorkspaceError::new(
            "IO_ERROR",
            format!("File worker kết thúc ngoài dự kiến: {error}"),
        )
    })??;

    ensure_active(&state, &result.workspace_id)?;
    Ok(result)
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
            "Workspace đã thay đổi. Hãy thử lại.",
        ));
    }
    Ok(snapshot)
}

fn ensure_active(state: &WorkspaceState, workspace_id: &str) -> Result<(), WorkspaceError> {
    if state
        .active_snapshot()?
        .is_some_and(|active| active.id == workspace_id)
    {
        Ok(())
    } else {
        Err(WorkspaceError::new(
            "STALE_WORKSPACE",
            "Workspace đã thay đổi trong lúc xử lý file.",
        ))
    }
}

fn read_file_from_disk(
    workspace_id: &str,
    root: &Path,
    relative_path: &str,
) -> Result<TextFileSnapshot, WorkspaceError> {
    let (path, normalized_path) = resolve_regular_file(root, relative_path)?;
    let bytes = fs::read(&path).map_err(|error| map_io_error("đọc file", error))?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(WorkspaceError::new(
            "FILE_TOO_LARGE",
            format!("File vượt quá giới hạn {MAX_FILE_BYTES} bytes."),
        ));
    }

    let (bom, text_bytes) = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        (true, &bytes[3..])
    } else {
        (false, bytes.as_slice())
    };
    let raw = std::str::from_utf8(text_bytes).map_err(|_| {
        WorkspaceError::new(
            "UNSUPPORTED_ENCODING",
            "Chỉ hỗ trợ file UTF-8 trong Phase 5.",
        )
    })?;
    if raw.chars().any(|character| {
        character == '\0'
            || (character.is_control()
                && character != '\n'
                && character != '\r'
                && character != '\t')
    }) {
        return Err(WorkspaceError::new(
            "BINARY_FILE",
            "File có dấu hiệu binary và không mở trong Editor.",
        ));
    }

    let eol = detect_eol(raw);
    if eol == "mixed" || eol == "cr" {
        return Ok(snapshot(
            workspace_id,
            &normalized_path,
            &bytes,
            raw.replace("\r\n", "\n").replace('\r', "\n"),
            bom,
            eol,
            false,
        ));
    }
    let content = raw.replace("\r\n", "\n");
    let writable = !fs::metadata(&path)
        .map_err(|error| map_io_error("đọc quyền file", error))?
        .permissions()
        .readonly();
    Ok(snapshot(
        workspace_id,
        &normalized_path,
        &bytes,
        content,
        bom,
        eol,
        writable,
    ))
}

fn snapshot(
    workspace_id: &str,
    path: &str,
    bytes: &[u8],
    content: String,
    bom: bool,
    eol: String,
    writable: bool,
) -> TextFileSnapshot {
    TextFileSnapshot {
        workspace_id: workspace_id.to_owned(),
        file_id: path.to_owned(),
        relative_path: path.to_owned(),
        content,
        revision: revision(path, bytes),
        byte_length: bytes.len(),
        encoding: "utf8".to_owned(),
        bom,
        eol,
        writable,
    }
}

fn write_file_to_disk(
    workspace_id: &str,
    root: &Path,
    relative_path: &str,
    expected_revision: &str,
    content: &str,
) -> Result<WriteFileResult, WorkspaceError> {
    let (path, normalized_path) = resolve_regular_file(root, relative_path)?;
    let current = fs::read(&path).map_err(|error| map_io_error("đọc file trước khi lưu", error))?;
    if current.len() > MAX_FILE_BYTES {
        return Err(WorkspaceError::new(
            "FILE_TOO_LARGE",
            "File hiện tại vượt quá giới hạn Editor.",
        ));
    }
    let current_snapshot = read_file_from_disk(workspace_id, root, relative_path)?;
    if current_snapshot.revision != expected_revision {
        return Err(WorkspaceError::new(
            "FILE_CONFLICT",
            "File đã thay đổi trên đĩa. Hãy Compare hoặc Reload trước khi lưu.",
        ));
    }
    if !current_snapshot.writable {
        return Err(WorkspaceError::new("READ_ONLY", "File không cho phép ghi."));
    }
    if current_snapshot.eol == "mixed" || current_snapshot.eol == "cr" {
        return Err(WorkspaceError::new(
            "UNSUPPORTED_EOL",
            "Không thể lưu file có mixed EOL hoặc bare CR.",
        ));
    }

    let encoded = encode_content(content, current_snapshot.bom, &current_snapshot.eol)?;
    if encoded.len() > MAX_FILE_BYTES {
        return Err(WorkspaceError::new(
            "FILE_TOO_LARGE",
            format!("Nội dung sau encode vượt quá giới hạn {MAX_FILE_BYTES} bytes."),
        ));
    }
    let parent = path.parent().ok_or_else(|| {
        WorkspaceError::new("IO_ERROR", "Không tìm thấy parent directory của file.")
    })?;
    let temp = unique_temp_path(parent);
    let write_result = (|| -> Result<(), WorkspaceError> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        let mut file = options
            .open(&temp)
            .map_err(|error| map_io_error("tạo file tạm", error))?;
        file.write_all(&encoded)
            .map_err(|error| map_io_error("ghi file tạm", error))?;
        file.sync_all()
            .map_err(|error| map_io_error("sync file tạm", error))?;
        if let Err(rename_error) = fs::rename(&temp, &path) {
            // Windows does not replace an existing file with std::fs::rename on every filesystem.
            // The fallback keeps the operation recoverable but is not advertised as a perfect CAS.
            fs::copy(&temp, &path).map_err(|_| map_io_error("replace file", rename_error))?;
            fs::remove_file(&temp).map_err(|error| map_io_error("dọn file tạm", error))?;
        }
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temp);
        return write_result.map(|_| unreachable!());
    }

    let committed = fs::read(&path).map_err(|error| map_io_error("xác nhận file đã lưu", error))?;
    Ok(WriteFileResult {
        workspace_id: workspace_id.to_owned(),
        file_id: normalized_path.clone(),
        relative_path: normalized_path,
        revision: revision(relative_path, &committed),
        byte_length: committed.len(),
    })
}

fn encode_content(content: &str, bom: bool, eol: &str) -> Result<Vec<u8>, WorkspaceError> {
    let normalized_content = content.replace("\r\n", "\n").replace('\r', "\n");
    let normalized = match eol {
        "crlf" => normalized_content.replace('\n', "\r\n"),
        "lf" | "none" => normalized_content,
        _ => {
            return Err(WorkspaceError::new(
                "UNSUPPORTED_EOL",
                "EOL format không được hỗ trợ.",
            ))
        }
    };
    let mut bytes = Vec::with_capacity(normalized.len() + usize::from(bom) * 3);
    if bom {
        bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    bytes.extend_from_slice(normalized.as_bytes());
    Ok(bytes)
}

fn detect_eol(content: &str) -> String {
    let bytes = content.as_bytes();
    let has_crlf = bytes.windows(2).any(|pair| pair == b"\r\n");
    let bare_cr = bytes
        .iter()
        .enumerate()
        .any(|(index, byte)| *byte == b'\r' && bytes.get(index + 1).copied() != Some(b'\n'));
    let bare_lf = bytes
        .iter()
        .enumerate()
        .any(|(index, byte)| *byte == b'\n' && (index == 0 || bytes[index - 1] != b'\r'));
    match (has_crlf, bare_lf, bare_cr) {
        (true, false, false) => "crlf".to_owned(),
        (false, true, false) => "lf".to_owned(),
        (false, false, true) => "cr".to_owned(),
        (false, false, false) => "none".to_owned(),
        _ => "mixed".to_owned(),
    }
}

fn revision(path: &str, bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher.update([0]);
    hasher.update(bytes);
    format!("sha256:{:x}", hasher.finalize())
}

fn unique_temp_path(parent: &Path) -> PathBuf {
    let sequence = NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed);
    parent.join(format!(
        ".vibe-rider-save-{}-{sequence}.tmp",
        std::process::id()
    ))
}

fn map_io_error(operation: &str, error: std::io::Error) -> WorkspaceError {
    let code = match error.kind() {
        std::io::ErrorKind::NotFound => "NOT_FOUND",
        std::io::ErrorKind::PermissionDenied => "PERMISSION_DENIED",
        _ => "IO_ERROR",
    };
    WorkspaceError::new(code, format!("Không thể {operation}: {error}"))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::{detect_eol, encode_content, read_file_from_disk, revision, write_file_to_disk};

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

    struct TempDirectory(PathBuf);

    impl TempDirectory {
        fn new() -> Self {
            let sequence = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "vibe-rider-phase5-editor-{}-{sequence}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("fixture directory should be created");
            Self(path)
        }
    }

    impl Drop for TempDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn preserves_supported_eol_and_bom() {
        assert_eq!(
            encode_content("a\nb", true, "crlf").unwrap(),
            b"\xef\xbb\xbfa\r\nb"
        );
        assert_eq!(detect_eol("a\r\nb\r\n"), "crlf");
        assert_eq!(detect_eol("a\nb\n"), "lf");
    }

    #[test]
    fn revisions_change_with_content() {
        assert_ne!(revision("a.txt", b"one"), revision("a.txt", b"two"));
    }

    #[test]
    fn reads_writes_and_rejects_stale_revision() {
        let fixture = TempDirectory::new();
        let path = fixture.0.join("hello.txt");
        fs::write(&path, b"hello\n").expect("fixture file should be written");

        let snapshot = read_file_from_disk("workspace-1", &fixture.0, "hello.txt")
            .expect("fixture file should be readable");
        assert_eq!(snapshot.content, "hello\n");
        assert_eq!(snapshot.eol, "lf");

        let result = write_file_to_disk(
            "workspace-1",
            &fixture.0,
            "hello.txt",
            &snapshot.revision,
            "updated\n",
        )
        .expect("fixture file should be writable");
        assert_ne!(result.revision, snapshot.revision);
        assert_eq!(
            fs::read(&path).expect("saved bytes should be readable"),
            b"updated\n"
        );

        fs::write(&path, b"external\n").expect("external update should be written");
        let error = write_file_to_disk(
            "workspace-1",
            &fixture.0,
            "hello.txt",
            &result.revision,
            "should not overwrite\n",
        )
        .expect_err("stale revision must be rejected");
        assert_eq!(error.code, "FILE_CONFLICT");
        assert_eq!(
            fs::read(&path).expect("conflicted bytes should remain"),
            b"external\n"
        );
    }
}
