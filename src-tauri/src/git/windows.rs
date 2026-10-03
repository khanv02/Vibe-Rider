//! Git and every helper start inside a kill-on-close Job Object. Start suspended
//! so a fast hook/helper cannot escape containment before assignment.
use std::io;
use std::os::windows::{io::AsRawHandle, process::CommandExt};
use std::process::{Child, Command};
use std::sync::Arc;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    OpenThread, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME,
};

struct Handle(HANDLE);

impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: this wrapper owns a valid non-inherited handle exactly once.
        unsafe {
            CloseHandle(self.0);
        }
    }
}

pub(super) struct ProcessTree {
    job: Handle,
}

// SAFETY: the job handle is owned until the last Arc drops; Job Object APIs may
// be called across threads and termination never transfers handle ownership.
unsafe impl Send for ProcessTree {}
unsafe impl Sync for ProcessTree {}

impl ProcessTree {
    pub(super) fn spawn(command: &mut Command) -> io::Result<(Child, Arc<Self>)> {
        // SAFETY: null security/name creates a private, non-inherited job.
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return Err(io::Error::last_os_error());
        }
        let tree = Arc::new(Self { job: Handle(job) });
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: limits has the documented size and remains alive for this call.
        if unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
        let mut child = command.spawn()?;
        // SAFETY: Child owns the live process handle, still suspended.
        let assigned = unsafe { AssignProcessToJobObject(job, child.as_raw_handle().cast()) };
        let result = if assigned == 0 {
            Err(io::Error::last_os_error())
        } else {
            resume_initial_thread(child.id())
        };
        if let Err(error) = result {
            tree.terminate();
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        Ok((child, tree))
    }

    pub(super) fn terminate(&self) {
        // SAFETY: job remains owned by self; termination is idempotent.
        unsafe {
            TerminateJobObject(self.job.0, 1);
        }
    }
}

fn resume_initial_thread(process_id: u32) -> io::Result<()> {
    // std::process::Child doesn't expose the primary-thread handle. Enumerate
    // our still-suspended process's thread using documented Win32 APIs.
    // SAFETY: no pointers are passed to the snapshot API.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let snapshot = Handle(snapshot);
    let mut entry = THREADENTRY32 {
        dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };
    // SAFETY: entry is a correctly sized writable record owned by this frame.
    let mut found = unsafe { Thread32First(snapshot.0, &mut entry) } != 0;
    while found {
        if entry.th32OwnerProcessID == process_id {
            // SAFETY: thread ID belongs to the suspended child we just created.
            let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
            if thread.is_null() {
                return Err(io::Error::last_os_error());
            }
            let thread = Handle(thread);
            // SAFETY: thread handle has THREAD_SUSPEND_RESUME access.
            if unsafe { ResumeThread(thread.0) } == u32::MAX {
                return Err(io::Error::last_os_error());
            }
            return Ok(());
        }
        // SAFETY: snapshot and entry remain valid for iteration.
        found = unsafe { Thread32Next(snapshot.0, &mut entry) } != 0;
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "Không tìm thấy Git process thread.",
    ))
}
