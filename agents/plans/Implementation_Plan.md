# Kế hoạch triển khai Vibe Rider

Vibe Rider là desktop IDE local-first, terminal-first. Roadmap hiện tại tập trung vào IDE core và không mở rộng thành AI chat, agent loop hoặc session manager.

## Phạm vi hiện hành

```text
Workspace → Terminal → Explorer → Editor → Search → Git → UX ổn định
```

### Core đã có

- Foundation: Tauri, Rust, React, TypeScript và Vite.
- Workspace: Open Folder, workspace identity, remembered workspace và filesystem guard.
- Terminal: PTY, tối đa bốn pane, layout 1/2/4, resize, lifecycle và drag path vào terminal.
- Right Panel: Git, Explorer, Editor, collapse, resize, side selection và persistence.
- Editor: Monaco, tabs, save, dirty state, undo, diff review và kéo file để mở.
- Git: status, diff, stage/unstage, commit, push, branch và restore.
- Search: literal search có giới hạn, cancel, path guard và mở kết quả trong Editor.
- Explorer: create/delete, move file/folder bằng drag-and-drop và workspace refresh.

### Việc còn hợp lý

- Native click-through và smoke test trên Windows.
- Sửa bug, regression và vấn đề UX cụ thể.
- Kiểm tra drag-and-drop, terminal focus, dirty buffer, Git transition và workspace restore.
- Cải thiện performance hoặc accessibility khi có bằng chứng từ sử dụng thực tế.
- Packaging và clean-machine verification khi chuẩn bị phát hành.

## Phase 8 — GitHub Account & API Authentication

Đã triển khai lõi Phase 8. Phase 8 thêm GitHub OAuth/API account thật cho desktop local app: Login, Change account, Logout local, profile/avatar và secure token storage. Native click-through vẫn cần Client ID và tài khoản test để nghiệm thu. Xem [Phase 8 GitHub Auth Plan](Phase_8_GitHub_Auth_Plan.md) và [Phase 8 Preview](../../docs/phase-8-github-auth-preview.md).

## Nguyên tắc

- Không thêm feature lớn chỉ vì roadmap cũ có đề cập.
- Không tạo session/history layer riêng cho CLI bên ngoài.
- Không parse terminal output để suy ra hội thoại, approval hoặc patch.
- Không thêm provider, database, cloud sync, plugin marketplace, debugger hoặc full LSP nếu chưa có nhu cầu thực tế.
- Mỗi thay đổi phải có ownership rõ ràng, path/process safety và kiểm tra tương ứng.

## Verification tối thiểu

```powershell
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --offline
cargo test --manifest-path src-tauri/Cargo.toml --offline
```

Native acceptance không được suy ra chỉ từ build hoặc unit tests; cần chạy app thật trên Windows khi thay đổi ảnh hưởng terminal, layout, Editor, Explorer hoặc Git.
