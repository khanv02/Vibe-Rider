use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::path_guard::{is_link_or_reparse, is_within, resolve_directory, validate_relative_path};
use crate::workspace::{WorkspaceError, WorkspaceState};

const MAX_DIRECTORY_ENTRIES: usize = 5_000;
const MAX_CLIPBOARD_IMAGE_BYTES: usize = 20 * 1024 * 1024;
static NEXT_CLIPBOARD_IMAGE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadDirectoryRequest {
    workspace_id: String,
    relative_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub relative_path: String,
    pub kind: DirectoryEntryKind,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DirectoryEntryKind {
    Directory,
    File,
    Link,
    Other,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub workspace_id: String,
    pub relative_path: String,
    pub entries: Vec<DirectoryEntry>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CreateEntryKind {
    Directory,
    File,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEntryRequest {
    workspace_id: String,
    parent_relative_path: String,
    name: String,
    kind: CreateEntryKind,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteEntryRequest {
    workspace_id: String,
    relative_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryMutationResult {
    pub workspace_id: String,
    pub relative_path: String,
    pub kind: DirectoryEntryKind,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveClipboardImageRequest {
    workspace_id: String,
    mime_type: String,
    bytes: Vec<u8>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardImageResult {
    pub workspace_id: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub mime_type: String,
}

#[tauri::command]
pub async fn read_directory(
    state: State<'_, WorkspaceState>,
    request: ReadDirectoryRequest,
) -> Result<DirectoryListing, WorkspaceError> {
    let snapshot = state
        .active_snapshot()?
        .ok_or_else(|| WorkspaceError::new("NO_WORKSPACE", "Hãy mở workspace trước."))?;

    if snapshot.id != request.workspace_id {
        return Err(WorkspaceError::new(
            "STALE_WORKSPACE",
            "Workspace đã thay đổi. Hãy tải lại Explorer.",
        ));
    }

    let workspace_id = request.workspace_id.clone();
    let relative_path = request.relative_path.clone();
    let root = snapshot.root;
    let listing = tauri::async_runtime::spawn_blocking(move || {
        list_directory(&workspace_id, &root, &relative_path)
    })
    .await
    .map_err(|error| {
        WorkspaceError::new(
            "IO_ERROR",
            format!("Directory worker kết thúc ngoài dự kiến: {error}"),
        )
    })??;

    let still_active = state
        .active_snapshot()?
        .is_some_and(|active| active.id == listing.workspace_id);
    if !still_active {
        return Err(WorkspaceError::new(
            "STALE_WORKSPACE",
            "Workspace đã thay đổi trong lúc đọc directory.",
        ));
    }

    Ok(listing)
}

#[tauri::command]
pub async fn create_entry(
    state: State<'_, WorkspaceState>,
    request: CreateEntryRequest,
) -> Result<EntryMutationResult, WorkspaceError> {
    let lease = state.begin_mutation(&request.workspace_id)?;
    let workspace_id = request.workspace_id.clone();
    let parent_relative_path = request.parent_relative_path.clone();
    let name = request.name.clone();
    let kind = request.kind;
    let root = lease.snapshot.root.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        create_entry_on_disk(&workspace_id, &root, &parent_relative_path, &name, kind)
    })
    .await
    .map_err(|error| {
        WorkspaceError::new(
            "IO_ERROR",
            format!("Create entry worker stopped unexpectedly: {error}"),
        )
    })??;

    ensure_active(&state, &result.workspace_id)?;
    Ok(result)
}

#[tauri::command]
pub async fn delete_entry(
    state: State<'_, WorkspaceState>,
    request: DeleteEntryRequest,
) -> Result<EntryMutationResult, WorkspaceError> {
    let lease = state.begin_mutation(&request.workspace_id)?;
    let workspace_id = request.workspace_id.clone();
    let relative_path = request.relative_path.clone();
    let root = lease.snapshot.root.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        delete_entry_on_disk(&workspace_id, &root, &relative_path)
    })
    .await
    .map_err(|error| {
        WorkspaceError::new(
            "IO_ERROR",
            format!("Delete entry worker stopped unexpectedly: {error}"),
        )
    })??;

    ensure_active(&state, &result.workspace_id)?;
    Ok(result)
}

#[tauri::command]
pub async fn save_clipboard_image(
    state: State<'_, WorkspaceState>,
    request: SaveClipboardImageRequest,
) -> Result<ClipboardImageResult, WorkspaceError> {
    let lease = state.begin_mutation(&request.workspace_id)?;
    let workspace_id = request.workspace_id.clone();
    let mime_type = request.mime_type.clone();
    let bytes = request.bytes;
    let root = lease.snapshot.root.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        save_clipboard_image_on_disk(&workspace_id, &root, &mime_type, &bytes)
    })
    .await
    .map_err(|error| {
        WorkspaceError::new(
            "IO_ERROR",
            format!("Clipboard image worker stopped unexpectedly: {error}"),
        )
    })??;

    ensure_active(&state, &result.workspace_id)?;
    Ok(result)
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
            "Workspace changed while processing the filesystem request.",
        ))
    }
}

