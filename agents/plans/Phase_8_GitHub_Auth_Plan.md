# Kế hoạch Phase 8 — GitHub Account & API Authentication

> Trạng thái: **implemented — native verification pending**. Lõi implementation đã hoàn tất; cần public Client ID và tài khoản test để nghiệm thu flow GitHub thật.

Ngày lập: 2026-10-05. Phase này nối GitHub account thật vào account badge hiện có: đăng nhập, đổi account, logout cục bộ, lấy profile/avatar qua GitHub API và giữ token an toàn trên máy local.

## 1. Mục tiêu và quyết định chính

### Mục tiêu

- Người dùng bấm `Login` trong app, hoàn tất GitHub authorization và thấy account thật, username và avatar.
- Người dùng bấm `Change account` để xác thực account khác mà không làm mất account cũ nếu flow mới bị hủy hoặc lỗi.
- Người dùng bấm `Logout` để xóa token local của app; không giả vờ xóa SSH key hoặc Git Credential Manager.
- App gọi GitHub API từ Rust để lấy và kiểm tra profile; React không bao giờ nhận access token.
- Account state không còn bị suy ra từ `git push`. GitHub API authentication và Git remote credential là hai boundary khác nhau.
- Khi chưa có GitHub session, account menu không hiển thị `Repository`; repository context vẫn do Git local cung cấp.

### Quyết định V1

| Hạng mục | Quyết định |
| --- | --- |
| Provider | GitHub.com trước; GitHub Enterprise không thuộc V1 |
| App registration | GitHub OAuth App, bật Device Flow |
| Sign-in flow | OAuth 2.0 Device Authorization Grant; không dùng URL `/login` đơn thuần |
| Client secret | Không dùng và không ship secret trong `.exe` |
| Permission | `read:user` tối thiểu; cân nhắc `offline_access` để nhận refresh token khi OAuth App bật expiring tokens |
| Repository permission | Không xin `repo`, `workflow`, `delete_repo` hoặc write scope trong V1 |
| Profile API | Rust gọi `GET https://api.github.com/user`, lấy stable numeric `id`, `login`, `name`, `avatar_url` |
| Token store | OS credential store qua native Rust/keyring adapter; không dùng JSON preferences/localStorage |
| Callback | V1 không dùng browser callback; device code tránh phải nhúng client secret hoặc dựng auth relay server |
| MCP | Không dùng; MCP không liên quan đến OAuth hay GitHub account authentication |

GitHub hỗ trợ authorization code flow và device flow. Với desktop app local không có backend tin cậy để giữ client secret, Device Flow là lựa chọn không-secret thực tế cho V1; đổi lại UI phải hiển thị đúng verification URL/code và polling phải tuân interval GitHub trả về. GitHub khuyến nghị PKCE cho public client và cảnh báo không bật Device Flow nếu không cần, nên PKCE + backend relay sẽ là hướng V2 nếu sau này cần browser sign-in một-click và không muốn nhập code. Xem [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) và [OAuth app security best practices](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app).

## 2. Baseline hiện tại

- `src/components/git/GitAccountBadge.tsx` hiện chỉ mở URL GitHub bằng browser mặc định.
- `src/git/accountApi.ts` gọi `open_external_url`; chưa có GitHub HTTP client hoặc auth session.
- `src-tauri/src/external.rs` chỉ allowlist URL GitHub/repository để mở ngoài app.
- `useWorkspaceGit` dùng `authVerified`; state này chỉ thành `true` sau Push thành công và không chứng minh browser/GitHub account login.
- `GitStatus` cung cấp commit identity và remote metadata từ Git local, không cung cấp account GitHub.
- UI preferences hiện lưu panel/layout, nhưng không được phép lưu GitHub access token hoặc refresh token.

### Các lỗi/nhầm lẫn phải loại bỏ

1. `github.com/login` chỉ đăng nhập web session trong browser, không trả token/callback cho app.
2. Git commit email hoặc `users.noreply.github.com` không phải bằng chứng account hiện tại đã authorize app.
3. Git remote URL không phải account session; remote public cũng không chứng minh user có quyền.
4. Push thành công chỉ chứng minh Git credential có quyền push vào remote tại thời điểm đó, không phải GitHub OAuth identity.
5. `Repository` trong account popover chỉ được hiện khi có GitHub session hợp lệ và local repository URL hợp lệ.

## 3. Phạm vi và ngoài phạm vi

### Trong phạm vi

