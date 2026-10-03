# Vibe Rider

Vibe Rider là một desktop IDE local-first, terminal-first dành cho developer làm việc với terminal và AI CLI.

Đây cũng là project học tập. Mục tiêu là hiểu cách React kết nối với Rust, Tauri IPC, filesystem, process, PTY, Git và AI tools qua các bước nhỏ có thể kiểm chứng.

## Trạng thái hiện tại

Phase 0 — Foundation đã hoàn tất nghiệm thu native trên Windows. Working tree hiện có implementation Phase 1 — Workspace đang tiếp tục phát triển và chưa nghiệm thu native; các bằng chứng Foundation được ghi trong [Phase 0 Preview](docs/phase-0-foundation-preview.md).

Đã có:

- Tauri 2 configuration, cửa sổ tối thiểu `960 × 600` và Rust entry point.
- React + TypeScript + Vite frontend.
- Terminal-first layout mock với grid terminal 2 × 2 ở trung tâm.
- Activity rail bên phải và Git panel placeholder mặc định.
- Status bar foundation.
- IPC proof-of-boundary: React gọi Rust command `ping`.

Chưa có:

- Open workspace và filesystem API.
- PowerShell hoặc PTY terminal thật.
- xterm.js và bốn terminal session độc lập.
- Monaco Editor.
- Git CLI integration và ripgrep search.
- AI provider, chat hoặc agent tools.

Đã xác minh trong môi trường hiện tại:

- `npm run build` chạy thành công.
- Tauri CLI chạy được, phiên bản hiện tại là `2.12.1`.
- Node.js, npm và Git có trong `PATH`.

Tauri native build và IPC trong cửa sổ desktop chưa được xác minh vì `rustc` và `cargo` hiện chưa có trong `PATH`.

## Product direction

```text
Terminal First
Local First
AI Friendly
Simple
Fast
Developer Controlled
```

Terminal là main workspace. Git, Explorer, Editor và AI GUI là supporting tools ở bên phải. Ứng dụng không nhằm trở thành bản sao đầy đủ của VS Code hoặc một cloud IDE.

## Phase 0 layout

```text
┌─────────────────────────────────────────────┬────┬──────────┐
│ MAIN WORKSPACE: TERMINALS (2 × 2 MOCK)      │    │ GIT      │
│ ┌──────────────────┬──────────────────────┐ │ ⎇  │ default  │
│ │ Terminal 1       │ Terminal 2           │ │    │ IPC check│
│ ├──────────────────┼──────────────────────┤ │ ▱  │          │
│ │ Terminal 3       │ Terminal 4           │ │ <> │          │
│ └──────────────────┴──────────────────────┘ │ ✦  │          │
├─────────────────────────────────────────────┴────┴──────────┤
│ T1 ●   T2 ●   T3 ●   T4 ●                 Workspace: none  │
└─────────────────────────────────────────────────────────────┘
```

Đây chỉ là layout mock. Activity rail và Git panel chưa có chức năng Git/Explorer/Editor/AI thật. Nút `Ping Rust` chỉ dùng để kiểm tra boundary React ↔ Tauri ↔ Rust.

## Kiến trúc dự kiến

```text
React + TypeScript
          ↕
      Tauri IPC
          ↕
Rust services
          ↕
Filesystem / PTY / process / Git CLI / ripgrep
```

Rust sở hữu operation native và permission boundary. Frontend không tự ý truy cập path ngoài workspace, không tự chạy operation nhạy cảm và không expose arbitrary command nếu không cần.

## Stack

| Layer | Công nghệ | Trạng thái |
| --- | --- | --- |
| Desktop shell | Tauri 2 | Có scaffold |
| System core | Rust | Có entry point; native build chờ toolchain |
| Frontend | React + TypeScript | Đã có |
| Build | Vite | Đã có, port `1420` |
| State | Zustand | Dự kiến |
| Terminal UI | xterm.js | Dự kiến |
| PTY | `portable-pty` hoặc abstraction phù hợp | Dự kiến |
| Editor | Monaco Editor | Dự kiến |
| Git/search | Git CLI + ripgrep | Dự kiến |

## Chạy project

### Điều kiện Windows

Để chạy đầy đủ Tauri cần:

- Node.js và npm.
- Rust toolchain, ưu tiên `stable-msvc`.
- Microsoft C++ Build Tools.
- WebView2 Runtime.
- Git.

Kiểm tra:

```powershell
node --version
npm --version
rustc --version
cargo --version
git --version
```

### Cài dependency và chạy frontend

```powershell
npm ci
npm run dev
```

`npm ci` dùng lockfile để cài dependency nhất quán. Dùng `npm install` khi cần thay đổi dependency. Vite chạy tại `http://localhost:1420`; browser preview chỉ kiểm tra frontend, không kiểm tra được IPC native.

### Build frontend

```powershell
npm run build
```

### Chạy desktop app

```powershell
npm run tauri -- dev
```

Lệnh này cần Rust, C++ Build Tools và WebView2. Sau khi native app mở, kiểm tra nút `Ping Rust` trả về `pong from Rust`.

Có thể kiểm tra riêng Tauri CLI mà chưa cần Rust:

```powershell
npm run tauri -- --version
```

### Kiểm tra Rust

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

## IPC proof hiện tại

```text
User click Ping Rust
        ↓
React invoke("ping")
        ↓
Tauri IPC
        ↓
Rust ping command
        ↓
"pong from Rust"
```

Đây chưa phải filesystem API, process API hay terminal API.

## Cấu trúc hiện tại

```text
src/
├─ App.tsx                           # Ghép shell và gọi IPC demo
├─ main.tsx                          # React entry point
├─ styles.css                        # Foundation visual system
└─ components/
   ├─ AppLayout.tsx                  # Header, body grid và status bar host
   ├─ TerminalWorkspace.tsx           # Mock grid terminal 2 × 2
   ├─ RightPanel.tsx                 # Activity rail và Git placeholder
   └─ StatusBar.tsx                  # Foundation status bar

src-tauri/
├─ src/lib.rs                        # Tauri builder và command Rust
├─ src/main.rs                       # Desktop entry point
├─ build.rs                           # Tauri build attributes
└─ tauri.conf.json                   # Window, Vite URL và frontend build config
```

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
- [Phase 0 Preview](docs/phase-0-foundation-preview.md) — bằng chứng và trạng thái Phase 0 hiện tại.
- [Phase 1 Workspace](docs/phase-1-workspace-preview.md) — phạm vi, contract, tiến độ và tiêu chí nghiệm thu Workspace.
