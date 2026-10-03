# Kế hoạch Phase 5 — Editor

Ngày lập: 2026-10-03. Trạng thái: **core đã triển khai; native click-through đang chờ**.

Nguồn yêu cầu: [Project Instruction](../rules/Project_Instruction.md), mục 4, 11–12, 14, 19, 23–29. Thứ tự task: [Implementation Plan](Implementation_Plan.md#phase-5--editor). Checklist và actual results: [Phase 5 Preview](../../docs/phase-5-editor-preview.md).

## 1. Mục tiêu và baseline

Thay Editor placeholder bằng Monaco trong right panel để mở, sửa, lưu file text có sẵn trong workspace; giữ nhiều tab, dirty buffer và undo history; cung cấp Diff Viewer dùng chung cho Phase 6/10. Terminal tiếp tục là main workspace.

Baseline kiểm tra từ code khi lập plan:

- React 18, TypeScript 5.5, Vite 5 và Tauri 2; chưa có `monaco-editor`, Zustand hoặc frontend test runner trong `package.json`.
- `RightPanel.tsx` có Editor placeholder và Normal/Expanded; App sở hữu Explorer controller và `useRightPanel`. Slots được giữ mounted qua switch/collapse.
- `ExplorerTreeNode.tsx` hiện chỉ toggle directory hoặc select leaf; chưa có callback mở file. Backend phân biệt `directory`, `file`, `link`, `other`.
- Rust chỉ có `read_directory`; `path_guard.rs` validate relative path, canonical containment và chặn link/junction/reparse. Chưa có resolver cho regular file, read/write text hoặc save revision.
- `open_workspace` hiện chọn folder, đóng session của workspace trước rồi thay Rust workspace state. Guard dirty phải chạy **trước khi gọi command**, không đợi frontend nhận descriptor mới.
- `lib.rs` cleanup terminal ở app exit; chưa có dirty-editor close guard.
- Phase 3/4 native smoke còn pending trong tài liệu. CSS đã có slot fill-height và explicit layout 4; working tree hiện có thay đổi App/RightPanel đưa active-tool toggle collapse trở lại, khác rule no-op trong README. Giữ nguyên các thay đổi đó ở lượt lập plan; checkpoint baseline phải reconcile behavior và kiểm lại tools tự hide trước tích hợp Editor.

Core implementation đã hoàn thành theo các task bên dưới. Native baseline `1 → 2 → 4`, panel switch/resize/collapse, focus và terminal retention vẫn phải xác nhận riêng; nếu còn lỗi layout/tools thì sửa trước khi đánh dấu nghiệm thu Phase 5.

## 2. Phạm vi và quyết định UX

| Hạng mục | Quyết định Phase 5 |
| --- | --- |
| Vị trí | Editor trong right panel; tái sử dụng Normal/Expanded của Phase 4 |
| Open | Click file thường hoặc Enter khi label file đang focus; select rồi mở/focus tab. Directory vẫn toggle, link/other báo unsupported |
| Tab identity | Một file trong cùng workspace chỉ có một edit model/tab; label filename, tooltip relative path, disambiguate tên trùng |
| Open lại | Focus model đang mở, giữ draft và undo; không đọc lại đĩa để ghi đè draft |
| Size mode | Mở từ Explorer ở Normal, không auto-expand. Chọn tab trong Editor giữ mode; collapse/reopen giữ mode theo Phase 4 |
| Save | Nút Save rõ ràng; chỉ lưu file hiện có, phải kiểm revision; không autosave |
| Dirty | Chỉ báo khi text hiện tại khác saved baseline; Undo về baseline trở lại clean |
| Close | Tab dirty có Save / Discard / Cancel; tab clean đóng ngay |
| Workspace/app exit | Save All / Discard All / Cancel cho draft; chờ save đang chạy và kết quả guard trước khi chuyển/đóng |
| Conflict | Giữ draft, cho Compare với disk / Reload có xác nhận / Keep editing; chưa có force overwrite |
| External change | Kiểm lại khi tab được kích hoạt, app lấy focus hoặc user Reload, và bắt buộc khi Save; chưa cần watcher |
| Diff | Read-only saved-vs-draft review; caller Phase 6/10 truyền snapshot sau này; preview không ghi filesystem |
| Ngoài phạm vi | New file, Save As, rename/delete, format-on-save, persistence/recovery, full LSP, Git operations, AI patch apply |

Save bằng `Ctrl+S` chỉ đăng ký trong Monaco khi Editor focus; terminal focus không bị intercept. Global shortcuts vẫn thuộc Phase 7. Nếu close confirmation đang pending, chỉ có một dialog và khóa action đổi workspace/close lặp lại.

## 3. Kiến thức cần hiểu

| Concept | What / Why / How |
| --- | --- |
| Model và view | Model giữ text/history; editor view hiển thị model. Tách owner để đổi panel/tab không mất nội dung |
| Dirty và disk revision | Dirty so draft với baseline; revision so đĩa hiện tại với lần đọc/lưu trước. Hai trạng thái giải quyết hai vấn đề khác nhau |
| Encoding và EOL | UTF-8/BOM và LF/CRLF là thuộc tính bytes trên đĩa; serializer giữ format, không tự thêm newline |
| Optimistic concurrency | Hash bytes + identity phát hiện file đã đổi; Save kiểm ngay trước commit và trả conflict thay vì silent overwrite |
| Atomic replacement | Chuẩn bị file tạm rồi replace để giảm nguy cơ file đích bị ghi một nửa; cần kiểm lỗi Windows và metadata |
| Lifecycle guard | Close/switch chỉ dispose draft sau lựa chọn và operation thành công; Cancel giữ state |

Monaco mô tả model, URI, editor view và disposable như các resource riêng. Plan áp dụng cách tách owner này để giữ draft khi view ẩn. [Monaco concepts](https://github.com/microsoft/monaco-editor#concepts).

## 4. Architecture và ownership

~~~text
App
  ├─ workspace + useWorkspaceExplorer                   (đã có)
  ├─ useRightPanel: visibility, width, Normal/Expanded    (đã có)
  └─ WorkspaceEditor controller
       ├─ scoped Zustand store: tab metadata/actions
       ├─ model registry: Monaco models + saved baseline + view state
       └─ transition coordinator: open/save/reload/close/workspace/exit
            ↓
RightPanel → EditorPanel → EditorTabs + MonacoEditor / SharedDiffViewer
Explorer → onOpenFile(entry) → controller → editorApi → Tauri IPC
                                                        ↓
Rust file service → WorkspaceState + file path guard → Local filesystem
~~~

- Dùng Zustand scoped cho editor metadata vì Explorer, tabs, toolbar và close guard cùng đọc state. Giữ workspace/terminal/UI controllers hiện có; không gom vào một store.
- App tạo một editor controller có lifetime dài hơn visibility. Registry giữ model, baseline text, listeners và view state ngoài serializable store; không copy toàn bộ text vào React/Zustand mỗi phím.
- Monaco view attach/detach model; model chỉ dispose khi tab thực sự đóng hoặc workspace switch đã commit. Tab switch lưu/khôi phục cursor, selection và scroll. Undo/redo nằm ở edit model.
- Rust quản lý canonical root, file access, encoding/revision và write commit. Frontend chỉ gửi workspace ID + relative path; model URI/file ID không phải permission boundary.
- React StrictMode và lazy import phải có cleanup/idempotency: không duplicate model/listener/worker và không làm dispose buffer chỉ vì view remount.

## 5. File API, format và access contract — Task 5.1

### 5.1.1. Chính sách file

| Input | Hành vi |
| --- | --- |
| Regular text file UTF-8 | Mở/edit/save; giữ BOM nếu có |
| LF hoặc CRLF đồng nhất | Giữ EOL; không tự thêm/xóa final newline, thay đổi user chủ động sửa được lưu theo draft |
| File rỗng/single line chưa có EOL | Mở được; mặc định LF cho newline mới, không thêm newline chỉ vì save |
| Mixed LF/CRLF hoặc bare CR | View read-only, giải thích format chưa hỗ trợ edit; không silently normalize |
| UTF-16, UTF-32, ANSI/invalid UTF-8 | Trả unsupported encoding, không lossy decode |
| Binary | Reject theo byte signature/NUL/control-byte policy, không chỉ theo extension |
| Directory, link/junction/reparse, other | Reject; file resolver không dùng resolver directory để đọc file |
| File > 2 MiB | Reject bounded read; save kiểm lại size bytes sau encode |
| Quá 20 tabs hoặc 20 MiB tổng text đầu vào | Báo limit, giữ tab cũ; không auto-evict dirty tab |

Các giới hạn là quyết định ban đầu để implement/profile; cả Rust lẫn frontend kiểm đúng phần mình sở hữu. Tổng bytes draft được tính lại khi edit/import, vượt giới hạn thì chặn Save/nhận thêm model và cho user giảm nội dung hoặc đóng tab; không truncate draft. Đọc dùng giới hạn thực tế `MAX_FILE_BYTES + 1`, không chỉ tin metadata trước read.

Mở rộng path guard: non-empty relative path; chặn traversal, absolute/UNC/device/drive-relative/ADS/NUL; kiểm từng component không đi qua link/reparse; canonical target nằm trong root và là regular file. Windows names/alias/case và path có dấu/khoảng trắng cần test. Backend trả file identity để dedup; không lowercase path tùy tiện ở frontend. File writable có nhiều hard links cần chính sách reject rõ để atomic replacement không âm thầm đổi semantics.

### 5.1.2. DTO dự kiến

~~~ts
type ReadFileRequest = { workspaceId: string; relativePath: string };
type TextFileSnapshot = {
  workspaceId: string;
  fileId: string;          // stable canonical-path identity trong workspace
  relativePath: string;    // normalized path, không dùng absolute root ở request
  content: string;         // text không chứa UTF-8 BOM đầu file
  revision: string;        // opaque hash của disk bytes + target identity
  byteLength: number;
  encoding: "utf8";
  bom: boolean;
  eol: "lf" | "crlf" | "none" | "mixed" | "cr";
  writable: boolean;
};
type WriteFileRequest = {
  workspaceId: string;
  relativePath: string;
  expectedRevision: string;
  content: string;
};
type WriteFileResult = {
  workspaceId: string; fileId: string; relativePath: string;
  revision: string; byteLength: number;
};
~~~

- Expose `read_file` / `write_file` bằng camelCase DTO như `read_directory`; `{code, message}` nhất quán. `NO_WORKSPACE`, `STALE_WORKSPACE`, `INVALID_PATH`, `OUTSIDE_WORKSPACE`, `LINK_NOT_SUPPORTED`, `NOT_FILE`, `NOT_FOUND`, `FILE_TOO_LARGE`, `BINARY_FILE`, `UNSUPPORTED_ENCODING`, `READ_ONLY`, `FILE_CONFLICT`, `IO_ERROR` cần test.
- Read trả snapshot nhất quán: content, format và revision từ cùng bytes; mtime/size chỉ phục vụ hiển thị, không đủ làm revision. Dùng hash mạnh như SHA-256 và identity target; chốt dependency nhỏ khi implement.
- `fileId` là identity logic ổn định của canonical relative path trong workspace, normalize aliases/case tại Rust; khác physical file identity dùng trong revision. Atomic replace có thể đổi physical identity nhưng không đổi tab/model URI; Save phải giữ `fileId` của cùng logical file.
- Write không tin format từ frontend: re-read file hiện tại, kiểm expected revision, giữ BOM/EOL đã xác thực, validate text/size và trả revision của bytes đã ghi. File bị xóa thì báo `NOT_FOUND`, không tự tạo lại.
- Bounded filesystem work nằm trong `spawn_blocking`. Read loại stale result; write phải validate workspace ở commit, không chỉ kiểm sau khi đã ghi đĩa.

### 5.1.3. Save commit

1. Serialize save theo file; khóa lại workspace transition để tránh old-workspace write. Reuse `WorkspaceState::while_workspace_is_active` hoặc operation lease tương đương; thống nhất lock order và không giữ mutex trên UI thread qua async await.
2. Resolve target và đọc current bytes/format/identity; mismatch revision trả `FILE_CONFLICT` trước khi đụng file đích.
3. Encode snapshot bằng UTF-8, giữ BOM/EOL, không trim/format/add newline; tạo temp file duy nhất bằng `create_new` ở cùng validated parent.
4. Ghi đủ bytes và sync temp; kiểm lại workspace, path/identity/revision sát commit; giữ metadata/permissions cần thiết của file đích.
5. Replace file đích bằng rename/replace phù hợp Windows; không delete file đích trước. Cleanup temp chỉ do operation sở hữu khi lỗi; old file giữ nguyên nếu pre-commit thất bại.
6. Trả revision của committed bytes; frontend cập nhật saved baseline của snapshot, không thay draft đang edit.

`std::fs::rename` hỗ trợ replace nhưng behavior/error phụ thuộc OS/filesystem; cần native test Windows với file đích đang mở, read-only, ACL và permission failure. Nếu primitive không giữ được metadata đã yêu cầu, dùng replacement helper phù hợp trước nghiệm thu. [Rust rename](https://doc.rust-lang.org/std/fs/fn.rename.html).

Đây là optimistic conflict check: terminal/AI CLI không dùng mutex của app, nên hash-then-replace không đảm bảo compare-and-swap tuyệt đối với external write trong khoảng commit. Revalidate thu hẹp race; ghi giới hạn này trong actual results. Không tuyên bố bảo vệ khỏi mọi concurrent process, malicious filesystem race hoặc power loss.

## 6. Monaco integration và open file — Task 5.2

- Thêm `monaco-editor` và Zustand khi implement, chọn versions tương thích stack, khóa lockfile; chưa install hoặc nâng React/Vite trong lượt plan.
- Dùng Monaco ESM và Vite workers nội bộ, cấu hình `MonacoEnvironment.getWorker` trước tạo editor. Lazy-load editor runtime khi mở Editor/file đầu tiên; không CDN hoặc fetch workspace text từ web. Core editor worker và language workers tương ứng phải có trong build. [Monaco ESM/Vite](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md#using-vite).
- Syntax highlighting tối thiểu TS/JS, JSON, Rust, Markdown, HTML/CSS và plaintext fallback. Không resolve full repo/types/LSP trong phase này.
- Controller dedup open requests; token/generation theo workspace/file. A/B mở liên tiếp không để response A muộn giành active tab của B. Tab closing trước read complete không tự xuất hiện lại.
- Request path normalize từ backend; model URI có workspace ID và file identity, encode đúng tên có dấu/khoảng trắng; URI mới cho workspace mới. Aliases trả cùng identity không tạo hai model cho một file.
- Empty/loading/error/retry/read-only state có action rõ; lỗi read không ghi đè draft khác. Sau open thành công chọn Editor, gắn model và focus Monaco sau layout; đọc không thành công giữ error dễ truy cập.
- Không key Editor theo width hoặc active file. ResizeObserver đo host, coalesce layout bằng frame; bỏ layout zero-size khi hidden, layout lại khi show/Expanded. Không chiếm focus chỉ do fit/resize.
- Giữ slot fill-height, `min-width/min-height: 0`, toolbar/tabs không ép Monaco viewport về zero. Test Normal ở width 272/304 px và Expanded, cùng window 960 × 600.

## 7. Edit/save, dirty và conflict — Task 5.3

Model registry giữ current model + saved baseline. Dirty tính theo text so với baseline có cùng chuẩn EOL, không coi change/version counter là bằng chứng nội dung khác. Debounce chỉ để cập nhật indicator; flush dirty trước Save/Close/Workspace/Exit. Undo về baseline phải clean.

Save flow:

~~~text
Save → capture draft snapshot + expected revision + model version
     → write_file → validate/encode/commit
       ├─ success → saved baseline = snapshot; revision = returned revision
       │            current draft khác snapshot → vẫn dirty
       └─ error/conflict → giữ draft/undo/baseline; hiển thị action sửa lỗi
~~~

- Save một file chỉ có một request in-flight; disable duplicate Save, không queue vô hạn. User vẫn có thể edit khi save thường; response không gọi `setValue` để mất edit/undo.
- Save All chạy tuần tự có kết quả từng file; failure/conflict dừng close/switch, giữ draft chưa lưu. Không hứa rollback các file đã save thành công trước đó.
- External check dựa trên revision. Tab clean có disk mới: banner Reload; không tự thay model ngay khi focus. Tab dirty: banner conflict, giữ draft. Deleted file: giữ draft có thể copy, báo missing; không silently recreate.
- Compare disk-vs-draft dùng snapshot mới trong Diff Viewer, không tự đổi saved baseline/expectedRevision. Reload dirty luôn hỏi Discard/Cancel; Keep editing không cho force write stale revision.
- Thao tác Reload thật sự reset model/undo sau xác nhận; save/update indicator thông thường giữ history. Error toast/message không đưa toàn content hoặc sensitive file bytes vào log.

## 8. Tabs và lifecycle — Task 5.4

Tabs có ordered file IDs, active ID, status loading/ready/saving/error/conflict/read-only và dirty badge. Dùng ARIA tabs đầy đủ với Arrow/Home/End hoặc buttons có accessible labels; không gắn tab role nếu chưa có keyboard contract. Close buttons không làm active file khác ngoài ý muốn; đóng active chọn tab bên phải, nếu không có thì bên trái.

| Trigger | Guard/commit |
| --- | --- |
| Đóng một dirty tab | Save thành công mới dispose; Discard chỉ bỏ tab đó; Cancel giữ tab/focus |
| Switch panel, collapse, resize | Không prompt/dispose; giữ text/undo/cursor/scroll, session/layout terminal |
| Open Folder khi có draft | Guard trước `open_workspace`; Save All hoàn tất hoặc stage Discard All rồi mới mở picker |
| Picker Cancel/error | Giữ workspace, editor models và terminal; stage Discard không được xóa draft trước picker success |
| Workspace mới commit | Invalidate old reads/saves, dispose models/listeners old workspace và init store mới; terminal cleanup theo backend |
| App X/Alt+F4 | Prevent close khi dirty/pending save, guard một lần; Save All/Discard All cho phép close, Cancel giữ app/sessions |

Transition coordinator tạm khóa editor mutations/open/save/close trong lúc quyết định/picker/commit để snapshot không đổi ngoài guard. Save đã có trước đó phải hoàn tất trước transition. Save All được xử lý bởi coordinator; khi switch Cancel, những file đã save vẫn saved nhưng remaining models vẫn tồn tại.

Tauri close interception dùng `onCloseRequested` + `preventDefault` và listener cleanup; sau guard approved gọi close với flag một lần để tránh lặp dialog. Verify permissions với API đang dùng; chỉ thêm core window/event permissions cần thiết. Forced kill/crash recovery thuộc phạm vi khác. [Tauri window close API](https://v2.tauri.app/reference/javascript/api/namespacewindow/#oncloserequested).

Nếu write đang chạy, backend workspace lease đảm bảo commit old-root hoàn tất trước workspace swap hoặc reject trước commit. Frontend generation bỏ stale response không thay thế được guard backend. Không thay terminal spawn/ACK/session logic để xử lý editor lifecycle.

## 9. Shared Diff Viewer — Task 5.5

`DiffPreview` gồm `previewId`, labels, language, original/modified text snapshot và source `editor | git | ai`; viewer nhận dữ liệu, không tự gọi Git/provider hoặc `write_file`.

- Phase 5 có nút Review changes cho saved-vs-draft của tab; conflict có Compare disk-vs-draft. Khi mở, capture immutable snapshot để diff không đổi khi user tiếp tục edit.
- Hai model diff thuộc viewer, URI khác edit models; cả hai sides read-only. Close/switch preview dispose đúng models/listeners, không dispose/edit live file model.
- Inline diff ở panel hẹp, side-by-side khi đủ width; resize/hidden/show theo cùng host layout contract. Apply/Accept buttons chưa xuất hiện ở Phase 5.
- Diff preview đang mở vẫn giữ edit tabs. Quay về edit khôi phục active model/cursor; Ctrl+S trong diff không lưu snapshot.
- Git Phase 6 cung cấp staged/unstaged snapshots; AI Phase 10 sở hữu proposal/approval và file-write operation riêng. Viewer không được cấp quyền tự apply.

## 10. Files cần tạo/sửa

| File | Responsibility dự kiến |
| --- | --- |
| `src-tauri/src/file_editor.rs` — mới | Text DTOs, bounded read, encoding/revision, serialized validated write/commit |
| `src-tauri/src/path_guard.rs` | File resolver, regular-file validation, shared path checks và tests |
| `src-tauri/src/workspace.rs` | Active-workspace lease/commit coordination cần cho file write |
| `src-tauri/src/lib.rs` | Register commands/state, lifecycle integration khi cần |
| `src-tauri/Cargo.toml`, `Cargo.lock` | Dependency hash/replacement helper nếu cần, lock version |
| `src/editor/types.ts`, `editorApi.ts` — mới | Serializable types, typed invoke và error mapping |
| `src/editor/editorStore.ts`, `useWorkspaceEditor.ts` — mới | Scoped Zustand metadata + actions, generation và coordinator |
| `src/editor/modelRegistry.ts`, `monacoRuntime.ts` — mới | Model ownership/baseline/view state, local workers/lazy import |
| `src/editor/useEditorCloseGuard.ts` — mới | Tab/workspace/native close guard và focus restoration |
| `src/components/EditorPanel.tsx`, `EditorTabs.tsx`, `MonacoEditor.tsx` — mới | Editor shell, tabs/actions/loading/error/read-only, Monaco view |
| `src/components/SharedDiffViewer.tsx`, `UnsavedChangesDialog.tsx` — mới | Snapshot diff và Save/Discard/Cancel UI |
| `src/components/ExplorerPanel.tsx`, `ExplorerTreeNode.tsx` | Propagate onOpenFile, chỉ regular file opens |
| `src/App.tsx`, `RightPanel.tsx` | App-owned editor, guarded workspace flow và thay placeholder |
| `src/styles.css` | Fill-height, tab overflow, compact toolbar, modal/focus và diff width |
| `package.json`, `package-lock.json`, `vite.config.ts` | Monaco/Zustand, workers, compatible frontend test tooling khi cần |
| `src-tauri/capabilities/*` | Chỉ core window/event permissions cần cho close guard; giữ filesystem qua Rust |
| Plan/preview/README | Checkpoint status và actual test evidence |

Tên file có thể gộp khi trách nhiệm nhỏ; không tạo module rỗng chỉ để khớp bảng. Không sửa generated schemas hoặc thêm filesystem plugin scope rộng.

## 11. Tasks và checkpoints

| Task | Thực hiện | Checkpoint phải đạt |
| --- | --- | --- |
| Baseline | Reconcile Phase 4 behavior, retest layout 4/tools/focus | Pending native click-through; startup đã pass |
| **5.1 — File API** | Resolver, UTF-8/format/size DTO, revision, write commit và tests | Đã đạt automated: round-trip/conflict fixture; cargo test 19/19 |
| **5.2 — Open file** | Monaco runtime/workers, controller/model registry, Explorer callback | Đã triển khai; build/package pass, native open/dedup pending |
| **5.3 — Edit/save** | Dirty/Undo, Save/Save All, external change/conflict | Đã triển khai; fixture/conflict pass, native bytes/UI pending |
| **5.4 — Tabs/lifecycle** | Multi-tabs/view state, close/workspace/exit guards và cleanup | Đã triển khai; native close/focus/picker matrix pending |
| **5.5 — Shared Diff Viewer** | Review changes + conflict compare, reusable read-only snapshots | Đã triển khai; native small-panel/read-only matrix pending |

Thứ tự đã thực hiện: baseline → 5.1 → 5.2 → 5.3 → 5.4 → 5.5. Còn native verification trước khi nghiệm thu và bàn giao Phase 6.

## 12. Verification và tiêu chí hoàn tất

### Automated tests cần triển khai

- Rust: paths traversal/UNC/ADS/sibling prefix; directory/link/reparse rejection; stale workspace before commit; UTF-8/BOM/LF/CRLF/no-final-newline byte equality; invalid encoding/binary/size limit; missing/read-only/locked target; conflict cùng size/mtime nhưng khác content; save serialization và temp cleanup/failure giữ old bytes.
- Frontend: dedup/race open; workspace generation; dirty Undo/Redo; snapshot save + edit in-flight; Save All partial failure; transition Cancel/error không dispose; model/listener cleanup; Diff Viewer không invoke write.
- Browser integration: real Monaco model/undo/view-state, worker loading, retained buffer qua panels/tabs, separator/hidden geometry và keyboard focus. Chọn runner tương thích stack khi implement; mock Monaco không đủ chứng minh worker/render/undo thật.

Các lệnh dự kiến khi triển khai:

~~~powershell
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git diff --check
npm run tauri -- dev
npm run tauri -- build --no-bundle
~~~

Frontend chưa có test runner riêng; `npm run build`, Rust tests/clippy và `tauri build --no-bundle` đã có actual evidence. Release runtime cần verify workers trong native asset protocol chạy offline, không chỉ build thành công; native click-through vẫn pending.

### Ma trận native/UI

| Case | Expected result |
| --- | --- |
| Open file TS/JSON/Rust và path có dấu/khoảng trắng | Đúng content/language/path, Editor Normal, terminal giữ session |
| Open lặp file và hai file cùng basename | Một model/file, phân biệt tabs, không mất draft |
| Edit A → B → A; Undo/Redo | Text/history/cursor/scroll đúng; Undo về baseline clean |
| Switch ba tools; bấm active icon; collapse/reopen | Không tools tự hide ngoài rule đã xác nhận; models không reset |
| Layout `4 → 1 → 2 → 4`; resize/Expanded ở `960 × 600` | Bốn pane khôi phục, terminal và Monaco có viewport dùng được; focus không bị cướp |
| Save UTF-8/BOM/LF/CRLF/no-final-newline | Rust read-back xác nhận bytes; không normalize ngoài policy |
| Save pending rồi edit thêm hoặc spam Save | Không duplicate commit; edit sau snapshot vẫn dirty |
| Terminal sửa file, kể cả cùng size; xóa file | Save reject conflict/missing; draft tồn tại, Compare/Reload có guard |
| Read-only/locked file, oversized/binary/unsupported encoding | Error rõ; không truncate hoặc ghi đè file |
| Close dirty tab Save/Discard/Cancel và save fail | Chỉ dispose sau quyết định thành công; Cancel/fail giữ model |
| Open Folder với dirty; picker success/Cancel/error | Guard chạy trước teardown; Cancel/error giữ draft/session |
| X/Alt+F4 với dirty/pending-save; app close cuối cùng | Guard một lần, Cancel giữ app; approved close cleanup editor/PTY |
| Review/Compare diff, close preview | Read-only, disk không đổi, edit tab còn nguyên |
| Dev và native release offline | Workers/assets tải được, không CDN/main-thread fallback warning |

Ưu tiên chạy automated/integration/native automation bằng công cụ thật có sẵn; ghi môi trường, expected, actual và evidence từng case. Chỉ cần user xác nhận những case native chưa thao tác được; không bắt user test lại các case đã có bằng chứng.

### Checklist nghiệm thu

- [ ] Phase 4 regression checkpoint đạt: layout 4/tools/focus/retention.
- [ ] File API chỉ truy cập workspace, đúng regular-text/format/size policy.
- [ ] Monaco và workers hoạt động ở dev/native release offline.
- [ ] Open/dedup/tab switch giữ text, undo và view state.
- [ ] Save giữ Unicode/BOM/EOL/final newline và lỗi không làm mất draft.
- [ ] Disk revision conflict và save-in-flight xử lý đúng.
- [ ] Tab/workspace/app close Save/Discard/Cancel đúng, không teardown sớm.
- [ ] Panel resize/collapse/Expanded giữ model và bốn terminal sessions.
- [ ] Diff Viewer read-only, models độc lập và không tự write.
- [ ] Cleanup models/listeners/temp resources có bằng chứng.
- [ ] Automated/native matrix có actual results; docs/README phản ánh đúng status.

## 13. Bàn giao Phase 6 và kiến thức đạt được

Phase 6 nhận file snapshot/revision contract, editor model owner và shared Diff Viewer. Git operation refresh chỉ báo disk change, không overwrite dirty editor; Git diff service cung cấp snapshots cho viewer. AI Accept/Reject được xây ở Phase 10 qua write/approval contract riêng.

Qua phase này cần hiểu model/view ownership, encoding và disk bytes, optimistic conflict detection, save snapshot, guarded lifecycle và cleanup. Các concept này cũng áp dụng cho form nhiều tab, app ghi local files và UI review thay đổi.
