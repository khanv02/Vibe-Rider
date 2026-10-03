use std::ffi::OsStr;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

use super::process::{resolve_git, sanitize_environment, GitRunner, Limits};
use super::repository::{inspect, validate_path};
use super::status::read as read_status;
use super::GitService;

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

struct Fixture {
    root: PathBuf,
    executable: PathBuf,
}

impl Fixture {
    fn new(repository: bool) -> Self {
        let sequence = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "vibe-rider-git-{}-{sequence}-repo có dấu",
            std::process::id()
        ));
        fs::create_dir(&root).expect("owned fixture must be new");
        let fixture = Self {
            root: root.canonicalize().unwrap(),
            executable: resolve_git().expect("Git installed for integration tests"),
        };
        if repository {
            fixture.git(&["init", "--initial-branch=main", "--template="]);
        }
        fixture
    }
    fn git(&self, args: &[&str]) {
        let mut command = Command::new(&self.executable);
        command.args(args).current_dir(&self.root);
        sanitize_environment(&mut command);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let output = command.output().expect("fixture Git process");
        assert!(
            output.status.success(),
            "fixture Git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    fn runner(&self) -> GitRunner {
        GitRunner::new(self.executable.clone(), self.root.clone())
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Only the unique directory successfully created by this fixture.
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn operations_have_backend_identity_and_owner_scoped_cancellation() {
    let service = GitService::default();
    let lease = service.begin("main", "workspace", "push", true).unwrap();
    let other_workspace = service.begin("main", "other", "commit", true).unwrap();
    assert_eq!(
        service
            .begin("main", "workspace", "commit", true)
            .err()
            .unwrap()
            .code,
        "GIT_BUSY"
    );
    assert_eq!(
        service
            .operations("other-window", "workspace")
            .unwrap()
            .len(),
        0
    );
    assert_eq!(service.operations("main", "workspace").unwrap().len(), 1);
    let id = lease.id.to_string();
    assert_eq!(
        service
            .cancel("other-window", "workspace", &id)
            .unwrap_err()
            .code,
        "INVALID_OPERATION_OWNER"
    );
    assert_eq!(
        service.cancel("main", "other", &id).unwrap_err().code,
        "INVALID_OPERATION_OWNER"
    );
    assert!(service.cancel("main", "workspace", &id).unwrap());
    assert!(lease.control.cancelled.load(Ordering::Acquire));
    assert_eq!(
        service.ensure_workspace_idle("workspace").unwrap_err().code,
        "GIT_BUSY"
    );
    drop(lease);
    assert!(service.ensure_workspace_idle("workspace").is_ok());
    assert!(!service.cancel("main", "workspace", &id).unwrap());
    drop(other_workspace);
    assert!(service.operations("main", "workspace").unwrap().is_empty());
}

#[test]
fn shutdown_rejects_new_operations() {
    let service = GitService::default();
    service.close_all_for_shutdown();
    assert_eq!(
        service
            .begin("main", "workspace", "status", false)
            .err()
            .unwrap()
            .code,
        "GIT_SHUTTING_DOWN"
    );
}

#[test]
fn request_dto_rejects_arbitrary_command_fields() {
    assert!(
        serde_json::from_value::<super::GitWorkspaceRequest>(serde_json::json!({
            "workspaceId": "fixture", "command": "reset --hard"
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<super::GitCancelRequest>(serde_json::json!({
            "workspaceId": "fixture", "operationId": "1", "pid": 123
        }))
        .is_err()
    );
}

#[test]
fn missing_leaf_is_validated_without_allowing_traversal_metadata_or_nested_repo() {
    let fixture = Fixture::new(true);
    fs::create_dir(fixture.root.join("src")).unwrap();
    fs::write(fixture.root.join("src/name [1] có dấu.txt"), b"test").unwrap();
    assert!(validate_path(&fixture.root, "src/name [1] có dấu.txt").is_ok());
    assert_eq!(
        validate_path(&fixture.root, "src/deleted.txt").unwrap(),
        fixture.root.join("src/deleted.txt")
    );
    for path in [
        "",
        "../outside",
        "..\\outside",
        "C:outside",
        ".git/config",
        ".GIT/index",
        "src/.git./config",
        "src ",
        "src/NUL.txt",
        "src/COM1.txt",
        "src/con",
    ] {
        assert!(
            validate_path(&fixture.root, path).is_err(),
            "must reject {path}"
        );
    }
    assert_eq!(
        validate_path(&fixture.root, "src").unwrap_err().code,
        "NOT_FILE"
    );
    fs::create_dir(fixture.root.join("nested")).unwrap();
    fs::create_dir(fixture.root.join("nested/.git")).unwrap();
    assert_eq!(
        validate_path(&fixture.root, "nested/deleted.txt")
            .unwrap_err()
            .code,
        "UNSUPPORTED_REPOSITORY"
    );
    fs::write(fixture.root.join("not-directory"), b"test").unwrap();
    assert!(validate_path(&fixture.root, "not-directory/child.txt").is_err());
}

#[cfg(windows)]
#[test]
fn inherited_repository_and_config_overrides_cannot_redirect_git() {
    let fixture = Fixture::new(true);
    let outside = Fixture::new(true);
    let mut command = Command::new(&fixture.executable);
    command
        .current_dir(&fixture.root)
        .args(["rev-parse", "--show-toplevel"])
        .env("GIT_DIR", outside.root.join(".git"))
        .env("GIT_WORK_TREE", &outside.root)
        .env("GIT_CONFIG_COUNT", "1")
        .env("GIT_CONFIG_KEY_0", "core.worktree")
        .env("GIT_CONFIG_VALUE_0", &outside.root);
    sanitize_environment(&mut command);
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
    let output = command.output().unwrap();
    assert!(output.status.success());
    let actual = String::from_utf8(output.stdout).unwrap();
    assert_eq!(
        PathBuf::from(actual.trim_end()).canonicalize().unwrap(),
        fixture.root
    );
}

#[cfg(windows)]
#[test]
fn deleted_path_does_not_follow_junction_ancestor() {
    let fixture = Fixture::new(true);
    let outside = Fixture::new(false);
    let junction = fixture.root.join("link");
    create_junction(&junction, &outside.root).expect("native junction fixture must be created");
    assert_eq!(
        validate_path(&fixture.root, "link/deleted.txt")
            .unwrap_err()
            .code,
        "LINK_NOT_SUPPORTED"
    );
    // Remove only the junction itself, not its target tree.
    fs::remove_dir(&junction).unwrap();
}

#[cfg(windows)]
fn create_junction(link: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::IO::DeviceIoControl;
    // Mount-point reparse data uses offsets into a UTF-16 PathBuffer. All paths
    // are owned fixtures; no command shell/quoting or administrator symlink API.
    let print = target
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_owned();
    let substitute = format!(r"\??\{print}").encode_utf16().collect::<Vec<_>>();
    let print = print.encode_utf16().collect::<Vec<_>>();
    let mut paths = substitute.clone();
    paths.push(0);
    paths.extend(&print);
    paths.push(0);
    let mut data = Vec::new();
    data.extend_from_slice(&0xa0000003u32.to_le_bytes()); // IO_REPARSE_TAG_MOUNT_POINT
    data.extend_from_slice(&(8u16 + (paths.len() * 2) as u16).to_le_bytes());
    data.extend_from_slice(&0u16.to_le_bytes());
    for field in [
        0u16,
        (substitute.len() * 2) as u16,
        ((substitute.len() + 1) * 2) as u16,
        (print.len() * 2) as u16,
    ] {
        data.extend_from_slice(&field.to_le_bytes());
    }
    for character in paths {
        data.extend_from_slice(&character.to_le_bytes());
    }
    fs::create_dir(link)?;
    let wide = link
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    // SAFETY: wide is NUL-terminated; flags open only our existing fixture dir.
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            0x40000000,
            7,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error());
    }
    let mut returned = 0;
    // SAFETY: data has the documented mount-point layout and correct byte length.
    let success = unsafe {
        DeviceIoControl(
            handle,
            0x000900a4,
            data.as_ptr().cast(),
            data.len() as u32,
            std::ptr::null_mut(),
            0,
            &mut returned,
            std::ptr::null_mut(),
        )
    };
    let result = if success == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    };
    // SAFETY: we own this handle and close it once after DeviceIoControl.
    unsafe {
        CloseHandle(handle);
    }
    result
}

#[cfg(windows)]
#[test]
fn repository_probe_checks_exact_root_and_rejects_parent_bare_pointer_and_sparse() {
    let fixture = Fixture::new(true);
    let runner = fixture.runner();
    let service = GitService::default();
    let lease = service
        .begin("main", "fixture", "repository", false)
        .unwrap();
    let repository = inspect("fixture", &fixture.root, &runner, &lease.control).unwrap();
    assert_eq!(repository.workspace_id, "fixture");
    assert!(repository.git_version.starts_with("git version"));
    let second = inspect("other-workspace", &fixture.root, &runner, &lease.control).unwrap();
    assert_ne!(repository.repository_id, second.repository_id);

    let subfolder = fixture.root.join("subfolder");
    fs::create_dir(&subfolder).unwrap();
    let subrunner = GitRunner::new(fixture.executable.clone(), subfolder.clone());
    assert_eq!(
        inspect("fixture", &subfolder, &subrunner, &lease.control)
            .unwrap_err()
            .code,
        "NOT_REPOSITORY"
    );
    fs::write(subfolder.join(".git"), b"gitdir: ../.git\n").unwrap();
    assert_eq!(
        inspect("fixture", &subfolder, &subrunner, &lease.control)
            .unwrap_err()
            .code,
        "UNSUPPORTED_REPOSITORY"
    );

    let bare = Fixture::new(false);
    bare.git(&["init", "--bare", "--template="]);
    assert_eq!(
        inspect("fixture", &bare.root, &bare.runner(), &lease.control)
            .unwrap_err()
            .code,
        "UNSUPPORTED_REPOSITORY"
    );
    fixture.git(&["config", "core.sparseCheckout", "true"]);
    assert_eq!(
        inspect("fixture", &fixture.root, &runner, &lease.control)
            .unwrap_err()
            .code,
        "UNSUPPORTED_REPOSITORY"
    );
}

#[cfg(windows)]
#[test]
fn runner_drains_both_streams_and_returns_bounded_diagnostic_tail() {
    let fixture = Fixture::new(true);
    let service = GitService::default();
    let lease = service.begin("main", "fixture", "fixture", true).unwrap();
    let args = [
        "-c",
        "alias.fixture=!printf '%65536s' x; printf '%65536s' y >&2",
        "fixture",
    ];
    let args = args.iter().map(OsStr::new).collect::<Vec<_>>();
    let output = fixture
        .runner()
        .run(
            "fixture",
            &args,
            None,
            Limits {
                timeout: Duration::from_secs(5),
                bytes: 1024,
                machine: false,
            },
            &lease.control,
        )
        .unwrap();
    assert_eq!(output.exit_code, Some(0));
    assert_eq!(output.stdout.len(), 1024);
    assert_eq!(output.stderr.len(), 1024);
    assert_eq!(output.stdout.last(), Some(&b'x'));
    assert_eq!(output.stderr.last(), Some(&b'y'));
    assert!(output.truncated);
}

#[cfg(windows)]
#[test]
fn runner_machine_output_overflow_fails_even_if_process_exits_quickly() {
    let fixture = Fixture::new(true);
    let service = GitService::default();
    let lease = service.begin("main", "fixture", "fixture", false).unwrap();
    let args = ["-c", "alias.fixture=!printf '%65536s' x", "fixture"];
    let args = args.iter().map(OsStr::new).collect::<Vec<_>>();
    let result = fixture.runner().run(
        "fixture",
        &args,
        None,
        Limits {
            timeout: Duration::from_secs(5),
            bytes: 1024,
            machine: true,
        },
        &lease.control,
    );
    assert_eq!(result.err().unwrap().code, "OUTPUT_LIMIT");
}

#[cfg(windows)]
#[test]
fn timeout_kills_descendants_and_releases_pipes_promptly() {
    let fixture = Fixture::new(true);
    let service = GitService::default();
    let lease = service.begin("main", "fixture", "fixture", true).unwrap();
    let args = ["-c", "alias.fixture=!sleep 20 & wait", "fixture"];
    let args = args.iter().map(OsStr::new).collect::<Vec<_>>();
    let started = Instant::now();
    let result = fixture.runner().run(
        "fixture",
        &args,
        None,
        Limits {
            timeout: Duration::from_millis(200),
            bytes: 1024,
            machine: false,
        },
        &lease.control,
    );
    assert_eq!(result.err().unwrap().code, "TIMEOUT");
    assert!(started.elapsed() < Duration::from_secs(4));
    assert!(lease.control.tree.lock().unwrap().is_none());
}

#[cfg(windows)]
#[test]
fn exited_parent_does_not_leave_helper_holding_reader_pipes() {
    let fixture = Fixture::new(true);
    let service = GitService::default();
    let lease = service.begin("main", "fixture", "fixture", true).unwrap();
    let args = ["-c", "alias.fixture=!sleep 20 & exit 0", "fixture"];
    let args = args.iter().map(OsStr::new).collect::<Vec<_>>();
    let started = Instant::now();
    let output = fixture
        .runner()
        .run(
            "fixture",
            &args,
            None,
            Limits {
                timeout: Duration::from_secs(4),
                bytes: 1024,
                machine: false,
            },
            &lease.control,
        )
        .unwrap();
    assert_eq!(output.exit_code, Some(0));
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[cfg(windows)]
#[test]
fn owner_cancel_interrupts_a_running_git_process() {
    let fixture = Fixture::new(true);
    let service = GitService::default();
    let lease = service.begin("main", "fixture", "fixture", true).unwrap();
    let control = Arc::clone(&lease.control);
    let runner = fixture.runner();
    let worker = std::thread::spawn(move || {
        let args = ["-c", "alias.fixture=!sleep 20 & wait", "fixture"];
        let args = args.iter().map(OsStr::new).collect::<Vec<_>>();
        runner.run(
            "fixture",
            &args,
            None,
            Limits {
                timeout: Duration::from_secs(5),
                bytes: 1024,
                machine: false,
            },
            &control,
        )
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    while lease.control.tree.lock().unwrap().is_none() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(lease.control.tree.lock().unwrap().is_some());
    assert!(service
        .cancel("main", "fixture", &lease.id.to_string())
        .unwrap());
    assert_eq!(worker.join().unwrap().err().unwrap().code, "CANCELLED");
    assert!(lease.control.tree.lock().unwrap().is_none());
}

#[cfg(windows)]
#[test]
fn real_porcelain_status_reports_staged_unstaged_and_untracked_entries() {
    let fixture = Fixture::new(true);
    fs::write(fixture.root.join("tracked file.txt"), b"one\n").unwrap();
    fixture.git(&["add", "--", "tracked file.txt"]);
    fs::write(fixture.root.join("tracked file.txt"), b"two\n").unwrap();
    fs::write(fixture.root.join("new [file].txt"), b"new\n").unwrap();

    let service = GitService::default();
    let lease = service.begin("main", "fixture", "status", false).unwrap();
    let repository = inspect("fixture", &fixture.root, &fixture.runner(), &lease.control).unwrap();
    let snapshot = read_status(
        "fixture",
        &repository.repository_id,
        &fixture.root,
        &fixture.runner(),
        &lease.control,
        Some("request-1".into()),
    )
    .unwrap();
    assert_eq!(snapshot.status.request_id.as_deref(), Some("request-1"));
    assert_eq!(snapshot.status.branch.head.as_deref(), Some("main"));
    assert!(snapshot
        .status
        .entries
        .iter()
        .any(|entry| entry.staged && entry.current_path == "tracked file.txt"));
    assert!(snapshot
        .status
        .entries
        .iter()
        .any(|entry| entry.unstaged && entry.current_path == "tracked file.txt"));
    assert!(snapshot
        .status
        .entries
        .iter()
        .any(|entry| entry.untracked && entry.current_path == "new [file].txt"));
}
