use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::path_guard::resolve_directory;
use crate::workspace::{WorkspaceError, WorkspaceState};

const MAX_DIRECTORY_ENTRIES: usize = 5_000;

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

    use super::{list_directory, DirectoryEntryKind};

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
}
