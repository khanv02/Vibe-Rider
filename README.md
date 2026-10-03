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

Đã hoàn tất nghiệm thu Phase 1. Native picker đã nối vào workspace state; filesystem contract, Explorer lazy-loading, native startup và picker click-through success/cancel/error đều đã pass.

- Có native folder picker qua `tauri-plugin-dialog`.
- Rust canonicalize folder đã chọn và tạo workspace descriptor gồm `id`, `name`, `rootPath`.
- Cancel không thay đổi workspace hiện tại.
- Header, status bar và Explorer context nhận workspace descriptor.
- Có chuyển panel Git ↔ Explorer.
- `read_directory` đọc một cấp, phân loại directory/file/link/other, sort ổn định và giới hạn 5.000 entry.
- Rust chặn traversal, absolute/drive-relative/UNC/device path, sibling-prefix và symlink/junction/reparse traversal.
- Explorer có cache theo directory, expand/collapse, selection, loading/empty/error, retry và refresh.
- Workspace switch/refresh có generation và request token để bỏ qua stale response.

Chi tiết phạm vi và checklist: [Phase 1 Workspace](docs/phase-1-workspace-preview.md).

### Phase 2 — Terminal Core

Đã hoàn tất implementation Phase 2. Native PTY, xterm.js stream, input, resize và lifecycle đã được nối end-to-end:

- Rust quản lý một PTY session với `portable-pty`/ConPTY.
- PowerShell được resolve ở Rust và spawn tại canonical workspace root.
- IPC `terminal_spawn`/`terminal_write`/`terminal_resize`/`terminal_ack`/`terminal_close` trả session ID, shell, PID và trạng thái.
- Chặn no-workspace, stale workspace, double-spawn và cross-window close.
- Có Channel output theo byte sequence, ACK backpressure, xterm parser, input UTF-8, FitAddon resize và cleanup khi Close/app exit.
- UI một session có xterm output, input/control bytes, resize và trạng thái idle/starting/running/closing/exited/error.

Rust test suite pass với native PowerShell round-trip input/output; frontend build, format, check và clippy đều pass. Native UI click-through đã pass, sẵn sàng mở rộng sang Phase 3.

Chi tiết tiến độ: [Phase 2 Terminal Core](docs/phase-2-terminal-core-preview.md).

### Phase 3 — Four Terminals

Đã hoàn tất implementation phần code cốt lõi. Ứng dụng có tối đa bốn PowerShell/PTY session độc lập, grid mặc định 2 × 2, layout 1/2/4, focus và Close/Restart từng terminal. Pane bị ẩn vẫn giữ component, process, output buffer và tiếp tục xử lý stream. Automated verification đã pass; native multi-pane click-through vẫn là release gate riêng.

Đã hoàn tất implementation theo thứ tự: multi-session manager → grid 2 × 2 → layout 1/2/4 → session actions/lifecycle. Bước còn lại là independent native verification theo ma trận trong preview.

Chi tiết implementation, actual results và checklist release: [Phase 3 — Four Terminals](docs/phase-3-four-terminals-preview.md). Kế hoạch thiết kế: [Phase 3 Plan](agents/plans/Phase_3_Four_Terminals_Plan.md).

### Phase 4 — Right Panel

Đã hoàn tất frontend contract và UI container: panel bên phải chuyển giữa Git/Explorer/Editor, kéo đổi chiều rộng, đóng/mở toàn bộ và có Editor Normal/Expanded. Explorer dùng chức năng hiện có; Git và Editor là các panel supporting tools. Các slot được giữ mounted để bảo toàn terminal session/buffer và Explorer state.

- Git mở mặc định; click lại tool đang active giữ panel mở. Collapse chỉ qua Hide tools hoặc splitter.
- Resize có splitter pointer/keyboard, giới hạn theo viewport và không làm thay đổi terminal session.
- Collapse ẩn rail/content/splitter; header vẫn có nút mở lại.
- Automated verification: `npm run build`, `cargo test` 16/16 và Tauri startup compile đều pass.
- Native click-through switch/resize/focus/state-retention và nghiệm thu đầy đủ vẫn là release gate riêng.

Thứ tự đã thực hiện: **4.1 Panel contract → 4.2 Switch panel → 4.3 Resize/collapse**; **4.4 State retention** đang chờ native verification. Kế hoạch: [Phase 4 Plan](agents/plans/Phase_4_Right_Panel_Plan.md). Checklist và actual results: [Phase 4 Right Panel](docs/phase-4-right-panel-preview.md).

### Phase 5 — Editor

Đã triển khai core Phase 5. Monaco đã thay Editor placeholder trong right panel, mở file từ Explorer, giữ nhiều tab/dirty buffer và cung cấp Diff Viewer read-only dùng chung. Native startup đã pass; click-through các thao tác Editor/layout còn pending.

