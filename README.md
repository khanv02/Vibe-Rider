# Vibe Rider

Vibe Rider là desktop IDE local-first, terminal-first dành cho developer làm việc với terminal và AI CLI.

Đây cũng là project học tập. Mỗi phase tập trung vào một boundary có thể kiểm chứng: React, Tauri IPC, Rust, filesystem, process, PTY, Git và AI tools.

## Trạng thái hiện tại

### Phase 0 — Foundation

Đã hoàn tất nghiệm thu native baseline trên Windows:

- Tauri 2 mở được cửa sổ `Vibe Rider`.
- Vite chạy đúng `http://localhost:1420`.
- Rust command `ping` được đăng ký qua Tauri IPC.
- Terminal-first shell và layout mock 2 × 2 hoạt động.
- Window config có kích thước tối thiểu `960 × 600`.

Chi tiết bằng chứng: [Phase 0 Preview](docs/phase-0-foundation-preview.md).

### Phase 1 — Workspace

Đang triển khai, hiện mới hoàn tất phần Workspace contract/Open Folder ở mức code:

- Có native folder picker qua `tauri-plugin-dialog`.
- Rust canonicalize folder đã chọn và tạo workspace descriptor gồm `id`, `name`, `rootPath`.
- Cancel không thay đổi workspace hiện tại.
- Header, status bar và Explorer context nhận workspace descriptor.
- Có chuyển panel Git ↔ Explorer.

Chưa có và chưa nghiệm thu:

- Path guard cho directory request.
- `read_directory` và directory entry contract ở Rust.
- Explorer tree, lazy loading, expand/collapse, refresh và retry.
- Unit tests cho path guard/directory API.
- Native click-through success/cancel/error của folder picker.

Chi tiết phạm vi và checklist: [Phase 1 Workspace](docs/phase-1-workspace-preview.md).

## Product direction

```text
Terminal First
Local First
AI Friendly
Simple
Fast
Developer Controlled
```

Terminal là main workspace. Git, Explorer, Editor và AI là supporting tools ở bên phải. Ứng dụng không nhằm trở thành bản sao đầy đủ của VS Code hoặc một cloud IDE.

## Layout hiện tại

```text
┌──────────────────────────────────────────────────────────────────────────┬────────────┐
│ Vibe Rider      WORKSPACE                  [Open Folder]                  │            │
├──────────────────────────────────────────────────────────────────────────┤            │
│ MAIN WORKSPACE: TERMINALS (2 × 2 MOCK)                                   │ GIT /      │
│ ┌────────────────────────────┬────────────────────────────┐              │ EXPLORER   │
│ │ Terminal 1                 │ Terminal 2                 │              │            │
│ ├────────────────────────────┼────────────────────────────┤              │ workspace  │
│ │ Terminal 3                 │ Terminal 4                 │              │ context    │
│ └────────────────────────────┴────────────────────────────┘              │            │
├──────────────────────────────────────────────────────────────────────────┴────────────┤
│ T1 ●   T2 ●   T3 ●   T4 ●                                      Workspace: none          │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

Terminal cards hiện là mock trực quan; chưa chạy PowerShell, PTY hoặc command thật. Git vẫn là placeholder. Explorer hiện hiển thị workspace context sau khi mở folder, chưa hiển thị cây thư mục.

## Kiến trúc hiện tại

```text
React + TypeScript
        ↕
Tauri IPC
        ↕
Rust commands and managed state
        ↕
Native dialog / local filesystem
```

Rust sở hữu native operation và workspace root nội bộ. Frontend chỉ giữ UI state và descriptor để hiển thị; không được dùng path hiển thị làm permission boundary.

### IPC hiện có

```text
React invoke("ping")
        ↓
Tauri IPC
        ↓
Rust ping()
        ↓
"pong from Rust"
```

```text
React invoke("open_workspace")
        ↓
Rust mở native folder picker
        ↓
canonicalize folder + tạo WorkspaceDescriptor
        ↓
WorkspaceState trong Tauri managed state
        ↓