fn create_entry_on_disk(
    workspace_id: &str,
    root: &Path,
    parent_relative_path: &str,
    name: &str,
    kind: CreateEntryKind,
) -> Result<EntryMutationResult, WorkspaceError> {
    let normalized_name = validate_entry_name(name)?;
    let parent = resolve_directory(root, parent_relative_path)?;
    let normalized_parent = normalize_relative_path(parent_relative_path)?;
    let target = parent.join(&normalized_name);

    match fs::symlink_metadata(&target) {
        Ok(_) => {
            return Err(WorkspaceError::new(
                "ALREADY_EXISTS",
                "An entry with this name already exists.",
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(map_io_error("check entry", error)),
    }

    let entry_kind = match kind {
        CreateEntryKind::Directory => {
            fs::create_dir(&target).map_err(|error| map_io_error("create directory", error))?;
            DirectoryEntryKind::Directory
        }
        CreateEntryKind::File => {
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(|error| map_io_error("create file", error))?;
            DirectoryEntryKind::File
        }
    };

    let relative_path = if normalized_parent.is_empty() {
        normalized_name
    } else {
        format!("{normalized_parent}/{normalized_name}")
    };
    Ok(EntryMutationResult {
        workspace_id: workspace_id.to_owned(),
        relative_path,
        kind: entry_kind,
    })
}

fn delete_entry_on_disk(
    workspace_id: &str,
    root: &Path,
    relative_path: &str,
) -> Result<EntryMutationResult, WorkspaceError> {
    let (target, normalized_path, kind) = resolve_existing_entry(root, relative_path)?;
    remove_entry_recursively(&target)?;
    Ok(EntryMutationResult {
        workspace_id: workspace_id.to_owned(),
        relative_path: normalized_path,
        kind,
    })
}

fn save_clipboard_image_on_disk(
    workspace_id: &str,
    root: &Path,
    mime_type: &str,
    bytes: &[u8],
) -> Result<ClipboardImageResult, WorkspaceError> {
    let extension = clipboard_extension(mime_type).ok_or_else(|| {
        WorkspaceError::new(
            "UNSUPPORTED_IMAGE",
            "Only PNG, JPEG, WebP, GIF, and BMP clipboard images are supported.",
        )
    })?;
    if bytes.is_empty() {
        return Err(WorkspaceError::new(
            "EMPTY_IMAGE",
            "Clipboard image is empty.",
        ));
    }
    if bytes.len() > MAX_CLIPBOARD_IMAGE_BYTES {
        return Err(WorkspaceError::new(
            "IMAGE_TOO_LARGE",
            format!("Clipboard image exceeds {MAX_CLIPBOARD_IMAGE_BYTES} bytes."),
        ));
    }

    let directory = ensure_clipboard_directory(root)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| WorkspaceError::new("IO_ERROR", "System clock is before the Unix epoch."))?
        .as_millis();
    let sequence = NEXT_CLIPBOARD_IMAGE.fetch_add(1, Ordering::Relaxed);
    let file_name = format!("image-{timestamp}-{sequence}.{extension}");
    let target = directory.join(&file_name);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|error| map_io_error("create clipboard image", error))?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&target);
        return Err(map_io_error("write clipboard image", error));
    }

    let absolute_path = target.to_str().map(ToOwned::to_owned).ok_or_else(|| {
        WorkspaceError::new("UNSUPPORTED_PATH_ENCODING", "Image path is not Unicode.")
    })?;
    Ok(ClipboardImageResult {
        workspace_id: workspace_id.to_owned(),
        relative_path: format!(".vibe-rider/clipboard/{file_name}"),
        absolute_path,
        mime_type: mime_type.to_owned(),
    })
}