- Thứ tự: **5.1 File API → 5.2 Open file → 5.3 Edit/save → 5.4 Tabs/lifecycle → 5.5 Shared Diff Viewer**.
- Rust giữ filesystem boundary, UTF-8/BOM/newline, giới hạn file và disk revision; Save không silently overwrite file đã đổi bên ngoài.
- Model giữ text/undo/view state qua đổi tab/panel; Save/Discard/Cancel bảo vệ draft khi đóng tab, đổi workspace hoặc thoát app.
- Trước khi đánh dấu nghiệm thu phải kiểm lại regression layout 4 terminal/tools tự hide và thống nhất active-tool click giữa code/tài liệu. Native acceptance Phase 3/4 vẫn là gate riêng.

Thiết kế, DTO, files và checkpoints: [Phase 5 Editor Plan](agents/plans/Phase_5_Editor_Plan.md). Tiến độ và checklist nghiệm thu: [Phase 5 Editor](docs/phase-5-editor-preview.md).

### Phase 6 — Git

Implementation update: Git status/branch, scoped diff, stage/unstage/restore, reviewed commit, upstream push, refresh and editor disk-change handling are implemented. Git UI review thêm Normal/Expanded, structured push target, old/new preview, List/3 columns, Stage all/Unstage all và operation feedback có error code/guidance. Activity rail có avatar GitHub/identity ở đáy với menu GitHub/Login/Change account/Logout; Git panel có Account và Working repository riêng; Right panel hỗ trợ Left/Right optional layout. Auth chỉ verified sau Push thành công. Automated checks pass; native acceptance remains pending.

Git status/branch, staged/unstaged diff qua Shared Diff Viewer, stage/unstage/restore, reviewed commit/push và refresh giữ dirty editor buffer đã triển khai. Automated checks đạt; native acceptance Phase 3/4/5 vẫn là điều kiện chuyển phase.

Contract, checkpoints 6.1–6.6 và ma trận nghiệm thu: [Phase 6 Git](docs/phase-6-git-preview.md).

Kế hoạch triển khai, baseline code, files/ownership và thứ tự task: [Phase 6 Git Plan](agents/plans/Phase_6_Git_Plan.md).

### Phase 7 — UX (kế hoạch song song Phase 6)

Đã lập plan cho shortcuts, layout polish, persistence và restore workspace; Git UI/mutations, runtime guard và guard wait/cancel đã tích hợp. Dogfooding và nghiệm thu toàn Phase 7 vẫn chờ native matrix.

Phạm vi, dependency, ownership files và checklist: [Phase 7 UX Plan](agents/plans/Phase_7_UX_Plan.md). Core 7.1–7.4, workspace/Git transition guard và Git UI/mutations đã triển khai; native matrix và dogfooding còn chờ.

## Product direction

```text
Terminal First
Local First
AI Friendly
Simple
Fast
Developer Controlled
```

Terminal là main workspace. Git, Explorer và Editor là supporting tools ở bên phải hoặc bên trái theo layout preference. Ứng dụng không nhằm trở thành bản sao đầy đủ của VS Code hoặc một cloud IDE.

AI được sử dụng chủ yếu qua các CLI chạy trong terminal; project không tích hợp AI chat/provider riêng trong giao diện.

## Layout hiện tại

```text
┌────────────────────────────────────────┬────────────┐
│ Vibe Rider / Workspace                 │ Explorer   │
├────────────────────────────────────────┤ Git        │
│ Phase 3 · Four Terminals · 4 panes     │ workspace  │
│ [Start / Close] · idle/running         │ context    │
├────────────────────────────────────────┴────────────┤
│ Layout 1 / 2 / 4 · Workspace: none                  │
└─────────────────────────────────────────────────────┘
```

