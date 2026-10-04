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

## Những phase đã đóng

### Phase 9 — Read-only Agent

Đã đóng. Search, Search UI và read-only filesystem/Git tools được giữ như IDE core. Không tiếp tục agent loop, provider, CLI adapter, evidence UI, Activity Log, checkpoint, trash hoặc session history.

### Phase 10 — Coding Agent

Đã đóng. Không tiếp tục AI coding-agent, live CLI integration, AI chat/provider hoặc workflow tự động Read → Patch → Accept → Test. Các primitive patch review, approval boundary và verification command chỉ được giữ nếu chúng vẫn hữu ích cho IDE thông thường.

### Phase 11

Không tồn tại trong roadmap hiện hành.

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
