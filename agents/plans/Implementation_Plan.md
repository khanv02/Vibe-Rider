# Kế hoạch triển khai Vibe Rider V1

Nguồn yêu cầu và thứ tự triển khai: [Project Instruction](../rules/Project_Instruction.md).

File này là kế hoạch thực hiện, không thay thế yêu cầu sản phẩm trong `Project_Instruction.md`. Khi hai tài liệu khác nhau, `Project_Instruction.md` được ưu tiên.

## 1. Mục tiêu và phạm vi

Vibe Rider là desktop IDE local-first, terminal-first cho developer làm việc với terminal và AI CLI.

Mục tiêu V1:

- Tauri 2 chạy trên Windows.
- Terminal là main workspace.
- Hỗ trợ bốn terminal độc lập.
- Explorer, Editor, Git và AI GUI là supporting tools ở bên phải.
- Rust sở hữu filesystem, process, PTY, Git, search và permission boundary.
- Người dùng kiểm soát thao tác ghi file và chạy command của AI.

Stack theo tài liệu nguồn:

```text
Tauri 2
Rust
React
TypeScript
Vite
Zustand
xterm.js
portable-pty hoặc PTY abstraction phù hợp
Monaco Editor
Git CLI
ripgrep
```

Không đưa vào kế hoạch: cloud backend, authentication, collaboration, account system, plugin marketplace, microservices, Docker, database, vector database, multi-agent system, full VS Code compatibility, full LSP hoặc debugger.

## 2. Nguyên tắc kiến trúc

```text
React UI
   ↕
Tauri IPC
   ↕
Rust services
   ↕
Filesystem / PTY / process / Git CLI / ripgrep
```

- Terminal là vùng chính; supporting tools không được chiếm vai trò workspace trung tâm.
- Frontend không tự thực hiện operation nhạy cảm với hệ thống.
- Rust phải kiểm tra workspace, path traversal, absolute path và symlink/junction trước operation filesystem.
- Không expose arbitrary command cho frontend nếu không cần. Command của coding agent luôn đi qua permission và approval.
- Không tạo global store khổng lồ. Chỉ tách `workspaceStore`, `terminalStore`, `editorStore`, `uiStore`, `gitStore` khi state thực sự cần.
- Không hard-code chức năng cho Terminal 1–4. Các command minh họa trong mock chỉ là ví dụ.
- Chỉ tạo module khi đến phase có responsibility tương ứng; không sinh trước toàn bộ hệ thống.

## 3. Thứ tự phase

Các phase phải triển khai theo đúng thứ tự trong `Project_Instruction.md`:

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

| Phase | Công nghệ chính | Kết quả chính |
| --- | --- | --- |
| 0 — Foundation | Tauri 2, Rust, React, TypeScript, Vite | Desktop shell và terminal-first layout mock |
| 1 — Workspace | Rust filesystem, Tauri IPC, React | Open Folder, read directory và Explorer |
| 2 — Terminal Core | Rust, PTY, `portable-pty`, xterm.js, Tauri IPC | Một PowerShell terminal hoạt động thật |
| 3 — Four Terminals | PTY session manager, React state | Bốn session độc lập và layout 1/2/4 |
| 4 — Right Panel | React layout state | Panel Git/Explorer/Editor/AI switchable, collapsible, resizable |
| 5 — Editor | Monaco Editor, Zustand | Open, edit, save, tabs, dirty state và Diff Editor |
| 6 — Git | Git CLI, Rust process | Status, diff, add, restore, commit và push |
| 7 — UX | React state, persistence | Shortcut, restore workspace và dogfooding chính IDE |
| 8 — AI Chat | Một AI provider | Chat streaming với context do user chọn |
| 9 — Read-only Agent | LLM tool calling, ripgrep, filesystem tools | Agent đọc, liệt kê và tìm code |
| 10 — Coding Agent | Patch, diff, permission, command execution | Read → Search → Patch → Review → Accept → Test |

## 4. Kế hoạch theo phase

### Phase 0 — Foundation

**Mục tiêu:** desktop app chạy được với terminal-first layout mock. Chưa có filesystem, PTY, Git, Monaco, ripgrep hoặc AI functionality.

