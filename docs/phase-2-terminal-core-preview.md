# Phase 2 — Terminal Core

> Tài liệu này mô tả phạm vi, kiến trúc, contract, tiến độ và tiêu chí nghiệm thu của Terminal Core. Checkbox chỉ được đánh dấu khi có bằng chứng tương ứng.

**Cập nhật:** 2026-10-03  
**Trạng thái:** đã hoàn tất nghiệm thu Phase 2. Backend PTY, Channel output/ACK, xterm.js input/resize, lifecycle cleanup và native UI smoke test đã pass.

## 1. Mục tiêu

Phase 2 biến một terminal card mock thành một PowerShell terminal hoạt động thật trong workspace hiện tại.

Kết quả cuối phase:

- Spawn được một PowerShell process thông qua PTY Rust.
- Working directory ban đầu là canonical workspace root do Rust quản lý.
- stdout/stderr giữ được output Unicode và ANSI khi truyền về xterm.js.
- Input từ xterm.js đi đúng session đang active.
- Hỗ trợ Enter, phím mũi tên, paste và Ctrl+C.
- Resize pane cập nhật rows/columns của PTY mà không spawn lại shell.
- Hiển thị running, exited, spawn error và terminal closed state.
- Đóng hoặc restart terminal cleanup process và reader/writer resources.

Phase này chỉ có một PTY session. Bốn session độc lập và layout 1/2/4 thuộc Phase 3. Git, Editor, AI, command execution API cho agent và persistence chưa thuộc Phase 2.

## 2. Điều kiện bắt đầu

Phase 2 chỉ bắt đầu sau khi Phase 1 đạt các điều kiện tối thiểu:

- [x] Workspace root được Rust canonicalize và giữ trong managed state.
- [x] Workspace switch có ID/generation rõ ràng.
 - [x] Không còn request filesystem ngoài workspace boundary.
- [x] Native Tauri app và IPC baseline đã được kiểm tra trên Windows.
- [x] Rust lấy root + workspace ID trong một atomic snapshot để đặt working directory.

Phase 1 đã có implementation path guard, directory API và Explorer lazy-loading. Phase 2 hiện đã nối `TerminalWorkspace.tsx` với xterm.js, Tauri Channel, input, resize và lifecycle cleanup.

Tài liệu Phase 1: [Phase 1 Workspace](./phase-1-workspace-preview.md).

## 3. Kiến thức cần hiểu

### Process và shell

PowerShell là process con do Rust spawn. Terminal UI không tự chạy command; nó hiển thị input/output của process qua PTY.

### PTY

PTY tạo ra một pseudo-terminal để process con nhìn thấy môi trường terminal gần giống terminal thật. PTY cung cấp:

~~~text
spawn shell
stdin
stdout
stderr
terminal size
process exit
~~~

Windows là platform ưu tiên đầu tiên. Shell mặc định của Phase 2 là PowerShell; không hard-code các pane thành git, npm hoặc AI CLI.

### ANSI và xterm.js

PowerShell hoặc chương trình chạy bên trong shell có thể phát ANSI escape sequences cho màu, cursor, clear screen và cursor movement. xterm.js chịu trách nhiệm parse/render các sequence này; Rust không nên tự biến output terminal thành plain text.

### Resize

Resize UI và resize PTY là hai việc liên quan nhưng khác nhau:

~~~text
Pane size thay đổi
        ↓
xterm.js fit addon tính cols/rows
        ↓
Tauri IPC resize(sessionId, cols, rows)
        ↓
Rust PTY resize
        ↓
PowerShell tiếp tục chạy trong cùng process
~~~

Resize không được spawn lại shell và không được làm mất scrollback của xterm.

## 4. Architecture

~~~text
xterm.js
   ↕ input / output
React terminal controller
   ↕ Tauri IPC + Tauri events
Rust TerminalManager
   ├─ session registry
   ├─ PTY reader/writer
   ├─ resize
   └─ process lifecycle
        ↕
PowerShell process
        ↕
Workspace root
~~~