- OAuth App client ID cấu hình dạng public build/runtime config.
- Begin device authorization, hiển thị code/URL, copy code, mở browser và poll/cancel/timeout.
- Exchange device code lấy access/refresh token ở Rust.
- Lưu, đọc, rotate và xóa token bằng OS credential store.
- Gọi `/user`, kiểm response identity sau mỗi sign-in và khi startup restore.
- Account badge: placeholder, login pending, verified profile/avatar, change account, logout.
- Error states: denied, expired code, slow down, invalid token, network timeout, API rate-limit, store unavailable.
- Chỉ hiển thị local repository link khi session đã verify; không cho OAuth token điều khiển Git push.
- Native Windows verification, Rust tests, frontend build, packaged `.exe` smoke test.

### Ngoài phạm vi V1

- Tự động đổi credential HTTPS/SSH của Git.
- Lưu nhiều account cùng lúc hoặc account switch không cần authorization lại.
- GitHub repository listing/search, issue, PR, Actions, release hoặc file content API.
- Clone/init/pull/push bằng GitHub access token của Phase 8.
- GitHub Enterprise Server, GitLab, Bitbucket hoặc generic OAuth provider.
- Cloud auth backend, server-side token proxy hoặc database account.
- MCP server/tool cho GitHub.
- Tự động revoke token từ GitHub nếu endpoint yêu cầu client secret; logout V1 xóa token local và hướng dẫn revoke trong GitHub settings nếu cần.

## 4. Luồng người dùng và state machine

```text
SIGNED_OUT
   │ Login
   ▼
REQUESTING_DEVICE_CODE ── error ──► SIGNED_OUT + error
   │ code + Open GitHub
   ▼
WAITING_FOR_AUTH ── Cancel/expire/deny ──► SIGNED_OUT (hoặc giữ session cũ)
   │ authorization_pending / slow_down
   ▼
EXCHANGING_TOKEN
   │ access token
   ▼
FETCHING_PROFILE ── 401/invalid profile ──► SIGNED_OUT + error
   │ validate stable GitHub user id
   ▼
SIGNED_IN(profile)
   │ Change account
   └──────────────► REQUESTING_DEVICE_CODE (giữ session cũ tới khi session mới verified)

SIGNED_IN ── Logout ──► DELETE_LOCAL_TOKEN ──► SIGNED_OUT
SIGNED_IN ── startup ──► VALIDATE/REFRESH ──► SIGNED_IN hoặc REAUTH_REQUIRED
```

### Quy tắc state

- Chỉ một auth flow active cho một window; Begin mới cancel flow cũ.
- `flowId` do Rust tạo; mọi poll/cancel phải có `flowId`, workspace không phải identity boundary của OAuth.
- Change account không xóa token/session cũ trước khi profile mới được gọi `/user` và kiểm tra thành công.
- Token/API response không nằm trong React state, Tauri invoke response hoặc error message.
- Frontend chỉ nhận DTO public: `status`, `login`, `displayName`, `avatarUrl`, `githubUserId`, `expiresAt`, `lastValidatedAt`.

## 5. Device Flow contract

### Begin

Rust gọi fixed endpoint `POST https://github.com/login/device/code` với:

- `client_id` từ cấu hình public của app.
- scope tối thiểu `read:user`; không gửi repository/write scope.
- `Accept: application/json`.

Frontend nhận:

```ts
interface GitHubDeviceChallenge {
  flowId: string;
  verificationUri: "https://github.com/login/device";
  userCode: string;
  expiresAt: number;
  pollIntervalSeconds: number;
}
```

Không gửi `deviceCode` ra React; Rust giữ nó trong memory cùng flow state.

### Poll

Rust gọi fixed endpoint `POST https://github.com/login/oauth/access_token` theo `pollIntervalSeconds` tối thiểu. Xử lý bắt buộc:

- `authorization_pending`: tiếp tục chờ.
- `slow_down`: tăng interval theo response, không poll nhanh hơn.
- `expired_token`: kết thúc flow, yêu cầu Begin mới.
- `access_denied`: kết thúc flow với message rõ.
- `access_token`: lưu token vào secure store, sau đó gọi `/user` trước khi báo thành công.

Không polling vô hạn; deadline mặc định 15 phút theo `expires_in`, Cancel dừng flow và không lưu token.

### API profile

Rust gọi `GET https://api.github.com/user` với:

- `Authorization: Bearer <token>` chỉ gắn trong native request.
- `Accept: application/vnd.github+json`.
- `X-GitHub-Api-Version` cố định trong một module, không nhận arbitrary version từ UI.
- `User-Agent` có tên app/version.

Response phải kiểm `id` dạng stable numeric identifier; không dùng login/email làm account identity. `avatar_url` phải là HTTPS và chỉ render host allowlist (`avatars.githubusercontent.com`/GitHub avatar host); lỗi ảnh dùng placeholder.

## 6. Secure token storage và HTTP boundary

### Token storage

- Tạo `src-tauri/src/github_auth.rs` sở hữu auth session và `src-tauri/src/secure_store.rs` sở hữu OS secret adapter, hoặc gộp nếu module nhỏ nhưng responsibility phải tách.
- Windows dùng Credential Manager; các platform khác chỉ là adapter dự phòng, không tự viết plaintext file.
- Key cố định theo app/user, ví dụ `vibe-rider/github/oauth`; token bundle gồm access token, refresh token nếu có, expiry và GitHub user ID.
- Preferences JSON chỉ lưu UI settings; không serialize token/session secret vào `UiPreferences`.
- Không log token, device code, Authorization header, raw API body hoặc URL có secret.
- Redaction phải chạy trước structured error/feedback; test pattern `gho_`, `ghu_`, `ghr_`, Bearer và query secrets.
- Nếu secure store unavailable: fail closed, giữ app dùng được ở signed-out state; không fallback sang file plaintext.

### HTTP client

- Backend chỉ cho phép các endpoint GitHub OAuth/API nêu trong contract; frontend không gửi URL tùy ý.
- HTTPS bắt buộc, timeout cho DNS/connect/request/response, giới hạn body response và không follow redirect sang host ngoài allowlist.
- Device code/token/profile JSON parse bằng DTO có `deny_unknown_fields` nếu phù hợp; field thiếu hoặc type sai trả lỗi có mã.
- Không dùng GitHub token cho Git CLI trong V1. Credential của Git vẫn do SSH/Git Credential Manager.
- Khi `/user` trả 401, xóa access token hỏng nhưng giữ refresh-token flow theo policy; refresh thất bại thì chuyển `REAUTH_REQUIRED`.
- Với token expiring, lưu expiry và refresh token; refresh thành công phải atomically replace bundle, không mất token cũ nếu response lỗi.

### Cấu hình client ID

- `GITHUB_OAUTH_CLIENT_ID` là public configuration, không coi là secret.
- Dev dùng `.env.local`/env build bị `.gitignore`; packaged build phải báo lỗi cấu hình rõ nếu thiếu client ID.
- Không đưa `client_secret` vào source, `.env`, binary hay release artifact.
- Trước khi code auth, user tạo GitHub OAuth App và bật Device Flow; chỉ cần cung cấp Client ID, không gửi Client Secret.

## 7. Tauri command/API contract

CamelCase DTO, typed wrapper và structured errors thống nhất với Git service:

| Command | Input | Output |
| --- | --- | --- |
| `github_auth_begin` | `{ forceAccountSelection: boolean }` | `GitHubDeviceChallenge` |
| `github_auth_poll` | `{ flowId: string }` | `pending \| verified public session \| structured error` |
| `github_auth_cancel` | `{ flowId: string }` | `void` |
| `github_auth_session` | `{}` | public session hoặc `null` |
| `github_auth_logout` | `{}` | `{ signedOut: boolean }` |

Có thể gộp `github_auth_poll` thành một backend task dài có progress event nếu command polling từng nhịp gây nhiều IPC; quyết định này phải giữ cancel/deadline và không đưa secret ra event.

Frontend wrapper:

- `src/githubAuth/types.ts`: DTO/status/error codes.
- `src/githubAuth/authApi.ts`: invoke wrappers, không chứa token logic.
- `src/githubAuth/useGitHubAuth.ts`: session/flow/cancel/retry/refresh state.
- `GitAccountBadge` chỉ render + dispatch action, không gọi HTTP trực tiếp.

## 8. UI/UX contract

### Signed out

- Activity rail vẫn hiển thị avatar placeholder.
- Label: `Login` hoặc `Login to GitHub`.
- Menu có `Login`; không có `Repository`, `Change account` hay `Logout`.

### Device authorization dialog/popover

