# Vibe Rider

Vibe Rider là desktop IDE local-first, terminal-first cho developer làm việc với project trên máy của mình.

Mục tiêu hiện tại là một IDE gọn, ổn định và dễ hiểu: terminal tích hợp, Explorer, Editor, Search, Git và các thao tác file an toàn. Vibe Rider không phải AI chat app và không có session manager riêng cho các CLI.

## Tính năng

- Mở và ghi nhớ workspace local.
- Tối đa bốn terminal độc lập, layout 1/2/4, resize và chạy shell trực tiếp trong workspace.
- Explorer: duyệt, tạo, xóa và kéo file/folder để di chuyển trong workspace.
- Kéo file/folder vào terminal để chèn đường dẫn.
- Kéo file vào Editor để mở; hỗ trợ nhiều pane Editor.
- Monaco Editor với tabs, dirty state, save, undo và review diff.
- Search nội dung workspace, mở kết quả đúng file/dòng/cột.
- Git status, diff, stage/unstage, commit, push, branch và restore working tree.
- Light/dark theme, panel trái/phải, persistence và restore workspace gần nhất.

## Phạm vi sản phẩm

Vibe Rider ưu tiên workflow IDE thông thường:

```text
Open workspace → Edit → Save → Search → Git diff → Commit
```

AI CLI có thể chạy trực tiếp trong terminal theo workflow native của từng CLI. Vibe Rider không tự quản lý lịch sử hội thoại, checkpoint, trash, session history, Activity Log, agent loop hay provider AI riêng.

Các ý tưởng AI agent trước đây được đóng lại để giữ sản phẩm nhỏ và ổn định. Patch review và verification command chỉ được giữ ở mức primitive an toàn của IDE; không có kế hoạch mở rộng thành coding-agent.

## Yêu cầu

- Windows là nền tảng được kiểm tra chính.
- Node.js 18+ và npm.
- Rust stable và Cargo.
- Git nếu muốn dùng Git integration.
- ripgrep (`rg`) trong `PATH` nếu muốn dùng Search.

## Chạy từ source

```bash
git clone <repository-url>
cd vibe-rider
npm install
npm run tauri dev
```

Chọn **Open Folder**, sau đó chọn một thư mục project local.

## Lệnh phát triển

```bash
# Frontend type-check và production bundle
npm run build

# Tauri native development
npm run tauri -- dev

# Build native executable, không tạo installer
npm run tauri -- build --no-bundle

# Rust checks
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --offline
cargo test --manifest-path src-tauri/Cargo.toml --offline
```

Native executable sau khi build nằm tại:

```text
src-tauri/target/release/vibe-rider.exe
```

## Mô hình an toàn

Filesystem, process, PTY, Git và Search đi qua Rust/Tauri. Path được giới hạn trong workspace; symlink/junction, traversal, absolute path ngoài phạm vi và thao tác ghi không hợp lệ bị từ chối.

Các thao tác thay đổi file được thực hiện rõ ràng từ UI. Git restore và file restore là thao tác IDE độc lập, không liên quan đến session restore hay chat history.

## Cấu trúc project

```text
src/                 React UI, state và frontend APIs
src-tauri/src/       Rust commands, filesystem, PTY, Git và safety checks
src-tauri/           Tauri configuration và native build
public/              Static assets
agents/rules/        Project rules hiện hành
agents/plans/        Roadmap và implementation notes
docs/                Preview và verification notes
```

## Định hướng bảo trì

Feature mới chỉ nên được thêm khi giải quyết một nhu cầu lặp lại trong workflow thực tế. Ưu tiên hiện tại là bug fixes, native acceptance, UX rõ ràng, drag-and-drop, filesystem safety và độ ổn định của terminal/editor/Git.
