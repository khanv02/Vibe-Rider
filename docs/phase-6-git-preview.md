# Phase 6 — Git

> Implementation update (2026-10-03): Tasks 6.1–6.6 core code and the Git UI review pass are implemented. Automated verification is recorded below; native click-through acceptance remains pending.

Cập nhật: 2026-10-03. Trạng thái: **core Phase 6 và Git UI review đã triển khai; native click-through acceptance còn chờ**.

Kế hoạch triển khai: [Phase 6 Git Plan](../agents/plans/Phase_6_Git_Plan.md). Roadmap: [Implementation Plan](../agents/plans/Implementation_Plan.md#phase-6--git). Nguồn yêu cầu: [Project Instruction](../agents/rules/Project_Instruction.md). Contract bàn giao: [Phase 5 Editor](phase-5-editor-preview.md).

Kế hoạch phối hợp: [Phase 7 UX Plan](../agents/plans/Phase_7_UX_Plan.md). Các phần UX độc lập có thể thực hiện song song Git; workspace/exit adapters tích hợp theo checkpoint chung, dogfooding và nghiệm thu toàn Phase 7 chờ Phase 6.

## Review implementation (2026-10-03)

- Rust đã có repository boundary, status/branch/upstream, scoped diff, stage/unstage/restore, reviewed commit, push và operation lifecycle.
- Git actions chỉ chạy trong Tauri desktop runtime. Browser preview hiển thị cảnh báo rõ ràng thay vì tạo cảm giác action bị hỏng.
- Git panel có Normal/Expanded, push target dạng có cấu trúc `local → remote/branch`, preview old/new theo scope, cùng tùy chọn List/3 columns cho Staged Changes, Changes và Untracked.
- Có `Stage all`/`Unstage all`, restore theo entry, disabled reason cho Commit/Push và giữ commit message khi panel đổi trạng thái.
- Feedback của mỗi operation được giữ lại sau khi kết thúc, có mã lỗi, operation, message, hướng dẫn xử lý, Refresh status và Dismiss. Các nhóm lỗi chính gồm thiếu `user.name/email`, auth, permission, hook, index lock, stale status và push rejected.
- Activity rail hiển thị avatar GitHub/identity ở đáy thanh tools, nằm ngoài Git workflow. Git panel chỉ mở rộng mục `ACCOUNT` khi cần xem identity, remote và auth state; GitHub remote không tự được coi là đã đăng nhập.
- Right panel có optional `Left / Right` layout và được lưu cùng UI preferences. Trạng thái auth chỉ chuyển verified sau Push thành công, không đọc hoặc lưu token.
- Click avatar mở account menu gồm GitHub, Login/Change account và Logout web session. Các action mở browser mặc định qua URL GitHub allowlist; logout web không thể xóa SSH key hoặc Git Credential Manager local vì đó là credential store của hệ điều hành.
- Branch create/switch, pull/fetch, merge/rebase, stash và conflict resolution vẫn ngoài phạm vi Phase 6.
- Automated evidence đã pass; native Tauri click-through và dogfooding vẫn là gate chưa hoàn tất.

## 1. Mục tiêu và phạm vi

Thay Git placeholder trong right panel bằng workflow xem status → review diff → stage/unstage → commit → push. Terminal vẫn là workspace chính; Git CLI chạy qua Rust, frontend chỉ gọi operation có kiểu dữ liệu rõ ràng.

Phạm vi Phase 6:

- Branch hiện tại, upstream/ahead/behind khi có, staged, unstaged, untracked, rename và conflict.
- Diff text dùng Shared Diff Viewer; binary, file quá lớn và encoding không hỗ trợ có thông báo riêng.
- Stage từng file hoặc danh sách file đã chọn; Unstage và Restore working tree là hai action riêng.
- Commit các thay đổi đã staged, với message do user nhập.
- Push branch hiện tại lên upstream đã cấu hình, có loading, cancel, timeout và lỗi cụ thể.
- Refresh thủ công, sau operation và khi app lấy lại focus; giữ editor draft và terminal sessions.

Branch create/switch, pull/fetch UI, merge/rebase, stash, conflict resolution, stage từng hunk, force push, auto-commit và auto-push chưa thuộc phase này. Folder không có repository hiển thị empty state; không tự `git init`.

## 2. Baseline và điều kiện chuyển phase

Code hiện tại đã có Git service/commands trong Rust, controller và Git panel ở frontend. Phase 5 cung cấp file snapshots/revision, editor model owner và Shared Diff Viewer read-only; native click-through của Phase 3/4/5 vẫn còn gate riêng.

Baseline source inspection trong [plan](../agents/plans/Phase_6_Git_Plan.md#1-mục-tiêu-và-baseline) ghi rõ các contract cần mở rộng: preview identity/source/labels, editor disk-change/reload API và workspace/save/Git operation lease. Git CLI hiện có `2.53.0.windows.2`; đây chưa phải bằng chứng Git integration đạt.

- [ ] Hoàn tất baseline native: layout `1 → 2 → 4`, switch/collapse/resize tools, focus và PTY retention.
- [ ] Xác nhận open/save/conflict, dirty guards và Monaco workers của Phase 5 trong native dev/release.
- [ ] Reconcile active-tool click giữa code và docs trước khi dùng làm expected behavior.
- [ ] Chốt repository boundary, DTO và process lifecycle của Task 6.1 trước khi nối UI.

Việc implementation Phase 6 đã hoàn tất phần core; tài liệu này vẫn tách riêng automated evidence khỏi native acceptance của Phase 3/4/5.

## 3. Kiến thức và kiến trúc

Ba nguồn dữ liệu cần phân biệt:

| Nguồn | Ý nghĩa | Vai trò trong workflow |
| --- | --- | --- |
| HEAD | Commit hiện tại; có thể chưa tồn tại ở repository mới | Baseline của staged diff |
| Index | Nội dung đã stage | Nội dung Commit sẽ ghi |
| Working tree | File trên đĩa | Nội dung Stage sẽ đọc |
| Editor draft | Model chưa save của Phase 5 | Chưa thuộc Git status/diff cho tới khi Save |

```text
GitPanel / useWorkspaceGit
        ↓ typed invoke(workspaceId, operation arguments)
Rust GitService + operation manager
        ↓ validated repository + executable + argument vector
Git CLI
        ↓ bounded stdout/stderr + exit code
Structured status / immutable diff / operation result
        ↓
Git UI + Shared Diff Viewer + editor disk-change notification
```

Rust sở hữu executable, cwd, repository identity, path validation và child processes. Git state chỉ giữ metadata/loading/error/request ownership; không sao chép editor models hoặc PTY stream vào store.

## 4. Git service và repository boundary — Task 6.1

Contract dưới đây là API/command boundary đã được triển khai:

| Command | Input chính ngoài `workspaceId` | Output |
| --- | --- | --- |
| `git_status` | Request ID | Repository/branch metadata, entries, status token |
| `git_diff` | Entry ID, `staged`/`unstaged`/`untracked`, status token | Text snapshots hoặc unsupported reason |
| `git_add` | Entry IDs, status token | Operation result + yêu cầu refresh |
| `git_restore` | Entry IDs, mode `unstage`/`worktree`, confirmation token khi destructive | Operation result + affected paths |
| `git_commit` | Message, reviewed index token | Commit ID hoặc structured error |
| `git_push` | Reviewed branch/upstream identity | Operation ID và completion result |
| `git_cancel` | Operation ID | Cancel request acknowledged; completion theo process thực tế |

Không nhận command string, executable, raw options, root path hoặc remote URL tùy ý từ frontend. Mỗi operation build argument vector riêng; không gọi PowerShell/cmd để nối chuỗi lệnh Git.

Repository policy V1:

- Resolve canonical workspace từ `WorkspaceState`, rồi discover repository ở Rust. Chỉ bật Git operations khi canonical repository top-level trùng workspace root; mở subfolder thì hướng dẫn mở repository root, tránh Commit/Push tác động ngoài folder đã chọn.
- Bare repository, nested repository/submodule và linked worktree chưa hỗ trợ trong phase này; hiển thị lý do rõ. Không tự follow `.git` pointer ra ngoài workspace. Repository thông thường vẫn được Git dùng config/credential helper theo môi trường local.
- Kiểm tra workspace/repository identity trước khi chạy. Mutations có lease phối hợp workspace switch; không giữ global UI/workspace mutex trong suốt push. Workspace transition chờ operation kết thúc hoặc cancel và reap trước khi commit workspace mới.
- Loại bỏ environment override như `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` làm lệch repository. Không tự thêm `safe.directory` hoặc sửa config khi Git báo ownership error.
- Resolve Git executable ở backend; thiếu Git là `GIT_NOT_FOUND`, không tự cài đặt.

Process chạy ngoài UI thread, drain stdout/stderr đồng thời, có timeout và output cap. Đề xuất ban đầu: status/diff 15 giây, mutation local 60 giây, push 120 giây; mỗi stream tối đa 4 MiB, text snapshot tối đa 2 MiB/side, status tối đa 5.000 entries. Khi vượt cap, kết quả phải đánh dấu incomplete hoặc trả lỗi, không parse partial status thành thành công.

Operation manager trả ID do backend sinh, giới hạn một mutation/repository và kiểm owner khi cancel. Cancel/timeout phải cleanup process tree và reap child trên Windows, kể cả helper/hook. Không hứa rollback: commit/push có thể đã tác động trước cancel; refresh và đối chiếu kết quả trước retry.

Lỗi có `code`, `operation`, `exitCode` nếu có và message đã giới hạn/redact; phân biệt no-workspace/stale-workspace/not-repository/unsupported-repository, index-lock, permission, conflict, auth, missing-upstream, push-rejected, timeout và cancelled. Không log credentials hoặc URL chứa token.

## 5. Status và Git panel — Task 6.2

Thiết kế parser dùng `git status --porcelain=v2 --branch -z --untracked-files=all`. Porcelain phục vụ máy đọc; `-z` giữ filename qua NUL delimiter. Parse bytes/record theo format Git, không split output theo dòng hay whitespace của filename. Nguồn: [git-status](https://git-scm.com/docs/git-status).

- Mỗi entry có identity, current path, original path nếu rename, index status, worktree status và kind. Một file vừa staged vừa unstaged phải xuất hiện trong cả hai nhóm với diff mode riêng.
- Giữ path chính xác qua tên có dấu, khoảng trắng, tab/newline và ký tự pathspec. Path không biểu diễn được bằng Unicode không được lossy-convert để mutation nhầm file; báo unsupported.
- Xử lý repository chưa có commit, detached HEAD, không upstream, clean repository, conflict và submodule entry. Conflict chỉ review trạng thái, disable mutations chưa có contract xử lý.
- Branch/upstream hiển thị giá trị đã parse; ahead/behind là thông tin local hiện có, không tự fetch khi refresh.

Git panel có nhóm Staged Changes, Changes và Untracked; mỗi row có Open file, Review diff và action phù hợp. Có thể chuyển giữa List/3 columns, stage all/unstage all và giữ nhóm rõ ràng ở panel hẹp. File đã xóa không có Open file; filename được render như text, không HTML. Commit area giữ message qua panel switch/collapse, chỉ clear sau commit success; Push là action riêng.

Mọi lỗi Git phải còn nhìn thấy sau operation thay vì chỉ biến mất khi refresh. UI hiển thị `code → operation → message → guidance`; ví dụ `MISSING_USER_IDENTITY` hướng dẫn cấu hình `user.name/email`, `AUTH_REQUIRED` hướng dẫn SSH/Credential Manager, `PUSH_REJECTED` hướng dẫn Pull/rebase thủ công. Success cũng được thông báo để user biết Commit/Stage/Push đã thực sự hoàn tất.

Working repository hiển thị workspace name, canonical root path, repository identity và remote host; không hiển thị URL có credential. Account menu dùng web GitHub hiện có, không biến app thành OAuth credential store mới.

Các state cần có: no-workspace, missing-Git, not-repository, unsupported-repository, loading, clean, ready, error/retry, operation-running và stale/incomplete. Có keyboard/focus labels, scroll và path tooltip tại panel hẹp; terminal không bị remount hoặc mất focus chỉ vì status refresh.

## 6. Diff và shared viewer — Task 6.3

| Review mode | Original | Modified |
| --- | --- | --- |
| Unstaged | Index | Working tree trên đĩa |
| Staged | HEAD hoặc empty nếu chưa có HEAD | Index |
| Untracked | Empty | Working tree |
| Added/deleted | Empty ở phía không có file | Snapshot ở phía còn tồn tại |
| Rename | Path/content cũ ở baseline tương ứng | Path/content mới ở nguồn tương ứng |

Staged và unstaged là hai phép so sánh khác nhau theo [git-diff](https://git-scm.com/docs/git-diff). Không dùng working-tree text thay cho index khi review staged; không dùng editor draft thay cho disk khi review unstaged.

Backend đọc blob bằng identity đã xác thực từ HEAD/index, đọc working-tree regular file qua path guard. Deleted path cần validate parent và containment, không yêu cầu target đang tồn tại. Symlink/reparse entry chỉ hiển thị metadata/unsupported; không follow target. Binary, invalid UTF-8 và oversized snapshot không đẩy vào Monaco hoặc decode lossy.

Snapshot pair gắn repository/status identity; kiểm lại HEAD/index/disk trước và sau read, reject hoặc báo stale khi terminal thay đổi trong lúc capture. Giới hạn này không thay thế filesystem transaction với process Git ngoài app.

`DiffPreview` có `previewId`, `source`, scope và labels cho hai phía old/new. Shared Diff Viewer nhận immutable snapshots, không gọi Git hoặc write API. Diff model URI tách theo preview/source để không trùng editor preview; hai phía read-only, close chỉ dispose diff models. Viewer hỗ trợ inline tại panel hẹp, layout lại khi show/resize và Git panel có chế độ Expanded tùy chọn.

## 7. Stage, Unstage và Restore — Task 6.4

Stage lấy nội dung trên đĩa tại lúc chạy. Nếu file có dirty editor tab, UI phải cho biết draft chưa nằm trong nội dung Stage; có thể Save trước bằng editor action, không âm thầm Save hoặc Discard.

Path mutations chỉ nhận entries trong status mới nhất, validate lại workspace/path và dùng literal pathspec ở backend. `--` ngăn option injection nhưng vẫn cần vô hiệu pathspec magic/glob. Với rename, xử lý cả path cũ/mới đã validate; với deletion, stage removal đúng file. Không dùng `git add .` cho action chọn từng file.

| Action | Tác động | Guard |
| --- | --- | --- |
| Stage | Working tree → index | Status token và path check; refresh sau completion |
| Unstage | Đưa index về HEAD, giữ working tree | Action riêng; repository chưa có HEAD cần nhánh xử lý/test riêng |
| Restore working tree | Bỏ thay đổi unstaged, lấy nội dung từ index | Review + xác nhận mất disk changes, token và dirty-buffer guard |

Restore mặc định lấy nguồn từ index; `--staged` mặc định dùng HEAD theo [git-restore](https://git-scm.com/docs/git-restore). Vì vậy Restore working tree phải ghi rõ vẫn giữ staged changes. Không dùng cùng một nhãn Restore cho việc Unstage và discard disk changes.

Confirmation do backend cấp gắn operation, paths và phiên bản index/disk đã review; terminal thay đổi sau review thì reject stale và yêu cầu review lại. Dirty tab bị ảnh hưởng phải được giải quyết qua Save/Discard/Cancel trước khi tạo preview/confirmation cuối cùng. Cancel không chạy mutation. Untracked file không có Restore; không bổ sung delete/`git clean` vào action này.

Serialize mutation trong app, giữ draft khi lỗi và báo partial result nếu có. Git CLI ngoài terminal vẫn có thể chạy đồng thời; preflight tokens không bảo đảm atomic rollback với process ngoài app. Index-lock error hướng dẫn chờ/retry, không tự xóa `.git/index.lock`.

## 8. Commit và Push — Task 6.5

Commit chỉ dùng index đã review. Message không rỗng sau trim, hỗ trợ nhiều dòng, giới hạn đề xuất 64 KiB UTF-8 và reject NUL. Chuyển message qua stdin hoặc argument riêng, không shell interpolation; không thêm `-a`, auto-stage, amend hoặc skip hooks. Nếu index/HEAD đổi sau review, yêu cầu refresh/review lại.

- Không có staged changes: disable Commit. Conflict: disable Commit/Push và hướng dẫn giải quyết trong terminal.
- Chạy hooks theo Git local config; hook fail, thiếu user identity, signing fail và index-lock có lỗi riêng, giữ message và changes để sửa/retry.
- Commit success trả commit ID, refresh status và clear message. Failure/cancel không tự chạy lại commit; đối chiếu HEAD vì hook/process có thể đã thay đổi repository.

Push hiển thị target có cấu trúc `local branch → remote/branch` trước khi user bấm, tránh layout text rời gây lệch. Backend resolve remote/ref từ config đã kiểm chứng; chỉ push branch hiện tại với refspec cụ thể, không push tất cả branch/tag theo cấu hình mặc định. Thiếu upstream hoặc detached HEAD thì disable và hướng dẫn cấu hình ở terminal; không tự tạo remote/upstream.

Không force push, không tự pull/rebase khi bị reject. Không nhận password/token qua React; dùng cơ chế credential local, vô hiệu terminal prompt để child process không chờ stdin. Credential helper có thể có native UI; timeout/cancel vẫn phải có hiệu lực. Auth/remote/protected-branch/non-fast-forward lỗi giữ nguyên local commit và được phân loại để hướng dẫn user. Loading không khóa terminal hoặc panel navigation; duplicate Push bị chặn.

## 9. Refresh, races và editor retention — Task 6.6

- Refresh sau mọi operation completion, kể cả failure/cancel có khả năng đã đổi state; refresh khi app regain focus và khi user bấm Refresh.
- Coalesce focus/manual refresh; workspace generation + request token bỏ stale response. Response A muộn không thay status hoặc diff B mới hơn.
- Đổi workspace clear Git metadata/selection/message/diff theo workspace owner sau transition thành công; picker Cancel/error giữ state cũ.
- Git refresh không gọi `setValue`, dispose editor models hoặc thay saved baseline. Disk change chỉ thông báo editor kiểm revision và hiển thị Reload/conflict; dirty buffer được giữ.
- Diff cũ có thể tiếp tục là immutable review nhưng phải có stale indicator; mutation không dùng token cũ. Restore thành công yêu cầu editor kiểm disk revision, không tự reload dirty tab.
- Collapse/switch tools giữ Git selection/message và terminal processes; read-only background refresh không giành focus. Cleanup request listeners và processes khi app exit.

## 10. Files dự kiến và checkpoints

| File/nhóm | Responsibility dự kiến |
| --- | --- |
| `src-tauri/src/git/` | CLI runner, parser, repository/path policy, snapshots, mutation manager và fixtures |
| `src-tauri/src/lib.rs` | Đăng ký Git commands/managed state và shutdown cleanup |
| `src-tauri/src/workspace.rs`, `path_guard.rs` | Workspace lease, repository boundary, deleted-path validation |
| `src/git/types.ts`, `gitApi.ts`, `useWorkspaceGit.ts` | DTO, typed invoke, request generation và operation state |
| `src/components/GitPanel.tsx` | Status groups, review/actions, message, errors và confirmation UI |
| `src/editor/types.ts`, `SharedDiffViewer.tsx` | Source/mode/labels/preview identity và shared read-only models |
| `src/App.tsx`, `RightPanel.tsx`, `StatusBar.tsx` | Git controller, thay placeholder, branch context và editor notification |
| `src/styles.css` | Compact rows/actions, scroll, loading/error, accessible focus |

Không tạo module rỗng chỉ để khớp bảng. Không cấp arbitrary shell/filesystem scope cho frontend hoặc sửa generated schemas.

| Task | Checkpoint | Trạng thái |
| --- | --- | --- |
| 6.1 — Git service | Scoped repository, argument vector, bounded process, timeout/cancel và structured errors | Đã triển khai; Rust fixtures đạt |
| 6.2 — Status | Parser NUL-safe; staged/unstaged/untracked/rename/conflict/branch states đúng | Đã triển khai; parser/UI build đạt |
| 6.3 — Diff | Đúng HEAD/index/disk, shared viewer read-only, unsupported/stale có state | Đã triển khai; backend/UI build đạt |
| 6.4 — Add/restore | Literal paths, separate modes, destructive confirmation, dirty guard | Đã triển khai; lease/confirmation code đạt |
| 6.5 — Commit/push | Reviewed index, message, upstream, auth/hooks/reject/cancel lifecycle | Đã triển khai; automated compile/test đạt |
| 6.6 — Refresh | Generation/coalescing, workspace transition và editor/terminal retention | Core đã triển khai; native acceptance còn chờ |

Thứ tự: nghiệm thu baseline → 6.1 → 6.2 → 6.3 → 6.4 → 6.5 → 6.6 → native acceptance. Mỗi checkpoint ghi expected/actual/evidence trước khi tiếp tục.

## 11. Verification và actual results

Chỉ tạo fixtures trong thư mục tạm: repository mới/đã có HEAD, file tên Unicode/khoảng trắng/pathspec, staged + unstaged trên cùng file, rename, deletion, binary và conflict. Test mutations không dùng repository làm việc của user. Push integration dùng local bare remote trong fixture; remote thật chỉ test khi user chủ động chọn destination và có credentials.

Rust tests cần kiểm parser record/NUL, path/option/pathspec injection, no-workspace/stale identity, repository ngoài boundary, literal add/restore, missing HEAD, index conflict, snapshot race, caps và exit codes. Process fixture có stdout/stderr lớn, helper treo, timeout/cancel/process-tree cleanup; hooks fixture fail và commit đã xảy ra trước cancel.

Frontend/integration tests tập trung request race, refresh coalescing, mutation duplicate, confirmation stale, message retention, diff ownership và dirty-buffer guards. Build pass không thay thế parser fixtures, real Monaco review hoặc native Git operation.

| Native/UI case | Expected | Actual |
| --- | --- | --- |
| Missing Git, folder thường, repo parent/nested/worktree | State/lý do đúng, không tự đổi config hoặc init repo | Chưa chạy |
| Unicode/spaces/pathspec names; staged + unstaged | Đúng paths/nhóm, mutation chỉ đúng entry | Chưa chạy |
| New repo/detached/no-upstream/clean/conflict | Branch/status/actions phản ánh đúng state | Chưa chạy |
| Text/binary/add/delete/rename diff | Đúng snapshot pair, unsupported rõ, disk không đổi | Chưa chạy |
| Stage/Unstage/Restore; stale confirmation; dirty tab | Đúng index/disk, Cancel không mutate, draft giữ theo guard | Chưa chạy |
| Commit multiline; hook/identity/lock failure | Chỉ commit staged, message giữ khi fail, không auto-retry | Chưa chạy |
| Push local remote/rejected/auth/timeout/cancel | UI responsive, commit giữ, helpers được cleanup | Chưa chạy |
| Terminal sửa index/disk rồi focus/refresh | Stale response bị bỏ; editor có revision notification | Chưa chạy |
| `4 → 1 → 2 → 4`, tools/resize/collapse ở `960 × 600` | Git UI dùng được, terminal/editor state giữ và focus đúng | Chưa chạy |
| Workspace switch/picker Cancel/app exit khi operation chạy | Transition có owner, không mutate nhầm root, cleanup hoàn tất | Chưa chạy |

Các lệnh verification khi đã triển khai:

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

**Actual verification (2026-10-03):** `cargo test --offline` đạt **46/46**, `cargo clippy --offline -- -D warnings` đạt, `cargo check --offline` đạt, `npm run build` đạt, `cargo fmt` đạt và `tauri build --no-bundle` tạo được release executable. Coverage gồm runner/process cleanup, repository/path boundary, real porcelain status fixture với staged + unstaged + untracked, real HEAD/index/disk diff → restore → commit fixture, local bare-remote one-ref push fixture, workspace leases và frontend Git panel/controller compilation. Native Tauri click-through (Git operations, Monaco reload, layout/exit) và dogfooding vẫn pending; không chuyển kết quả đó thành native acceptance.

## 12. Checklist nghiệm thu và bàn giao

- [ ] Baseline Phase 3/4/5 native acceptance đạt.
- [ ] Git CLI chạy qua Rust với repository/path/arguments boundary đã kiểm chứng.
- [ ] Status parser và branch states đúng trên fixtures, kể cả filename đặc biệt.
- [ ] Diff phân biệt HEAD/index/disk; text viewer read-only, binary/size/stale có feedback.
- [ ] Stage/Unstage/Restore đúng file; Restore có confirmation và dirty guard.
- [ ] Commit chỉ dùng index đã review; failure không mất message/draft.
- [ ] Push đúng upstream/ref, không force; auth/reject/timeout/cancel không treo UI.
- [ ] Workspace/process ownership, helper cleanup và mutation concurrency được kiểm chứng.
- [ ] Refresh không ghi đè dirty editor buffer hoặc reset terminal sessions.
- [ ] Automated/native matrix có actual results và evidence; README/roadmap khớp trạng thái.

Phase 7 nhận Git workflow để dogfooding sửa code → build/test → review → commit. Phase 9 tái dùng `git_status`/`git_diff` qua read-only registry; không cấp mutation cho read-only agent. Phase 10 quản lý approval riêng, không tự commit/push.

Kiến thức cần đạt: phân biệt HEAD/index/disk/draft; parse machine output; process ownership và bounded I/O; confirmation gắn phiên bản; lỗi/cancel không đồng nghĩa rollback. Các concept này áp dụng cho mọi desktop tool gọi CLI và review thay đổi dữ liệu local.
