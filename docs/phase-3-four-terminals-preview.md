# Phase 3 — Four Terminals

> Tài liệu này mô tả phạm vi, kiến trúc, contract, tiến độ và tiêu chí nghiệm thu của multi-terminal workspace. Checkbox chỉ được đánh dấu khi có implementation và bằng chứng tương ứng.

**Cập nhật:** 2026-10-03  
**Trạng thái:** implementation cốt lõi đã hoàn tất; native multi-pane verification đang chờ. Phase 2 Terminal Core đã hoàn tất một PTY session; Phase 3 đã mở rộng thành bốn session độc lập.

Kế hoạch triển khai chi tiết và các quyết định chung: [Phase 3 Four Terminals Plan](../agents/plans/Phase_3_Four_Terminals_Plan.md). Automated checks đã có actual result; native multi-pane click-through/full smoke matrix chưa được đánh dấu pass.

## 1. Mục tiêu

Phase 3 biến Terminal Core một pane thành workspace có tối đa bốn PowerShell terminal độc lập. Người dùng có thể tạo, chọn, đóng, restart và tương tác với từng session mà không làm lẫn input/output hoặc lifecycle của session khác.

Kết quả cuối phase:

- Có bốn pane cố định T1–T4, mặc định grid 2 × 2; tối đa bốn PTY session trong app một cửa sổ, tính cả starting/closing.
- Mỗi session có sessionId, paneId, workspace ID, owner, shell, PID và lifecycle riêng.
- Phím người dùng đi đến pane đang được focus; terminal replies đi đến session sở hữu xterm tương ứng, kể cả pane ẩn.
- Output, exit event và lỗi được route đúng pane.
- Layout hỗ trợ 1, 2 và 4 terminal.
- Đổi layout chỉ ẩn/hiện pane; không tự terminate session bị ẩn.
- Close/restart một session không ảnh hưởng các session còn lại.
- Đổi workspace hoặc đóng app cleanup toàn bộ session thuộc workspace cũ.

Phase này chưa bao gồm Git, Editor, AI, persistence, terminal tabs, remote shell hoặc arbitrary command API cho agent.

## 2. Điều kiện bắt đầu

- [x] Phase 1 có workspace ID, canonical root và Explorer boundary.
- [x] Phase 2 có PTY spawn/write/resize/ACK/close cho một session.
- [x] Phase 2 có xterm.js, Channel output và cleanup routine.

Phase 1/2 đã được ghi nhận nghiệm thu trong tài liệu và người dùng xác nhận native UI chạy được. Kiểm chứng cleanup shell/child command/dev server nằm trong Task 3.5, không phải yêu cầu người dùng nghiệm thu lại Phase 2.

Phase 3 đã triển khai trên contract Phase 2 hiện tại. Không thay đổi quyền filesystem của Explorer để phục vụ multi-terminal.

## 3. Phạm vi và quyết định thiết kế

| Hạng mục | Quyết định Phase 3 |
| --- | --- |
| Session count | Tối đa 4 slots starting/running/closing trong app một cửa sổ; backend enforce capacity |
| Session identity | Rust cấp sessionId opaque; React không tự tạo ID làm authority |
| Pane identity | T1–T4 cố định; Restart giữ paneId nhưng thay sessionId |
| Ownership | Mỗi session lưu workspaceId và window owner; command phải kiểm tra cả hai |
| Layout | Mặc định 4; hỗ trợ 1/2/4; chỉ đổi visibility, giữ xterm/process/buffer |
| Focus | Một pane nhận phím người dùng; terminal replies và output route theo session sở hữu xterm |
| Startup | Không tự spawn bốn shell khi app render; người dùng tạo session bằng action rõ ràng |
| Close | Chỉ cleanup session tương ứng, giữ pane và output cuối |
| Restart | Close hoàn tất rồi reset buffer/spawn session mới; session ID mới |
| Workspace switch | Validate candidate trước cleanup; Cancel giữ session; chỉ commit sau cleanup toàn bộ thành công |
| Right panel | Git/Explorer giữ nguyên; switch panel không làm mất session |
| Persistence | Chưa lưu layout hoặc session sau restart app |

