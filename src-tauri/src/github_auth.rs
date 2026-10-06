use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::github_api::{ApiError, DevicePoll, GitHubApi, GitHubUser, OAuthToken};
use crate::secure_store;
use crate::workspace::WorkspaceState;

static NEXT_FLOW_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Default)]
pub struct GitHubAuthService {
    inner: Arc<Mutex<AuthState>>,
}

impl GitHubAuthService {
    pub(crate) fn has_authenticated_session(&self) -> Result<bool, GitHubAuthError> {
        self.inner
            .lock()
            .map(|auth| auth.session.is_some() && auth.token.is_some())
            .map_err(|_| {
                GitHubAuthError::new(
                    "GITHUB_STATE_ERROR",
                    "The GitHub authentication service was interrupted.",
                    true,
                )
            })
    }
}

#[derive(Default)]
struct AuthState {
    session: Option<PublicSession>,
    token: Option<StoredToken>,
    flow: Option<ActiveFlow>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredToken {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<u64>,
}

#[derive(Clone, Debug)]
struct ActiveFlow {
    flow_id: String,
    device_code: String,
    expires_at: u64,
    interval_seconds: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSession {
    pub github_user_id: u64,
    pub login: String,
    pub display_name: Option<String>,
    pub avatar_url: String,
    pub expires_at: Option<u64>,
    pub last_validated_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceChallenge {
    pub flow_id: String,
    pub verification_uri: String,
    pub user_code: String,
    pub expires_at: u64,
    pub poll_interval_seconds: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "status"
)]
pub enum AuthPollResult {
    Pending { next_poll_interval_seconds: u64 },
    SlowDown { next_poll_interval_seconds: u64 },
    Verified { session: PublicSession },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAuthError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginAuthRequest {
    #[serde(default)]
    pub force_account_selection: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowRequest {
    pub flow_id: String,
}

#[tauri::command]
pub async fn github_auth_begin(
    state: State<'_, GitHubAuthService>,
    workspace: State<'_, WorkspaceState>,
    request: BeginAuthRequest,
) -> Result<DeviceChallenge, GitHubAuthError> {
    if workspace
        .active_snapshot()
        .map_err(|_| {
            GitHubAuthError::new(
                "WORKSPACE_UNAVAILABLE",
                "The active workspace could not be verified.",
                true,
            )
        })?
        .is_none()
    {
        return Err(GitHubAuthError::new(
            "WORKSPACE_REQUIRED",
            "Open a workspace folder before signing in to GitHub.",
            false,
        ));
    }
    let _ = request.force_account_selection;
    let api = GitHubApi::new().map_err(GitHubAuthError::from)?;
    let flow = api
        .begin_device_flow()
        .await
        .map_err(GitHubAuthError::from)?;
    let now = unix_now();
    let flow_id = format!(
        "flow-{}-{}",
        now,
        NEXT_FLOW_ID.fetch_add(1, Ordering::Relaxed)
    );
    let expires_at = now.saturating_add(flow.expires_in);
    let challenge = DeviceChallenge {
        flow_id: flow_id.clone(),
        verification_uri: flow.verification_uri,
        user_code: flow.user_code,
        expires_at,
        poll_interval_seconds: flow.interval,
    };
    let mut auth = lock_state(&state)?;
    auth.flow = Some(ActiveFlow {
        flow_id,
        device_code: flow.device_code,
        expires_at,
        interval_seconds: flow.interval,
    });
    Ok(challenge)
}

#[tauri::command]
pub async fn github_auth_poll(
    state: State<'_, GitHubAuthService>,
    request: FlowRequest,
) -> Result<AuthPollResult, GitHubAuthError> {
    let active_flow = {
        let auth = lock_state(&state)?;
        auth.flow
            .as_ref()
            .filter(|flow| flow.flow_id == request.flow_id)
            .cloned()
            .ok_or_else(|| {
                GitHubAuthError::new(
                    "GITHUB_FLOW_NOT_FOUND",
                    "This sign-in session is no longer available.",
                    false,
                )
            })?
    };
    if unix_now() >= active_flow.expires_at {
        clear_flow(&state, &request.flow_id)?;
        return Err(GitHubAuthError::new(
            "GITHUB_DEVICE_EXPIRED",
            "The GitHub sign-in code has expired.",
            false,
        ));
    }

    let api = GitHubApi::new().map_err(GitHubAuthError::from)?;
    match api
        .poll_device_flow(&active_flow.device_code)
        .await
        .map_err(GitHubAuthError::from)?
    {
        DevicePoll::Pending => Ok(AuthPollResult::Pending {
            next_poll_interval_seconds: active_flow.interval_seconds,
        }),
        DevicePoll::SlowDown => {
            let next_interval = active_flow.interval_seconds.saturating_add(5);
            update_interval(&state, &request.flow_id, next_interval)?;
            Ok(AuthPollResult::SlowDown {
                next_poll_interval_seconds: next_interval,
            })
        }
        DevicePoll::Approved(token) => {
            let user = api
                .current_user(&token.access_token)
                .await
                .map_err(GitHubAuthError::from)?;
            let expires_at = token
                .expires_in
                .map(|seconds| unix_now().saturating_add(seconds));
            let public_session = public_session(&user, expires_at);
            persist_session(&state, &request.flow_id, token, public_session.clone())?;
            Ok(AuthPollResult::Verified {
                session: public_session,
            })
        }
    }
}

#[tauri::command]
pub fn github_auth_cancel(
    state: State<'_, GitHubAuthService>,
    request: FlowRequest,
) -> Result<(), GitHubAuthError> {
    clear_flow(&state, &request.flow_id)
}

#[tauri::command]
pub async fn github_auth_session(
    state: State<'_, GitHubAuthService>,
) -> Result<Option<PublicSession>, GitHubAuthError> {
    if let Some(session) = lock_state(&state)?.session.clone() {
        return Ok(Some(session));
    }
    let Some(bytes) = secure_store::read().map_err(storage_error)? else {
        return Ok(None);
    };
    let stored: StoredToken = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => {
            let _ = secure_store::delete();
            return Ok(None);
        }
    };
    let api = GitHubApi::new().map_err(GitHubAuthError::from)?;
    let (token, user) = validate_token(&api, stored).await?;
    let session = public_session(&user, token.expires_at);
    let serialized = serde_json::to_vec(&token).map_err(|_| {
        GitHubAuthError::new(
            "GITHUB_SESSION_ERROR",
            "Could not prepare the GitHub session.",
            false,
        )
    })?;
    secure_store::write(&serialized).map_err(storage_error)?;
    let mut auth = lock_state(&state)?;
    auth.token = Some(token);
    auth.session = Some(session.clone());
    Ok(Some(session))
}

#[tauri::command]
pub fn github_auth_logout(state: State<'_, GitHubAuthService>) -> Result<(), GitHubAuthError> {
    secure_store::delete().map_err(storage_error)?;
    let mut auth = lock_state(&state)?;
    auth.token = None;
    auth.session = None;
    auth.flow = None;
    Ok(())
}

fn persist_session(
    state: &State<'_, GitHubAuthService>,
    flow_id: &str,
    token: OAuthToken,
    session: PublicSession,
) -> Result<(), GitHubAuthError> {
    let stored = StoredToken {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: token
            .expires_in
            .map(|seconds| unix_now().saturating_add(seconds)),
    };
    let bytes = serde_json::to_vec(&stored).map_err(|_| {
        GitHubAuthError::new(
            "GITHUB_SESSION_ERROR",
            "Could not prepare the GitHub session.",
            false,
        )
    })?;
    {
        let auth = lock_state(state)?;
        if !auth
            .flow
            .as_ref()
            .is_some_and(|flow| flow.flow_id == flow_id)
        {
            return Err(GitHubAuthError::new(
                "GITHUB_FLOW_NOT_FOUND",
                "This sign-in session is no longer available.",
                false,
            ));
        }
    }
    let mut auth = lock_state(state)?;
    if !auth
        .flow
        .as_ref()
        .is_some_and(|flow| flow.flow_id == flow_id)
    {
        return Err(GitHubAuthError::new(
            "GITHUB_FLOW_NOT_FOUND",
            "This sign-in session is no longer available.",
            false,
        ));
    }
    secure_store::write(&bytes).map_err(storage_error)?;
    auth.flow = None;
    auth.token = Some(stored);
    auth.session = Some(session);
    Ok(())
}

async fn validate_token(
    api: &GitHubApi,
    mut token: StoredToken,
) -> Result<(StoredToken, GitHubUser), GitHubAuthError> {
    if token
        .expires_at
        .is_some_and(|expires| expires <= unix_now().saturating_add(60))
    {
        if let Some(refresh_token) = token.refresh_token.as_deref() {
            token = api
                .refresh_token(refresh_token)
                .await
                .map_err(GitHubAuthError::from)
                .map(|refreshed| StoredToken {
                    access_token: refreshed.access_token,
                    refresh_token: refreshed.refresh_token,
                    expires_at: refreshed
                        .expires_in
                        .map(|seconds| unix_now().saturating_add(seconds)),
                })?;
        }
    }
    match api.current_user(&token.access_token).await {
        Ok(user) => Ok((token, user)),
        Err(error) if error.code == "GITHUB_UNAUTHORIZED" => {
            let Some(refresh_token) = token.refresh_token.as_deref() else {
                let _ = secure_store::delete();
                return Err(error.into());
            };
            let refreshed = api
                .refresh_token(refresh_token)
                .await
                .map_err(GitHubAuthError::from)?;
            let refreshed_token = StoredToken {
                access_token: refreshed.access_token,
                refresh_token: refreshed.refresh_token,
                expires_at: refreshed
                    .expires_in
                    .map(|seconds| unix_now().saturating_add(seconds)),
            };
            let user = api
                .current_user(&refreshed_token.access_token)
                .await
                .map_err(GitHubAuthError::from)?;
            Ok((refreshed_token, user))
        }
        Err(error) => Err(error.into()),
    }
}

fn public_session(user: &GitHubUser, expires_at: Option<u64>) -> PublicSession {
    PublicSession {
        github_user_id: user.id,
        login: user.login.clone(),
        display_name: user.name.clone(),
        avatar_url: if user
            .avatar_url
            .starts_with("https://avatars.githubusercontent.com/")
        {
            user.avatar_url.clone()
        } else {
            String::new()
        },
        expires_at,
        last_validated_at: unix_now(),
    }
}

fn clear_flow(state: &State<'_, GitHubAuthService>, flow_id: &str) -> Result<(), GitHubAuthError> {
    let mut auth = lock_state(state)?;
    if auth
        .flow
        .as_ref()
        .is_some_and(|flow| flow.flow_id == flow_id)
    {
        auth.flow = None;
    }
    Ok(())
}

fn update_interval(
    state: &State<'_, GitHubAuthService>,
    flow_id: &str,
    interval_seconds: u64,
) -> Result<(), GitHubAuthError> {
    let mut auth = lock_state(state)?;
    if let Some(flow) = auth.flow.as_mut().filter(|flow| flow.flow_id == flow_id) {
        flow.interval_seconds = interval_seconds;
    }
    Ok(())
}

fn lock_state<'a>(
    state: &'a State<'_, GitHubAuthService>,
) -> Result<std::sync::MutexGuard<'a, AuthState>, GitHubAuthError> {
    state.inner.lock().map_err(|_| {
        GitHubAuthError::new(
            "GITHUB_STATE_ERROR",
            "The GitHub authentication service was interrupted.",
            true,
        )
    })
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn storage_error(message: String) -> GitHubAuthError {
    GitHubAuthError::new("GITHUB_SECURE_STORE_ERROR", message, false)
}

impl GitHubAuthError {
    fn new(code: &str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            retryable,
        }
    }
}

impl From<ApiError> for GitHubAuthError {
    fn from(error: ApiError) -> Self {
        Self::new(&error.code, error.message, error.retryable)
    }
}

#[cfg(test)]
mod tests {
    use super::{AuthPollResult, FlowRequest, GitHubAuthService, PublicSession, StoredToken};