- Hiển thị app name, `github.com/login/device`, user code lớn, `Copy code`, `Open GitHub`, `Cancel`.
- Có trạng thái `Waiting for authorization…`, countdown tới expiry, `Try again` khi hết hạn.
- Không tự đóng mất flow khi panel switch; closing panel chỉ ẩn view, auth flow vẫn thuộc App controller.
- Không hiển thị device code nội bộ; chỉ hiển thị user code.

### Signed in

- Hiển thị avatar URL sau khi `/user` verify, fallback placeholder nếu tải ảnh lỗi.
- Hiển thị `@login`, display name nếu có; account identity dùng numeric `githubUserId`.
- Menu có `Repository` chỉ khi account verified + local remote URL hợp lệ, `Change account`, `Logout`.
- `Logout` ghi rõ “đăng xuất khỏi Vibe Rider trên máy này”, không nói đã xóa Git Credential Manager/SSH.

### Account switching

- `Change account` dùng `forceAccountSelection`/tương đương để tránh silently reuse browser session nếu flow hỗ trợ.
- Giữ avatar/account cũ trong lúc chờ account mới.
- Chỉ thay session sau profile mới verify; nếu Cancel/error giữ account cũ và báo non-destructive error.

## 9. Task sequence và ownership

### 8.0 — Product/config gate

- Tạo OAuth App, bật Device Flow, ghi Client ID vào local build config.
- Chốt scope `read:user` và có/không `offline_access` theo setting expiring token.
- Ghi rõ no `client_secret`, no `repo` scope, no Git credential takeover.
- Owner: product + integration owner. Không bắt đầu token code trước gate này.

### 8.1 — Secure store và auth state Rust

- Thêm secure-store dependency/adapter, kiểm tra Cargo offline/Windows build.
- Implement token bundle, flow generation, in-memory pending device code, session validation và logout.
- Add redaction, bounded errors, no-secret serialization tests.
- Owner: `src-tauri/src/github_auth.rs`, `secure_store.rs`, `src-tauri/src/lib.rs`.

### 8.2 — GitHub OAuth/API client

- Implement fixed endpoint requests, JSON DTOs, polling interval/backoff/deadline, token exchange, profile `/user`, refresh.
- Không chạm Git push/credential path.
- Owner: `src-tauri/src/github_api.rs` hoặc module tương đương + Rust tests.

### 8.3 — Typed frontend controller

- Implement `useGitHubAuth`, auth API wrappers, public session DTO, pending/error/cancel state.
- App sở hữu controller để panel switch không unmount flow.
- Owner: `src/githubAuth/*`, `App.tsx` integration.

### 8.4 — Account badge và repository visibility

- Replace `authVerified` badge semantics bằng `githubAuth.session`.
- Login opens device-flow UI; success avatar/profile; Change account/Logout.
- Hide Repository unless verified session + valid local remote.
- Keep GitPanel account/remote explanation honest: OAuth account does not replace Git credential.
- Owner: `GitAccountBadge.tsx`, `RightPanel.tsx`, `GitPanel.tsx`, `styles.css`.

### 8.5 — Lifecycle/error/security hardening

- Startup load secure session → validate/refresh → signed-in or reauth-required.
- Workspace switch does not leak session; app exit cancels network task and wipes transient codes.
- Rate-limit/backoff, offline/retry, 401/403, denied/expired/cancel and avatar failure UX.
- Recheck `Repository` visibility after logout/account switch.

### 8.6 — Verification and release

- Unit/parser/HTTP mock/secure-store tests, TypeScript build, Rust check/test/clippy.
- Native Tauri test on Windows with a non-production/test OAuth App/account.
- Verify packaged `.exe` reads public Client ID and secure store, not dev `.env` or plaintext token.
- Update preview, README setup and release checklist only after native evidence.

## 10. Files dự kiến

| File/nhóm | Responsibility |
| --- | --- |
| `src-tauri/src/github_auth.rs` | Auth manager, flow state, public session, commands |
| `src-tauri/src/github_api.rs` | Fixed GitHub OAuth/API HTTP boundary, DTOs, response/error parsing |
| `src-tauri/src/secure_store.rs` | Windows Credential Manager/keyring adapter |
| `src-tauri/src/lib.rs` | Register commands and shutdown cleanup |
| `src/githubAuth/types.ts` | Typed frontend auth DTO/status/error |
| `src/githubAuth/authApi.ts` | Typed invoke wrappers |
| `src/githubAuth/useGitHubAuth.ts` | App-owned flow/session controller |
| `src/components/git/GitAccountBadge.tsx` | Avatar/menu/login/change/logout rendering |
| `src/components/git/GitHubAuthDialog.tsx` | Device code/copy/open/cancel/waiting UI |
| `src/components/layout/RightPanel.tsx`, `src/app/App.tsx` | Controller wiring and stable mounted flow |
| `src/components/git/GitPanel.tsx`, `src/styles.css` | Account/repository copy and layout |
| `.env.example`/local config docs | Public Client ID setup; never client secret |
| `docs/phase-8-github-auth-preview.md` | Contract, actual results and native evidence |