Session manager là nguồn sự thật về process. React giữ danh sách descriptor và UI state; không giữ process handle, PTY handle hoặc output toàn bộ trong React state/store.

## 4. Kiến trúc

~~~text
TerminalWorkspace
  ├─ Layout state: 1 / 2 / 4
  └─ TerminalPane × 4, luôn mounted với key = paneId
        ↕
  terminal controller / API
        ↕
  Tauri IPC + Channel
        ↕
  TerminalManager
    ├─ session_id → TerminalSlot (starting/running/closing)
    ├─ owner/workspace validation
    ├─ output routing
    └─ close/restart cleanup
        ↕
  PowerShell PTY sessions
~~~

### Ownership

| Layer | Sở hữu |
| --- | --- |
| React layout | Layout mode, focus pane, visible panes và selected session |
| Terminal pane | Xterm instance, input subscription, resize observer và view state |
| Terminal API | Typed command/event wrapper và Channel lifecycle |
| Rust TerminalManager | Map session, reservation, ownership, process và cleanup |
| RunningSession | PTY master, writer, reader, child process và output flow |
| WorkspaceState | Active workspace ID và canonical root |

Ẩn một pane không gọi close; Close chỉ xảy ra khi user action, workspace switch, app exit hoặc lifecycle error yêu cầu.

## 5. Layout contract

~~~ts
type TerminalLayout = 1 | 2 | 4;
type TerminalPaneId = "T1" | "T2" | "T3" | "T4";

type TerminalSlot = {
  paneId: TerminalPaneId;
  sessionId: string | null;
};

type TerminalWorkspaceState = {
  layoutMode: TerminalLayout;
  activePaneId: TerminalPaneId;
  visiblePaneIds: TerminalPaneId[];
  panes: Record<TerminalPaneId, TerminalSlot>;
};
~~~

Layout semantics:

- Layout 1: pane active visible; chọn T1–T4 đổi pane visible, không đóng session còn lại.
- Layout 2: khi vào mode, hiện pane active và pane kế tiếp theo vòng T1 → T2 → T3 → T4 → T1. Click pane đang visible chỉ đổi focus; chọn pane ẩn cập nhật cặp visible.
- Layout 4: T1/T2 trên, T3/T4 dưới theo grid 2×2; đây là mode mặc định.
- Chuyển 1 → 4 khôi phục các session ẩn với cùng sessionId, không spawn lại.
- Bốn pane giữ component/xterm với key cố định qua mọi mode; pane ẩn vẫn parse output và ACK, không fit container zero-size.
- Slot rỗng hiển thị Start action, không được gọi spawn từ render/effect.
- Focus pane được đánh dấu rõ ràng; input không dựa vào vị trí DOM hoặc thứ tự mảng tình cờ.

## 6. Session contract

Rust giữ các command Phase 2 và mở rộng manager từ một slot sang map session:

~~~ts
type TerminalSession = {
  sessionId: string;
  workspaceId: string;
  paneId: TerminalPaneId;
  shell: "pwsh" | "powershell";
  pid: number | null;
  state: "running" | "exited";
};

type TerminalEvent =
  | { type: "started"; session: TerminalSession }
  | { type: "data"; sessionId: string; workspaceId: string; paneId: TerminalPaneId;
      sequence: number; data: number[] }
  | { type: "exited"; sessionId: string; workspaceId: string; paneId: TerminalPaneId;
      exitCode: number | null; reason: string }
  | { type: "error"; sessionId: string; workspaceId: string; paneId: TerminalPaneId;
      code: string; message: string };
~~~

Commands giữ semantics Phase 2:

| Command | Bổ sung Phase 3 |
| --- | --- |
| terminal_spawn | Request có paneId; reserve atomic, reject pane trùng/capacity 4; trả session ID mới |
| terminal_write | Route theo workspaceId + sessionId + owner |
| terminal_resize | Resize đúng master PTY, không ảnh hưởng session khác |
| terminal_ack | ACK đúng output flow của session |
| terminal_close | Giữ closing marker đến khi cleanup xong; duplicate close idempotent; các session khác tiếp tục chạy |
| terminal_list — mới | Snapshot starting/running/closing của window/workspace để reconcile |
| terminal_close_workspace — mới | Cleanup toàn bộ slot/reservation của window/workspace tương ứng |