    #[test]
    fn git_access_requires_a_loaded_session_and_token() {
        let service = GitHubAuthService::default();
        assert!(!service.has_authenticated_session().unwrap());

        let mut auth = service.inner.lock().unwrap();
        auth.token = Some(StoredToken {
            access_token: "token".into(),
            refresh_token: None,
            expires_at: None,
        });
        auth.session = Some(PublicSession {
            github_user_id: 1,
            login: "octocat".into(),
            display_name: None,
            avatar_url: "https://avatars.githubusercontent.com/u/1".into(),
            expires_at: None,
            last_validated_at: 1,
        });
        drop(auth);

        assert!(service.has_authenticated_session().unwrap());
    }

    #[test]
    fn poll_result_uses_frontend_camel_case_fields() {
        let value = serde_json::to_value(AuthPollResult::Pending {
            next_poll_interval_seconds: 5,
        })
        .expect("poll result should serialize");

        assert_eq!(value["status"], "pending");
        assert_eq!(value["nextPollIntervalSeconds"], 5);
        assert!(value.get("next_poll_interval_seconds").is_none());
    }

    #[test]
    fn flow_request_accepts_frontend_camel_case_field() {
        let request: FlowRequest = serde_json::from_value(serde_json::json!({
            "flowId": "flow-123"
        }))
        .expect("frontend flow request should deserialize");

        assert_eq!(request.flow_id, "flow-123");
    }
}