**Kiến thức cần hiểu:**

- Tauri là desktop shell, không phải terminal engine.
- React/Vite render và build frontend.
- Rust/Tauri command tạo boundary IPC.
- Browser build không chứng minh được native Tauri build.

**Architecture:**

```text
Tauri window
    ↓
React AppLayout
    ├── TerminalWorkspace: mock 2 × 2
    ├── RightPanel: activity rail + Git placeholder
    └── StatusBar
```

**Data flow của IPC proof:**

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

**Files và responsibility hiện tại:**

```text
src/App.tsx                         # Ghép shell và gọi IPC demo
src/components/AppLayout.tsx       # Header, body grid và status bar host
src/components/TerminalWorkspace.tsx # Mock terminal 2 × 2
src/components/RightPanel.tsx       # Activity rail và Git placeholder
src/components/StatusBar.tsx        # Foundation status bar
src/styles.css                       # Visual layout system
src-tauri/src/lib.rs                 # Tauri builder và ping command
src-tauri/src/main.rs                # Native entry point
src-tauri/tauri.conf.json            # Window và Vite configuration
```

**Task theo thứ tự:**

- [ ] **0.1 — Kiểm tra môi trường Windows:** Node.js, npm, Rust `stable-msvc`, C++ Build Tools, WebView2 và Git. Ghi rõ tool nào thiếu.
- [ ] **0.2 — Hoàn thiện scaffold:** Tauri 2 + React + TypeScript + Vite, một package manager và một lockfile; kiểm tra frontend build.
- [x] **0.3 — Dựng app shell:** mock bốn terminal 2 × 2, activity rail bên phải, Git mặc định và status bar.
- [x] **0.4 — Xác minh nền tảng:** native Tauri dev mode, IPC `ping`, frontend build, Rust check và layout ở cửa sổ tối thiểu.

**Expected result:** cửa sổ native mở được, terminal là vùng chính, supporting tools nằm bên phải và không có tính năng Phase 1 trở đi được giả làm đã hoạt động.

### Phase 1 — Workspace

Kế hoạch chi tiết: [Phase 1 — Workspace](Phase_1_Workspace_Plan.md).

**Mục tiêu:** mở một thư mục local và duyệt cây thư mục lazy-loaded bằng Rust filesystem.

**Kiến thức:** path, directory entry, absolute/relative path, IPC request/response, containment và lazy loading.

**Architecture:**

```text
User chọn folder
        ↓
Native dialog / Tauri
        ↓
Rust Workspace + Path Guard
        ↓
read_directory(path)
        ↓
Explorer hiển thị một cấp children
```

**Task:**

- [x] **1.1 — Workspace contract:** open-folder flow, root path, workspace name/id và lỗi hợp lệ.
- [x] **1.2 — Path guard:** chặn `..`, path ngoài root, absolute path không hợp lệ và symlink/junction/reparse traversal.
- [x] **1.3 — Directory API:** trả children một cấp gồm tên, path và loại entry; không recursive scan.
- [x] **1.4 — Explorer UI:** expand, collapse, refresh, loading, empty và error state.
- [x] **1.5 — Workspace switch:** bỏ request/cây cũ, cleanup state liên quan và không trả kết quả IPC cũ.

**Nghiệm thu:** mở được folder có dấu/khoảng trắng; cancel không mất state; path traversal và junction thoát root bị chặn; repository lớn không bị đọc đệ quy.

### Phase 2 — Terminal Core

Kế hoạch chi tiết: [Phase 2 — Terminal Core](Phase_2_Terminal_Core_Plan.md).

**Mục tiêu:** một PowerShell terminal hoạt động thật trong workspace.

**Kiến thức:** process, shell, PTY, stdin, stdout, stderr, ANSI, resize và lifecycle.

**Architecture:**

```text
xterm.js
   ↕ input / output
Tauri IPC
   ↕
Rust PTY manager
   ↕
PowerShell process
```

**Data flow:**

```text
User input → xterm.js → IPC → PTY stdin → PowerShell
PowerShell stdout/stderr → PTY reader → IPC → xterm.js
```