Không dùng paneId làm permission boundary. PaneId chỉ là vị trí UI; session ID và workspace/owner validation mới là authority. Event JSON phải có field camelCase thật sự; kiểm tra expected keys, không chỉ serialize/deserialize cùng Rust type. Contract đầy đủ tại mục 6 của plan chi tiết.

## 7. Input/output routing

~~~text
Focus pane 2
  → xterm pane 2 onData
  → terminal_write(session-2)
  → PTY session-2

PTY session-3 output
  → Channel data(session-3)
  → lookup sessionId
  → xterm pane gắn session-3
~~~

Các quy tắc bắt buộc:

- Không broadcast input đến mọi pane.
- Không hiển thị output chỉ dựa trên slot index nếu session ID đã đổi.
- Response/event của session cũ sau restart phải bị bỏ qua.
- ACK sequence được kiểm tra độc lập cho từng session.
- Pane ẩn vẫn parse/ACK; terminal replies do xterm phát sinh gửi về session sở hữu pane, không phụ thuộc activePaneId.
- Một session bị lỗi không chuyển toàn bộ workspace sang error.
- Khi pane dispose, native session phải được close hoặc chuyển ownership rõ ràng; không để Channel listener mồ côi.

## 8. Lifecycle và workspace switch

### Close một session

1. Đánh dấu pane đang closing và disable input.
2. Gọi terminal_close cho đúng session ID.
3. Chờ cleanup PTY/reader/writer/child.
4. Xóa session khỏi manager và slot.
5. Giữ nguyên các session khác.

### Restart một session

1. Lưu slot và workspace ID, không dùng lại session ID.
2. Close session cũ hoàn tất.
3. Spawn session mới tại canonical root hiện tại.
4. Gắn Channel/listener mới trước khi spawn.
5. Chỉ thay descriptor của slot nếu session mới publish thành công.

### Workspace switch

1. Picker chọn candidate; Rust validate/canonicalize. Cancel hoặc folder không hợp lệ giữ nguyên workspace/session.
2. Mark switching, chặn spawn/input/resize mới và invalidate starting reservations của workspace cũ.
3. Cleanup toàn bộ session cũ ngoài manager/workspace lock, kể cả pane ẩn và process spawn về muộn.
4. Chỉ commit workspace mới sau khi cleanup thành công; lỗi giữ descriptor cũ và reconcile pane state, không tự phục hồi session đã đóng.
5. Reset snapshots/buffer về idle, active T1 và giữ layout mode; root listing và terminal mới dùng workspace ID mới.

Response đến muộn của workspace/session cũ không được cập nhật UI mới.

## 9. Task triển khai

### Task 3.1 — Session manager

- [x] Đổi TerminalManager từ single slot sang map/session registry tối đa 4.
- [x] Giữ reservation chống double-spawn cùng pane và capacity counting cả starting/closing.
- [x] Bổ sung paneId, list/close-workspace và kiểm tra event JSON camelCase.
- [x] Kiểm tra session ID, workspace ID và owner window trong mọi command.
- [x] Giữ output flow/ACK độc lập cho từng session.
- [ ] Native test close/restart một session không ảnh hưởng session khác.

### Task 3.2 — Grid 2×2

- [x] Tách TerminalPane khỏi container workspace.
- [x] Render bốn pane cố định, mặc định grid 2 × 2, với focus/status riêng.
- [x] Hiển thị slot rỗng và action Start rõ ràng.
- [x] Giữ terminal là vùng chính ở kích thước 960 × 600.
- [x] Không để terminal pane bị co về kích thước không dùng được.

### Task 3.3 — Layout modes

- [x] Thêm state layout 1 | 2 | 4.
- [x] Chuyển layout không close session ẩn.
- [x] Khôi phục đúng xterm/session khi pane hiện lại.
- [x] Có buttons 1/2/4 và selector T1–T4; shortcut toàn app để Phase 7.
- [x] Pane ẩn vẫn parse/ACK, pane hiện lại fit đúng size mà không respawn.

### Task 3.4 — Session actions