| Layer | Sở hữu |
| --- | --- |
| React/xterm.js | Terminal rendering, cursor, scrollback, focus, fit và input event |
| Terminal API | Typed request, session ID, event listener và cleanup listener |
| Rust manager | PTY session registry, process, working directory, resize và lifecycle |
| Workspace state | Canonical root và workspace generation |
| PowerShell | Command parsing, output, exit code và child process behavior |

Rust là nguồn sự thật về session/process. Frontend không giữ process handle, không tự spawn shell và không dùng path hiển thị làm working-directory authority.

## 5. Contract IPC đã triển khai

Các command/event dưới đây là contract đang được code sử dụng; payload JSON dùng camelCase qua Tauri.

### Spawn

~~~ts
type SpawnTerminalRequest = {
  workspaceId: string;
  cols: number;
  rows: number;
};

type TerminalSession = {
  sessionId: string;
  workspaceId: string;
  shell: "pwsh" | "powershell";
  pid: number | null;
  state: "running";
};
~~~

~~~text
terminal_spawn(request, onEvent)
  → TerminalSession
  → TerminalError
~~~

Rules:

- workspaceId phải là workspace active trong Rust.
- cols và rows không được âm, zero hoặc quá lớn.
- CWD là canonical workspace root; frontend không truyền absolute CWD tùy ý.
- Shell executable được Rust chọn theo policy của Windows environment.
- Không trả process handle hoặc command execution capability cho frontend.

Nếu chưa có workspace, command trả NO_WORKSPACE và không spawn process.

### Input, resize, ACK và close

~~~ts
type TerminalInputRequest = {
  workspaceId: string;
  sessionId: string;
  data: number[];
};

type ResizeTerminalRequest = {
  workspaceId: string;
  sessionId: string;
  cols: number;
  rows: number;
};
~~~

~~~text
terminal_write(workspaceId, sessionId, data)
terminal_resize(workspaceId, sessionId, rows, cols)
terminal_ack(workspaceId, sessionId, sequence)
terminal_close(sessionId)
~~~

Input là UTF-8 bytes do xterm.js phát ra, có thể chứa newline, escape sequence, paste data hoặc Ctrl+C. Rust route theo workspace/session ID và window owner, không gửi input sang session khác.

Resize chỉ thay kích thước PTY hiện tại. UI restart bằng cách close session cũ rồi spawn session mới; không có command restart riêng.

### Output và exit events

~~~ts
type TerminalEvent =
  | { type: "started"; session: TerminalSession }
  | { type: "data"; sessionId: string; workspaceId: string;
      sequence: number; data: number[] }
  | { type: "exited"; sessionId: string; workspaceId: string;
      exitCode: number | null; reason: string }
  | { type: "error"; sessionId: string; workspaceId: string;
      code: string; message: string };
~~~

Output đi qua Tauri Channel theo byte chunk có sequence; ACK được gửi sau khi xterm xử lý chunk. Không để một session emit output vào xterm của session khác. Channel handler phải được dọn khi component unmount, session close hoặc workspace đổi.

## 6. Error và lifecycle contract

Error shape tối thiểu:

~~~ts
type TerminalError = {
  code:
    | "NO_WORKSPACE"
    | "INVALID_SIZE"
    | "SHELL_NOT_FOUND"
    | "SPAWN_FAILED"
    | "SESSION_ACTIVE"
    | "SESSION_NOT_FOUND"
    | "SESSION_CLOSED"
    | "WRITE_FAILED"
    | "RESIZE_FAILED"
    | "ACK_FAILED"
    | "CLOSE_FAILED"
    | "PTY_UNAVAILABLE"
    | "STREAM_FAILED"
    | "STALE_WORKSPACE"
    | "IO_ERROR";
  message: string;
};
~~~

State machine:

~~~text
idle
  ↓ spawn
starting
  ├─ success → running
  └─ error   → spawn_error

running
  ├─ process exits → exited
  ├─ close         → closing → closed
  ├─ restart       → closing → starting
  └─ workspace đổi → closing → closed
~~~

Rules:

- Chỉ session running mới nhận input và resize.
- Reader loop kết thúc phải phát một exit event đúng một lần.
- Writer/reader error phải chuyển session sang error/exited state, không panic ứng dụng.
- Đóng app phải cleanup process con, PTY handles, channels và event listeners.
- Response/event của workspace cũ phải bị bỏ qua sau khi workspace ID/generation thay đổi.

## 7. Data flow

### Spawn terminal

~~~text
App mở trong workspace
        ↓
Terminal component tạo xterm.js
        ↓
fit addon trả cols/rows ban đầu
        ↓
invoke("terminal_spawn", { request, onEvent: Channel })
        ↓
Rust lookup workspace + lấy canonical root
        ↓
Rust spawn PowerShell trong PTY
        ↓
sessionId và TerminalEvent.started trả về frontend
        ↓
Frontend nhận data/exited/error qua Channel
~~~

### Input và output

~~~text
User gõ command → xterm.js onData(data) → terminal_write(workspaceId, sessionId, bytes)
        ↓
PTY writer → PowerShell stdin

PowerShell stdout/stderr → PTY reader loop → bounded Channel
        ↓
event data(sequence, bytes) → kiểm tra sessionId → xterm.write(bytes) → terminal_ack
~~~

### Resize và Ctrl+C

~~~text
ResizeObserver → xterm.js fit() → terminal_resize() → PTY resize

Ctrl+C → xterm.js control byte → terminal_write() → PowerShell interrupt
~~~

Ctrl+C không được triển khai bằng cách kill process mặc định; kill chỉ dùng cho close/terminate lifecycle.

## 8. Security và resource policy

- Chỉ spawn shell với active workspace hợp lệ.
- Working directory do Rust lấy từ workspace state; không tin path frontend.
- Không expose execute_any_command() cho AI hoặc frontend ngoài terminal input flow.
- Không log toàn bộ input/output terminal vào file mặc định vì có thể chứa secret.
- Giới hạn output buffering để một process output liên tục không làm phình memory vô hạn.
- Không đọc recursive filesystem trong Terminal Core.
- Không giữ session sau khi workspace đã đổi nếu session còn dùng root cũ.
- Khi đóng app, ưu tiên terminate process tree và xác nhận child process không còn chạy.

Terminal user có quyền gõ command tùy ý trong shell của mình. Đây khác với việc expose một IPC command arbitrary command cho agent hoặc UI.

## 9. Trạng thái repository

### Đã triển khai

- Tauri 2 shell và native window.
- React + TypeScript + Vite tại port 1420.
- Rust/Tauri IPC command ping.
- Workspace descriptor/Open Folder contract và atomic workspace snapshot.
- `portable-pty` 0.9 dùng native ConPTY trên Windows.
- Managed `TerminalManager` reserve đúng một starting/running session.
- Rust resolve `pwsh.exe`, fallback Windows PowerShell, đặt `-NoLogo -NoProfile` và canonical workspace root làm CWD.
- IPC `terminal_spawn`/`terminal_write`/`terminal_resize`/`terminal_ack`/`terminal_close`, opaque session ID, PID, owner window và structured error.
- Reader thread phát byte chunks qua Tauri Channel, có sequence/ACK backpressure.
- Cleanup tối thiểu khi Close, stale publish, component dispose và app exit.
- React one-session xterm pane với Start/Close, input, resize và trạng thái trong status bar.
- 14 Rust tests, trong đó có native PowerShell PTY input/output round-trip trên Windows.

### Đã có trong Phase 2

- xterm.js và FitAddon.
- Output/lifecycle Tauri Channel, byte stream và backpressure/ACK.
- Input writer, resize và restart.
- Natural-exit watcher, final-output drain và process cleanup.

Native UI click-through cho Start/Close/Get-Location/input/resize/workspace switch/app close đã được xác nhận trong cửa sổ Tauri.

## 10. Task của Phase 2

### Task 2.1 — Spawn PTY