fn validate_entry_name(name: &str) -> Result<String, WorkspaceError> {
    if name.trim().is_empty() || name == "." || name == ".." || name.contains('\0') {
        return Err(WorkspaceError::new(
            "INVALID_NAME",
            "Entry name is invalid.",
        ));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(WorkspaceError::new(
            "INVALID_NAME",
            "Entry name must contain one path component only.",
        ));
    }
    let relative = validate_relative_path(name)?;
    let mut components = relative.components();
    let Some(component) = components.next() else {
        return Err(WorkspaceError::new(
            "INVALID_NAME",
            "Entry name is invalid.",
        ));
    };
    if components.next().is_some() {
        return Err(WorkspaceError::new(
            "INVALID_NAME",
            "Entry name must contain one path component only.",
        ));
    }
    component
        .as_os_str()
        .to_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            WorkspaceError::new("UNSUPPORTED_PATH_ENCODING", "Entry name is not Unicode.")
        })
}

fn resolve_existing_entry(
    root: &Path,
    relative_path: &str,
) -> Result<(std::path::PathBuf, String, DirectoryEntryKind), WorkspaceError> {
    let relative = validate_relative_path(relative_path)?;
    if relative.as_os_str().is_empty() {
        return Err(WorkspaceError::new(
            "INVALID_PATH",
            "The workspace root cannot be deleted.",
        ));
    }
    let candidate = root.join(&relative);
    let mut cursor = root.to_path_buf();
    for component in relative.components() {
        cursor.push(component.as_os_str());
        let metadata =
            fs::symlink_metadata(&cursor).map_err(|error| map_io_error("read entry", error))?;
        if is_link_or_reparse(&metadata) {
            return Err(WorkspaceError::new(
                "LINK_NOT_SUPPORTED",
                "Symbolic links and junctions cannot be deleted through Explorer.",
            ));
        }
    }

    let canonical_root =
        fs::canonicalize(root).map_err(|error| map_io_error("validate workspace", error))?;
    let canonical_target =
        fs::canonicalize(&candidate).map_err(|error| map_io_error("validate entry", error))?;
    if !is_within(&canonical_root, &canonical_target) {
        return Err(WorkspaceError::new(
            "OUTSIDE_WORKSPACE",
            "Entry is outside the workspace.",
        ));
    }
    let metadata =
        fs::symlink_metadata(&candidate).map_err(|error| map_io_error("read entry", error))?;
    let kind = if metadata.is_dir() {
        DirectoryEntryKind::Directory
    } else if metadata.is_file() {
        DirectoryEntryKind::File
    } else {
        DirectoryEntryKind::Other
    };
    let normalized_path = normalize_relative_path(relative_path)?;
    Ok((candidate, normalized_path, kind))
}

fn remove_entry_recursively(path: &Path) -> Result<(), WorkspaceError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| map_io_error("read entry", error))?;
    if is_link_or_reparse(&metadata) {
        return Err(WorkspaceError::new(
            "LINK_NOT_SUPPORTED",
            "Symbolic links and junctions cannot be deleted through Explorer.",
        ));
    }
    if metadata.is_dir() {
        for result in fs::read_dir(path).map_err(|error| map_io_error("read directory", error))? {
            let child = result
                .map_err(|error| map_io_error("read directory entry", error))?
                .path();
            remove_entry_recursively(&child)?;
        }
        fs::remove_dir(path).map_err(|error| map_io_error("delete directory", error))?;
    } else {
        fs::remove_file(path).map_err(|error| map_io_error("delete file", error))?;
    }
    Ok(())
}

