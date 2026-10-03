# Kế hoạch Phase 3 — Four Terminals

Ngày lập: 2026-10-03. Trạng thái: **đã triển khai implementation; native multi-pane verification đang chờ**.

Nguồn yêu cầu: [Project Instruction](../rules/Project_Instruction.md), mục 5–8, 14, 24, 27–29. Thứ tự task theo [Implementation Plan](Implementation_Plan.md#phase-3--four-terminals).

## 1. Mục tiêu và đầu vào

Khôi phục layout mặc định **2 × 2 với bốn terminal thật**, mỗi terminal có PowerShell/PTY, output buffer, input queue và lifecycle riêng. Người dùng chuyển giữa layout 1/2/4, chọn terminal, Close và Restart từng terminal mà các terminal khác tiếp tục chạy.

Phase 1 và Phase 2 đã được ghi nhận nghiệm thu trong tài liệu và người dùng xác nhận các thao tác native UI chạy được. Phase 3 kế thừa baseline đó; mọi kết quả kiểm thử mới của Phase 3 phải được ghi riêng khi triển khai.

Đối chiếu code hiện tại:

- `terminal/mod.rs`: `TerminalManager.active` là `Mutex<Option<TerminalSlot>>`, chỉ cho một reservation/session; commands đã có workspace/session/window ownership.
- `terminal/session.rs`: mỗi `RunningSession` có reader, writer/master, killer, waiter, Channel và ACK credit riêng; có `SessionIo` để thao tác ngoài manager lock.
- `TerminalWorkspace.tsx`: toàn bộ xterm, input, resize và session lifecycle nằm trong một component cho T1.
- `App.tsx`, `AppLayout.tsx`, `StatusBar.tsx`: truyền một `TerminalViewState`, cần chuyển thành snapshot của bốn pane.
- `workspace.rs`: `open_workspace` commit root mới; cleanup terminal hiện xảy ra ở React effect sau khi nhận descriptor. Phase 3 cần phối hợp cleanup toàn bộ session ở native boundary.
- `styles.css`: có grid mock 2 × 2, nhưng xterm host hiện có `min-height: 240px`; phải điều chỉnh để bốn pane dùng được ở `960 × 600`.

## 2. Phạm vi và quyết định UX

| Hạng mục | Quyết định Phase 3 |
| --- | --- |
| Pane | Bốn slot cố định `T1`, `T2`, `T3`, `T4`; không gán vai trò AI/Git/build cố định |
| Session | Tối đa bốn session trong app một cửa sổ; Rust kiểm soát giới hạn, tính cả starting/closing |
| Layout mặc định | 4 terminal, grid 2 × 2; người dùng luôn có nút chọn 1/2/4 |
| Startup | Bốn pane hiện sẵn; chưa mở workspace thì Start bị disable; Start từng pane bằng user action |
| Shell/CWD | Giữ PowerShell policy của Phase 2; root lấy từ workspace snapshot do Rust quản lý |
| Focus | Click pane hoặc nút T1–T4; active pane có viền rõ và được phản ánh ở status bar |
| Close | Kết thúc session của pane đó, giữ slot và output cuối để xem; Start lại khi người dùng chọn |
| Restart | Close xong mới spawn shell mới tại workspace root; cùng pane ID nhưng session ID mới; reset buffer của pane đó |
| Hidden pane | Giữ component/xterm/session; tiếp tục parse output, ACK và cập nhật status |
| Workspace switch | Cancel hoặc chọn folder không hợp lệ giữ workspace/session; chọn folder hợp lệ thu hồi toàn bộ session cũ trước khi commit |
| State | React state tại workspace owner + hooks/ref cho từng pane; chưa cần thêm Zustand chỉ cho bốn slot |
| Ngoài phạm vi | Drag/reorder, split tự do, persistence, shell settings, multi-window UI, editor, Git operations và AI tools |

Shortcut `Ctrl+1/2/4` vẫn là proposal trong Project Instruction. Phase 3 dùng buttons; shortcut toàn app và kiểm tra xung đột với shell/CLI thuộc Phase 7.

## 3. Kiến thức cần hiểu

| Concept | What / Why / How |
| --- | --- |
| Pane và session | Pane là vị trí UI lâu dài; session là một lần chạy shell. Restart giữ pane nhưng thay session |
| Ownership | Rust sở hữu PTY/process; controller của pane sở hữu xterm và Channel handler; workspace sở hữu layout/focus |
| Routing | Input/output/resize/ACK cần đúng workspace và session; không route output qua biến active terminal |
| Visibility | Ẩn pane thay đổi layout, không kết thúc process hay hủy output buffer |
| Concurrency | Bốn spawn/close có thể diễn ra đồng thời; reservation phải atomic và blocking IO phải nằm ngoài manager lock |
| Generation | Mỗi pane có token riêng để event/response của session cũ không ghi vào session mới |
| Backpressure | Một terminal output nhiều không được giữ credit hoặc lock của ba terminal khác |

## 4. Architecture và state ownership

```text
App / TerminalWorkspace owner
  ├─ layoutMode, visiblePaneIds, activePaneId
  ├─ pane snapshots T1–T4 → StatusBar
  └─ bốn TerminalPane luôn mounted, key = paneId
       └─ useTerminalSession cho từng pane
            ├─ xterm + FitAddon + ResizeObserver
            ├─ Channel + generation + input queue
            └─ spawn/write/resize/ack/close qua terminalApi
                         ↕
              Rust TerminalManager
                HashMap<sessionId, TerminalSlot>
                  ├─ T1 → PTY / PowerShell / credit riêng
                  ├─ T2 → PTY / PowerShell / credit riêng
                  ├─ T3 → PTY / PowerShell / credit riêng
                  └─ T4 → PTY / PowerShell / credit riêng
```

Pane snapshot đề xuất:

```ts
type TerminalPaneId = "T1" | "T2" | "T3" | "T4";
type TerminalLayoutMode = 1 | 2 | 4;

interface TerminalPaneSnapshot {
  paneId: TerminalPaneId;
  session: TerminalSession | null;
  state: TerminalViewState;
  error: string | null;
  exitCode: number | null;
}

interface TerminalWorkspaceSnapshot {
  layoutMode: TerminalLayoutMode;
  activePaneId: TerminalPaneId;
  visiblePaneIds: TerminalPaneId[];
  panes: Record<TerminalPaneId, TerminalPaneSnapshot>;
}
```

Workspace state giữ descriptor/status; ref trong controller phản ánh session hiện hành để IO không dùng closure cũ. Output bytes không được đưa vào React state hoặc copy sang global store. Xterm instance, observer, Channel và pending input thuộc controller riêng của pane.

React giữ state theo identity/vị trí component. Cả bốn pane có key cố định, cùng parent qua mọi layout; thay CSS visibility/order thay vì filter render hoặc đổi key theo layout/session. [React: preserving state](https://react.dev/learn/preserving-and-resetting-state).

## 5. Rust multi-session manager

Chuyển active slot đơn thành map, metadata của slot chứa `sessionId`, `workspaceId`, `paneId` và owner window. Với tối đa bốn slot, kiểm tra pane uniqueness trong cùng map là đủ; tránh tạo hai registry phải đồng bộ.

Các invariant bắt buộc:

1. Reserve và kiểm tra capacity trong cùng manager lock; không vượt bốn process/reservation khi spawn đồng thời.
2. Một `(window, workspaceId, paneId)` chỉ có một starting/running/closing slot.
3. Publish chỉ thay reservation có đúng session ID và metadata, đồng thời workspace vẫn active; stale spawn phải cleanup.
4. `session_io` tra đúng map entry, kiểm tra ownership rồi clone IO handles và thả manager lock trước write/resize/ACK.
5. Close giữ marker closing trong registry khi teardown; pane/capacity chỉ được giải phóng khi cleanup hoàn tất. Session closing từ chối input mới.
6. Duplicate Close khi đang closing cùng chờ kết quả cleanup; Close session đã thu hồi là no-op. Session của window khác bị từ chối; không thao tác session khác để trả no-op.
7. Natural exit thu hồi resource của đúng session; không giữ handle/thread đến lần spawn không liên quan. Nội dung và exit code còn ở UI.
8. Rollback, error và cleanup của T2 chỉ ảnh hưởng T2. `close_all_for_shutdown` phải bao gồm cả starting reservations và session bị ẩn.

Không giữ manager/workspace lock qua spawn, Channel send, kill hoặc thread join. Lock order khi phối hợp publish/switch là workspace state → manager; teardown chạy ngoài cả hai lock. Cleanup worker không join chính reader/waiter thread của mình.

## 6. Contract IPC

Giữ các commands Phase 2; thêm `paneId` vào spawn request/session metadata. Mỗi spawn vẫn có một Channel riêng, handler được gắn trước invoke. Tauri hỗ trợ Channel cho streaming. [Tauri command/Channel guide](https://v2.tauri.app/develop/calling-rust/).

| API | Contract Phase 3 |
| --- | --- |
| `terminal_spawn` | `{ request: { workspaceId, paneId, rows, cols }, onEvent }` → session descriptor có `paneId` |
| `terminal_write` | Giữ `{ workspaceId, sessionId, data }`; ghi đúng session, không broadcast |
| `terminal_resize` | Giữ `{ workspaceId, sessionId, rows, cols }`; master của đúng session |
| `terminal_ack` | Giữ `{ workspaceId, sessionId, sequence }`; credit/sequence độc lập từng session |
| `terminal_close` | Giữ `{ sessionId }`; owner validation, close đúng một session, dùng được sau khi workspace đổi |
| `terminal_list` — mới | `{ workspaceId }` → snapshot các slot của window/workspace, gồm starting/running/closing; phục vụ reconcile sau HMR hoặc cleanup lỗi |
| `terminal_close_workspace` — mới | `{ workspaceId }` → cleanup tất cả slot/reservations thuộc workspace của window gọi; không đóng session workspace/window khác |

`terminal_close_workspace` cũng là manager routine được native workspace switch dùng; không để frontend tự close tất cả trước khi picker kết thúc vì Cancel phải giữ session.

Event `started` chứa session descriptor. `data`, `exited`, `error` chứa `workspaceId`, `paneId`, `sessionId` và payload như Phase 2. `TerminalSession.state` vẫn là trạng thái lúc spawn; `terminal_list` dùng snapshot lifecycle riêng, không giả mọi slot là running.

JSON phải thật sự camelCase cho cả fields trong enum variants. Dùng `rename_all_fields = "camelCase"` hoặc explicit field renames cho event enum; `rename_all` ở enum chỉ đổi tên variants. Task 3.1 cần kiểm tra serialized payload bằng expected JSON keys; Rust serialize rồi deserialize cùng type chưa chứng minh TypeScript nhận đúng `sessionId`/`workspaceId`/`exitCode`. [Serde container attributes](https://serde.rs/container-attrs.html).

Thêm lỗi `INVALID_PANE`, `SESSION_LIMIT_REACHED`, `PANE_ACTIVE`, `WORKSPACE_SWITCHING` khi phù hợp. Giữ lỗi structured từ Phase 2. Rust từ chối stale workspace với write/resize/spawn; close vẫn cho phép thu hồi session cũ, ACK cuối chỉ áp dụng đúng stream đang drain.

## 7. Data flow và layout

### Start và IO

```text
Start T2 → reserve T2 → spawn PTY → publish → started → output stream
T2 onData → queue T2 → terminal_write(session T2) → PTY T2
PTY T2 → Channel T2 → xterm T2 → parser callback → ACK T2
```

Input queue capture session ID/generation của pane khi nhận dữ liệu; paste lớn chia UTF-8 bytes thành chunks tối đa 16 KiB, giữ thứ tự. Close/Restart hủy pending input chưa gửi. Input error trả về muộn chỉ cập nhật đúng generation.

Focus quyết định nơi nhận phím người dùng. `onData` còn có thể phát terminal replies khi parse escape sequences; những replies này vẫn phải gửi tới session sở hữu xterm đó, kể cả pane đang ẩn. Không dùng active pane để route mọi `onData`/output.

### Quy tắc layout

| Mode | Visible panes | Khi chọn T1–T4 |
| --- | --- | --- |
| 4 | T1 T2 trên, T3 T4 dưới | Chỉ đổi focus |
| 1 | Pane đang active | Hiện pane được chọn, ẩn pane trước |
| 2 | Hai pane nằm cạnh nhau | Click pane đang visible chỉ đổi focus; chọn pane ẩn cập nhật cặp visible |

Vào mode 2: chọn active pane và pane kế tiếp theo vòng T1 → T2 → T3 → T4 → T1. Lưu `visiblePaneIds` của cặp; không tính lại cặp chỉ vì click terminal bên cạnh. Mode 1/2 vẫn có selector/status cho cả bốn pane, kể cả pane ẩn hoặc closed.

Pane ẩn dùng CSS `display: none`, không unmount. Controller không fit hoặc gửi resize cho container zero-size; giữ geometry cuối. Khi pane hiện lại, fit sau layout ổn định, gửi size mới nếu đổi và chỉ focus pane active. FitAddon đo terminal theo container. [xterm addons](https://xtermjs.org/docs/guides/using-addons/).

Giảm min-height/padding và đưa actions vào header gọn để grid 2 × 2 đủ chỗ tại `960 × 600`; mọi grid/flex child có `min-height: 0`, `min-width: 0`. Không tự đổi về mode 1 hoặc tăng window minimum để né kiểm chứng mode 4.

## 8. Lifecycle, buffer và workspace switch

Mỗi pane có state `idle → starting → running → closing → idle`, hoặc `running → exited/error`. Start/Restart tạo generation mới; response spawn về sau Cancel/unmount/workspace switch phải bị đóng. Nếu `exited` đến trước invoke response, response đó không được khôi phục UI thành running.

Natural exit giữ output; disable user input ngay khi biết process exit và hoàn tất các parser callbacks đã nhận trước khi hiển thị trạng thái kết thúc. Close giữ output cuối; Restart chỉ reset buffer sau cleanup session cũ thành công. Không tự chạy lại command/AI CLI đã nhập.

Mỗi session giữ read chunk 16 KiB, in-flight payload tối đa 512 KiB, input chunk tối đa 16 KiB và xterm scrollback 5.000 lines như baseline. Bốn session có tối đa 2 MiB payload chưa ACK; con số này không đại diện toàn bộ RAM do còn JSON, parser/scrollback và OS buffers. Pane ẩn tiếp tục parse/ACK, không tạo queue output thứ hai. [xterm flow control](https://xtermjs.org/docs/guides/flowcontrol/).

Workspace switch cần có native transition gate:

1. Picker chọn candidate và Rust validate/canonicalize. Cancel hoặc validation error trả về trước khi cleanup.
2. Mark switching, chặn spawn/input/resize mới và invalidate starting reservations của workspace cũ; phối hợp với publish để không sót session về muộn.
3. Mark từng session closing, giải phóng worker chờ ACK, thu hồi cả pane visible/hidden ngoài manager/workspace lock.
4. Chỉ commit root/ID mới khi tất cả cleanup hoàn tất; React reset snapshots/buffer về idle, active T1 và giữ layout mode đã chọn.
5. Nếu cleanup lỗi, chưa commit workspace mới; báo lỗi, reconcile status từng pane bằng lifecycle/snapshot. Session đã đóng không tự sống lại; không mô tả failure là rollback mọi process.

Close app/window, HMR/unmount dùng cùng ownership/cleanup routine. Không chờ ACK vô hạn khi consumer mất. Đặt deadline cho native cleanup tests và trả lỗi rõ nếu teardown không hoàn tất. Kiểm chứng shell cùng child command/dev server; nếu session-owned child còn tồn tại thì phải sửa ownership/cleanup trước nghiệm thu Phase 3, có thể cần Windows Job Object.

Đường dẫn canonical `\\?\` vẫn là baseline hợp lệ. Làm đẹp prompt/path display là thay đổi riêng, không đưa vào việc quản lý bốn terminal.

## 9. Files cần tạo/sửa

| File | Responsibility |
| --- | --- |
| `src-tauri/src/terminal/mod.rs` | DTO/pane validation, multi-session registry, list/close-workspace, routing/reservation tests |
| `src-tauri/src/terminal/session.rs` | Metadata pane, IO/credit riêng, exit notification và resource cleanup |
| `src-tauri/src/workspace.rs` | Transition gate, candidate validation → close old sessions → commit |
| `src-tauri/src/lib.rs` | Register commands, native window/app cleanup cho toàn bộ registry |
| `src/terminal/types.ts`, `terminalApi.ts` | Pane/layout/snapshot DTO và typed wrappers |
| `src/terminal/useTerminalSession.ts` — mới | Controller một pane: xterm, Channel, generation, input, fit/resize, cleanup |
| `src/terminal/useTerminalWorkspace.ts` — mới | Snapshots/layout/focus cho bốn pane, reconcile và workspace lifecycle |
| `src/terminal/layout.ts` — mới | Pure layout selection rules để test mode 1/2/4 |
| `src/components/TerminalPane.tsx` — mới | Header/actions/output/error của một pane, stable identity |
| `src/components/TerminalWorkspace.tsx` | Grid/layout controls, bốn pane mounted, active pane |
| `src/App.tsx`, `AppLayout.tsx`, `StatusBar.tsx` | Truyền bốn pane snapshots và chọn terminal từ status bar |
| `src/styles.css` | Grid modes, hidden/focus, compact pane và minimum window size |
| `package.json`, `package-lock.json` | Chỉ thêm frontend test tooling phù hợp khi triển khai tests; không đổi terminal stack |
| `docs/phase-3-four-terminals-preview.md` | Phạm vi/checklist ở lượt lập kế hoạch; thêm actual results và native smoke evidence khi triển khai |
| `README.md`, các plan | Cập nhật trạng thái theo kết quả đã chạy |

Plan này được dùng làm contract triển khai. Automated checks đã có actual result; native multi-pane smoke chưa được đánh dấu pass. Không cài thêm test runner/package ngoài stack hiện tại.

## 10. Task triển khai và điểm kiểm chứng

| Task | Công việc | Điểm kiểm chứng trước task tiếp |
| --- | --- | --- |
| **3.1 — Multi-session manager** | Map thay slot đơn, pane/capacity reservation, DTO/event JSON, list/close-workspace, routing và cleanup từng session | Bốn reservation/session ID riêng; double-spawn cùng pane bị chặn; lookup/Close/ACK T2 không ảnh hưởng T1/T3/T4 |
| **3.2 — Grid 2 × 2** | Tách controller/pane, bốn slots, focus, Start/Close từng pane và bốn trạng thái ở status bar | Bốn PowerShell chạy đồng thời, marker/output và phím đúng pane; UI usable ở minimum window |
| **3.3 — Layout 1/2/4** | Buttons/visible-pair rules, stable components, fit-on-show và hidden parsing | Đổi 4 → 1 → 2 → 4 giữ session ID/PID/buffer; hidden output vẫn chạy; không treo vì thiếu ACK |
| **3.4 — Session actions/lifecycle** | Restart độc lập, stale-event/exit barrier, transactional workspace switch, HMR và app cleanup | Restart T2 chỉ đổi ID/PID T2; switch thu hồi mọi slot; late response không leak process |
| **3.5 — Independent verification** | Native multi-PTY tests, test routing/layout lifecycle, chạy đồng thời shell/server/build/CLI và ghi evidence | Checklist Phase 3 đạt, không còn process/session/output thuộc workspace cũ |

Thứ tự: `3.1 → 3.2 → 3.3 → 3.4 → 3.5 → nghiệm thu Phase 3`.

Khi triển khai, bắt đầu Task 3.1, giải thích ownership/data flow, ghi expected/actual result rồi tiến từng checkpoint theo working style của project. Không đánh dấu task hoàn tất chỉ vì code đã được viết.

## 11. Kiểm thử và nghiệm thu

### Automated checks và actual result

- Rust: concurrent reservations/capacity, duplicate pane, partial spawn rollback, owner/session/workspace lookup, idempotent close, stale publish và JSON camelCase contract.
- Rust Windows integration: bốn PTY cùng lúc, mỗi shell sinh marker riêng; resize một session giữ các PID; Close/Restart một session; exit/error và cleanup toàn bộ sau workspace switch.
- Frontend: pure mode/focus rules, mock Channel events interleaved, late invoke response sau exit/restart, pane mount retention, per-session input/ACK và paste chia chunks đúng thứ tự.
- Output flood: hữu hạn và chậm ACK ở một pane; ba pane khác nhận input/resize bình thường; marker cuối không mất; Close có deadline kể cả pane đang ẩn.
- Fixture/test session cleanup kể cả assertion fail. Native test có timeout và chỉ theo dõi PID/handles do test tạo; không kill theo tên `node`/`powershell` toàn máy.

Actual result ngày 2026-10-03: `npm run build` pass; `cargo fmt -- --check`, `cargo check`, `cargo test` **16/16 pass** (gồm native PowerShell PTY round-trip, bốn reservation, duplicate pane và camelCase event contract); `cargo clippy --all-targets -- -D warnings` pass; `git diff --check` pass. Chưa chạy full native multi-pane click-through matrix trong mục dưới.

```powershell
npm run build
# Frontend test command sẽ được thêm cùng test runner ở Task 3.2.
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri -- dev
git diff --check
```

Không chạy build/test lại chỉ để nghiệm thu file plan. Các lệnh trên dành cho implementation; lượt lập plan chỉ kiểm tra Markdown, liên kết và diff.

### Ma trận smoke native dự kiến

| Case | Expected result |
| --- | --- |
| Chưa mở workspace | Bốn pane idle, Start disabled; Rust cũng từ chối spawn trực tiếp |
| Start T1–T4 | Bốn session ID/PID riêng, `Get-Location` cùng workspace root |
| Marker `[T1]` … `[T4]` | Output nằm đúng pane, không bị broadcast/nhân đôi |
| Click focus/paste/arrows/Ctrl+C | Input/control bytes chỉ ảnh hưởng shell được focus |
| Layout 4 → 1 → 2 → 4 | Session/PID/output buffer giữ nguyên; cặp pane không đổi khi click pane bên cạnh |
| Hidden output > credit limit | Pane ẩn vẫn parse/ACK, khi hiện lại thấy output; pane khác không treo |
| Window resize/minimize/restore | Pane visible được fit đúng, hidden giữ size cuối, không respawn |
| Close/Restart T2 | Ba session còn lại giữ PID/buffer và command đang chạy |
| `exit 7` ở T3 | Giữ output cuối, hiện exit code 7; Start lại cấp ID mới |
| Workspace A → B / Cancel | A → B thu hồi bốn session trước commit; Cancel giữ nguyên tất cả |
| Switch khi Start đang pending | Reservation cũ bị hủy; process về muộn bị cleanup, không xuất hiện trong B |
| App close khi server/output đang chạy | Thu hồi session và child thuộc app; không giữ port/process test |
| Shell + dev server + build/test + CLI tương tác | Bốn workflow chạy đồng thời, không gán vai trò cố định cho pane |
| `960 × 600` và `1440 × 900` | Cả mode 4 và supporting panel dùng được, actions/status không che terminal |

Native UI evidence có thể từ kiểm tra trực tiếp hoặc xác nhận của người dùng; ghi rõ nguồn và phạm vi đã thử. Dòng output CLI đơn lẻ không chứng minh toàn bộ ma trận pass. Browser preview chỉ xác nhận frontend rendering.

### Checklist hoàn tất Phase 3

- [ ] Bốn PTY/PowerShell sessions chạy độc lập, backend enforce capacity/pane ownership.
- [ ] Input/output/resize/ACK không lẫn session, lỗi một pane không đổi pane khác.
- [ ] Grid mặc định 2 × 2, mỗi pane có focus/status/actions riêng.
- [ ] Layout 1/2/4 giữ component, session ID/PID và buffer; pane ẩn tiếp tục parse/ACK.
- [ ] Close/Restart/exit hoạt động từng pane; session response/event cũ bị loại bỏ.
- [ ] Workspace switch, Cancel, pending spawn và native app close thu hồi đúng toàn bộ session.
- [ ] Shell/child-process cleanup và output flood được kiểm chứng với deadline.
- [x] Automated checks có actual result rõ ràng; native smoke tests vẫn chờ click-through.
- [ ] Mode 4 usable tại `960 × 600`; supporting tools vẫn bên phải.
- [ ] README/preview/plan ghi đúng tiến độ, không đánh dấu case chưa thử là pass.

## 12. Bàn giao và kiến thức đạt được

Sau Phase 3 cần giải thích được pane identity khác session identity, routing khác focus, hidden khác Close, và vì sao mỗi session cần credit/generation/lifecycle riêng. Các concept này cũng dùng cho nhiều process, tab editor và request chạy đồng thời.

Phase 4 nhận terminal workspace đã hoạt động độc lập; switch/collapse/resize supporting panel chỉ ảnh hưởng geometry, không làm mất bốn sessions.