**Task:**

- [x] **2.1 — Spawn PTY:** tạo PowerShell tại workspace, environment và kích thước ban đầu; trả session ID.
- [x] **2.2 — Stream output:** reader loop → IPC stream/channel → xterm; giữ Unicode/ANSI và giới hạn buffer.
- [x] **2.3 — Send input:** route theo session ID; hỗ trợ Enter, phím mũi tên, paste và Ctrl+C.
- [x] **2.4 — Resize:** pane → xterm fit → rows/columns PTY; không spawn lại shell.
- [x] **2.5 — Lifecycle:** running/exited/error, close/restart, unregister listener và cleanup process con.

**Nghiệm thu:** `echo hello`, `Get-Location`, lệnh output liên tục, Ctrl+C, resize và đóng app đều hoạt động đúng.

### Phase 3 — Four Terminals

Kế hoạch chi tiết: [Phase 3 — Four Terminals](Phase_3_Four_Terminals_Plan.md). Trạng thái: **đã triển khai implementation; native multi-pane verification đang chờ**.

**Mục tiêu:** bốn PTY session độc lập với layout 1, 2 và 4 terminal.

**Kiến thức:** session ownership, routing input/output, process lifecycle và component lifecycle.

**Task:**

- [ ] **3.1 — Session manager:** map session ID → PTY/process; mỗi session có lifecycle riêng.
- [ ] **3.2 — Grid 2 × 2:** bốn pane có focus/status riêng; không gán nhiệm vụ cố định cho pane.
- [ ] **3.3 — Layout modes:** đổi 1/2/4 chỉ ẩn/hiện pane, không terminate session bị ẩn.
- [ ] **3.4 — Session actions:** chọn, close và restart từng session; cleanup đúng khi đổi workspace.
- [ ] **3.5 — Independent verification:** chạy shell, dev server, build/test và CLI tương tác đồng thời.

**Nghiệm thu:** output/phím không lẫn session; đổi 4 → 1 → 4 giữ process; restart một session không ảnh hưởng ba session còn lại.

### Phase 4 — Right Panel

Kế hoạch chi tiết: [Phase 4 — Right Panel](Phase_4_Right_Panel_Plan.md). Checklist: [Phase 4 Preview](../../docs/phase-4-right-panel-preview.md). Trạng thái: **đã triển khai frontend; native verification đang chờ**.

**Mục tiêu:** biến right-panel mock của Phase 0 thành container hỗ trợ thật mà không làm gián đoạn terminal.

**Kiến thức:** layout state, focus, resize constraint, collapse và giữ state khi switch panel.

**Task:**

- [x] **4.1 — Panel contract:** `activeRightPanel`, `rightPanelOpen`, `rightPanelWidth`; Git mặc định.
- [x] **4.2 — Switch panel:** Git, Explorer, Editor và AI; chỉ một panel chính hiển thị.
- [x] **4.3 — Resize/collapse:** giới hạn width, đóng/mở panel và editor normal/expanded.
- [ ] **4.4 — State retention:** switch panel không làm mất terminal session hoặc Explorer state.

**Nghiệm thu:** Git mặc định; switch/collapse/resize hoạt động; đóng panel để terminal chiếm gần toàn màn hình.

**Actual verification:** `npm run build` pass; `cargo test --manifest-path src-tauri/Cargo.toml` pass 16/16; `npm run tauri -- dev` compile/startup pass. Native click-through cho switch, resize, focus và state retention chưa được đánh dấu đạt.

### Phase 5 — Editor

**Mục tiêu:** mở, sửa và lưu file bằng Monaco; có Diff Editor dùng chung.

**Kiến thức:** editor model, buffer, dirty state, encoding, newline, save và conflict với thay đổi bên ngoài.

**Task:**

- [ ] **5.1 — File API:** `read_file` và `write_file` qua Rust path guard; quy định text/binary/size limit.
- [ ] **5.2 — Open file:** Explorer → Monaco model/tab; syntax highlighting.
- [ ] **5.3 — Edit/save:** dirty state, save và kiểm tra file đã đổi trước khi ghi.
- [ ] **5.4 — Tabs/lifecycle:** nhiều tab, close và Save/Discard/Cancel.
- [ ] **5.5 — Shared Diff Viewer:** read-only old/new snapshot cho Git và AI patch.

