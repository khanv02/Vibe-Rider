use std::time::Duration;

use reqwest::header::{ACCEPT, AUTHORIZATION};
use serde::Deserialize;

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const USER_URL: &str = "https://api.github.com/user";
const RESPONSE_LIMIT: usize = 256 * 1024;
const API_VERSION: &str = "2022-11-28";
// OAuth client IDs are public application identifiers, not secrets. Keep the
// Vibe Rider client ID embedded so installed builds can start Device Flow
// without requiring every user to configure an environment variable.
const DEFAULT_GITHUB_OAUTH_CLIENT_ID: &str = "Ov23liQjZN0RbJOsUPei";

#[derive(Clone, Debug)]
pub(crate) struct ApiError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl ApiError {
    fn new(code: &str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            retryable,
        }
    }
}

#[derive(Clone)]
pub(crate) struct GitHubApi {
    client: reqwest::Client,
    client_id: String,
}

#[derive(Clone, Debug)]
pub(crate) struct DeviceAuthorization {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct OAuthToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
}

#[derive(Clone, Debug)]
pub(crate) enum DevicePoll {
    Pending,
    SlowDown,
    Approved(OAuthToken),
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct GitHubUser {
    pub id: u64,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
}

#[derive(Debug, Deserialize)]
struct DeviceAuthorizationResponse {
    device_code: Option<String>,
    user_code: Option<String>,
    verification_uri: Option<String>,
    verification_uri_complete: Option<String>,
    expires_in: Option<u64>,
    interval: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OAuthTokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
}

impl GitHubApi {
    pub(crate) fn new() -> Result<Self, ApiError> {
        let client_id = option_env!("GITHUB_OAUTH_CLIENT_ID")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(DEFAULT_GITHUB_OAUTH_CLIENT_ID);

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(format!("Vibe Rider/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|_| {
                ApiError::new(
                    "GITHUB_CLIENT_ERROR",
                    "Could not initialize the GitHub connection.",
                    true,
                )
            })?;

        Ok(Self {
            client,
            client_id: client_id.to_string(),
        })
    }

    pub(crate) async fn begin_device_flow(&self) -> Result<DeviceAuthorization, ApiError> {
        let response = self
            .client
            .post(DEVICE_CODE_URL)
            .header(ACCEPT, "application/json")
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("scope", "read:user offline_access"),
            ])
            .send()
            .await
            .map_err(network_error)?;
        let status = response.status();
        let body: DeviceAuthorizationResponse = parse_json(response).await?;
        if let Some(error) = body.error {
            return Err(oauth_error(&error, body.error_description.as_deref()));
        }
        if !status.is_success() {
            return Err(ApiError::new(
                "GITHUB_HTTP_ERROR",
                "GitHub could not create a sign-in session.",
                status.is_server_error(),
            ));
        }