React cập nhật header/status/Explorer context
```

`open_workspace` hiện không nhận root path tùy ý từ frontend. `read_directory` chưa được đăng ký.

## Stack

| Layer | Công nghệ | Trạng thái |
| --- | --- | --- |
| Desktop shell | Tauri 2 | Đã có; native startup đã kiểm tra |
| System core | Rust | Có `ping`, workspace state và `open_workspace` |
| Native dialog | `tauri-plugin-dialog` | Đã tích hợp cho Open Folder |
| Serialization | `serde` | Đã dùng cho workspace DTO/error |
| Frontend | React + TypeScript | Đã có |
| Build | Vite | Đã có, strict port `1420` |
| State | React local state | Đang dùng cho Phase 1; shared store chưa có |
| Terminal UI | xterm.js | Chưa tích hợp |
| PTY | `portable-pty` hoặc abstraction phù hợp | Chưa tích hợp |
| Editor | Monaco Editor | Chưa tích hợp |
| Git/search | Git CLI + ripgrep | Chưa tích hợp |

## Yêu cầu môi trường Windows

Để chạy native Tauri cần:

- Node.js và npm.
- Rust toolchain `stable-x86_64-pc-windows-msvc` hoặc `stable-msvc` tương ứng.
- Microsoft C++ Build Tools/MSVC linker.
- WebView2 Runtime.
- Git.

Môi trường đã dùng để kiểm tra:

| Công cụ | Phiên bản/kết quả |
| --- | --- |
| Node.js | `v24.13.0` |
| npm | `11.6.2` |
| Rust | `rustc 1.99.0` |
| Cargo | `cargo 1.99.0` |
| Rust toolchain | `stable-x86_64-pc-windows-msvc` |
| Git | `2.53.0.windows.2` |
| Tauri CLI | `2.12.1` |
| WebView2 Runtime | `154.0.4258.53` |

Kiểm tra nhanh:

```powershell
node --version
npm --version
rustc --version
cargo --version
git --version
```

## Cài đặt và chạy

### Cài dependency

```powershell
npm ci
```

`npm ci` sử dụng `package-lock.json` để cài dependency frontend nhất quán.

### Frontend browser preview

```powershell
npm run dev
```

Mở `http://localhost:1420`.

Browser preview dùng để kiểm tra React layout và TypeScript/Vite. Nó không chứng minh Tauri IPC, native dialog, Rust hoặc WebView2.

### Frontend production build

```powershell
npm run build
```

### Native desktop app

```powershell
npm run tauri -- dev
```

Lệnh này chạy Vite tại port `1420`, build Rust và mở cửa sổ native. Trong app:

1. Chọn `Ping Rust` trong Git panel để kiểm tra IPC.
2. Chọn `Open Folder` để mở native folder picker của Phase 1.
3. Sau khi chọn folder, kiểm tra workspace name ở header/status bar và Explorer panel.

### Kiểm tra Tauri CLI

```powershell
npm run tauri -- --version
```

### Kiểm tra Rust

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

`cargo test` hiện pass nhưng chưa có unit test; kết quả hiện tại là `0 tests`.

## Phase 1 Workspace hiện có

### Open Folder flow

```text
Click Open Folder
        ↓
Rust / tauri-plugin-dialog
        ├─ Cancel → null → giữ workspace hiện tại
        └─ Folder hợp lệ
             ↓
          canonicalize root
             ↓
          tạo workspaceId + name + rootPath
             ↓
          React cập nhật context và chuyển Explorer active
```

Workspace descriptor hiện có dạng:

```ts
type WorkspaceDescriptor = {
  id: string;
  name: string;
  rootPath: string;
};
```

### Giới hạn hiện tại

Phase 1 chưa được coi là hoàn tất chỉ vì Open Folder đã có code. Các thao tác filesystem tiếp theo phải được triển khai theo thứ tự:

1. `path_guard.rs`: chặn traversal, absolute/drive-relative/UNC/device path, sibling prefix và symlink/junction/reparse point ngoài boundary.
2. `read_directory`: đọc đúng một cấp, trả metadata, phân loại entry và map error ổn định.
3. Workspace store và Explorer tree: cache children, expand/collapse, loading/empty/error, retry và refresh.
4. Request ownership: bỏ qua stale response khi đổi workspace hoặc refresh liên tiếp.

