use std::process::Command;

fn allowed_github_url(url: &str) -> bool {
    matches!(
        url,
        "https://github.com"
            | "https://github.com/"
            | "https://github.com/login"
            | "https://github.com/logout"
            | "https://github.com/settings/profile"
    )
}

fn allowed_repository_url(url: &str) -> bool {
    let Some(value) = url.strip_prefix("https://") else {
        return false;
    };
    let Some((host, path)) = value.split_once('/') else {
        return false;
    };
    if !matches!(host, "github.com" | "gitlab.com" | "bitbucket.org") {
        return false;
    }
    let parts = path
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    parts.len() == 2
        && parts
            .iter()
            .all(|part| !part.contains(['?', '#', ':', '@', '\\', ' ']))
}

fn allowed_external_url(url: &str) -> bool {
    allowed_github_url(url) || allowed_repository_url(url)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !allowed_external_url(&url) {
        return Err("Chỉ được mở URL GitHub đã được cho phép.".to_string());
    }

    #[cfg(windows)]
    let result = Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn();

    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&url).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(&url).spawn();

    result
        .map(|_| ())
        .map_err(|error| format!("Không thể mở browser mặc định: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{allowed_github_url, allowed_repository_url};

    #[test]
    fn external_url_allowlist_rejects_arbitrary_hosts() {
        assert!(allowed_github_url("https://github.com/login"));
        assert!(allowed_repository_url("https://github.com/openai/codex"));
        assert!(allowed_repository_url("https://gitlab.com/group/project"));
        assert!(!allowed_github_url("https://example.com"));
        assert!(!allowed_repository_url(
            "https://github.com.evil.example/login"
        ));
        assert!(!allowed_repository_url(
            "https://github.com/openai/codex/issues"
        ));
        assert!(!allowed_github_url("https://github.com.evil.example/login"));
    }
}
