# Kế hoạch Phase 2 — Terminal Core

Ngày lập: 2026-10-03. Trạng thái: **đã hoàn tất nghiệm thu Phase 2; automated và native UI smoke test đều pass**.

Nguồn yêu cầu: [Project Instruction](../rules/Project_Instruction.md), mục 5, 23, 24, 27 và 28; thứ tự task theo [Implementation Plan](Implementation_Plan.md#phase-2--terminal-core).

## 1. Mục tiêu và điều kiện bắt đầu

Sau Phase 2, Vibe Rider có **một terminal PowerShell hoạt động thật trong workspace**. Người dùng nhập lệnh, xem output, dùng phím tương tác, thay đổi kích thước và đóng/restart terminal. Terminal vẫn là vùng chính; Explorer/Git nằm ở panel phải.

Hiện trạng đã đối chiếu với repository:

- `TerminalWorkspace.tsx` đã chuyển từ bốn card mock sang control cho một PTY session.
- `StatusBar.tsx` phản ánh trạng thái session idle/starting/running/closing/exited/error.
- Rust có atomic workspace snapshot, `portable-pty`, `TerminalManager`, spawn/write/resize/ack/close commands.
- PowerShell spawn tại canonical root; reader phát byte chunks qua Tauri Channel với sequence và bounded ACK flow.
- `@xterm/xterm`, `@xterm/addon-fit`, output Channel, input UTF-8 và resize đã tích hợp.
- `main.tsx` dùng React StrictMode; spawn chỉ xảy ra từ user action và có operation token/cleanup.

[Phase 1](../../docs/phase-1-workspace-preview.md) đã hoàn tất implementation và native picker click-through. Phase 2 đã hoàn thiện backend/frontend contract và native UI smoke test.

## 2. Phạm vi và quyết định thiết kế

| Hạng mục | Quyết định Phase 2 |
| --- | --- |
| Session | Một PTY active; Rust vẫn cấp `sessionId` riêng để mở rộng ở Phase 3 |
| Giao diện | Thay grid mock bằng một pane thật, status bar chỉ phản ánh session đang có |
| Shell | PowerShell; ưu tiên `pwsh.exe` từ PATH, fallback Windows PowerShell ở system directory do Rust resolve |
| Startup | Sau khi mở workspace, người dùng bấm Start Terminal; mặc định `-NoLogo -NoProfile`, chưa có shell settings |
| CWD | Canonical root lấy từ Rust workspace snapshot, không nhận `cwd` tùy ý từ frontend |
| Environment | Kế thừa môi trường app/PATH; chưa có environment editor, không log toàn bộ environment |
| Backend | `portable-pty` và managed `TerminalManager` trong Rust |
| Frontend | `@xterm/xterm`, `@xterm/addon-fit`, import stylesheet chính thức |
| IPC | Commands cho spawn/input/resize/close/ack; Channel cho output và lifecycle |
| Encoding | Truyền bytes, xterm nhận `Uint8Array`; input Unicode encode UTF-8 |
| Restart | Close session cũ hoàn tất rồi spawn session mới, không tự chạy lại command cũ |
| Chưa thuộc phase | Bốn session, layout 1/2/4, persistence, editor, Git operations và AI run-command |

Đây là terminal để người dùng thao tác shell trực tiếp. Workspace root đặt **working directory ban đầu**, không phải sandbox ngăn PowerShell truy cập các path khác. Quyền filesystem của Explorer và quyền chạy command của AI vẫn đi qua các boundary riêng trong roadmap.

Trên Windows, `portable-pty` dùng ConPTY; xterm.js render terminal ở WebView. PTY và terminal renderer là hai trách nhiệm khác nhau. [portable-pty source](https://docs.rs/crate/portable-pty/latest/source/src/lib.rs), [Microsoft ConPTY](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session).

Khi thiếu cả hai PowerShell executable hoặc ConPTY không tạo được, trả lỗi có mã và cho retry. Không tự đổi sang shell khác hoặc thay execution policy. Dependency versions sẽ được resolve và khóa bằng lockfile khi triển khai; phiên lập plan không cài package.

## 3. Kiến thức cần hiểu

| Concept | What / Why / How trong feature này |
| --- | --- |
| Process | PowerShell là process con do Rust tạo; ID và handle dùng để theo dõi/đóng session |
| Shell | PowerShell nhận phím và diễn giải lệnh; frontend không parse lệnh người dùng |
| PTY | Tạo môi trường terminal tương tác cho shell, cung cấp input/output và kích thước |
| stdin / stdout / stderr | Ghi input vào PTY; output hiển thị là stream terminal chung, không thiết kế hai log pane cho stdout/stderr |
| ANSI / VT sequences | Bytes có thể là màu, cursor, clear screen hoặc text; để xterm parse, không strip ANSI |
| Unicode streaming | Một ký tự UTF-8 có thể bị chia giữa hai chunk; không decode từng chunk bằng chuỗi lossy |
| Blocking IO | Read/write/wait có thể chờ lâu; tách worker và lock để UI, resize, close vẫn phản hồi |
| Backpressure | Producer nhanh hơn renderer cần bị điều tiết; scrollback limit không đủ để giới hạn IPC queue |
| Lifecycle | Pane, Channel, PTY và shell phải có owner và đường cleanup riêng |

## 4. Architecture và ownership

```text
User / TerminalPane
        ↕
xterm + FitAddon
        ↕ terminalApi / terminalController
Tauri IPC
  ├─ invoke: spawn, write, resize, close, ack
  └─ Channel: started, data, exited, error
        ↕
Rust TerminalManager
  ├─ Workspace snapshot + shell resolution
  ├─ Session: master PTY, writer, child/killer, owner IDs
  ├─ Output reader + bounded stream dispatcher
  └─ Lifecycle / process cleanup
        ↕
Windows ConPTY ↔ PowerShell ↔ user commands
```

Rust giữ PTY handles, process handles và active-session reservation. React chỉ giữ descriptor/state hiển thị. Xterm instance, input subscriptions và ResizeObserver nằm ở controller/ref; không lưu chúng hoặc toàn bộ output vào Zustand/React state.

Các giới hạn ownership:

- Workspace snapshot trả root + ID bằng một lock và lỗi rõ ràng; không dùng `Option` để gộp lock error với no-workspace.
- Session giữ `workspaceId`, `sessionId` và window owner; input/resize chỉ hợp lệ cho session đang chạy của workspace hiện tại.
- Reserve một slot `starting` trước khi spawn; hai request đồng thời không được tạo hai shell.
- Workspace commit và bước kiểm tra/publish session dùng cùng cơ chế phối hợp; kiểm tra ID rồi thả lock trước khi publish không đủ để loại race với workspace switch. Không giữ lock này qua blocking spawn hoặc teardown.
- Read loop chạy trên thread riêng. Write IO và child wait không dùng chung lock với reader/manager; không giữ manager lock trong lúc IO, chờ exit hoặc gửi Channel.
- Có thể tách killer handle khỏi child đang wait để close không bị kẹt sau wait lock. [portable-pty ChildKiller](https://docs.rs/portable-pty/latest/portable_pty/trait.ChildKiller.html).
- Clone reader và lấy writer theo API PTY; `take_writer` chỉ lấy một lần, resize dùng master hiện tại. [portable-pty MasterPty](https://docs.rs/portable-pty/latest/portable_pty/trait.MasterPty.html).

## 5. Contract IPC đã triển khai

JSON dùng camelCase, IDs là opaque strings do Rust cấp. Channel phải gắn handler **trước khi** invoke spawn để không mất prompt đầu tiên. Tauri Channel được dùng cho streaming và thứ tự message trong stream. [Tauri Channels](https://v2.tauri.app/develop/calling-frontend/#channels).

```ts
type TerminalSession = {
  sessionId: string;
  workspaceId: string;
  shell: "pwsh" | "powershell";
  pid: number | null;
  state: "running";
};

type TerminalEvent =
  | { type: "started"; session: TerminalSession }
  | { type: "data"; sessionId: string; workspaceId: string;
      sequence: number; data: number[] }
  | { type: "exited"; sessionId: string; workspaceId: string;
      exitCode: number | null; reason: string }
  | { type: "error"; sessionId: string; workspaceId: string;
      code: string; message: string };

type TerminalError = { code: string; message: string };
```

`data` là byte values 0–255, serialize dạng array trong bước đầu; frontend chuyển thành `Uint8Array`. Không coi `Vec<u8>` JSON là binary transport tự động. Chỉ đổi sang raw binary Channel nếu đo đạc cho thấy cần thiết.

| Command | Input | Success / semantics |
| --- | --- | --- |
| `terminal_spawn` | `{ workspaceId, rows, cols, onEvent: Channel<TerminalEvent> }` | Trả `TerminalSession`; gửi `started` trước mọi data; chỉ nhận workspace active |
| `terminal_write` | `{ workspaceId, sessionId, data: number[] }` | Ghi bytes vào writer theo thứ tự; không thêm newline hay parse command |
| `terminal_resize` | `{ workspaceId, sessionId, rows, cols }` | Resize master PTY hiện có; không tạo process mới |
| `terminal_ack` | `{ workspaceId, sessionId, sequence }` | ACK cộng dồn cho bytes xterm đã parse; duplicate ACK là no-op, ACK vượt sequence đã gửi bị từ chối |
| `terminal_close` | `{ sessionId }` | Close đúng session thuộc window owner; idempotent với session đã đóng, dùng được khi workspace vừa đổi |

Spawn không nhận executable, command line, arbitrary cwd hoặc environment từ frontend. Validate integer rows/cols trong giới hạn hợp lý, byte values và input size; initial size dùng pane đã đo, hoặc `80 × 24` nếu chưa đo được.

Error codes: `NO_WORKSPACE`, `STALE_WORKSPACE`, `SESSION_ACTIVE`, `SESSION_NOT_FOUND`, `SESSION_CLOSED`, `SHELL_NOT_FOUND`, `INVALID_SIZE`, `INVALID_INPUT`, `PTY_UNAVAILABLE`, `SPAWN_FAILED`, `WRITE_FAILED`, `RESIZE_FAILED`, `STREAM_FAILED`, `CLOSE_FAILED`.

## 6. Data flow

### Spawn

```text
User bấm Start Terminal
  → controller tạo Channel và gắn onmessage
  → terminal_spawn(workspaceId, size, Channel)
  → Rust reserve slot + snapshot workspace + resolve shell
  → openpty → spawn shell tại root → tạo reader/writer/child owner
  → kiểm tra workspace ID vẫn khớp; nếu stale thì cleanup process vừa tạo
  → publish session → Channel started → reader bắt đầu stream
  → UI hiển thị running
```

Nếu stream tới trước invoke response, controller dùng `started` trên Channel để nhận session. Mỗi spawn có token riêng; response của một lần start đã bị cancel không được nối vào pane mới, session về muộn phải được đóng.

### Input và output

```text
User phím/paste
  → xterm.onData → TextEncoder → input queue tuần tự
  → terminal_write → PTY writer → PowerShell

PowerShell / command output
  → PTY reader → Channel data(bytes, sequence)
  → xterm.write(Uint8Array, callback)
  → callback gửi terminal_ack → Rust giải phóng credit
```

Không local echo bằng React/xterm trước khi shell trả output. Enter, arrows, Backspace và Ctrl+C giữ nguyên escape/control sequence từ xterm; Ctrl+C thường là input byte `0x03`, không đồng nghĩa Close Terminal.

Xterm hỗ trợ UTF-8 byte arrays và decoder giữ trạng thái giữa chunks; test phải chia Unicode thành nhiều chunk. [xterm Encoding](https://xtermjs.org/docs/guides/encoding/).

### Resize

```text
Pane đổi kích thước → ResizeObserver → FitAddon.fit()
  → đọc rows/cols mới → terminal_resize → master.resize()
```

Coalesce bằng animation frame, chỉ gửi size đã thay đổi, bỏ qua container 0 × 0. Render/fit và native resize phải cùng geometry; shell PID không thay đổi. [xterm addons](https://xtermjs.org/docs/guides/using-addons/).

## 7. Stream limits và lifecycle

### Giới hạn ban đầu để kiểm chứng

- Read chunk khoảng 4–16 KiB; gộp các chunk nhỏ, không emit từng character.
- Queue Rust giới hạn theo bytes, dự kiến 256 KiB; in-flight output chưa ACK dự kiến tối đa 512 KiB/session.
- Khi hết credit, pause việc chuyển thêm output; không tạo queue vô hạn. ACK cập nhật credit, input/resize/close vẫn dùng đường điều khiển độc lập.
- Xterm scrollback ban đầu 5.000 lines; output không được sao chép toàn bộ vào app store hoặc log.
- Input chunk tối đa 16 KiB; paste lớn chia chunk và serialize theo thứ tự, Close hủy input chưa gửi.
- `write` callback là ACK sau khi parser xử lý; ACK được gộp để giảm số IPC calls. Không ACK chỉ vì nhận event.

Các số trên là lựa chọn thiết kế ban đầu, cần đo trên WebView2 thật. Xterm `write` tự buffer nên một producer nhanh có thể làm queue tăng; cần flow control ngoài scrollback. [xterm Flow Control](https://xtermjs.org/docs/guides/flowcontrol/).

### State machine

```text
idle → starting → running → closing → exited
          └─ error   └─ natural exit → exited

exited / error → user Restart → starting với sessionId mới
```

Natural exit giữ nội dung terminal để user xem; input bị disable. Output cuối phải được drain và parse trước khi hiển thị trạng thái kết thúc. Không tự restart shell hoặc chạy lại lệnh cũ.

Channel `exited` đến sau data cuối nhưng xterm parse bất đồng bộ: controller chờ callback của các `write` đã nhận rồi mới cập nhật trạng thái hiển thị kết thúc. Nếu pane đã dispose, bỏ barrier UI và hoàn tất cleanup native độc lập.

Close, restart, đổi workspace và đóng cửa sổ đi qua cùng cleanup routine:

1. Mark closing, chặn input/spawn mới và hủy input chưa gửi.
2. Giải phóng các worker đang chờ credit; trong teardown tiếp tục drain output, không chờ frontend ACK vô hạn.
3. Kết thúc shell/session, giữ reader hoạt động để ConPTY có thể flush frame cuối.
4. Chờ exit/EOF trên worker với deadline, đóng PTY handles và thu hồi reader/writer/wait tasks.
5. Bỏ slot active, gửi lifecycle khi consumer còn tồn tại; Close lần nữa không gây crash.

ConPTY close có thể sinh output cuối và làm deadlock nếu không drain IO; cleanup phải được kiểm chứng với process tree. [Microsoft pseudoconsole teardown](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session#ending-the-pseudoconsole-session).

Nghiệm thu cleanup gồm PowerShell và child command/dev server đang chạy. Không coi kill một PID là bằng chứng cho cả tree. Nếu teardown ConPTY chưa thu hồi được process thuộc session trong case thực tế, bổ sung Windows Job Object ownership trong Task 2.5 trước khi nghiệm thu. [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).

### React và workspace lifecycle

- Start là user action, không gọi spawn từ render hoặc mount effect. StrictMode mount/unmount không được sinh hai shell.
- Controller dispose input subscriptions, observer, xterm và Channel handler; spawn đang pending có token để session về muộn được cleanup.
- Switch Git/Explorer không unmount terminal hoặc đổi session.
- Cancel folder picker giữ terminal đang chạy. Chọn workspace mới hợp lệ thì đóng session cũ trước khi commit workspace mới; cleanup thất bại giữ workspace cũ và báo lỗi.
- Native window-close/app-exit hook gọi Rust cleanup; không dựa riêng vào React effect hoặc `beforeunload`.
- HMR/remount phải thu hồi session cũ trước khi cho Start mới; Channel lỗi cũng đưa session vào cleanup.

## 8. Files cần tạo/sửa

Chỉ tạo file khi task đến responsibility tương ứng; không sinh trước hệ thống multi-session.

| File | Responsibility |
| --- | --- |
| `src-tauri/src/terminal/mod.rs` | Terminal DTOs, IPC commands và manager một session |
| `src-tauri/src/terminal/session.rs` | PTY, reader/writer/child, output credit và cleanup |
| `src-tauri/src/terminal/shell.rs` | Resolve PowerShell executable, startup arguments và environment |
| `src-tauri/src/workspace.rs` | Snapshot root + ID atomic; phối hợp teardown khi commit workspace mới |
| `src-tauri/src/lib.rs` | Register terminal state/commands và native close hooks |
| `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` | Thêm `portable-pty`; Windows dependency chỉ khi cleanup cần |
| `src/terminal/types.ts` | Session/error/event contract |
| `src/terminal/terminalApi.ts` | Typed invoke, tạo Channel, write/resize/close/ack |
| `src/terminal/terminalController.ts` | Xterm adapter, input/output queues, start token và disposables |
| `src/components/TerminalPane.tsx` | DOM host, Start/Close/Restart, focus và lifecycle UI |
| `src/components/TerminalWorkspace.tsx` | Một terminal thật thay grid mock; layout 1/2/4 để Phase 3 |
| `src/App.tsx`, `src/components/StatusBar.tsx`, `src/styles.css` | Nối workspace/session status, pane styles và overflow |
| `package.json`, `package-lock.json` | Thêm `@xterm/xterm`, `@xterm/addon-fit`; tái sử dụng Zustand từ Phase 1 nếu cần |
| `docs/phase-2-terminal-core-preview.md`, `README.md` | Ghi actual evidence, giới hạn và hướng dẫn sau khi triển khai |

Nếu shared terminal state cần cho pane/status bar, tạo store nhỏ chỉ giữ descriptor/state. Không đưa output, xterm instance hoặc native handles vào store.

## 9. Task triển khai và điểm kiểm chứng

| Task | Công việc | Kết quả phải kiểm chứng |
| --- | --- | --- |
| **2.1 — Spawn PTY** | Chốt contract, thêm dependency, atomic workspace snapshot, resolve PowerShell, reserve slot, open PTY và rollback khi spawn lỗi | Một PowerShell tại đúng root; ID/PID, size/env đúng; no-workspace/stale/double-spawn bị chặn; có close routine tối thiểu để kiểm tra không để process |
| **2.2 — Stream output** | Channel gắn trước spawn, reader/pump, byte chunks, xterm pane, credit/ACK và stream errors | Prompt đầu không mất; Unicode/ANSI không bị hỏng; output flood không tăng queue vô hạn |
| **2.3 — Send input** | `onData`, UTF-8 bytes, tuần tự write/paste, validate ID và hủy pending input | Enter/arrows/Backspace/paste đúng; Ctrl+C ngắt lệnh và quay lại prompt; không echo hai lần |
| **2.4 — Resize** | FitAddon, ResizeObserver, coalesce và PTY resize | Geometry cập nhật khi pane/window đổi; wrap/cursor đúng; PID không thay đổi; zero-size không crash |
| **2.5 — Lifecycle** | Exit/drain, close/restart, process tree cleanup, native-close hooks, workspace switch, StrictMode/HMR và status bar | Exit code/state đúng; session cũ không ảnh hưởng session mới; close khi output đang dồn không deadlock; shell và child process được thu hồi |

Tiến độ thực tế: Phase 2 đã implement `portable-pty`, atomic workspace snapshot, shell resolution, single-session reservation, owner-window validation, spawn/write/resize/ack/close IPC, Channel byte stream với ACK backpressure, xterm.js và idempotent cleanup. Automated verification và native UI click-through đã pass.

Thứ tự đã hoàn tất: `Phase 1 nghiệm thu → 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → automated Phase 2 verification`.

Cleanup tối thiểu bắt đầu từ 2.1; giới hạn stream bắt đầu từ 2.2. Không đợi đến 2.5 mới có cách kết thúc process hoặc giới hạn output.

Phase 2 đã hoàn tất nghiệm thu. Kiểm tra process-tree sâu hơn chỉ là hardening tùy chọn trước khi mở rộng Phase 3.

## 10. Kế hoạch kiểm thử và nghiệm thu

Unit tests chỉ tập trung vào contract và concurrency có rủi ro: snapshot/stale ID, reservation, input ordering, credit/ACK, sequence ownership và cleanup idempotency. Native integration tests phải dùng PTY thật và temporary workspace, cleanup kể cả khi assertion fail; không để shell/dev server chạy sau test.

| Case | Expected result |
| --- | --- |
| Chưa mở workspace / root bị xóa | Không spawn; UI có lỗi và action phù hợp |
| Workspace có dấu/khoảng trắng | `Get-Location` trỏ đúng folder, không lỗi quoting |
| `echo hello` | Hiện `hello` và prompt mới, không echo giả |
| `[Console]::WriteLine('Tiếng Việt 😀')` | Unicode đúng; test split bytes giữa chunks vẫn giữ ký tự |
| stdout/stderr và ANSI | Text/error hiển thị trong terminal; màu/cursor/clear screen đúng |
| Arrows, Backspace, history, paste nhiều dòng | Input đúng thứ tự; không đảo chunk hoặc tự thêm Enter |
| Lệnh output liên tục rồi Ctrl+C | Ngắt command và trở lại prompt; shell không bị đóng |
| Output flood hữu hạn, parser ACK chậm | Queue/in-flight giữ giới hạn; marker cuối không mất; close vẫn phản hồi |
| Resize nhanh, minimize/restore | Không spawn lại; `$Host.UI.RawUI.WindowSize`/wrapping phản ánh size mới |
| `exit 7` | Drain output cuối, hiển thị exited/code 7, input bị disable |
| Close/Restart lúc prompt hoặc đang chạy node server | Session cũ và process thuộc session được đóng; restart có ID mới |
| Đổi workspace trong lúc spawn đang pending | Process về muộn được cleanup; CWD/session của workspace mới không lẫn |
| Cancel folder picker / switch Git ↔ Explorer | Shell và buffer vẫn giữ nguyên |
| StrictMode / HMR / remount | Không có hai shell sống hoặc listener trùng |
| Close app khi output đang dồn/chờ ACK | Native cleanup không deadlock, không để PowerShell/child process thuộc session |
| PowerShell thiếu / IPC/Channel lỗi | Error có mã, partial spawn rollback; không retry loop vô hạn |
| Browser preview | Chỉ kiểm tra rendering; native terminal actions báo chưa có native runtime |

Lệnh kiểm tra sau implementation:

```powershell
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- dev
git diff --check
```

Checklist hoàn tất Phase 2:

- [x] Phase 1 đã có implementation filesystem boundary.
- [x] Một PowerShell PTY chạy tại workspace root và có session ID riêng.
- [x] Prompt/output streaming giữ Unicode, ANSI và thứ tự, có giới hạn queue/ACK.
- [x] Nhập/paste/Ctrl+C hoạt động; input chỉ đi tới session hợp lệ.
- [x] Resize pane → xterm → PTY không đổi PID.
- [x] Exit/Close/Restart hiển thị đúng trạng thái và thu hồi handles/workers/process thuộc session.
- [x] Workspace switch, cancel picker, StrictMode/HMR và native window close đã được kiểm tra.
- [x] Frontend build và Rust format/check/test/clippy đạt; native PTY smoke test có actual results.
- [x] README/preview ghi đúng implementation và native UI smoke result.
- [x] Terminal có min-size/overflow guard để usable ở cửa sổ native tối thiểu 960 × 600.

Evidence ngày 2026-10-03: `npm run build`, Rust format/check/test (14 tests), clippy `-D warnings`, native PowerShell PTY input/output round-trip, Tauri native startup và native UI click-through Start/Close/Get-Location/input/resize/workspace switch đều pass.

## 11. Kiến thức đạt được và bàn giao Phase 3

Sau Phase 2 cần giải thích được PowerShell khác PTY/xterm thế nào, input/output đi qua đâu, vì sao UTF-8 không decode từng chunk, vì sao scrollback không thay backpressure và vì sao process lifecycle không phụ thuộc vào render lifecycle.

Phase 3 tái sử dụng session ID, contract IO và cleanup routine để mở rộng `TerminalManager` thành nhiều session độc lập rồi thêm layout 1/2/4. Việc ẩn pane ở Phase 3 phải tách khỏi Close session; không tự terminate process chỉ vì pane tạm không hiển thị.