Không sửa `src-tauri/src/external.rs` để biến browser URL mở hiện tại thành auth state. External opener chỉ dùng cho verification URL; token exchange/profile phải đi qua Rust HTTP boundary.

## 11. Verification matrix

| Case | Expected evidence |
| --- | --- |
| Missing Client ID | App signed-out, error rõ, không crash, không request GitHub |
| Login begin | Device challenge có URL/code/expiry; device code không xuất hiện trong React/log |
| Browser authorization success | Poll đúng interval, `/user` success, avatar/login hiển thị |
| Authorization pending | UI tiếp tục chờ, không poll dồn |
| Slow down | Interval tăng, không vượt rate limit |
| Cancel | Poll dừng, không lưu token |
| Expired/denied | Flow kết thúc đúng, retry tạo flow mới |
| Change account success | Account mới thay account cũ sau profile verify |
| Change account cancel/error | Account cũ vẫn nguyên |
| Logout | Secure-store entry bị xóa; UI signed-out; Git SSH/GCM không bị đụng |
| Startup valid token | Validate/refresh rồi restore profile |
| Startup 401/expired refresh | Reauth-required, không show stale account như verified |
| Secure store unavailable | Fail closed, không tạo plaintext fallback |
| API timeout/403/rate-limit | Error bounded/redacted, Retry không nhân đôi flow |
| Repository visibility | Hidden signed-out; shown only with verified session + local remote |
| Git Push | Không tự thay auth session; Git credential behavior vẫn như Phase 6 |
| Window close/panel switch | Transient code/poll cleanup đúng, no token leak, flow ownership không phụ thuộc panel mount |
| Packaged `.exe` | Client ID hoạt động, token chỉ ở OS credential store, no secrets in artifact |

## 12. Acceptance checklist

- [ ] OAuth App đã bật Device Flow; Client ID không phải secret và không commit secret.
- [ ] Login không còn chỉ mở `/login`; có device authorization + polling + cancel/expiry.
- [ ] `/user` được gọi sau mỗi sign-in và identity được xác nhận bằng stable numeric ID.
- [ ] Access/refresh token không qua React, preferences, logs, Git CLI hoặc error text.
- [ ] Token được lưu ở OS credential store; store lỗi thì fail closed.
- [ ] Avatar/profile có fallback; account switch giữ account cũ khi flow mới thất bại.
- [ ] Repository ẩn khi signed out; local Git credential và OAuth token không bị trộn.
- [ ] Logout chỉ logout Vibe Rider local và copy giải thích đúng giới hạn.
- [ ] Rust tests + frontend build + clippy/check pass.
- [ ] Native Windows matrix và packaged `.exe` smoke test có evidence.

## 13. Phụ thuộc và câu hỏi cần chốt trước khi code

1. Tạo OAuth App GitHub riêng cho Vibe Rider và bật Device Flow.
2. Cung cấp `Client ID` public cho build/dev; không gửi Client Secret.
3. Xác nhận V1 chỉ cần profile/avatar và local repository link, chưa cần list private repositories/API write.
4. Xác nhận `read:user` + `offline_access` là scope cho V1; nếu không cần refresh token có thể bỏ `offline_access`.
5. Chốt `keyring`/native Windows Credential Manager adapter sau khi kiểm tra dependency offline.

### Rủi ro đã biết

- Device Flow có thêm bước nhập code và có rủi ro phishing hơn PKCE callback; UI phải dùng URL GitHub cố định, app name rõ và không chấp nhận token/code từ nguồn khác.
- OAuth App client ID là public; ai cũng có thể dùng client ID, nên không coi client ID là secret hoặc dùng nó làm access control.
- Browser account và Git Credential Manager có thể là hai account khác nhau; UI phải nói rõ OAuth account không tự đổi Git push credential.
- Avatar URL là dữ liệu mạng; CSP/host allowlist và fallback phải ngăn arbitrary remote resource.
