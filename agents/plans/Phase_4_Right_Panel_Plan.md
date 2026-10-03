# Kế hoạch Phase 4 — Right Panel

Ngày lập: 2026-10-03. Trạng thái: **đã triển khai frontend; native verification đang chờ**.

Nguồn yêu cầu: [Project Instruction](../rules/Project_Instruction.md), mục 6, 9, 12, 14, 24, 26–29. Thứ tự task: [Implementation Plan](Implementation_Plan.md#phase-4--right-panel). Checklist tiến độ: [Phase 4 Preview](../../docs/phase-4-right-panel-preview.md).

## 1. Mục tiêu và baseline

Xây dựng right panel có thể chuyển giữa Git, Explorer, Editor và AI, kéo thay đổi chiều rộng, đóng/mở và mở rộng vùng Editor. Terminal vẫn là main workspace; panel actions chỉ thay đổi presentation/geometry, giữ session ID/PID, xterm, buffer, routing và layout 1/2/4.

Code hiện tại:

- `App.tsx` giữ `useRightPanel` ở App; default Git, mở folder thành công hoặc lỗi chuyển sang Explorer. Explorer controller vẫn nằm ở App.
- `RightPanel.tsx` có activity rail bốn tool, Explorer thật và Git/Editor/AI placeholder; tool slots được giữ mounted và chỉ một slot visible.
- `AppLayout.tsx` đặt terminal, splitter và right panel trong cùng body; body width được đo bằng ResizeObserver và truyền vào geometry controller.
- `styles.css` dùng CSS variables cho panel/splitter width, hỗ trợ full collapse và không còn media query ghi đè width resize.
- `TerminalWorkspace.tsx` giữ bốn `TerminalPane` với key T1–T4; `TerminalPane.tsx` có ResizeObserver/FitAddon, bỏ fit khi host zero-size và ACK output riêng.
- Native window mặc định `1440 × 900`, minimum `960 × 600`.

Phase 3 có implementation và automated results được ghi nhận; native multi-pane smoke vẫn chưa được xác nhận trong tài liệu. Phase 4 frontend đã được triển khai theo contract này; khi nghiệm thu phải kiểm tra lại terminal dưới tác động của panel. Plan này không tự đóng nghiệm thu Phase 3.

## 2. Phạm vi và quyết định UX

| Hạng mục | Quyết định Phase 4 |
| --- | --- |
| Tool IDs | `git`, `explorer`, `editor`, `ai`; duy nhất một nội dung chính visible |
| Startup | Git mở mặc định; toàn bộ panel UI state nằm trong memory |
| Explorer | Tái sử dụng controller và tree của Phase 1; giữ cache, expanded paths, selection và scroll khi ẩn |
| Git | Giữ placeholder/IPC proof hiện có; Git operations thuộc Phase 6 |
| Editor | Container/placeholder có Normal/Expanded; Monaco, tabs và file API thuộc Phase 5 |
| AI | Container/placeholder; chat/provider/context thuộc Phase 8 |
| Rail | Cả bốn nút enabled để mở đúng nội dung/placeholder; placeholder ghi rõ chức năng chưa tích hợp |
| Collapse | Đóng toàn bộ right panel, gồm rail/content và resize handle; terminal nhận toàn bộ body width |
| Reopen | Header có nút Show/Hide tools luôn truy cập được; mở lại tool, width và editor mode trước khi collapse |
| Resize | Kéo splitter phía trái panel; width được giới hạn theo body width thực tế |
| State owner | React controller ở App, không tạo thêm global store chỉ cho layout này |
| Ngoài phạm vi | Git execution, Monaco, AI calls, file read/write mới, persistence, dock/drag panel, global shortcuts, thay shell/PTY lifecycle |

Click tool khác chọn tool và mở panel. Click lại tool đang active là no-op để rail không tự collapse; collapse chỉ đến từ nút Hide tools hoặc Enter trên splitter. Header Show tools mở lại tool vừa dùng. Switch từ Editor Expanded sang tool khác trở về geometry Normal; khi quay lại Editor bắt đầu Normal, chỉ Expand bằng user action. Collapse/reopen cùng Editor giữ mode đã chọn.

Rail luôn gọi `selectPanel(id)`; thao tác collapse có entry point riêng (`closePanel()`/header/splitter). Như vậy click rail lặp lại không vô tình làm mất tools bar.

Open Folder thành công mở Explorer ở Normal; Cancel giữ nguyên panel/terminal state. Error mở Explorer để hiện lỗi như flow hiện tại. Width Normal đã chọn không bị reset khi đổi workspace; dữ liệu Explorer được reset theo workspace ID như Phase 1.

## 3. Kiến thức cần hiểu

| Concept | What / Why / How |
| --- | --- |
| UI state và domain state | Panel width/open là presentation; Explorer cache và terminal session có owner riêng, không bị reset theo panel |
| Component identity | Giữ parent/key của terminal qua switch/collapse; thêm splitter không đổi vị trí/identity subtree ngoài ý muốn |
| Requested và effective width | Width user chọn là preference; effective width được clamp theo cửa sổ hiện tại, không mất preference khi window tạm nhỏ |
| Pointer capture | Splitter tiếp tục nhận drag khi pointer đi qua xterm/panel; mọi đường kết thúc phải giải phóng capture và drag state |
| ResizeObserver | Đo body thực tế và fit terminal theo container; cập nhật geometry không spawn shell |
| Focus | Chọn tool, kéo splitter và đóng panel có hành vi focus rõ; hidden content không nhận Tab/input |

## 4. Architecture và ownership

```text
App
  ├─ workspace descriptor + useWorkspaceExplorer (đã có)
  ├─ terminal pane snapshots (đã có)
  └─ useRightPanel → UI state/actions + effective width
       ↓
     AppLayout
       ├─ Header: Show/Hide tools + Open Folder
       ├─ Body (grid ổn định)
       │    ├─ TerminalWorkspace → T1–T4 luôn giữ identity
       │    ├─ RightPanelResizeHandle
       │    └─ RightPanel
       │         ├─ Activity rail: Git / Explorer / Editor / AI
       │         └─ Tool slots: một visible, slot đã mount được giữ
       └─ StatusBar

Panel action → UI state → CSS geometry
  → ResizeObserver/FitAddon từng terminal visible
  → terminal_resize của đúng session khi rows/cols thực sự đổi
```

Right-panel state không chứa PTY handles, xterm instance, output bytes, filesystem cache, Monaco model hoặc AI messages. `useWorkspaceExplorer` tiếp tục ở App để switch panel không tạo controller/request generation mới.

Giữ terminal subtree cùng parent/key qua cả open/closed/expanded state. RightPanel được giữ mounted và ẩn bằng CSS/`hidden`; không dùng hai nhánh AppLayout với cấu trúc terminal khác nhau. Tool slots đã mount giữ identity; chỉ một slot visible. React gắn state với identity/vị trí trong cây render. [React: preserving state](https://react.dev/learn/preserving-and-resetting-state).

## 5. State và action contract

```ts
type RightPanelId = "git" | "explorer" | "editor" | "ai";
type EditorPanelSize = "normal" | "expanded";

interface RightPanelState {
  activeRightPanel: RightPanelId;
  rightPanelOpen: boolean;
  rightPanelWidth: number; // requested Normal width, gồm rail, không gồm splitter
  editorSize: EditorPanelSize;
  editorExpandedWidth: number | null; // null → target 60% body khi Expand
}
```

Defaults: `git`, open, `rightPanelWidth = 304`, `editorSize = "normal"`, expanded width `null`. Width tính bằng CSS pixels, không nhân thêm Windows DPI scale. `bodyWidth`, bounds, effective width và drag metadata là derived/transient state, không lưu như domain state.

| Action | State/behavior |
| --- | --- |
| `selectPanel(id)` | Chọn ID hợp lệ, mở panel; switch khỏi Editor trả mode Normal |
| `togglePanel()` / `closePanel()` | Đổi open, giữ active ID và requested widths; close kết thúc drag nếu đang kéo |
| `setPanelWidth(px)` | Reject giá trị không hữu hạn, clamp theo mode/bounds; cập nhật width của mode tương ứng |
| `setEditorSize(mode)` | Chỉ áp dụng khi Editor active; Expand/Normal không đổi terminal layout |
| Body resize | Recompute effective width; không ghi đè requested width, không tự mở panel đã đóng |
| Workspace change | Giữ width; thành công/error mở Explorer Normal; Cancel không đổi state |

Normal và Expanded giữ width riêng để thu nhỏ Editor không làm mất width panel trước đó. Drag update theo requestAnimationFrame; commit kích thước cuối hợp lệ, hủy pending frame khi interaction kết thúc. Controller không gọi terminal spawn/close.

## 6. Geometry và giới hạn resize

Thông số ban đầu để implement/kiểm chứng:

| Thông số | Giá trị |
| --- | --- |
| Rail | 48 px, thuộc `rightPanelWidth` |
| Splitter | 6 px, nằm ngoài right panel |
| Normal panel min / default | 272 / 304 px; phần content min 224 px |
| Normal panel max | `min(480, floor(0.4 × B), B − 600 − 6)` |
| Editor Expanded min | `max(272, ceil(0.5 × B))` |
| Editor Expanded max | `min(floor(0.7 × B), B − 420 − 6)` |
| Editor Expanded target | `floor(0.6 × B)`, clamp theo bounds |
| Panel collapsed | Panel 0 px, splitter 0 px; terminal width B |

`B` là body content width đo từ container, không phải native outer window width. Khi mở: `terminalWidth = B − splitterWidth − effectivePanelWidth`. Normal giữ terminal tối thiểu 600 px; Expanded là thao tác tạm thời cho Editor, vẫn giữ terminal tối thiểu 420 px. Các thông số này là quyết định thiết kế cần visual QA, chưa phải kết quả đã đạt.

Ví dụ khi body width đúng các giá trị sau:

| B | Normal default: panel / terminal | Expanded target sau clamp: panel / terminal | Collapsed: terminal |
| --- | --- | --- | --- |
| 960 px | 304 / 650 px | 534 / 420 px | 960 px |
| 1440 px | 304 / 1130 px | 864 / 570 px | 1440 px |

Grid giữ ba child ổn định; điều khiển cột bằng effective width/CSS variable. Xóa hard-coded cột phải trong media query cũ để không ghi đè resize/collapse. Grid/flex children có `min-width: 0`, `min-height: 0`; tool content tự scroll, header/actions không làm viewport terminal co về zero.

Nếu B = 0 khi mount/minimize, bỏ qua fit/geometry update. Nếu expanded bounds không khả thi, dùng geometry Normal; nếu Normal cũng không đủ chỗ, ẩn panel tạm bằng effective width 0 và giữ user state để khôi phục khi B đủ lớn. Không truyền negative/NaN width. Tại window minimum 960 × 600 phải vẫn dùng được mode 4; không tự đổi về mode 1 hoặc nâng window minimum để né lỗi layout.

## 7. Pointer, keyboard và focus

### Drag splitter

1. `pointerdown` primary button: capture pointer ID, start X/width/mode và bounds.
2. `pointermove`: `nextWidth = startWidth + startX − currentX`; kéo trái làm panel rộng hơn. Clamp theo bounds hiện tại, cập nhật tối đa một lần mỗi frame.
3. `pointerup`: commit cuối và release capture. `pointercancel`, `lostpointercapture`, window blur, collapse hoặc unmount kết thúc interaction và cleanup; giữ width hợp lệ cuối.
4. Chỉ tắt text selection trong lúc drag; khôi phục cursor/user-select/listeners sau tất cả đường kết thúc. Kéo splitter không gửi input/control bytes vào PTY.

Pointer capture định tuyến các event tiếp theo về element đã capture. [MDN: setPointerCapture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture).

### Keyboard và visibility

- Splitter focusable, `role="separator"`, `aria-orientation="vertical"`, accessible name, `aria-controls` và `aria-valuemin/max/now`; `aria-valuetext` mô tả panel width bằng pixels.
- Khi splitter được focus: ArrowLeft tăng width, ArrowRight giảm width, bước 10 px; Home/End về min/max; Enter collapse. Chỉ xử lý phím của control đang focus.
- Rail dùng buttons với trạng thái active; không thêm tab semantics nếu chưa làm đủ tab keyboard contract. Editor/AI click mở placeholder thật.
- Header toggle có `aria-expanded` và `aria-controls`; collapse ẩn cả rail/content/splitter khỏi Tab order.
- Khi đóng panel chứa focus hoặc kết thúc keyboard collapse, đưa focus về xterm của terminal active. Mở/chọn panel giữ focus ở control người dùng vừa bấm; drag/fit không tự cướp focus khi người dùng đang thao tác panel.
- Cần đường focus rõ từ app shell tới terminal active; kiểm chứng DOM input focus thực tế, không chỉ active border. Bổ sung hook/callback/ref focus nhỏ nếu wiring hiện tại chưa đủ.

Window Splitter pattern là tham khảo cho separator keyboard/ARIA, cần tự kiểm chứng với UI thực tế. [W3C APG: Window Splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/). Global shortcuts/persistence vẫn thuộc Phase 7.

## 8. State retention và terminal resize

- Bốn `TerminalPane` không unmount/rekey khi panel switch, collapse, drag hoặc Expand Editor. Panel actions giữ `activePaneId`, terminal layout mode và session identity.
- ResizeObserver ở body chỉ derive panel bounds; terminal observer fit theo host. Tránh update width không đổi/feedback loop; dedup rows/cols trước IPC. [MDN: ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver).
- Terminal hidden trong mode 1/2 giữ geometry cuối và tiếp tục parse/ACK; hiện lại fit theo diện tích mới. Hidden do terminal layout khác với collapsed supporting tools.
- Explorer controller sống ở App; panel/Explorer đã mount được giữ khi ẩn. Cache, expanded paths, selectedPath và DOM scroll được giữ; switch panel không tự refresh hoặc re-read cây đã cache.
- Loading/error/pending Explorer request tiếp tục thuộc workspace/generation cũ; khi workspace đổi, reset/loại stale response theo contract Phase 1, không thêm cache dùng chung các root.
- App close và workspace cleanup vẫn theo Rust terminal manager. Switch/close panel không đi vào session teardown.
- Future Monaco model/draft/AI conversation có domain owner riêng ở phase tương ứng; Phase 4 chỉ chuẩn bị slot và giữ presentation state đã có.

## 9. Files cần tạo/sửa

| File | Responsibility |
| --- | --- |
| `src/panels/types.ts` — mới | IDs/state/mode và action contracts |
| `src/panels/panelLayout.ts` — mới | Defaults, pure width bounds/clamp và state transition rules |
| `src/panels/useRightPanel.ts` — mới | App-owned UI controller, requested/effective widths và actions |
| `src/components/RightPanelResizeHandle.tsx` — mới | Pointer capture/keyboard splitter, drag cleanup và accessibility |
| `src/components/RightPanel.tsx` | Rail bốn tools, stable slots, collapse header và Editor Normal/Expanded |
| `src/App.tsx` | Integrate panel controller; giữ Explorer/terminal ownership; folder selection/error flow |
| `src/components/AppLayout.tsx` | Grid geometry, body measurement, stable splitter/panel children và header toggle |
| `src/components/ExplorerPanel.tsx` | Chỉ sửa nếu cần scroll/header integration; giữ filesystem semantics |
| `src/components/TerminalWorkspace.tsx`, `TerminalPane.tsx` | Scoped focus/fit integration khi regression check chứng minh cần; không thay session contract |
| `src/styles.css` | Width variables, expanded/collapsed states, compact controls, focus và min-window layout |
| `docs/phase-4-right-panel-preview.md`, plan, README | Scope/checkpoints và actual results sau khi chạy |

Phase 4 không cần thêm Rust command/capability, Monaco/provider/Git service hoặc layout library. Chỉ xem xét frontend test tooling tương thích stack nếu các state/pointer regression tests cần; không cài package trong lượt lập plan này.

## 10. Task và checkpoint theo roadmap

| Task | Công việc | Điểm kiểm chứng |
| --- | --- | --- |
| **4.1 — Panel contract** | IDs/state/actions, default Git, requested/effective geometry, App ownership | Default đúng, invalid widths bị reject; panel state không chứa domain state; chưa thay terminal identity |
| **4.2 — Switch panel** | Enable bốn rail tools, placeholder rõ, stable visible slots và workspace flow | Đúng một tool visible; Explorer cache/selection/scroll giữ qua switch; Cancel giữ panel state |
| **4.3 — Resize/collapse** | Splitter pointer/keyboard, bounds, header reopen, Editor Normal/Expanded | Drag đúng hướng/clamp/cleanup; full collapse cấp toàn body width cho terminal; reopen/Normal trả width đúng |
| **4.4 — State retention & verification** | Focus/fit integration, terminal+Explorer regressions, min-window/native QA, docs evidence | Session/PID/buffer không đổi, hidden ACK chạy, actual focus đúng, không overflow; native matrix có kết quả |

Thứ tự: `4.1 → 4.2 → 4.3 → 4.4 → nghiệm thu Phase 4 → Phase 5`.

Đã triển khai theo thứ tự 4.1 → 4.2 → 4.3. Task 4.4 còn yêu cầu native click-through để xác nhận focus, xterm/Explorer retention và min-window; không đánh dấu nghiệm thu trước evidence.

## 11. Verification và nghiệm thu

### Kiểm tra đã chạy và kiểm tra còn lại

- Đã chạy: `npm run build` pass (TypeScript + Vite).
- Đã chạy: `cargo test --manifest-path src-tauri/Cargo.toml` pass 16/16.
- Đã chạy: `npm run tauri -- dev` compile/startup pass; tiến trình được dừng sau khi xác nhận startup.
- Còn lại: native click-through theo ma trận dưới đây; frontend chưa có test runner nên pure rules chưa có automated suite riêng.

- Pure rules cần bổ sung khi có runner: normal/expanded bounds, small/zero body, invalid width, restore requested width sau window shrink/grow; switch/collapse defaults và action transitions.
- Frontend integration: bốn tools, một visible, scroll/cache retention, collapse/reopen Tab order/focus, pointer cancel/lost capture; mock IO xác nhận panel action không gọi terminal spawn/close.
- Resize integration: thay body/panel width làm fit đúng pane visible, dedup rows/cols, hidden pane không fit zero-size; input/output/ACK vẫn đúng session.
- Thêm meaningful tests cho bounds/lifecycle nếu implementation cần; không chỉ test snapshot tên class. Chọn tooling tương thích dependencies khi triển khai, không tự nâng stack để dùng runner mới nhất.

```powershell
npm run build
git diff --check
npm run tauri -- dev
```

Chạy frontend tests theo command được chốt khi có runner. Rust tests/checks cần chạy lại nếu sửa backend hoặc đang xác minh native terminal regression liên quan; không lặp toàn bộ suite chỉ vì thay file Markdown. Native launch thành công chưa chứng minh panel/session behaviors pass.

### Ma trận native/UI cần ghi actual result

| Case | Expected result |
| --- | --- |
| Startup, chưa mở workspace | Git mở 304 px khi bounds cho phép; bốn terminal idle; placeholder chính xác |
| Git → Explorer → Editor → AI | Một tool visible; Editor/AI có placeholder dùng được; không tự gọi Git/provider/file write |
| Explorer expand/select/scroll → tool khác → Explorer | Cache/expanded/selection/scroll giữ nguyên, không refetch chỉ do switch |
| Full collapse → Header Show tools | Panel+rail+splitter biến mất; terminal nhận toàn body; reopen đúng tool và clamped width |
| Pointer kéo trái/phải, quá min/max | Đúng chiều; width bị clamp; không select terminal text hoặc gửi input |
| Pointer rời handle, cancel, mất capture/blur | Drag kết thúc; cursor/user-select/frame/listeners được dọn; UI không kẹt |
| Splitter Tab/arrows/Home/End/Enter | Keyboard resize/collapse đúng bounds; focus không rơi vào hidden content |
| Editor Normal → Expanded → Normal | Expanded theo bounds 50–70% khi đủ chỗ; Normal khôi phục width; không đổi terminal layout |
| Expanded Editor → Explorer; collapse/reopen Editor | Switch tool trả Normal; collapse/reopen cùng Editor giữ mode trước đó |
| `960 × 600`, `1440 × 900`, window shrink/grow, DPI | Mode 4 và controls dùng được; min bounds không overflow; widths tính CSS pixels |
| Bốn PowerShell, marker/command riêng khi panel thay đổi | PID/session ID/output/input giữ đúng pane; terminal resize không respawn |
| Layout 4 → 1 → 2 → 4 cùng panel resize | Hidden output tiếp tục ACK; buffer/session giữ; pane hiện lại fit đúng size |
| Panel focus → collapse → gõ terminal | DOM focus về active xterm; command chỉ tới session đó |
| Workspace A → B / Cancel / error | Success/error hiện Explorer; Cancel giữ panel/session; Explorer stale response không hiện trong B |
| App close khi panel collapsed/Editor active | Cleanup terminal vẫn theo native routine, không phụ thuộc right-panel visibility |

Ưu tiên chạy checks và UI automation trong phạm vi công cụ thực sự hỗ trợ. Frontend browser evidence chứng minh layout/state; native Tauri evidence mới chứng minh PTY/window behavior. Nếu cần xác nhận của người dùng cho case chưa thao tác được, ghi rõ case và nguồn xác nhận; không mặc định toàn ma trận đạt hoặc yêu cầu test lại các case đã có bằng chứng.

### Checklist hoàn tất

- [ ] Git mở mặc định; switch đủ bốn tools với một nội dung visible.
- [ ] Full collapse/header reopen giữ tool/width và trả diện tích cho terminal.
- [ ] Pointer/keyboard resize có bounds và cleanup đầy đủ.
- [ ] Editor Normal/Expanded hoạt động, Normal width được khôi phục.
- [ ] Terminal session/PID/buffer/layout/input/ACK giữ đúng khi panel thay đổi.
- [ ] Explorer cache/expanded/selection/scroll/pending request được giữ và reset đúng theo workspace.
- [ ] Actual focus/Tab order/accessibility đã được kiểm chứng.
- [ ] UI usable ở minimum window, không che actions hoặc fit terminal về zero.
- [ ] Automated/native checks có expected/actual result và nguồn rõ ràng.
- [ ] README/preview/plan phản ánh đúng status; không đánh dấu trước evidence.

## 12. Bàn giao Phase 5 và kiến thức đạt được

Phase 5 nhận Editor slot có Normal/Expanded, panel owner và visibility lifecycle ổn định; sau đó mới tích hợp Monaco, file API, models/tabs/dirty/save và Diff Viewer. Phase 6/8 thay Git/AI placeholder bằng controller/service tương ứng, không cần thay cơ chế dock/splitter của Phase 4.

Concept cần giải thích được: UI geometry khác process ownership, collapse khác unmount, width preference khác rendered width, focus khác selected pane. Những nguyên tắc này dùng cho sidebar/drawer, editor tabs và dashboard có nhiều nội dung chạy đồng thời.