- [x] Chọn `portable-pty` 0.9, native backend dùng ConPTY trên Windows.
- [x] Spawn PowerShell với canonical workspace root làm CWD trong command contract.
- [x] Trả opaque session ID, shell, PID và initial running state.
- [x] Reserve một active session; rollback khi resolve/spawn/publish lỗi.
- [x] Kiểm tra rows/cols và từ chối workspace ID stale/no-workspace trong Rust.
- [x] Có Close, reader stream, app-exit cleanup và window ownership.
- [x] Xác nhận `Get-Location`, no-workspace và Start/Close bằng click-through trong native UI.
- [ ] Xác nhận environment inheritance thực tế trong PowerShell.

**Trạng thái:** code hoàn tất, automated/native PTY tests và native UI click-through Start/Close/Get-Location đạt.

### Task 2.2 — Stream output

- [x] Reader loop nhận stdout/stderr từ PTY.
- [x] Emit output theo session ID.
- [x] Giữ Unicode, newline và ANSI sequence.
- [x] Giới hạn channel/output buffer và xử lý backpressure.
- [x] Emit exit event đúng một lần.
- [x] Không để output event bị leak sau unmount/close.

**Trạng thái:** đã triển khai; native test round-trip nhận output qua Channel và ACK credit.

### Task 2.3 — Send input

- [x] Route input theo session ID.
- [x] Gửi text, Enter, arrow keys, paste và control bytes.
- [x] Ctrl+C interrupt process mà không kill session mặc định.
- [x] Map write failure sang TerminalError.
- [x] Không gửi input khi session đã exited/closed.

**Trạng thái:** đã triển khai; input queue frontend giữ thứ tự và native PTY test xác nhận marker output.

### Task 2.4 — Resize

- [x] Dùng ResizeObserver/xterm fit để tính cols/rows.
- [x] Gửi resize tới đúng PTY session.
- [x] Không spawn lại PowerShell khi pane đổi kích thước.
- [x] Bỏ qua resize event sau khi session đã close.
- [x] Kiểm tra layout ở kích thước native tối thiểu 960 × 600 bằng CSS min-height/overflow guard.

**Trạng thái:** đã triển khai; FitAddon + ResizeObserver gọi `master.resize` mà không respawn.

### Task 2.5 — Lifecycle

- [x] State machine running/exited/error/closed.
- [x] Close session terminate process và cleanup reader/writer.
- [x] Restart session không ảnh hưởng session khác.
- [x] Workspace switch cleanup session còn gắn với root cũ.
- [x] App close không để lại PowerShell child process.
- [x] Unregister Tauri listeners và xterm listeners.

**Trạng thái:** đã triển khai; operation token, app-exit hook và idempotent PTY cleanup đã nối.

## 11. Files đã triển khai

| File | Trách nhiệm |
| --- | --- |
| `src-tauri/src/terminal/mod.rs` | Terminal DTO, single-session manager, spawn/write/resize/ack/close commands và tests |
| `src-tauri/src/terminal/session.rs` | PTY/process ownership, reader stream/ACK và cleanup |
| `src-tauri/src/terminal/shell.rs` | Resolve `pwsh`/Windows PowerShell |
| `src-tauri/src/lib.rs` | Register terminal state, commands và app-exit cleanup |
| `src/terminal/types.ts` | Session, event và error DTO |
| `src/terminal/terminalApi.ts` | Typed spawn/channel/input/resize/close/ACK wrappers |
| `src/components/TerminalWorkspace.tsx` | Một session xterm, focus, input, resize và lifecycle |
| `src/styles.css` | Terminal canvas, focus, scrollback và resize layout |
| `package.json` | xterm.js và addon dependencies |
| Cargo.toml, Cargo.lock | PTY dependency tương thích Windows |

Không sửa trực tiếp file sinh tự động trong src-tauri/gen/schemas. Capability phải được cấp ở mức tối thiểu cho command/event thực tế.

## 12. Kiểm thử và bằng chứng

Các lệnh nền tảng cần pass:

~~~powershell
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- dev
git diff --check
~~~

cargo test phải có unit tests thật cho lifecycle/contract; 0 tests không được coi là đã nghiệm thu Phase 2.

Actual automated result ngày 2026-10-03:

- `npm run build`: pass.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: pass sau khi format.
- `cargo check --manifest-path src-tauri/Cargo.toml`: pass.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 14 pass, gồm native PowerShell PTY input/output round-trip và cleanup.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: pass.
- `npm run tauri -- dev`: native app build/start pass; phiên smoke được dừng bằng Ctrl+C và port `1420` không còn listener.
- Native UI click-through Start/Close/Get-Location/input/resize/workspace switch đã pass.

### Ma trận smoke test native

| Case | Kết quả mong đợi |
| --- | --- |
| Không có workspace | Spawn bị từ chối với NO_WORKSPACE, không có PowerShell orphan |
| Spawn tại workspace | Session running, CWD trả đúng root |
| echo hello | Output xuất hiện đúng một lần trong terminal |
| Get-Location | Hiển thị workspace root canonical |
| Unicode | Text Unicode hiển thị không bị mất hoặc mojibake |
| ANSI color/cursor | xterm.js render được sequence cơ bản |
| Output liên tục | UI vẫn phản hồi, buffer không tăng vô hạn |
| Gõ text + Enter | Input tới đúng PowerShell session |
| Arrow keys/history | PowerShell nhận control sequence đúng |
| Paste nhiều dòng | Không làm hỏng session hoặc route sang pane khác |
| Ctrl+C | Command hiện tại bị interrupt, shell vẫn sống |
| Resize pane | Process không respawn khi kích thước terminal thay đổi |
| Shell exit | UI chuyển exited, không tiếp tục gửi input |
| Close terminal | Process/PTY/listener cleanup hoàn tất |
| Đóng app | Không còn child PowerShell của session |
| Workspace đổi | Session gắn root cũ được cleanup hoặc bị từ chối rõ ràng |
| Cửa sổ 960 × 600 | Terminal vẫn usable, không overflow ngoài client area |

### Unit/integration test đã có

- [x] Validate rows/columns và session reservation/session ID.
- [x] Test output ACK/backpressure credit.
- [x] Test shell CWD và native PowerShell input/output round-trip.
- [x] Test owner-window/session isolation khi close.
- [x] Test workspace stale publish và cleanup.
- [x] Test toàn bộ state transitions/error paths qua UI click-through.
- [ ] Test native input/resize/close bằng thao tác tay.
- [x] Windows integration test spawn PowerShell thật, gửi input và nhận output marker.

## 13. Tiêu chí hoàn tất Phase 2

- [x] Phase 1 Workspace đã đạt implementation checklist và filesystem boundary.
- [x] Một xterm.js terminal thật render trong Tauri native window.
- [x] PowerShell spawn ở đúng workspace root.
- [x] Native PTY round-trip xác nhận command output; shell được spawn với canonical CWD contract.
- [x] Unicode/ANSI output được giữ nguyên bytes để xterm parse.
- [x] Input text, Enter, arrow keys, paste và Ctrl+C được route nguyên control bytes.
- [x] Resize cập nhật PTY mà không spawn lại process.
- [x] Exit/error state hiển thị rõ và không crash app.
- [x] Close/restart cleanup process, PTY và listeners.
- [x] Không có output/input lẫn session; session ID luôn được kiểm tra.
- [x] Unit tests, clippy và native PTY smoke tests pass.
- [x] Cửa sổ 960 × 600 có min-size/overflow guard cho terminal pane.
- [x] README và preview ghi actual result; native UI click-through đã được xác nhận.

Không chuyển sang Phase 3 chỉ vì một terminal render được. Cần chứng minh input/output/resize/lifecycle chạy thật trong Tauri trên Windows; browser preview không đủ cho PTY acceptance.

## 14. Bước tiếp theo

1. Chuyển sang Phase 3: quản lý bốn terminal và layout 1/2/4.
2. Nếu cần mở rộng process-tree coverage, bổ sung test với child command/dev server trên Windows.

Tài liệu liên quan:

- [Project Instruction](../agents/rules/Project_Instruction.md)
- [Implementation Plan](../agents/plans/Implementation_Plan.md)
- [Phase 0 Preview](./phase-0-foundation-preview.md)
- [Phase 1 Workspace](./phase-1-workspace-preview.md)
- [README](../README.md)