Terminal Core đã spawn/close PowerShell PTY thật, render output qua xterm.js, nhận input/control bytes và resize theo pane. Right panel hiện chỉ gồm Git, Explorer và Editor; có thể đặt ở bên trái hoặc bên phải theo layout preference. Explorer hiển thị workspace context và cây thư mục lazy-loaded sau khi mở folder.

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
React cập nhật header/status và khởi tạo Explorer root listing
```

`open_workspace` không nhận root path tùy ý từ frontend. `read_directory` nhận `workspaceId` và `relativePath`; Rust giữ canonical root và kiểm tra path trước khi đọc.

## Stack

| Layer | Công nghệ | Trạng thái |
| --- | --- | --- |
| Desktop shell | Tauri 2 | Đã có; native startup đã kiểm tra |
| System core | Rust | Có workspace state, `ping`, `open_workspace`, `read_directory`, `read_file`, `write_file`, `terminal_spawn`, `terminal_write`, `terminal_resize`, `terminal_ack`, `terminal_close` |
| Native dialog | `tauri-plugin-dialog` | Đã tích hợp cho Open Folder |
| Serialization | `serde` | Đã dùng cho workspace DTO/error |
| Frontend | React + TypeScript | Đã có |
| Build | Vite | Đã có, strict port `1420` |
| State | React local state | Đang dùng cho Phase 1; shared store chưa có |
| Terminal UI | React + xterm.js + FitAddon | Có output stream, input, resize, Start/Close và session metadata |
| PTY | `portable-pty` 0.9 / Windows ConPTY | Đã tích hợp cho một PowerShell session |
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

`cargo test` pass với 16 unit tests, gồm path guard, containment, one-level listing, empty directory, error boundary, terminal lifecycle và multi-session contract.

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

### Phase 1 đã hoàn tất implementation

1. `path_guard.rs`: chặn traversal, absolute/drive-relative/UNC/device path, sibling prefix và symlink/junction/reparse point trong path request.
2. `read_directory`: đọc đúng một cấp, trả metadata, phân loại entry, sort ổn định, giới hạn 5.000 entry và map lỗi.
3. Explorer tree: cache children, expand/collapse, selection, loading/empty/error, retry và refresh.
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

Manual click-through đã xác nhận các nhánh success/cancel/error của folder picker trong native window. Tiền tố `\\?\` trên path là Windows canonical extended-length path và được giữ trong workspace state.

## Cấu trúc repository

```text
src/
├─ App.tsx                              # App state, panel controller, ping IPC và Open Folder flow
├─ main.tsx                             # React entry point
├─ styles.css                           # Visual system, shell và panel layout
├─ components/
│  ├─ AppLayout.tsx                     # Header, body grid, splitter và status bar host
│  ├─ TerminalWorkspace.tsx             # Grid bốn terminal và layout 1/2/4
│  ├─ RightPanel.tsx                    # Rail ba tool, stable slots và workspace context
│  ├─ RightPanelResizeHandle.tsx        # Pointer/keyboard resize và ARIA separator
│  ├─ ExplorerPanel.tsx                 # Explorer tree, states, refresh và selection
│  ├─ ExplorerTreeNode.tsx              # Node lazy-loaded và retry
│  ├─ EditorPanel.tsx                   # Editor toolbar, tabs, dirty close và Diff entry point
│  ├─ MonacoEditor.tsx                   # Monaco model view, layout và Ctrl+S
│  ├─ SharedDiffViewer.tsx               # Read-only snapshot diff
│  ├─ UnsavedChangesDialog.tsx           # Save/Discard/Cancel guard
│  ├─ StatusBar.tsx                     # Workspace name và terminal status
│  └─ TerminalPane.tsx                   # Xterm, session lifecycle và actions của một pane
├─ workspace/
   ├─ types.ts                          # Workspace và directory DTO/error types
   ├─ workspaceApi.ts                   # Typed invoke wrapper và error formatting
   └─ useWorkspaceExplorer.ts           # Cache, expansion, loading và request tokens
├─ editor/
   ├─ editorApi.ts                       # Typed read_file/write_file IPC
   ├─ editorStore.ts                     # Zustand tab metadata
   ├─ useWorkspaceEditor.ts              # Model registry, open/save/dirty lifecycle
   ├─ modelRegistry.ts                   # Monaco model ownership và cleanup
   └─ monacoRuntime.ts                   # Local worker, theme và language mapping
├─ terminal/
   ├─ types.ts                          # Terminal session/event/error DTOs
   └─ terminalApi.ts                    # Tauri Channel và terminal command wrappers
└─ panels/
   ├─ types.ts                          # Right-panel IDs/state/geometry types
   ├─ panelLayout.ts                    # Width bounds, clamp và derived geometry
   └─ useRightPanel.ts                   # App-owned panel state/actions

src-tauri/
├─ src/
│  ├─ lib.rs                            # Tauri builder, managed state và commands
│  ├─ main.rs                           # Desktop entry point
│  ├─ workspace.rs                      # Workspace state, dialog flow và descriptor
│  ├─ path_guard.rs                     # Relative path, containment và link policy
│  ├─ filesystem.rs                     # One-level directory listing và error mapping
│  ├─ file_editor.rs                    # UTF-8 file read/write, revision và safe replacement
│  └─ terminal/
│     ├─ mod.rs                         # Multi-session manager và IPC commands
│     ├─ session.rs                     # PTY session, Channel và cleanup
│     └─ shell.rs                       # PowerShell resolution
├─ build.rs                             # Tauri build attributes
├─ Cargo.toml                           # Rust dependencies
└─ tauri.conf.json                      # Window, Vite URL và frontend build config

