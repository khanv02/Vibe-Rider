# Phase 8 — GitHub Account & API Authentication

Trạng thái: **implemented — native verification pending**. Lõi implementation đã có; native click-through cần public Client ID của OAuth App và tài khoản test để nghiệm thu.

## Kết quả implementation

- Rust gọi cố định GitHub Device Flow và `GET /user`; device code/token không đi qua React.
- Windows Credential Manager lưu token bundle; không có plaintext fallback.
- Account badge dùng session GitHub đã verify; Repository bị ẩn khi signed out.
- Có Login, Change account, Logout local, copy code, mở trang GitHub, polling, cancel, expiry, slow-down và refresh token.
- `npm run build` và `cargo check --manifest-path src-tauri/Cargo.toml` đã pass.
- `cargo test` (64 tests) và `cargo clippy --offline -- -D warnings` đã pass.
- `cargo fmt --check` còn báo một đoạn format có sẵn trong `src-tauri/build.rs`; các file Phase 8 đã được rustfmt.
- Chưa thể test flow GitHub thật nếu chưa đặt `GITHUB_OAUTH_CLIENT_ID`; thiếu cấu hình sẽ báo lỗi rõ ràng và không gửi request.

## Mục tiêu

Phase 8 kết nối account GitHub thật vào Vibe Rider local app bằng OAuth Device Flow và GitHub REST API. Người dùng có thể Login, Change account, Logout local, xem username/avatar và chỉ thấy Repository link khi account đã được app xác thực.

V1 không biến app thành Git credential manager: SSH/HTTPS credential cho Git vẫn do hệ điều hành/Git Credential Manager quản lý. OAuth session chỉ dùng cho GitHub API profile và các metadata read-only đã chốt.

## Contract đã chốt

- OAuth App có Device Flow enabled.
- Chỉ đưa public Client ID vào build; không có Client Secret trong source hoặc `.exe`.
- Token chỉ ở Rust + OS credential store; không vào React, localStorage, preferences, terminal, log hoặc error message.
- Scope tối thiểu `read:user`; không xin `repo`/write scope ở V1.
- Rust gọi `GET /user` để validate account và lấy stable numeric `id`, login, name, avatar URL.
- Device code/polling hết hạn, cancel, denied, slow down, 401, timeout và refresh failure đều có state/error riêng.
- Account switch atomic ở mức UX: account cũ còn nguyên nếu account mới chưa verify.

## User flows

```text
Signed out → Login → Device code → Open GitHub → Poll → /user → Signed in
Signed in  → Change account → flow mới → verify → replace session
Signed in  → Logout → xóa local token → Signed out
```

## Không thuộc Phase 8 V1

- MCP.
- Git push bằng OAuth token.
- Clone/pull/issue/PR/Actions/repository content.
- Lưu nhiều account.
- GitHub Enterprise.
- Auth backend/cloud relay.

## Evidence cần có khi nghiệm thu

1. Rust unit tests cho OAuth response/error, polling deadline/backoff, redaction và secure-store failure.
2. `npm run build`, `cargo fmt --check`, `cargo check`, `cargo clippy -- -D warnings`, `cargo test` pass.
3. Native Windows test: Login success/cancel/deny/expiry, Change account, Logout, restart, offline/401 và avatar fallback.
4. Packaged `.exe` test chứng minh token không nằm trong `.vibe-rider-data`, preferences hoặc frontend payload.

## Tài liệu GitHub chính thức

- [Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Best practices for creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app)
- [Creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
- [Get the authenticated user](https://docs.github.com/en/rest/users/users)