**Nghiệm thu:** mở nhiều file, đổi tab không mất buffer, save đúng file, giữ Unicode/newline và diff không tự ghi filesystem.

### Phase 6 — Git

**Mục tiêu:** thao tác Git qua operation rõ ràng và Git CLI, không cho frontend chạy arbitrary Git command.

**Kiến thức:** working tree, index, HEAD, staged/unstaged, branch, commit và remote.

**Task:**

- [ ] **6.1 — Git service:** working directory cố định, arguments riêng, exit code/output/error.
- [ ] **6.2 — Status:** branch, staged, unstaged, untracked, rename và filename có dấu/khoảng trắng.
- [ ] **6.3 — Diff:** staged/unstaged, file mới/xóa và binary; dùng Diff Viewer cho text.
- [ ] **6.4 — Add/restore:** operation riêng, validate path và confirmation trước restore.
- [ ] **6.5 — Commit/push:** message, loading, lỗi auth/remote, timeout/cancel; không force push.
- [ ] **6.6 — Refresh:** refresh sau operation/focus và không ghi đè editor buffer dirty.

**Nghiệm thu:** status/diff/stage/restore/commit đúng trên repository thử nghiệm; push không làm treo UI; lỗi Git được hiển thị rõ.

### Phase 7 — UX

**Mục tiêu:** dùng IDE để tiếp tục phát triển chính IDE.

**Task:**

- [ ] **7.1 — Shortcuts:** layout 1/2/4, focus terminal/panel và save; kiểm tra conflict trước khi chốt phím.
- [ ] **7.2 — Layout polish:** min size, resize, focus indicator, loading/error/empty state và status bar.
- [ ] **7.3 — Persistence:** workspace gần nhất, layout, panel mở/width; validate dữ liệu lưu.
- [ ] **7.4 — Restore:** mở lại workspace nếu còn tồn tại và spawn shell mới; không tự chạy lại command/process cũ.
- [ ] **7.5 — Dogfooding:** sửa code, chạy build/test, xem Git diff và commit trong chính IDE.

**Nghiệm thu:** hoàn thành một vòng sửa code → build/test → review diff → commit; restart giữ layout/workspace; không mất terminal input hoặc dirty buffer.

### Phase 8 — AI Chat

**Mục tiêu:** AI GUI tùy chọn để hỏi code và lỗi terminal; chưa có quyền sửa file/chạy command.

**Task:**

- [ ] **8.1 — Provider contract:** chat, streaming, cancel và error; chỉ chọn một provider đầu tiên.
- [ ] **8.2 — Provider connection:** API key ngoài frontend/log; xử lý thiếu key, network và rate limit.
- [ ] **8.3 — Chat UI:** message, streaming response, cancel/retry và request state.
- [ ] **8.4 — Explicit context:** current file, selected code hoặc terminal error do user chọn; giới hạn kích thước.
- [ ] **8.5 — Verification:** provider giả lập cho stream/cancel/error và provider thật khi credential sẵn sàng.

**Nghiệm thu:** chat streaming/cancel được; không gửi toàn repository/lịch sử terminal; chat không thay đổi filesystem.

### Phase 9 — Read-only Agent

**Mục tiêu:** agent tìm và đọc code trong workspace để trả lời có căn cứ.

**Task:**

- [ ] **9.1 — Search service:** Rust gọi ripgrep, giới hạn result/output/time và hỗ trợ cancel.
- [ ] **9.2 — Search UI:** path, line, snippet và mở vị trí trong editor.
- [ ] **9.3 — Read tools:** `read_file`, `list_directory`, `search_text`, `git_status`, `git_diff`.
- [ ] **9.4 — Agent loop:** validate tool arguments, execute qua Rust, giới hạn bước/thời gian/output.
- [ ] **9.5 — Tool activity:** hiển thị dữ liệu đã đọc và câu trả lời có path/line; chỉ read-only registry.

