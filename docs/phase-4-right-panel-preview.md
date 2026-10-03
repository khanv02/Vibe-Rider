# Phase 4 — Right Panel

Tài liệu này là contract triển khai, phạm vi và checklist nghiệm thu cho Phase 4 của Vibe Rider. Phase 4 biến right-panel mock thành một container thật cho Git, Explorer, Editor và AI mà không làm gián đoạn terminal workspace.

**Cập nhật:** 2026-10-03  
**Trạng thái:** đã triển khai frontend; native click-through Phase 4 đang chờ. Phase 3 đã cung cấp terminal/pane state cần được giữ nguyên khi panel switch, collapse hoặc resize.

Kế hoạch tổng thể: [Implementation Plan](../agents/plans/Implementation_Plan.md#phase-4--right-panel). Quy tắc sản phẩm: [Project Instruction](../agents/rules/Project_Instruction.md).

Kế hoạch chi tiết: [Phase 4 Right Panel Plan](../agents/plans/Phase_4_Right_Panel_Plan.md). Preview này giữ phạm vi/checklist; width rules, focus và task checkpoints theo plan chi tiết. Frontend implementation đã có; actual evidence hiện gồm build, Rust tests và Tauri startup, còn native click-through chưa hoàn tất.

## 1. Mục tiêu

Right panel phải là vùng hỗ trợ tùy chọn ở bên phải màn hình. Terminal vẫn là main workspace và phải tiếp tục giữ process, xterm state, focus và output khi người dùng thao tác với panel.

Kết quả cuối phase:

- Git là panel mặc định.
- Có thể switch giữa Git, Explorer, Editor và AI; chỉ một panel chính hiển thị tại một thời điểm.
- Có thể collapse hoàn toàn panel, gồm rail/content/splitter, để terminal nhận toàn bộ body width; header có nút mở lại.
- Có thể resize panel trong giới hạn an toàn, không làm terminal hoặc cửa sổ 960 × 600 bị unusable.
- Switch/collapse/resize không unmount terminal workspace và không làm mất Explorer state.
- Editor slot có Normal/Expanded để kiểm chứng geometry trước khi tích hợp Monaco ở Phase 5.
- Panel không tự gọi Git, Editor hoặc AI operation ngoài scope của panel đang active.

Phase này chưa triển khai Git operations, Monaco editor, AI chat hoặc persistence. Các panel đó chỉ cần có slot/contract UI ổn định để Phase 5–8 tích hợp.

## 2. Điều kiện bắt đầu

- [x] Phase 1 có workspace descriptor và Explorer lazy-loading.
- [x] Foundation có right-panel container và Git placeholder hiện tại.
- [x] Phase 3 có bốn terminal pane, layout 1/2/4 và session lifecycle.
- [ ] Native Phase 3 multi-pane smoke đã pass đầy đủ; nếu chưa, phải chạy lại sau khi panel thay đổi vì layout có thể ảnh hưởng kích thước terminal.

Phase 4 không được thay đổi filesystem permission, PTY ownership hoặc terminal command contract. Right panel chỉ quản lý layout/presentation state; native operation vẫn thuộc service tương ứng của phase sau.

## 3. Contract state

~~~ts
type RightPanelId = "git" | "explorer" | "editor" | "ai";

type RightPanelState = {
  activeRightPanel: RightPanelId;
  rightPanelOpen: boolean;
  rightPanelWidth: number; // requested Normal width, gồm rail, không gồm splitter
  editorSize: "normal" | "expanded";
  editorExpandedWidth: number | null; // null → target 60% body
};

type RightPanelLimits = {
  minWidthPx: number;
  maxWidthPx: number;
  collapsedWidthPx: number;
};
~~~

Quy tắc:

- activeRightPanel luôn là một ID hợp lệ, kể cả khi panel đang đóng.
- rightPanelOpen = false ẩn toàn bộ rail/content/splitter; header toggle vẫn hiện để mở lại.
- rightPanelWidth là width preference Normal; effective width được clamp theo body hiện tại, không mất preference khi window tạm nhỏ.
- Reject width không hữu hạn; user resize được clamp theo mode/bounds. Normal/Expanded giữ width riêng.
- Git mặc định, panel mở, Normal width 304 px, Editor Normal khi app khởi tạo.
- Switching panel giữ state của panel cũ trong owner tương ứng; không reset chỉ vì panel mất visibility.
- Click tool khác mở tool đó; click lại active tool khi panel đang mở sẽ collapse. Collapse cũng dùng nút Hide tools hoặc Enter trên splitter. Switch khỏi Editor Expanded dùng Normal geometry; quay lại Editor bắt đầu Normal. Collapse/reopen cùng Editor giữ mode trước đó.

## 4. Layout contract

~~~text
App shell
  ├─ Header
  ├─ Body
  │   ├─ Terminal workspace: flex 1, min-width 0
  │   └─ Right panel: fixed/clamped width, optional
  └─ Status bar

Right panel
  ├─ Activity rail: Git / Explorer / Editor / AI
  ├─ Collapse/expand control
  └─ Tool slots giữ identity sau khi mount: đúng một view visible
~~~

Layout bắt buộc:

- Terminal workspace và right panel là sibling trong app body.
- Terminal workspace không dùng fixed width khiến panel resize gây overflow.
- Panel resize không được thay đổi active terminal pane hoặc terminate session.
- Khi panel đóng, terminal nhận phần width còn lại; header/status bar vẫn usable.
- Khi panel mở lại, width cuối được khôi phục sau khi clamp theo viewport hiện tại.
- Ở viewport nhỏ, không cho resize xuống dưới min terminal width và không để controls bị che.

Width tính bằng CSS pixels và gồm rail 48 px, không gồm splitter 6 px. Normal min/default là 272/304 px; max là `min(480, floor(0.4 × B), B − 600 − 6)`. Expanded dùng 50–70% body khi đủ chỗ, target 60% và giữ terminal tối thiểu 420 px. Collapsed panel/splitter đều 0 px. Xem mục 6 của plan để xử lý body zero/small, restore width và ví dụ 960/1440 px.

## 5. Panel behavior

| Panel | Phase 4 behavior | State phải giữ |
| --- | --- | --- |
| Git | Placeholder hoặc shell UI sẵn sàng cho Phase 6 | selected view, loading/error slot |
| Explorer | Tái sử dụng ExplorerPanel Phase 1 | expanded directories, cache, selection, request ownership |
| Editor | Placeholder cho Monaco Phase 5, Normal/Expanded geometry | Size mode/width; models/tabs thuộc Phase 5 |
| AI | Placeholder cho Phase 8 | conversation/context slot nếu đã có |

Chỉ panel active được hiển thị như panel chính. Activity rail hiện khi panel mở; khi panel đóng, header Show tools mở lại tool đã chọn mà không che terminal.

## 6. Ownership và lifecycle

| State | Owner |
| --- | --- |
| active panel, open/closed, width | RightPanel/container state |
| Requested/effective width và Normal/Expanded | App-owned `useRightPanel`, bounds derive từ body width |
| Explorer cache/expanded/selection | Workspace Explorer controller |
| terminal session, xterm, output/ACK | TerminalPane và Rust TerminalManager |
| Git operation state | Git service/panel của Phase 6 |
| Editor model/tab/dirty state | Editor controller của Phase 5 |
| AI conversation/context | AI controller của Phase 8 |

Switch panel chỉ thay đổi presentation. Không đưa process handle, PTY handle, xterm instance hoặc toàn bộ output buffer vào right-panel state.

## 7. Task triển khai

### Task 4.1 — Panel contract

- [x] Tạo RightPanelId/RightPanelState và default Git.
- [x] Chuẩn hóa callback switch, toggle và width change.
- [x] Không để panel con tự thay đổi layout state của terminal.
- [x] Có trạng thái accessible cho panel active, collapsed và resize handle.

### Task 4.2 — Switch panel

- [x] Rail có Git, Explorer, Editor và AI.
- [x] Chỉ một panel chính visible tại một thời điểm.
- [x] Explorer giữ nguyên controller/cache/expanded state khi switch qua lại.
- [x] Editor và AI có placeholder rõ ràng, không giả lập operation chưa có.
- [x] Switch panel không thay đổi active terminal pane/session.

### Task 4.3 — Resize và collapse

- [x] Thêm resize handle có pointer/keyboard affordance phù hợp.
- [x] Clamp width theo min/max và viewport hiện tại.
- [x] Collapse panel không unmount terminal workspace.
- [x] Reopen khôi phục width hợp lệ gần nhất.
- [x] Editor Normal/Expanded giữ width riêng; Normal khôi phục width trước Expand.
- [x] Resize liên tục không tạo layout overflow hoặc terminal zero-size bất ngờ.

### Task 4.4 — State retention

- [ ] Switch panel khi bốn terminal đang running; mọi PID/session/output vẫn đúng (native click-through pending).
- [ ] Đổi layout terminal 1/2/4 trong lúc panel resize/collapse.
- [ ] Explorer refresh/expand request stale vẫn bị bỏ qua sau workspace switch.
- [ ] App close vẫn chạy terminal cleanup độc lập với panel state.
- [ ] Không thêm persistence cho panel/session nếu chưa thuộc Phase 7.

## 8. Input, focus và accessibility

- Click icon rail chọn panel và cập nhật aria-current.
- Collapse control có aria-label và trạng thái expanded/collapsed.
- Resize handle có role phù hợp, keyboard increment/decrement và giới hạn rõ ràng.
- Khi splitter focus: ArrowLeft tăng width, ArrowRight giảm width, Home/End về min/max, Enter collapse; focus sau collapse về active terminal.
- Focus trong panel không làm mất focus/session routing của terminal khi người dùng quay lại terminal.
- Nút Editor/AI enabled để mở container/placeholder đúng; nội dung ghi rõ chức năng chưa tích hợp và không gọi operation ngoài scope.
- Tab order không đi vào nội dung panel đã bị collapse.

## 9. Kiểm thử

~~~powershell
npm run build
git diff --check
npm run tauri -- dev
~~~

Actual automated evidence ngày 2026-10-03: `npm run build` pass; `cargo test --manifest-path src-tauri/Cargo.toml` pass 16/16; `npm run tauri -- dev` compile/startup pass. Frontend chưa có test runner riêng; native click-through theo ma trận bên dưới vẫn pending.

Ma trận native/UI:

| Case | Kết quả cần đạt |
| --- | --- |
| Startup | Git mở mặc định, terminal vẫn render đúng |
| Git → Explorer → Git | Panel đổi đúng, Explorer state không mất |
| Git → Editor → AI | Mỗi placeholder đúng, không gọi operation ngoài scope |
| Collapse/reopen | Terminal mở rộng rồi panel trở lại với width hợp lệ |
| Editor Normal/Expanded/Normal | Expanded theo bounds, Normal khôi phục width; không đổi terminal session/layout |
| Resize min/max | Width bị clamp, không overflow/zero-size terminal |
| Resize liên tục | Không crash, không mất xterm/session/output |
| Bốn session running | Switch/collapse/resize không lẫn input/output |
| Layout 4 → 1 → 4 | Session và pane state Phase 3 vẫn tồn tại |
| Workspace switch | Explorer và panel reconcile; terminal cleanup vẫn đúng |
| App close | Cleanup terminal không phụ thuộc panel đang active |
| Cửa sổ 960 × 600 | Header, terminal, panel và status bar vẫn thao tác được |

Ghi actual result riêng cho từng case. Không coi browser preview là bằng chứng thay cho native Tauri behavior.

## 10. Tiêu chí hoàn tất

- [ ] Git mở mặc định đã được native xác nhận.
- [ ] Switch được Git/Explorer/Editor/AI với duy nhất một panel chính visible.
- [ ] Collapse/reopen hoạt động mà không unmount hoặc terminate terminal session.
- [ ] Resize có min/max constraint và không gây overflow tại 960 × 600.
- [ ] Editor Normal/Expanded có geometry đúng và Normal width được giữ.
- [ ] Explorer state được giữ khi switch panel.
- [ ] Terminal layout/session/focus/output vẫn đúng trong lúc panel thay đổi.
- [ ] Accessibility smoke pass cho rail, collapse và resize.
- [ ] Native smoke matrix đã chạy và ghi evidence.
- [x] README và tài liệu Phase 4 ghi rõ actual result, không đánh dấu trước evidence.

## 11. Bàn giao Phase 5

Phase 5 có thể dùng panel contract này để mount Monaco vào Editor slot. Editor phải giữ model/tab/dirty state trong editor owner; switch panel hoặc collapse right panel không được reset buffer. Diff viewer dùng chung cho Editor, Git và AI phải được bổ sung sau khi file API và editor model được định nghĩa.

Tài liệu liên quan:

- [Project Instruction](../agents/rules/Project_Instruction.md)
- [Implementation Plan](../agents/plans/Implementation_Plan.md)
- [Phase 4 Right Panel Plan](../agents/plans/Phase_4_Right_Panel_Plan.md)
- [Phase 3 Four Terminals](./phase-3-four-terminals-preview.md)
- [README](../README.md)