        let device_code = body
            .device_code
            .ok_or_else(|| invalid_response("device_code"))?;
        let user_code = body
            .user_code
            .ok_or_else(|| invalid_response("user_code"))?;
        let verification_uri = body
            .verification_uri
            .or(body.verification_uri_complete)
            .filter(|value| value == "https://github.com/login/device")
            .unwrap_or_else(|| "https://github.com/login/device".to_string());
        Ok(DeviceAuthorization {
            device_code,
            user_code,
            verification_uri,
            expires_in: body.expires_in.unwrap_or(900),
            interval: body.interval.unwrap_or(5).max(5),
        })
    }

    pub(crate) async fn poll_device_flow(&self, device_code: &str) -> Result<DevicePoll, ApiError> {
        let response = self
            .client
            .post(ACCESS_TOKEN_URL)
            .header(ACCEPT, "application/json")
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("device_code", device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(network_error)?;
        let status = response.status();
        let body: OAuthTokenResponse = parse_json(response).await?;
        if let Some(access_token) = body.access_token {
            return Ok(DevicePoll::Approved(OAuthToken {
                access_token,
                refresh_token: body.refresh_token,
                expires_in: body.expires_in,
            }));
        }
        if let Some(error) = body.error {
            return match error.as_str() {
                "authorization_pending" => Ok(DevicePoll::Pending),
                "slow_down" => Ok(DevicePoll::SlowDown),
                "expired_token" => Err(ApiError::new(
                    "GITHUB_DEVICE_EXPIRED",
                    "The GitHub sign-in code has expired.",
                    false,
                )),
                "access_denied" => Err(ApiError::new(
                    "GITHUB_ACCESS_DENIED",
                    "GitHub access was denied.",
                    false,
                )),
                _ => Err(oauth_error(&error, body.error_description.as_deref())),
            };
        }
        Err(ApiError::new(
            "GITHUB_HTTP_ERROR",
            if status.is_server_error() {
                "GitHub is currently experiencing a server error."
            } else {
                "GitHub returned an invalid sign-in response."
            },
            status.is_server_error(),
        ))
    }

    pub(crate) async fn refresh_token(&self, refresh_token: &str) -> Result<OAuthToken, ApiError> {
        let response = self
            .client
            .post(ACCESS_TOKEN_URL)
            .header(ACCEPT, "application/json")
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
            ])
            .send()
            .await
            .map_err(network_error)?;
        let body: OAuthTokenResponse = parse_json(response).await?;
        if let Some(access_token) = body.access_token {
            return Ok(OAuthToken {
                access_token,
                refresh_token: body
                    .refresh_token
                    .or_else(|| Some(refresh_token.to_string())),
                expires_in: body.expires_in,
            });
        }
        Err(oauth_error(
            body.error.as_deref().unwrap_or("refresh_failed"),
            body.error_description.as_deref(),
        ))
    }

    pub(crate) async fn current_user(&self, access_token: &str) -> Result<GitHubUser, ApiError> {
        let response = self
            .client
            .get(USER_URL)
            .header(ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION)
            .header(AUTHORIZATION, format!("Bearer {access_token}"))
            .send()
            .await
            .map_err(network_error)?;
        let status = response.status();
        let body: GitHubUser = parse_json(response).await.map_err(|error| {
            if status == reqwest::StatusCode::UNAUTHORIZED {
                ApiError::new(
                    "GITHUB_UNAUTHORIZED",
                    "Your GitHub session is no longer valid.",
                    false,
                )
            } else {
                error
            }
        })?;
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(ApiError::new(
                "GITHUB_UNAUTHORIZED",
                "Your GitHub session is no longer valid.",
                false,
            ));
        }
        if !status.is_success() {
            return Err(ApiError::new(
                "GITHUB_HTTP_ERROR",
                "Could not verify the GitHub account.",
                status.is_server_error(),
            ));
        }
        Ok(body)
    }
}

async fn parse_json<T: for<'de> Deserialize<'de>>(
    response: reqwest::Response,
) -> Result<T, ApiError> {
    let bytes = response.bytes().await.map_err(network_error)?;
    if bytes.len() > RESPONSE_LIMIT {
        return Err(ApiError::new(
            "GITHUB_RESPONSE_TOO_LARGE",
            "The GitHub response was too large.",
            false,
        ));
    }
    serde_json::from_slice(&bytes).map_err(|_| {
        ApiError::new(
            "GITHUB_INVALID_RESPONSE",
            "GitHub returned an invalid response.",
            false,
        )
    })
}

fn network_error(_: reqwest::Error) -> ApiError {
    ApiError::new(
        "GITHUB_NETWORK_ERROR",
        "Could not connect to GitHub. Check your network and try again.",
        true,
    )
}

fn invalid_response(field: &str) -> ApiError {
    ApiError::new(
        "GITHUB_INVALID_RESPONSE",
        format!("GitHub omitted a required response field: {field}."),
        false,
    )
}

fn oauth_error(error: &str, description: Option<&str>) -> ApiError {
    let message = match error {
        "incorrect_client_credentials" => "The GitHub OAuth Client ID is invalid.",
        "bad_verification_code" => "The GitHub sign-in code is invalid.",
        "unverified_email" => "This GitHub account requires a verified email address.",
        _ => description.unwrap_or("GitHub rejected the OAuth request."),
    };
    ApiError::new("GITHUB_OAUTH_ERROR", message, false)
}