**Nghiệm thu:** agent tìm đúng code; path ngoài workspace bị từ chối; no-match/error/cancel không tạo loop vô hạn; không có filesystem write.

### Phase 10 — Coding Agent

**Mục tiêu:** Read → Search → Patch → Review → Accept → Test với approval rõ ràng.

**Task:**

- [ ] **10.1 — Patch proposal:** tạo patch trong memory cùng snapshot/version; chưa ghi đĩa.
- [ ] **10.2 — Review:** Diff Viewer và Accept/Reject; Reject không đổi filesystem.
- [ ] **10.3 — Apply:** kiểm tra approval, workspace, path và snapshot trước khi ghi; chặn stale patch.
- [ ] **10.4 — Run command:** proposal gồm executable, arguments, cwd; Run/Cancel, timeout và cleanup process.
- [ ] **10.5 — Test loop:** chỉ chạy verify sau khi user chọn Run; không tự commit/push.
- [ ] **10.6 — V1 verification:** release build, installer, môi trường thiếu Git/rg/PowerShell và giới hạn thực tế.

**Nghiệm thu:** Reject không ghi; Accept chỉ áp dụng proposal đã duyệt; path traversal/stale patch bị chặn; Cancel không chạy command; process được cleanup.

## 5. Quy trình thực hiện mỗi task

Theo working style trong `Project_Instruction.md`, mỗi task phải đi qua:

1. **Mục tiêu:** vấn đề task giải quyết.
2. **Kiến thức:** What / Why / How cần hiểu.
3. **Architecture:** các layer và ownership.
4. **Data Flow:** request, response, event hoặc process flow.
5. **Files cần tạo/sửa:** responsibility từng file.
6. **Chia task:** task hiện tại đủ nhỏ để kiểm chứng.
7. **Implement task đầu tiên:** không generate toàn bộ phase trong một lượt.
8. **Giải thích code:** tập trung vào ownership, state và boundary.
9. **Test:** expected result và actual result rõ ràng.
10. **Kiến thức vừa học:** concept, lý do quan trọng và ứng dụng ngoài project.

Không chuyển phase chỉ vì code đã được viết. Native feature phải được kiểm tra trong Tauri trên Windows; browser-only preview chỉ đủ cho frontend.

## 6. Trạng thái hiện tại và bước tiếp theo

Phase hiện tại: **Phase 4 — Right Panel đã triển khai frontend contract/UI; native smoke và state-retention verification đang chờ. Phase 3 native smoke vẫn là gate độc lập.**

| Hạng mục | Trạng thái |
| --- | --- |
| React + TypeScript + Vite scaffold | Có |
| Tauri config và Rust entry point | Có |
| Terminal-first layout mock | Đã triển khai |
| Phase 2 PTY/xterm/input/resize/lifecycle | Đã triển khai; automated/native PTY tests pass |
| IPC `ping` proof-of-boundary | Native đã xác minh |
| `npm run build` | Đã đạt |
| `rustc` / `cargo` trong `PATH` | Đã có `1.99.0`, toolchain `stable-x86_64-pc-windows-msvc`; kiểm tra 2026-10-03 |
| Tauri native dev mode | Đã xác minh |

Phase 1 và Phase 2 đã qua implementation, automated verification và native UI click-through. Phase 3 Four Terminals đã triển khai multi-session manager, grid/layout 1/2/4 và actions/lifecycle; `npm run build`, `cargo fmt --check`, `cargo check`, `cargo test` (16/16) và `cargo clippy -D warnings` đã pass. Native multi-pane click-through và full smoke matrix chưa được đánh dấu nghiệm thu.

Phase 4 đã triển khai state contract, switch bốn tools, full collapse/reopen, resize và Editor Normal/Expanded. Task 4.1–4.3 đã có code/build evidence; Task 4.4 còn cần native click-through để xác nhận focus, xterm/Explorer retention và min-window behavior.

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri -- dev
```

Khi chạy native, cần kiểm tra: cửa sổ mở được, port `1420` khớp, nút `Ping Rust` trả `pong from Rust`, layout không overflow ở `960 × 600` và app đóng không để process mồ côi.