- [x] Focus/select pane.
- [x] Close/restart từng session.
- [x] Disable input khi starting/closing/exited.
- [x] Hiển thị lỗi ở đúng pane.
- [x] Cleanup đúng khi workspace đổi hoặc app đóng.

### Task 3.5 — Independent verification

- [ ] Chạy lệnh khác nhau ở bốn shell và kiểm tra output không lẫn.
- [ ] Chạy một process dài ở pane 1, đổi layout và xác nhận process vẫn sống.
- [ ] Restart pane 2 trong khi pane 1/3/4 đang chạy.
- [ ] Resize nhiều pane liên tiếp, không respawn process.
- [ ] Close app khi nhiều session có output và child command/dev server; kiểm chứng cleanup với deadline.

## 10. Kiểm thử và bằng chứng

Các lệnh nền tảng:

~~~powershell
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- dev
git diff --check
~~~

Actual result ngày 2026-10-03: `npm run build` pass; `cargo fmt -- --check`, `cargo check`, `cargo test` **16/16 pass** (native PowerShell PTY round-trip, bốn reservation, duplicate pane và camelCase event contract); `cargo clippy --all-targets -- -D warnings` pass; `git diff --check` pass. Đây là automated evidence, chưa thay thế native multi-pane click-through.

Ma trận nghiệm thu:

| Case | Kết quả cần đạt |
| --- | --- |
| Spawn session 1–4 | Cả bốn session có ID/PID riêng |
| Spawn session 5 | Bị từ chối rõ ràng, không tạo process thứ năm |
| Input đồng thời | Mỗi lệnh chỉ xuất hiện ở đúng pane |
| Output đồng thời | Không có output lẫn session |
| Layout 4 → 1 → 4 | Session ẩn vẫn sống, hiện lại đúng xterm |
| Layout 2 / chọn pane ẩn | Cặp visible tuân theo quy tắc; click pane bên cạnh không đổi cặp |
| Hidden output vượt credit limit | Vẫn parse/ACK, marker cuối không mất; pane khác nhận input bình thường |
| Restart pane 2 | Pane 1/3/4 không đổi PID/state/output |
| Resize nhiều pane | Chỉ PTY tương ứng đổi size |
| Natural exit | Chỉ pane tương ứng chuyển exited |
| Workspace switch | Toàn bộ session cũ được cleanup |
| Cancel / switch khi Start pending | Cancel giữ session; stale spawn được cleanup, không xuất hiện trong workspace mới |
| App close | Không còn PowerShell child process thuộc workspace |
| Cửa sổ 960 × 600 | Grid và controls vẫn usable, không overflow |

Đây là expected results, chưa phải bằng chứng đã chạy. Ghi rõ actual result và nguồn native UI evidence khi triển khai; không suy ra cả ma trận pass từ một dòng output CLI.

## 11. Tiêu chí hoàn tất Phase 3

- [x] Tối đa bốn PTY session độc lập được manager hỗ trợ và reservation theo pane.
- [x] Session manager route input/output/resize/ACK đúng sessionId.
- [x] Grid 2×2 có focus/status riêng cho từng pane.
- [x] Layout 1/2/4 không terminate session bị ẩn.
- [x] Close/restart một pane không ảnh hưởng pane khác theo implementation và unit contract.
- [x] Workspace switch và app close gọi cleanup toàn bộ session ở native boundary.
- [ ] Native smoke test xác nhận input/output/resize/lifecycle với nhiều session.
- [x] Unit tests (16/16), native single-PTY round-trip và frontend build pass; native multi-pane smoke vẫn chờ.
- [x] README và tài liệu Phase 3 ghi actual result, không đánh dấu native smoke trước evidence.

## 12. Bàn giao Phase 4

Phase 4 sẽ biến right panel thành container Git/Explorer/Editor có switch, resize và collapse. Session/pane state của Phase 3 phải tồn tại khi switch panel; đóng panel không được terminate terminal session.

Tài liệu liên quan:

- [Project Instruction](../agents/rules/Project_Instruction.md)
- [Implementation Plan](../agents/plans/Implementation_Plan.md)
- [Phase 2 Terminal Core](./phase-2-terminal-core-preview.md)
- [Phase 3 Four Terminals Plan](../agents/plans/Phase_3_Four_Terminals_Plan.md)
- [README](../README.md)