Frontend không được tự truyền root path tùy ý vào Rust. Root canonical và quyền truy cập phải được Rust giữ và kiểm tra.

## Kiểm thử và bằng chứng

Các lệnh đã chạy pass:

```powershell
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- --version
git diff --check
```

Native smoke test đã xác nhận:

- Tauri build được native executable.
- Cửa sổ `Vibe Rider` mở và process responsive.
- Vite dùng đúng port `1420`.
- Window config tối thiểu là `960 × 600`.

Chưa có bằng chứng click-through native cho folder picker success/cancel/error do UI automation bị giới hạn trong môi trường kiểm tra. Path guard, directory listing và Explorer tree cũng chưa có implementation để test.

## Cấu trúc repository

```text
src/
├─ App.tsx                              # App state, ping IPC và Open Folder flow
├─ main.tsx                             # React entry point
├─ styles.css                           # Visual system, shell và panel layout
├─ components/
│  ├─ AppLayout.tsx                     # Header, Open Folder và status bar host
│  ├─ TerminalWorkspace.tsx             # Mock terminal grid 2 × 2
│  ├─ RightPanel.tsx                    # Git/Explorer panel và workspace context
│  └─ StatusBar.tsx                     # Workspace name và terminal status
└─ workspace/
   ├─ types.ts                          # Workspace DTO/error types
   └─ workspaceApi.ts                   # Typed invoke wrapper và error formatting

src-tauri/
├─ src/
│  ├─ lib.rs                            # Tauri builder, managed state và commands
│  ├─ main.rs                           # Desktop entry point
│  └─ workspace.rs                      # Workspace state, dialog flow và descriptor
├─ build.rs                             # Tauri build attributes
├─ Cargo.toml                           # Rust dependencies
└─ tauri.conf.json                      # Window, Vite URL và frontend build config

docs/
├─ phase-0-foundation-preview.md        # Phase 0 evidence and acceptance
└─ phase-1-workspace-preview.md         # Phase 1 scope, status and checklist
```

Không sửa trực tiếp file sinh tự động trong `src-tauri/gen/schemas`; capability/config phải được cập nhật theo cách gọi thực tế và không cấp filesystem permission rộng cho frontend.

## Roadmap

```text
0 Foundation
  → 1 Workspace
  → 2 Terminal Core
  → 3 Four Terminals
  → 4 Right Panel
  → 5 Editor
  → 6 Git
  → 7 UX
  → 8 AI Chat
  → 9 Read-only Agent
  → 10 Coding Agent
```

| Phase | Kết quả |
| --- | --- |
| 0 — Foundation | Desktop shell, terminal-first layout mock và IPC proof |
| 1 — Workspace | Open Folder, path guard và Explorer lazy loading |
| 2 — Terminal Core | Một PowerShell PTY hoạt động thật |
| 3 — Four Terminals | Session độc lập và layout 1/2/4 |
| 4 — Right Panel | Panel phải switchable, collapsible và resizable |
| 5 — Editor | Monaco, tabs, save, dirty state và diff |
| 6 — Git | Status, diff, add, restore, commit và push |
| 7 — UX | Shortcut, persistence và dogfooding chính IDE |
| 8 — AI Chat | Streaming chat với context do user chọn |
| 9 — Read-only Agent | `read_file`, `list_directory`, `search_text` và read-only Git tools |
| 10 — Coding Agent | Patch review, Accept/Reject, permission và Run command |

Chỉ chuyển phase sau khi tiêu chí nghiệm thu của phase hiện tại đã được kiểm chứng. Native feature phải được kiểm tra trong Tauri trên Windows; frontend browser preview không đủ để nghiệm thu native behavior.

## Tài liệu liên quan

- [Project Instruction](agents/rules/Project_Instruction.md) — vision, scope, architecture và working style.
- [Implementation Plan](agents/plans/Implementation_Plan.md) — thứ tự phase và trách nhiệm chính.
- [Phase 0 Preview](docs/phase-0-foundation-preview.md) — bằng chứng nghiệm thu Foundation.
- [Phase 1 Workspace](docs/phase-1-workspace-preview.md) — contract, tiến độ, test evidence và checklist Workspace.
