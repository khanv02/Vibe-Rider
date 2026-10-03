use std::env;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::TerminalError;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ShellKind {
    Pwsh,
    Powershell,
}

pub(crate) struct ResolvedShell {
    pub kind: ShellKind,
    pub executable: PathBuf,
}

pub(crate) fn resolve_powershell() -> Result<ResolvedShell, TerminalError> {
    let modern_name = if cfg!(windows) { "pwsh.exe" } else { "pwsh" };
    if let Some(executable) = find_on_path(modern_name) {
        return Ok(ResolvedShell {
            kind: ShellKind::Pwsh,
            executable,
        });
    }

    #[cfg(windows)]
    {
        for variable in ["SystemRoot", "WINDIR"] {
            if let Some(system_root) = env::var_os(variable) {
                let executable = PathBuf::from(system_root)
                    .join("System32")
                    .join("WindowsPowerShell")
                    .join("v1.0")
                    .join("powershell.exe");
                if is_executable_file(&executable) {
                    return Ok(ResolvedShell {
                        kind: ShellKind::Powershell,
                        executable,
                    });
                }
            }
        }
    }

    Err(TerminalError::new(
        "SHELL_NOT_FOUND",
        "Không tìm thấy pwsh hoặc Windows PowerShell trên máy.",
    ))
}

fn find_on_path(file_name: &str) -> Option<PathBuf> {
    env::var_os("PATH")
        .into_iter()
        .flat_map(|path| env::split_paths(&path).collect::<Vec<_>>())
        .map(|directory| directory.join(file_name))
        .find(|candidate| is_executable_file(candidate))
}

fn is_executable_file(path: &Path) -> bool {
    path.metadata().is_ok_and(|metadata| metadata.is_file())
}

#[cfg(test)]
mod tests {
    use super::is_executable_file;

    #[test]
    fn directories_are_not_accepted_as_shell_executables() {
        assert!(!is_executable_file(std::env::temp_dir().as_path()));
    }
}