fn ensure_clipboard_directory(root: &Path) -> Result<std::path::PathBuf, WorkspaceError> {
    let mut current = root.to_path_buf();
    for component in [".vibe-rider", "clipboard"] {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if is_link_or_reparse(&metadata) => {
                return Err(WorkspaceError::new(
                    "LINK_NOT_SUPPORTED",
                    "The clipboard directory cannot be a symbolic link or junction.",
                ));
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err(WorkspaceError::new(
                    "NOT_DIRECTORY",
                    "The clipboard storage path is not a directory.",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current)
                    .map_err(|error| map_io_error("create clipboard directory", error))?;
            }
            Err(error) => return Err(map_io_error("read clipboard directory", error)),
        }
    }
    Ok(current)
}

fn clipboard_extension(mime_type: &str) -> Option<&'static str> {
    match mime_type.to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        "image/bmp" => Some("bmp"),
        _ => None,
    }
}

pub(crate) fn list_directory(
    workspace_id: &str,
    root: &Path,
    relative_path: &str,
) -> Result<DirectoryListing, WorkspaceError> {
    let target = resolve_directory(root, relative_path)?;
    let normalized_relative_path = normalize_relative_path(relative_path)?;
    let mut entries = Vec::new();

    for result in fs::read_dir(&target).map_err(|error| map_io_error("đọc directory", error))? {
        let entry = result.map_err(|error| map_io_error("đọc directory entry", error))?;
        if entries.len() >= MAX_DIRECTORY_ENTRIES {
            return Err(WorkspaceError::new(
                "DIRECTORY_TOO_LARGE",
                format!("Directory vượt quá giới hạn {MAX_DIRECTORY_ENTRIES} entries."),
            ));
        }

        let name = entry
            .file_name()
            .to_str()
            .map(ToOwned::to_owned)
            .ok_or_else(|| {
                WorkspaceError::new(
                    "UNSUPPORTED_PATH_ENCODING",
                    "Tên directory entry không thể biểu diễn bằng Unicode.",
                )
            })?;
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|error| map_io_error("đọc metadata entry", error))?;
        let kind = classify_entry(&metadata);
        let child_relative_path = if normalized_relative_path.is_empty() {
            name.clone()
        } else {
            format!("{normalized_relative_path}/{name}")
        };

        entries.push(DirectoryEntry {
            name,
            relative_path: child_relative_path,
            kind,
        });
    }

    entries.sort_by(|left, right| {
        entry_sort_rank(left.kind)
            .cmp(&entry_sort_rank(right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(DirectoryListing {
        workspace_id: workspace_id.to_owned(),
        relative_path: normalized_relative_path,
        entries,
    })
}

fn normalize_relative_path(relative_path: &str) -> Result<String, WorkspaceError> {
    let normalized = crate::path_guard::validate_relative_path(relative_path)?;
    normalized
        .components()
        .map(|component| {
            component
                .as_os_str()
                .to_str()
                .map(ToOwned::to_owned)
                .ok_or_else(|| {
                    WorkspaceError::new(
                        "UNSUPPORTED_PATH_ENCODING",
                        "Directory path không thể biểu diễn bằng Unicode.",
                    )
                })
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|components| components.join("/"))
}

fn classify_entry(metadata: &fs::Metadata) -> DirectoryEntryKind {
    if metadata.file_type().is_symlink() || is_reparse_point(metadata) {
        DirectoryEntryKind::Link
    } else if metadata.is_dir() {
        DirectoryEntryKind::Directory
    } else if metadata.is_file() {
        DirectoryEntryKind::File
    } else {
        DirectoryEntryKind::Other
    }
}

fn entry_sort_rank(kind: DirectoryEntryKind) -> u8 {
    match kind {
        DirectoryEntryKind::Directory => 0,
        DirectoryEntryKind::File => 1,
        DirectoryEntryKind::Link => 2,
        DirectoryEntryKind::Other => 3,
    }
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    metadata.file_attributes() & 0x0400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
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
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::{
        create_entry_on_disk, delete_entry_on_disk, list_directory, save_clipboard_image_on_disk,
        CreateEntryKind, DirectoryEntryKind,
    };

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

    struct TempDirectory(PathBuf);

    impl TempDirectory {
        fn new() -> Self {
            let sequence = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "vibe-rider-phase1-filesystem-{}-{sequence}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("fixture directory should be created");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn lists_only_direct_children_and_sorts_directories_first() {
        let fixture = TempDirectory::new();
        fs::create_dir(fixture.path().join("z-directory")).expect("directory should exist");
        fs::write(fixture.path().join("a-file.txt"), b"file").expect("file should exist");
        fs::create_dir(fixture.path().join("z-directory").join("nested"))
            .expect("nested directory should exist");

        let listing =
            list_directory("workspace-1", fixture.path(), "").expect("listing should work");
        assert_eq!(listing.relative_path, "");
        assert_eq!(listing.entries.len(), 2);
        assert_eq!(listing.entries[0].name, "z-directory");
        assert_eq!(listing.entries[0].kind, DirectoryEntryKind::Directory);
        assert_eq!(listing.entries[1].name, "a-file.txt");
        assert_eq!(listing.entries[1].kind, DirectoryEntryKind::File);
        assert_eq!(listing.entries[0].relative_path, "z-directory");
    }

    #[test]
    fn empty_directory_returns_an_empty_listing() {
        let fixture = TempDirectory::new();
        fs::create_dir(fixture.path().join("empty")).expect("directory should exist");

        let listing = list_directory("workspace-1", fixture.path(), "empty")
            .expect("empty listing should work");
        assert!(listing.entries.is_empty());
        assert_eq!(listing.relative_path, "empty");
    }

    #[test]
    fn rejects_a_file_as_a_directory() {
        let fixture = TempDirectory::new();
        fs::write(fixture.path().join("file.txt"), b"file").expect("file should exist");

        let error = list_directory("workspace-1", fixture.path(), "file.txt")
            .expect_err("file must not be listed as a directory");
        assert_eq!(error.code, "NOT_DIRECTORY");
    }

    #[test]
    fn creates_files_and_directories_inside_the_workspace() {
        let fixture = TempDirectory::new();
        let directory = create_entry_on_disk(
            "workspace-1",
            fixture.path(),
            "",
            "src",
            CreateEntryKind::Directory,
        )
        .expect("directory should be created");
        assert_eq!(directory.relative_path, "src");
        assert_eq!(directory.kind, DirectoryEntryKind::Directory);

        let file = create_entry_on_disk(
            "workspace-1",
            fixture.path(),
            "src",
            "main.rs",
            CreateEntryKind::File,
        )
        .expect("file should be created");
        assert_eq!(file.relative_path, "src/main.rs");
        assert_eq!(fs::read(fixture.path().join("src/main.rs")).unwrap(), b"");
    }

    #[test]
    fn deletes_files_and_nested_directories_without_following_links() {
        let fixture = TempDirectory::new();
        fs::create_dir(fixture.path().join("src")).expect("directory should exist");
        fs::create_dir(fixture.path().join("src").join("nested")).expect("nested should exist");
        fs::write(
            fixture.path().join("src").join("nested").join("file.txt"),
            b"file",
        )
        .expect("file should exist");

        let result = delete_entry_on_disk("workspace-1", fixture.path(), "src")
            .expect("directory should be deleted");
        assert_eq!(result.kind, DirectoryEntryKind::Directory);
        assert!(!fixture.path().join("src").exists());
    }

    #[test]
    fn saves_supported_clipboard_images_under_the_workspace() {
        let fixture = TempDirectory::new();
        let result =
            save_clipboard_image_on_disk("workspace-1", fixture.path(), "image/png", &[1, 2, 3])
                .expect("clipboard image should be saved");
        assert!(result
            .relative_path
            .starts_with(".vibe-rider/clipboard/image-"));
        assert_eq!(fs::read(&result.absolute_path).unwrap(), vec![1, 2, 3]);
    }
}
