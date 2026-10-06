//! Small Windows Credential Manager wrapper used for OAuth credentials.
//!
//! The renderer never receives the credential blob.  Non-Windows builds fail
//! closed until a platform-native secure store is added for that platform.

const TARGET_NAME: &str = "Vibe Rider/GitHub OAuth";

#[cfg(windows)]
fn target_name() -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    std::ffi::OsStr::new(TARGET_NAME)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

pub fn read() -> Result<Option<Vec<u8>>, String> {
    #[cfg(windows)]
    {
        use std::ptr::null_mut;
        use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
        use windows_sys::Win32::Security::Credentials::{
            CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
        };

        let target = target_name();
        let mut credential: *mut CREDENTIALW = null_mut();
        let success = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
        if success == 0 {
            let error = unsafe { GetLastError() };
            if error == ERROR_NOT_FOUND {
                return Ok(None);
            }
            return Err(format!(
                "Credential Manager could not read the stored data ({error:?})."
            ));
        }
        if credential.is_null() {
            return Err("Credential Manager returned empty data.".to_string());
        }

        let result = unsafe {
            let value = &*credential;
            if value.CredentialBlobSize > 1024 * 1024 {
                Err("Credential Manager returned data above the safe size limit.".to_string())
            } else if value.CredentialBlobSize > 0 && value.CredentialBlob.is_null() {
                Err("Credential Manager returned an invalid credential blob.".to_string())
            } else {
                Ok(std::slice::from_raw_parts(
                    value.CredentialBlob,
                    value.CredentialBlobSize as usize,
                )
                .to_vec())
            }
        };
        unsafe { CredFree(credential.cast()) };
        result.map(Some)
    }

    #[cfg(not(windows))]
    {
        Err("GitHub OAuth secure storage is currently supported on Windows only.".to_string())
    }
}

pub fn write(value: &[u8]) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::ptr::null_mut;
        use windows_sys::Win32::Foundation::GetLastError;
        use windows_sys::Win32::Security::Credentials::{
            CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
        };

        if value.len() > 1024 * 1024 {
            return Err("The credential is too large to store safely.".to_string());
        }
        let target = target_name();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_ptr() as *mut u16,
            CredentialBlobSize: value.len() as u32,
            CredentialBlob: if value.is_empty() {
                null_mut()
            } else {
                value.as_ptr() as *mut u8
            },
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        let success = unsafe { CredWriteW(&credential, 0) };
        if success == 0 {
            let error = unsafe { GetLastError() };
            return Err(format!(
                "Credential Manager could not store the data ({error:?})."
            ));
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = value;
        Err("GitHub OAuth secure storage is currently supported on Windows only.".to_string())
    }
}

pub fn delete() -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
        use windows_sys::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};

        let target = target_name();
        let success = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if success == 0 {
            let error = unsafe { GetLastError() };
            if error == ERROR_NOT_FOUND {
                return Ok(());
            }
            return Err(format!(
                "Credential Manager could not delete the data ({error:?})."
            ));
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        Err("GitHub OAuth secure storage is currently supported on Windows only.".to_string())
    }
}