docs/
├─ phase-0-foundation-preview.md        # Phase 0 evidence and acceptance
├─ phase-1-workspace-preview.md         # Phase 1 scope, status and checklist
├─ phase-2-terminal-core-preview.md     # Phase 2 scope, status and checklist
├─ phase-3-four-terminals-preview.md    # Phase 3 scope, design and checklist
├─ phase-4-right-panel-preview.md       # Phase 4 scope, contract and checklist
├─ phase-5-editor-preview.md            # Phase 5 implementation evidence and checklist
├─ phase-6-git-preview.md               # Phase 6 design, contracts and acceptance checklist
└─ phase-7-ux-preview.md                # Phase 7 implementation evidence and native gate
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
  → 9 Read-only Agent
  → 10 Coding Agent
```

| Phase | Kết quả |
| --- | --- |
| 0 — Foundation | Desktop shell, terminal-first layout mock và IPC proof |
| 1 — Workspace | Open Folder, path guard và Explorer lazy loading |
| 2 — Terminal Core | Một PowerShell PTY hoạt động thật |
| 3 — Four Terminals | Multi-session manager, bốn PTY độc lập và layout 1/2/4; native smoke đang chờ |
| 4 — Right Panel | Frontend switch/collapse/resize đã triển khai; native state-retention smoke đang chờ |
| 5 — Editor | Core đã triển khai; Monaco, tabs, safe save, dirty state và read-only diff; native click-through đang chờ |
| 6 — Git | Core status/diff, stage/unstage/restore, commit/push và refresh đã triển khai; native acceptance còn chờ |
| 7 — UX | Shortcut, persistence, panel layout và dogfooding chính IDE |
| 9 — Read-only Agent | `read_file`, `list_directory`, `search_text` và read-only Git tools |
| 10 — Coding Agent | Patch review, Accept/Reject, permission và Run command |

Chỉ chuyển phase sau khi tiêu chí nghiệm thu của phase hiện tại đã được kiểm chứng. Native feature phải được kiểm tra trong Tauri trên Windows; frontend browser preview không đủ để nghiệm thu native behavior.

## Tài liệu liên quan

- [Project Instruction](agents/rules/Project_Instruction.md) — vision, scope, architecture và working style.
- [Implementation Plan](agents/plans/Implementation_Plan.md) — thứ tự phase và trách nhiệm chính.
- [Phase 0 Preview](docs/phase-0-foundation-preview.md) — bằng chứng nghiệm thu Foundation.
- [Phase 1 Workspace](docs/phase-1-workspace-preview.md) — contract, tiến độ, test evidence và checklist Workspace.
- [Phase 2 Terminal Core Plan](agents/plans/Phase_2_Terminal_Core_Plan.md) — kiến trúc PTY, contract input/output, lifecycle và tiêu chí nghiệm thu terminal.
- [Phase 3 Four Terminals Plan](agents/plans/Phase_3_Four_Terminals_Plan.md) — multi-session ownership, grid 2 × 2, layout 1/2/4, focus và kiểm thử độc lập.
- [Phase 3 Four Terminals](docs/phase-3-four-terminals-preview.md) — implementation status, actual test results, native smoke matrix và checklist release.
- [Phase 4 Right Panel](docs/phase-4-right-panel-preview.md) — panel contract, switch/collapse/resize, state retention và native acceptance matrix.
- [Phase 4 Right Panel Plan](agents/plans/Phase_4_Right_Panel_Plan.md) — state/ownership, width constraints, pointer/focus, Editor Normal/Expanded và checkpoint 4.1–4.4.
- [Phase 5 Editor Plan](agents/plans/Phase_5_Editor_Plan.md) — Monaco/model ownership, file API, save conflict, tabs/lifecycle và shared diff.
- [Phase 5 Editor](docs/phase-5-editor-preview.md) — implementation evidence, native gate và checklist nghiệm thu.
- [Phase 6 Git](docs/phase-6-git-preview.md) — Git CLI boundary, status/diff, mutations, refresh và checkpoints 6.1–6.6; core đã triển khai, native acceptance còn chờ.
- [Phase 6 Git Plan](agents/plans/Phase_6_Git_Plan.md) — baseline/dependencies, architecture, API/process lifecycle, files/ownership và task checkpoints.
- [Phase 7 UX Plan](agents/plans/Phase_7_UX_Plan.md) — phần UX song song Phase 6, contracts/ownership, persistence/restore và checkpoints tích hợp.
- [Phase 7 UX](docs/phase-7-ux-preview.md) — core 7.1–7.4 đã triển khai; native matrix, Git coordination và dogfooding còn chờ.
