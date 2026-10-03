# Kế hoạch Phase 7 — UX, chạy song song với Phase 6

Ngày lập: 2026-10-03. Trạng thái: **core và Git integration đã triển khai; native acceptance và dogfooding còn chờ**.

Nguồn yêu cầu: [Project Instruction](../rules/Project_Instruction.md), mục 8–9, 12, 14, 23–29. Roadmap: [Implementation Plan](Implementation_Plan.md#phase-7--ux). Luồng phối hợp: [Phase 6 Git](../../docs/phase-6-git-preview.md). Baseline Editor: [Phase 5 Preview](../../docs/phase-5-editor-preview.md).

Theo yêu cầu hiện tại của user, plan sắp xếp các phần độc lập 7.1–7.4 để triển khai cùng Phase 6. Các phần core đã được ghép; lượt tiếp theo tập trung native acceptance và dogfooding, không đánh dấu hoàn tất chỉ dựa trên build.

## Implementation review (2026-10-03)

Core 7.1–7.4, workspace/Git transition guard và phần Git UI polish đã được triển khai. Git panel hiện có runtime guard, Normal/Expanded, structured push target, old/new preview, List/3 columns và bulk stage/unstage. Automated verification pass; native matrix và Task 7.5 dogfooding vẫn là phần còn thiếu để nghiệm thu Phase 7.

## 1. Mục tiêu và phạm vi song song

Giúp dùng Vibe Rider hằng ngày: thao tác bằng keyboard, layout/focus ổn định, giữ cấu hình qua restart và mở lại workspace với shell mới. Tận dụng thời gian Phase 6 xây Git service mà không để hai luồng cùng sửa các phần tích hợp chưa chốt contract.

| Task | Phần làm song song | Dependency còn lại |
| --- | --- | --- |
| 7.1 — Shortcuts | Routing layout 1/2/4, chọn/focus terminal, panel và Save hiện có | Chốt ownership tại checkpoint C0; Git shortcuts để sau |
| 7.2 — Layout polish | Geometry, focus, overflow, states của terminal/Explorer/Editor và shell | Git rows/branch/operation state đã tích hợp; native review còn chờ |
| 7.3 — Persistence | Schema, validation, settings read/write, hydrate UI preferences | C0 thống nhất nguồn state; không phụ thuộc Git CLI |
| 7.4 — Restore | Validate remembered workspace, startup state machine, shell policy và fixtures | Adapter workspace/exit cần C0; kiểm operation đang chạy sau 6.1/6.6 |
| 7.5 — Dogfooding | Chạy vòng sửa → build/test → review diff → commit trong app | Chờ native acceptance và fixture local remote |

Phase 8 có thể thiết kế độc lập nhưng không đưa vào lịch implementation này để giữ hai luồng tập trung. Phase 9/10 chưa bắt đầu trong plan.

Không mở rộng sang editor draft recovery, terminal scrollback/history persistence, tự chạy AI CLI/dev server, command palette, configurable keybindings, theme system hoặc thiết kế lại Git workflow.

## 2. Baseline đã kiểm tra từ source

- `TerminalWorkspace.tsx` giữ `layoutMode`, `activePaneId`, `visiblePair`; `App.tsx` cũng giữ active pane cho status. Cần một nguồn state trước khi shortcut và persistence cùng cập nhật.
- `useRightPanel.ts` quản lý panel open/tool/width và Editor Normal/Expanded; `panelLayout.ts` đã có geometry constraints. Chưa có hydrate/persistence.
- `MonacoEditor.tsx` đã đăng ký `Ctrl+S` theo editor; `TerminalPane.tsx` route xterm input vào PTY. Global listener mới phải tránh xử lý Save hai lần hoặc nuốt terminal input.
- `AppLayout.tsx` đang focus terminal qua CSS query khi collapse. Chưa có explicit focus handle chung cho shortcut và restore.
- `open_workspace` hiện chỉ nhận native picker, đóng terminal workspace cũ rồi commit Rust state. Frontend không có API mở path bất kỳ; restore phải thêm luồng backend chỉ dùng remembered workspace.
- `prepareWorkspaceChange` hiện dùng `window.confirm` Save All/Cancel; chưa có đầy đủ transition coordinator như Phase 5 plan. Pending-save, concurrent-open và Discard/picker-cancel là checkpoint cần kiểm chứng, không coi plan cũ là implementation đã đạt.
- `StatusBar.tsx` nhận Git branch context; Git service/UI và settings service đã có trong source. `package.json` chưa có frontend test script nên build không thay thế frontend behavior test.

Native baseline Phase 3/4/5 được kiểm song song như luồng verification của các task, không tính thành phase mới. Lỗi làm mất input/draft/session phải sửa và có evidence trước tích hợp; chỉ build/startup pass chưa đủ nghiệm thu.

## 3. Tổ chức hai luồng và checkpoints

```text
C0: chốt layout/focus, workspace transition và ownership files
  ├─ Luồng A: 6.1 Git service → 6.2 Status → 6.3 Diff → 6.4 → 6.5 → 6.6
  └─ Luồng B: 7.1 Shortcuts ─┬→ 7.2 Shell/layout polish
                             └→ 7.3 Persistence → 7.4 Restore
                                      ↓
C1: kiểm baseline UX độc lập; Git có thể còn đang hoàn thiện
                                      ↓
C2: ghép Git + UX, kiểm workspace/exit/focus/refresh với operations thật
                                      ↓
C3: native Phase 6/7 acceptance → 7.5 Dogfooding → nghiệm thu Phase 7
```

Không cần chờ toàn bộ Git hoàn tất để ghép một vertical slice. Sau C0, tích hợp layout controller trước; Git service và settings service tiếp tục làm trong modules riêng. Sau 6.2, ghép GitPanel và branch props; sau 6.6, kiểm đồng thời refresh/restore/close guard.

| Checkpoint | Deliverable cần review | Điều kiện đạt |
| --- | --- | --- |
| C0 — Contract | Action/focus/layout types, schema draft, workspace transition và file ownership | Hai luồng dùng cùng nguồn state/transition; không sửa chung file đồng thời |
| C1 — UX độc lập | 7.1–7.4 với Git placeholder hoặc adapter test | Shortcut/input/retention, settings và startup restore pass; ghi rõ Git runtime còn pending |
| C2 — Tích hợp | GitPanel, branch status, operation guard và UX | Dirty/pending-save/push/restore/workspace/exit matrix pass |
| C3 — Nghiệm thu | Evidence Phase 6 và vòng dogfooding 7.5 | Không mất draft/input/session; restart đúng preferences/workspace |

Lịch theo dependency, không ước lượng số ngày khi chưa có evidence. Song song tiết kiệm thời gian ở modules độc lập; shared-file adapters vẫn ghép tuần tự.

## 4. Ownership files và cách tránh xung đột

| File/nhóm | Owner khi thực hiện | Contract bàn giao |
| --- | --- | --- |
| `src-tauri/src/git/`, `src/git/`, `GitPanel.tsx` | Luồng A — Phase 6 | Status/operation state, branch props, transition wait/cancel hooks |
| `src/ux/`, `src/preferences/`, `src-tauri/src/preferences.rs` | Luồng B — Phase 7 | Layout/focus actions, validated preference DTO, remembered-workspace candidate |
| `TerminalWorkspace.tsx`, `TerminalPane.tsx`, `useRightPanel.ts`, `panelLayout.ts` | Luồng B | UI controller/focus handles; giữ PTY/session protocol |
| `SharedDiffViewer.tsx`, `src/editor/types.ts` | Luồng A cho Git diff extensions | Viewer source/mode/labels; luồng B chỉ review geometry contract |
| `App.tsx`, `AppLayout.tsx`, `RightPanel.tsx`, `StatusBar.tsx` | Owner tích hợp duy nhất tại mỗi checkpoint | Ghép props/actions từ modules đã review |
| `workspace.rs`, `lib.rs`, dependency manifests/lockfiles | Owner tích hợp duy nhất | Register services, shared workspace commit/exit coordination |
| `styles.css` | Owner tích hợp duy nhất | Luồng A nộp Git selectors; luồng B nộp shell/focus rules |

C0 ghi tên người/agent phụ trách thực tế trước implementation. Không yêu cầu spawn subagents chỉ vì plan có hai luồng. Khi dùng hai checkout/worktree, lấy cùng baseline đã gồm thay đổi Phase 5; worktree mới từ HEAD có thể thiếu code Phase 5 đang chưa commit. Giữ các thay đổi hiện có, không reset/clean để chia luồng. Branch/worktree và commit là bước tổ chức implementation, chưa thực hiện ở lượt lập plan.

Module/file trong plan chỉ tạo khi có responsibility thực tế; không tạo framework command/transition tổng quát hoặc store toàn app để phục vụ riêng việc song song.

## 5. Contract chung cần chốt tại C0

### Layout và focus

Một app-owned UI controller giữ layout `1 | 2 | 4`, active pane, visible pair và right-panel preferences. `TerminalWorkspace` nhận state/actions; `useRightPanel` giữ geometry helpers hoặc chuyển ownership vào controller, không giữ hai bản mutable state.

- Chọn pane chưa visible phải reveal theo rule hiện có: layout 1 hiển thị pane được chọn, layout 2 thay pair hợp lệ, layout 4 giữ bốn pane.
- Terminal focus dùng handle gọi xterm focus; editor dùng Monaco focus; panel còn lại focus heading/action khả dụng. Không phụ thuộc internal textarea CSS selector.
- Selection và focus là hai action riêng: hydration/refresh cập nhật metadata không giành keyboard focus; shortcut/click focus sau khi host visible và layout xong.
- Giữ mounted pane/models. Layout change chỉ fit/resize, không spawn/close hoặc reset buffer.
- Chốt active-tool click giữ hành vi thực tế đang dùng (click icon active khi mở sẽ collapse), đồng bộ docs/test; shortcut Select tool luôn mở/focus, shortcut Toggle tools mới toggle. Không sửa rail behavior ở cả hai luồng.

### Workspace transition và app exit

Một coordinator nhỏ phục vụ Open Folder, startup restore và app close. Candidate được validate trước teardown; editor xử lý dirty/pending-save; Git adapter cung cấp wait hoặc cancel-and-reap cho mutation đang chạy. Cùng một close listener ở App, không đăng ký listener cạnh tranh ở Phase 6/7.

- Khóa transition lặp lại trước await đầu tiên; chờ save đang chạy, giải quyết dirty decision và freeze editor mutation trong khoảng quyết định/commit.
- Picker Cancel/error hoặc candidate invalid: giữ workspace, draft và terminal. Nếu có Discard, chỉ dispose sau workspace commit success; Save thành công trước Cancel vẫn giữ kết quả đã lưu.
- Git operation đang chạy: user chọn Wait, Cancel operation rồi tiếp tục, hoặc Keep workspace/app. Chưa có câu trả lời thì chưa switch/close; cancel phải kết thúc/reap, không chỉ bỏ frontend request.
- Backend kiểm workspace identity trước commit, phối hợp lease Git/file write và terminal cleanup. Không giữ global mutex xuyên qua native dialog/network wait.
- Nếu current `open_workspace` commit quá sớm cho coordinator, tách candidate/commit hoặc bổ sung cơ chế tương đương qua owner tích hợp; không để restore bypass guards bằng một API nhận path tùy ý.

## 6. Shortcuts — Task 7.1

Danh sách phím dưới đây là proposal cần kiểm trong Windows WebView2, xterm, Monaco và IME trước khi chốt:

| Action | Proposal | Scope |
| --- | --- | --- |
| Layout 1/2/4 | `Ctrl+Alt+1` / `2` / `4` | App, khi không có modal/transition |
| Focus T1–T4 | `Ctrl+Shift+1` … `4` | Reveal pane rồi focus; không tự Start |
| Toggle tools | `Ctrl+Alt+B` | App; collapse trả focus về pane đang active |
| Focus tool | `Ctrl+Alt+G` / `E` / `M` / `A` | Git / Explorer / Editor / AI; Git focus dùng panel thật, AI vẫn là placeholder |
| Save active file | `Ctrl+S` | Editor editable; reuse Monaco action hiện có |
| Save All | Nút hiện có; phím bổ sung sau conflict audit | Editor controller, không global intercept terminal |

Không dùng `Ctrl+1/2/4` toàn app chỉ vì tài liệu vision đưa ví dụ. Phím được chốt sau audit; mọi action vẫn có click/keyboard-button fallback nếu tổ hợp bị OS/WebView/app con giữ lại.

Routing contract:

- Xác định context terminal/editor/text input/modal/diff. Input commit message, native dialog, IME composition và modal không bị layout/focus shortcuts làm gián đoạn.
- Chỉ `preventDefault` cho action đã match, khả dụng và được xử lý; tôn trọng event đã handled. Ctrl+C/V, Enter, arrows và Ctrl+S trong terminal tiếp tục theo input path hiện có.
- Khi nhận app shortcut trong xterm, phối hợp key handler trước `onData` để tổ hợp đó không vừa đổi layout vừa gửi bytes vào PTY. Monaco routing cũng không xử lý duplicate Save.
- Repeat không spam Save/transition; Ctrl+S trong read-only diff không invoke write. Listener/handler cleanup một lần theo owner, kiểm dev remount không duplicate.
- Tooltip/help nhỏ cạnh controls chỉ hiển thị phím đã verify; không thêm settings UI cho keybindings.

Checkpoint: layout và focus hoạt động bằng phím; probe terminal xác nhận app shortcuts không gửi bytes, các phím terminal thường vẫn đúng; Save gọi một lần đúng file.

## 7. Layout, focus và states — Task 7.2

Giữ giới hạn minimum window `960 × 600`, panel Normal/Expanded và layout 1/2/4; sửa theo evidence, không đổi design system cả app.

- Geometry có fallback visible khi Expanded không thỏa bounds ở cửa sổ nhỏ: về Normal và giữ preferred width/mode riêng, tránh panel open nhưng width zero. Không persist effective width zero hoặc fallback tự động thành sở thích user.
- Host đo size, skip zero-size layout, coalesce resize; hidden/show fit lại. Không focus chỉ vì ResizeObserver, Git refresh hoặc restored state.
- Header/status/tabs/actions overflow hợp lý; long path/branch/commit message không đẩy terminal viewport mất diện tích. Git-specific rows đã có review layout; native click-through vẫn cần xác nhận.
- Focus indicator và tab order visible; collapse chuyển focus có chủ đích, hidden content không còn tab stops. Loading/empty/error có retry/action, không làm remount sessions/models.
- Status bar bỏ phase label hard-code; nhận workspace/terminal state hiện có. Branch và Git operation props là optional cho tới 6.2/6.6, không gọi Git từ StatusBar.

Checkpoint: ma trận minimum/default window, layout `4 → 1 → 2 → 4`, Normal/Expanded, splitter pointer/keyboard và tools switch/collapse đạt; text/undo/scroll/session IDs và focus được giữ đúng.

## 8. Persistence — Task 7.3

Chọn settings JSON có version, Rust đọc/ghi ở một file cố định trong app config directory. Frontend gọi typed settings commands, không nhận arbitrary config path hoặc thêm filesystem plugin scope. Dev dùng directory runtime riêng đã cấu hình để test không ghi đè release preferences. Không thêm plugin store nếu backend JSON hiện có đủ dùng.

Schema đề xuất; không phải DTO đã triển khai:

```ts
interface UiPreferencesV1 {
  version: 1;
  terminal: {
    layoutMode: 1 | 2 | 4;
    activePaneId: "T1" | "T2" | "T3" | "T4";
    visiblePair: ["T1" | "T2" | "T3" | "T4", "T1" | "T2" | "T3" | "T4"];
  };
  panel: {
    open: boolean;
    activeTool: "git" | "explorer" | "editor" | "ai";
    normalWidth: number;
    editorSize: "normal" | "expanded";
    expandedWidth: number | null;
  };
}
```

Backend envelope còn giữ một remembered workspace record từ native selection thành công: root locator và identity dùng validate. Record không thuộc `save_ui_preferences` input. Runtime `workspaceId`, PID/session ID, commands, output, editor text/diff, Git status/tokens/commit message và credentials không persist.

- Proposed IPC: `load_ui_preferences`, `save_ui_preferences(preferences)`, `restore_last_workspace` và `forget_last_workspace`; tên chốt tại C0. Restore không nhận frontend path.
- File/settings fields là dữ liệu không đáng tin: giới hạn file đề xuất 64 KiB; validate version/enums/finite widths/pair distinct. Bỏ unknown fields có chủ đích, fallback defaults cho field lỗi; JSON hỏng hoặc version mới chưa hỗ trợ không làm crash startup và không bị tự overwrite bằng defaults.
- Width preference validate ở schema rồi clamp effective geometry theo viewport. Default lần đầu giữ layout 4/Git open; không lưu computed viewport state vào preference.
- Serialize writes, debounce đề xuất 300 ms sau user changes; snapshot sequence tránh write cũ thắng write mới. Hydration hoàn tất mới bật persistence; user interaction xảy ra trước load response thì response không được ghi đè state vừa chọn.
- Ghi file tạm cùng directory rồi replace theo cơ chế kiểm chứng trên Windows; lỗi giữ file cũ và UI còn dùng được. Không lưu settings vào workspace hoặc `.git`.
- Close bình thường flush latest preferences có timeout bounded sau guards; lỗi settings hiển thị Retry hoặc Close without saving preferences, không giữ app vô hạn. Crash recovery của draft và rollback settings không thuộc phạm vi.
- `forget_last_workspace` chỉ clear remembered record, không đóng workspace hiện tại, xóa project hoặc reset draft. Settings nằm ngoài selected-workspace root là ngoại lệ hẹp cho cấu hình app, không mở rộng file/editor permission.

Checkpoint: round-trip/restart, malformed/oversized/unsupported-version settings, storage error, rapid changes, late hydration và viewport shrink không mất preferences hoặc draft.

## 9. Restore workspace — Task 7.4

Luồng startup: load validated UI preferences → backend đọc remembered root → validate candidate → commit qua shared transition → frontend nhận descriptor mới → Explorer/Git load theo workspace ID mới. Không tái dùng ID của lần chạy trước.

- Remembered record chỉ được cập nhật khi native selection/transition commit thành công; picker Cancel/error giữ record trước. Root path trong file không tự trở thành permission: reject broad/system/invalid path, kiểm canonical root/identity và readable directory; record không chứng minh được origin/identity phải yêu cầu chọn lại bằng native picker.
- Root đã xóa/di chuyển, permission denied, disconnected drive hoặc invalid identity: startup về no-workspace với Open Folder/Forget/Retry. Không recursive scan, tự tạo directory hoặc mở repo parent thay folder nhớ.
- Startup restore chỉ chạy một lần, idempotent qua dev remount. Có request generation và backend commit token để Open Folder/Cancel restore mới thắng response cũ; bỏ response frontend thôi không đủ chặn stale backend workspace commit.
- Khôi phục UI preferences trước khi spawn; không để hydration/layout toggles gọi Start nhiều lần.
- V1 chỉ auto-start **một shell mới tại pane active** sau restore thành công; ba pane còn lại idle và có Start như hiện tại. Đây là policy đề xuất để giữ startup nhẹ, không cố khôi phục số process cũ. Nếu không restore workspace thì không auto-spawn; chọn Open Folder bình thường giữ Start thủ công.
- Shell chạy qua `terminal_spawn` hiện có tại root đã validate, sau khi pane host mount; dedup bằng workspace/pane ownership. Spawn fail giữ workspace, có Retry/Start; không loop vô hạn.
- Không replay terminal commands/input/output, AI CLI, dev server hoặc environment snapshot cũ. Terminal vẫn dùng shell startup behavior hiện có; không ghi command string mới để restore.
- UI restore không tự focus Monaco hoặc chuyển sang Explorer đè active tool đã nhớ. Shell background Start không cướp focus; user có thể focus terminal bằng shortcut/click.

Phần candidate/validation/settings có thể làm song song Git service; sửa workspace commit/close adapter chỉ qua owner tích hợp sau C0. Restore runtime chưa được đánh dấu hoàn tất ở C1 nếu Git operation guard thật chưa kiểm ở C2.

Checkpoint: restart workspace Unicode/spaces đúng root, ID mới, đúng một shell mới, không command replay; missing folder và Open Folder thắng restore chậm không đổi nhầm workspace.

## 10. Dogfooding — Task 7.5, chờ Phase 6

Sau nghiệm thu Phase 6, dùng một bản clone thử nghiệm của project với fixture remote để đi trọn vòng trong Vibe Rider:

1. Mở workspace, mở hai file, sửa và chuyển tabs/panels bằng shortcuts; Undo/Redo và Save đúng bytes.
2. Chạy build/test trong terminal, đổi layout và resize; giữ process/input/output.
3. Review staged/unstaged diff, stage đúng nội dung đã save, commit với message do người thực hiện chọn. Push nếu cần dùng local fixture remote, không đẩy repo thật để nghiệm thu.
4. Tạo draft chưa save, thử workspace switch và app close rồi Cancel; draft và processes còn dùng được. Kiểm guard khi Git operation đang chạy và save pending.
5. Save/close bình thường, restart: workspace/layout/panel đúng, shell mới ở pane active, không tự chạy lại build/test/CLI.

Ghi môi trường, expected, actual, commit fixture và evidence; sửa lỗi tái hiện trước nghiệm thu. Không dùng build pass hoặc docs existence làm bằng chứng dogfooding.

## 11. Files dự kiến và verification

| File/nhóm tạo hoặc sửa | Responsibility |
| --- | --- |
| `src/ux/useWorkspaceUi.ts`, `shortcutRouter.ts`, `useAppShortcuts.ts` | Một nguồn UI state, context routing và action availability |
| `src/ux/focusHandles.ts`, workspace transition module khi cần | Explicit focus, serialize transition; reuse editor/Git guards |
| `src/preferences/types.ts`, `preferencesApi.ts`, `useUiPreferences.ts` | DTO, IPC, hydration/write sequencing |
| `src-tauri/src/preferences.rs` | Fixed config file, validation, bounded/atomic write và remembered record |
| `src-tauri/src/workspace.rs`, `lib.rs` | Candidate validation/commit, restore ownership và command registration |
| `TerminalWorkspace.tsx`, `TerminalPane.tsx`, `useRightPanel.ts`, `panelLayout.ts` | Controlled layout, focus handles, safe geometry; không sửa stream/ACK protocol |
| App/layout/panel/status/style files | Adapter integration theo ownership mục 4 |
| `package.json`, lockfile khi cần | Test tooling tối thiểu cho race/routing checks; không mặc định thêm runtime dependency |

Automated verification cần có:

- UI state/schema: valid/invalid layout/pair, panel widths, unsupported version, malformed/large JSON và defaults.
- Shortcut routing: normal input/IME/modal, xterm bytes vs handled actions, Monaco single Save và read-only diff.
- Settings service: temp-directory round-trip, failed replace giữ old settings, write ordering và remembered root chỉ đổi sau commit.
- Lifecycle integration: hydrate vs user action, restore vs native picker, pending save/dirty Cancel, app close vs Git mutation, stale backend commit và spawn dedup.

Chưa có frontend test runner; chọn runner tối thiểu khi implementation và chỉ thêm tests cho các races/guards cần kiểm. Parser/state unit tests không thay native input/focus tests; mock terminal không chứng minh PTY retention.

| Native matrix | Expected | Actual hiện tại |
| --- | --- | --- |
| Keyboard/IME trong xterm, Monaco, commit input, modal/diff | Context đúng, không lost/duplicate bytes hoặc Save | Chưa chạy |
| Layout 1/2/4 + Normal/Expanded tại 960 × 600 và 1440 × 900 | Viewport dùng được, panel không tự biến mất, session/models giữ | Chưa chạy |
| Collapse/show/resize + Git focus refresh | Focus theo user action, background không cướp focus | Chưa chạy |
| Rapid resize/settings writes rồi close/restart | Preference mới nhất, geometry clamp đúng | Chưa chạy |
| Corrupt/unsupported/read-only settings | Startup dùng được, lỗi rõ, không tự phá file cũ | Chưa chạy |
| Restore Unicode/missing folder, Open Folder thắng restore chậm | Đúng root/token, không stale commit | Chưa chạy |
| Restore spawn fail/dev remount | Tối đa một shell active, retry có chủ đích | Chưa chạy |
| Dirty/pending-save + switch/close Cancel | Không mất draft/session; settings không bypass guard | Chưa chạy |
| Push/commit/restore đang chạy + workspace switch/exit | Wait/cancel/reap đúng, không đổi nhầm root | Chưa chạy; chờ Phase 6 |
| Dogfooding và native dev/release restart | Vòng sửa → verify → review → commit và restore đạt | Chưa chạy; chờ Phase 6 |

Commands dự kiến khi implementation:

```powershell
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git diff --check
npm run tauri -- dev
npm run tauri -- build --no-bundle
```

Chạy frontend test command sau khi có script thực tế; không ghi `npm test` pass khi repo chưa có. Settings/Git mutations dùng fixtures; native dev/release dùng config isolated và ghi environment riêng.

## 12. Tiêu chí hoàn tất và bước bắt đầu

- [ ] C0 chốt contracts/owner và đồng bộ rail behavior giữa docs/code.
- [ ] Baseline Phase 3/4/5 có native evidence; lỗi mất draft/input/session đã xử lý.
- [ ] 7.1 shortcuts không ảnh hưởng terminal/editor input; phím đã verify có help.
- [ ] 7.2 geometry/focus/states đạt minimum/default window và giữ model/session.
- [ ] 7.3 settings có version/validation, không overwrite do hydrate race và lỗi storage không phá file cũ.
- [ ] 7.4 remembered workspace đúng boundary, startup idempotent và chỉ spawn shell mới theo policy.
- [x] C2 workspace/app-exit coordination và Git operation wait/cancel foundation đã nối; native matrix còn chờ.
- [ ] Phase 6 nghiệm thu; 7.5 dogfooding đạt và restart giữ workspace/layout/panel.
- [ ] Actual results/limitations được ghi, README/roadmap phản ánh đúng status.

Bước đầu khi được yêu cầu implementation: thực hiện **C0 + vertical slice 7.1** — một nguồn layout state, một shortcut layout và explicit terminal focus; verify input/session retention rồi mới mở rộng 7.2/7.3. Không generate toàn Phase 7 trong một lượt hoặc đánh dấu hoàn tất chỉ vì phần UX độc lập đã pass.

Kiến thức đạt được: tách UI preferences khỏi runtime process; keyboard routing theo context; hydration/commit ownership; restore trạng thái không replay tác vụ; kiểm integration tại nơi hai luồng cùng tác động lifecycle.
