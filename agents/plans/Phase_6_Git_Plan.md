# Kế hoạch Phase 6 — Git

> Implementation update (2026-10-03): Tasks 6.1–6.6 core code is now implemented. Automated verification passes; native acceptance remains pending.

Ngày lập: 2026-10-03. Trạng thái: **core Phase 6 đã triển khai; native acceptance còn chờ**.

Nguồn yêu cầu: [Project Instruction](../rules/Project_Instruction.md), mục 4, 10, 14, 23–29. Roadmap: [Implementation Plan](Implementation_Plan.md#phase-6--git). Thiết kế contracts, tiến độ và actual results: [Phase 6 Git Preview](../../docs/phase-6-git-preview.md). Dependency: [Phase 5 Editor Plan](Phase_5_Editor_Plan.md), [Phase 5 Preview](../../docs/phase-5-editor-preview.md).

Plan này cụ thể hóa thứ tự triển khai, trách nhiệm code và checkpoints; contract/checklist chi tiết trong preview đi cùng plan, không là bằng chứng implementation đã hoàn thành. Phần phối hợp UX dùng checkpoints C0–C3 đã có trong [Phase 7 UX Plan](Phase_7_UX_Plan.md).

## Implementation review (2026-10-03)

Tasks 6.1–6.6 đã triển khai ở mức core và Git UI review. Panel hiện có Normal/Expanded, push target có cấu trúc, preview old/new, List/3 columns, Stage all/Unstage all và runtime guard khi mở ngoài Tauri. Automated Rust/frontend verification pass; native click-through, local dogfooding và các workflow ngoài scope (branch create/switch, pull/fetch, merge/rebase) chưa hoàn tất.

Review bổ sung: operation feedback hiện giữ lại mã lỗi và hướng dẫn xử lý sau Stage/Unstage/Restore/Commit/Push; activity rail hiển thị avatar identity ở đáy với GitHub/Login/Change account/Logout web menu, còn Git panel có Account và Working repository riêng. Git status trả commit identity và remote provider; đây không phải bằng chứng login GitHub. Auth chỉ được xác nhận sau Push thành công; secrets không đi qua frontend. Optional Left/Right panel layout thuộc UX shell, được preferences lưu riêng. Logout web không xóa credential SSH/Git Credential Manager local.

## 1. Mục tiêu và baseline

Thay Git placeholder bằng workflow status → review staged/unstaged diff → stage/unstage → commit → push. Git vẫn là supporting tool bên phải; terminal tiếp tục là main workspace. Rust sở hữu Git CLI/process/filesystem boundary, frontend gọi operation có kiểu dữ liệu rõ ràng.

Baseline kiểm tra từ source ngày 2026-10-03 (được giữ để giải thích điểm xuất phát; trạng thái hiện tại xem phần review bên trên):

- `RightPanel.tsx` có Git slot mặc định, giữ mounted khi switch/collapse; Git panel/controller hiện đã được nối vào slot này.
- `App.tsx` hiện ghép workspace, Explorer, Editor và Git controllers; `StatusBar.tsx` nhận branch context.
- `src-tauri/src/lib.rs` hiện đã đăng ký Git service/commands. Git CLI có sẵn: `git version 2.53.0.windows.2`; không cần thêm `libgit2`.
- Phase 5 có File API, revision và Monaco model ownership. `resolve_regular_file` yêu cầu target tồn tại, chưa dùng được cho tracked path bị xóa.
- `DiffPreview` hiện có preview identity/source/labels và Git scope old/new; SharedDiffViewer URI tách theo preview/source.
- Editor controller chưa expose external-disk-change/reload API. Dirty-tab UI có Save/Discard/Cancel; workspace/native guard hiện là Save All/Cancel qua `window.confirm`, chưa đầy đủ transition coordinator mô tả trong plan Phase 5.
- `WorkspaceState::while_workspace_is_active` giữ workspace mutex suốt closure; operation manager không dùng lease này để giữ khóa trong network push.
- Frontend chưa có test runner riêng; Phase 3/4/5 native click-through vẫn pending theo docs.

Lượt lập plan chỉ thay tài liệu. Baseline inspection và Git version không được tính là Git integration tests pass.

## 2. Dependency, phạm vi và quyết định UX

### Gate trước tích hợp

Có thể chuẩn bị contracts/fixtures khi Phase 5 còn verification. Trước tích hợp Git UI/mutations phải kiểm chứng open/save/conflict, dirty guards, Monaco workers native dev/release và regression layout/panel/terminal; xử lý lỗi phát hiện và ghi actual evidence. Phase 3/4 native gates vẫn độc lập. Reconcile active-tool click giữa code và docs để có expected behavior thống nhất.

Nếu làm cùng Phase 7, chốt C0: một owner ghép shared files và một workspace/exit coordinator cho Editor, Git và UX. Không tự đánh dấu các phase trước hoàn tất khi viết plan này.

| Hạng mục | Phạm vi Phase 6 |
| --- | --- |
| Repository | Một repository thường tại workspace root; canonical top-level khớp root, Git metadata trong root |
| Unsupported | Bare workspace, linked worktree/gitdir ngoài root, nested repo/submodule mutations |
| Status | Branch/HEAD/upstream, local ahead/behind, staged, unstaged, untracked, rename và conflict |
| Diff | HEAD → index; index → disk; empty → untracked. Immutable, read-only snapshots |
| Stage/unstage | Selected entries; một file có cả staged/unstaged xuất hiện ở hai nhóm |
| Restore | Bỏ unstaged changes của tracked regular file về index, có review/confirmation và stale check |
| Commit | Toàn bộ reviewed staged index, multiline message; không auto-save/stage/amend |
| Push | Current branch tới configured upstream, hiển thị target và Cancel; không force hoặc tự tạo upstream |
| Refresh | Workspace/Git panel/focus/save/manual/operation triggers, coalesce; không reset dirty draft |
| Ngoài phạm vi | Init/clone, branch management, fetch/pull/merge/rebase/stash UI, history graph, hunk staging, delete untracked, AI writes |

Folder không phải repo có empty state, không tự `git init`. Mở subfolder hướng dẫn mở repository root; không tự thao tác Git ở parent. Binary/encoding/size unsupported vẫn hiển thị status và metadata, không lossy decode thành text.

## 3. Kiến thức cần hiểu

| Concept | What / Why / How |
| --- | --- |
| Working tree | File trên disk; editor draft chưa Save không nằm trong dữ liệu Git đọc |
| Index | Snapshot sẽ commit; Stage cập nhật index, không tự commit |
| HEAD | Commit hiện tại; repo mới có thể chưa có HEAD, detached HEAD không có current branch |
| Staged/unstaged | Hai phép so khác nhau: HEAD/index và index/disk; cùng một file có thể khác ở cả hai |
| Unstage/restore | Unstage đổi index và giữ disk; restore working tree bỏ disk changes và giữ staged content |
| Upstream | Remote branch đã cấu hình; ahead/behind dựa trên local refs, không hứa là remote mới nhất |
| Process lifecycle | Argument vector, bounded stdout/stderr, timeout/cancel và reap; process không nằm trong UI thread |
| Revision/ownership | Terminal có thể đổi repo trong lúc review; tokens phải kiểm ở Rust, editor draft có owner riêng |

## 4. Architecture và data flow

~~~text
App
  ├─ workspace / Explorer / Editor / right-panel controllers
  └─ useWorkspaceGit
       ├─ branch/status/selection/message/operation state
       ├─ request generation + refresh coalescing
       └─ GitPanel → SharedDiffViewer (immutable snapshots)
              ↓
        gitApi → Tauri IPC
              ↓
        GitService + operation manager
          ├─ repository/path validation + workspace/save lease
          ├─ fixed Git operations → executable/cwd/args
          ├─ bounded runner + cancel/process-tree cleanup
          └─ porcelain parser + HEAD/index/disk snapshots
              ↓
           Git CLI
~~~

App giữ Git controller sống qua panel visibility. State giữ metadata/selected scope/commit message và operation state; chỉ tách Zustand store khi consumer cần. Không copy Monaco models/PTY stream vào Git state.

GitService sở hữu executable, repository identity, process handles và mutations. Frontend không gửi command string, executable, cwd, raw flags, revision expression, URL hoặc PID. Operation IDs do backend sinh, cancel kiểm window/workspace/repository owner.

Data flow:

1. Status trigger → validate workspace/repo → Git CLI → parse bytes → kiểm request generation → render groups/branch.
2. Click scoped row → resolve HEAD/index/disk → capture/verify snapshots → render read-only preview; giữ edit models.
3. Mutation action → kiểm state/path/review token/busy → run operation → completion → refresh/reconcile và notify affected editor paths.

SharedDiffViewer chỉ nhận data, không tự gọi Git/write API. Git controller sở hữu Git preview; Editor controller sở hữu live draft/baseline/undo. Save editor phát tín hiệu refresh Git; Git disk change phát tín hiệu check revision vào Editor.

## 5. API và state contract

Dùng camelCase DTOs, typed invoke và structured errors như File API hiện có. Command list/modes giữ thống nhất với mục 4 của [Phase 6 Preview](../../docs/phase-6-git-preview.md#4-git-service-và-repository-boundary--task-61):

| Operation | Dữ liệu chính | Kết quả |
| --- | --- | --- |
| `git_status` | workspaceId + requestId | Repository/branch metadata, entries và status token |
| `git_diff` | workspaceId + entryId + scope + status token | Text pair hoặc unsupported metadata, snapshot identity |
| `git_add` | workspaceId + selected entry IDs + status token | Stage operation + affected paths |
| `git_restore` | workspaceId + entry IDs + mode `unstage`/`worktree` | Unstage hoặc confirmed disk restore; destructive mode cần backend confirmation token |
| `git_commit` | workspaceId + multiline message + reviewed index token | Operation completion và actual commit ID nếu thành công |
| `git_push` | workspaceId + reviewed branch/upstream identity | Operation ID, bounded progress và completion |
| `git_cancel` | workspaceId + backend operation ID | Cancel acknowledged; completion theo actual process outcome |

Mutations phải có start acknowledgment/operation ID trước khi chạy lâu, dùng progress/completion Channel hoặc event có owner để UI Cancel được. Chốt transport ở 6.1; test cả completion tới sớm hơn UI nhận start acknowledgment. Cancel acknowledgment không phải kết quả mutation đã rollback.

Status entry tối thiểu: backend identity, current/original relative path, index/worktree statuses, kind và permitted actions. Tokens gắn workspace/repo/HEAD/index; status token không chứng minh mọi disk byte còn giống nhau. Restore confirmation riêng phải gắn exact paths, source blobs và disk fingerprint/missing state, có lifetime hữu hạn; apply revalidate ở backend.

Git UI states: no-workspace, missing-Git, not-repository, unsupported, loading, clean, ready, error/retry, busy và stale/incomplete. Refresh fail giữ last-known data kèm stale indicator, disable mutations tới khi có status mới. Errors có code/operation/exitCode và bounded redacted diagnostics; không phân loại chỉ bằng một câu stderr tiếng Anh.

## 6. Git service — Task 6.1

**Deliverable:** runner, repository/path validation, operation manager và fixtures; chưa cần Git UI đầy đủ.

- Resolve Git executable ở backend; tránh executable trong current directory và không gọi qua cmd/PowerShell. Cwd lấy từ canonical workspace, kiểm top-level/non-bare/gitdir bằng Git metadata; ownership error không tự sửa `safe.directory`. [Git rev-parse](https://git-scm.com/docs/git-rev-parse).
- Sanitize repository/index/object/config redirect env như `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_CONFIG_COUNT` và indexed config env. Giữ environment cần cho Git/credentials.
- Reuse lexical path checks; reject traversal/absolute/UNC/device/ADS/NUL, root-wide/directory action và `.git` administrative paths. Missing-target resolver kiểm nearest existing parent, mọi ancestors, containment và HEAD/index membership. Không nới `resolve_regular_file` để bỏ validation khi file missing.
- Validate modes/ancestors để không follow symlink/junction/reparse hoặc gitlink. Rename kiểm cả paths; nested repository không bị Stage như ordinary directory.
- Path args có `--`/NUL stdin và literal pathspec policy; chỉ `--` chưa chặn glob/pathspec magic. [Git literal pathspecs](https://git-scm.com/docs/git#Documentation/git.txt---literal-pathspecs).
- Đọc stdout/stderr đồng thời ngoài UI thread, giữ bytes tới parser. Không thu `output()` không giới hạn rồi mới cắt. Machine output incomplete phải fail; mutation log có thể ring-buffer/truncated flag và vẫn drain để xác định completion.
- Limits ban đầu theo preview: status/diff 15 giây, local mutation 60 giây, push 120 giây; 4 MiB/stream, 5.000 status entries, 2 MiB/text side. Measure và ghi actual limits; không đưa text bị truncate vào viewer.
- Serialize một mutation/repo, reject duplicate/busy, coalesce read refresh. Process registry chỉ cancel process thuộc owner; cleanup tree/helpers, reap child và kết thúc readers trên Windows; không mở console window.
- Shared operation lease kiểm active workspace/acquire dưới khóa ngắn rồi nhả mutex trước process. Workspace switch/exit chờ hoặc cancel/reap; restore không chạy đồng thời với app Save trên target. Ghi lock order và test backend guard, không chỉ disable UI.

**Checkpoint:** Git missing/non-repo/wrong root, unsafe/deleted paths, env redirect, pipe deadlock, output cap, duplicate, timeout/cancel/process-tree và workspace/save race đều có fixture evidence. Không tự xóa index lock hoặc retry interrupted mutation.

## 7. Status và Git panel — Task 6.2

**Deliverable:** porcelain-v2 byte parser, status DTO/controller và minimal GitPanel.

Chạy status với `--porcelain=v2 --branch -z --untracked-files=all`; read refresh dùng `--no-optional-locks`, chốt rename detection nhất quán. Parser consume metadata fields và NUL records theo loại `1`, `2`, `u`, `?`; rename có extra original path. Không split filenames theo whitespace/newline; bỏ qua unknown headers nhưng malformed tracked record phải fail. [Git status format](https://git-scm.com/docs/git-status#_porcelain_format_version_2).

Tách Staged Changes, Changes và Untracked; `MM` là hai rows/scopes. Hiển thị old → new, conflict/mode/submodule badges, unborn/detached/upstream vắng mặt. Preserve literal Unicode/spaces/brackets/pathspec chars; unsupported path encoding không lossy-convert thành path mutation.

Header branch/upstream/local counts; rows có Open file/Review/actions phù hợp, deleted file không Open. Commit message giữ qua switch/collapse. List scroll, path tooltips và keyboard labels dùng được ở panel hẹp; background status không giành terminal focus.

**Checkpoint:** NUL parser fixtures cho đặc biệt/rename/MM/conflict/malformed/initial/detached; out-of-order requests/workspace generation và empty/error/retry UI. HEAD/index/worktree states đối chiếu với fixture, không chỉ snapshot UI.

## 8. Git diff và shared viewer — Task 6.3

**Deliverable:** immutable snapshots và viewer contract cho hai callers Editor/Git.

| Scope/case | Original | Modified |
| --- | --- | --- |
| Staged | HEAD blob hoặc empty nếu unborn | Index stage-0 blob |
| Unstaged | Index stage-0 blob | Disk bytes |
| Untracked/added | Empty ở phía chưa có file | Disk/index theo scope |
| Deleted | HEAD/index theo scope | Empty |
| Rename | Old path blob của baseline | New path blob/disk của scope |
| Conflict | Structured metadata | Chưa có three-way merge UI |

Backend resolve path/mode/blob identity từ verified HEAD/index, kiểm type/size rồi đọc blob bằng OID; không interpolate frontend path vào revision expression. OID opaque theo repository object format. Không `cat-file --filters`/follow symlinks; nếu dùng patch fallback thì `--no-ext-diff --no-textconv`. [Git cat-file](https://git-scm.com/docs/git-cat-file), [Git diff](https://git-scm.com/docs/git-diff).

Recheck HEAD/index/disk khi capture, bounded retry hoặc stale error khi đổi. Blob là bytes lưu trong Git, disk là working-tree bytes; BOM/EOL/attributes conversion có thể khác. Giữ UTF-8 policy Phase 5, binary/unsupported/oversize trả metadata, không lossy decode hoặc truncate. Viewer không mô phỏng mọi clean/smudge filter.

Mở rộng `DiffPreview` với unique preview/workspace/source identity, labels và Git scope/old-new paths. Model URIs tách Editor/Git previews cùng file; cả hai sides read-only, `originalEditable: false`. Close chỉ dispose preview models/listeners, không dispose edit tab. Git preview trong Git panel, không tự chuyển/expand Editor; Ctrl+S không save snapshot hoặc editor bị ẩn.

**Checkpoint:** staged text thực sự lấy index, added/deleted/rename/unborn/mode/binary/size fixtures; snapshot race; hai callers cùng file không trùng model; native layout/hidden-show/read-only/focus và cleanup đạt.

## 9. Stage, unstage và restore — Task 6.4

**Deliverable:** selected-entry mutations qua explicit operations và destructive confirmation UI.

- Stage dùng `git add -A` với exact selected literal paths, bao gồm tracked deletion. Rename pair được backend expand/validate; filesystem rename chưa stage thường là deletion + untracked, cần chọn cả hai. Không dùng `git add .` cho selected action. [Git add](https://git-scm.com/docs/git-add).
- Unstage có HEAD dùng `git restore --source=HEAD --staged` cho exact paths; giữ disk/draft. Unborn dùng nhánh backend hẹp remove exact index entries (`update-index --force-remove`), không phụ thuộc HEAD chưa tồn tại. [Git restore](https://git-scm.com/docs/git-restore), [Git update-index](https://git-scm.com/docs/git-update-index).
- Worktree restore dùng index làm source; giữ staged changes, có thể tạo lại tracked deletion. Chỉ bật cho supported regular-file cases; conflict/link/submodule/rename semantics chưa chắc phải disable với lý do. Không delete untracked, `git clean`, restore root hoặc `reset --hard`.
- Confirmation backend gắn exact target/source và disk fingerprint/missing state. UI nói rõ saved disk changes sẽ mất, source là Index; Cancel không gọi apply. Target/index đổi sau review thì token stale, cần review lại.
- Stage file dirty phải nói rõ lấy disk; Save là action user chọn, không auto-save. Restore target dirty/saving bị chặn cho tới user giải quyết draft qua Save/Discard/Cancel, sau đó tạo confirmation mới. Backend lease serialize restore và File API save.
- Lock/filter/permission failures giữ message/draft, refresh actual state; không hứa rollback hoặc xóa `.git/index.lock`. Binary restore chỉ bật khi có valid metadata/fingerprint confirmation; oversized fingerprint có streaming/deadline, không đưa bytes vào UI.

**Checkpoint:** selected literal paths không mở rộng glob; stage deletion, unstage unborn/normal giữ disk; restore về index giữ staged content; stale/Cancel/dirty/save-in-flight không apply; locked/partial failure có actual evidence. External Git vẫn có thể race sau preflight, không tuyên bố compare-and-swap/rollback tuyệt đối.

## 10. Commit và push — Task 6.5

**Deliverable:** reviewed staged-only commit và one-ref push có lifecycle rõ.

Commit message tối đa 64 KiB UTF-8 theo preview, reject NUL/blank-only, multiline qua stdin (`--file=-`) với cleanup policy được test. Không `-a`, amend, auto-stage hoặc skip hooks. Disable nếu không staged, conflict hoặc merge/rebase/cherry-pick đang dang dở; chốt detached-HEAD UX rõ ràng, Push luôn disable detached. Reviewed HEAD/index token đổi thì refresh/review lại. [Git commit](https://git-scm.com/docs/git-commit).

Giữ local identity/hooks/signing, không auto sửa config. Missing identity/hook fail/signing/index-lock có diagnostics; failure giữ message. Success xác nhận actual HEAD/commit rồi clear message đúng workspace/request. Hooks có thể đổi index/files, interrupted operation có thể đã commit; reconcile trước retry.

Push resolve upstream ở Rust, hiển thị branch → remote/branch. Thiếu upstream/HEAD/remote thì disable và hướng dẫn cấu hình trong terminal; không tự chọn origin/set-upstream. Dùng explicit fully qualified local/destination refspec và porcelain output, không `+`/wildcard/delete/force. Override mirror/followTags và không recurse submodule push để config không mở rộng operation sang refs khác. [Git push](https://git-scm.com/docs/git-push).

Dùng credentials/SSH/GCM đã có trên máy; không lưu secrets trong frontend/log. `GIT_TERMINAL_PROMPT=0` và stdin đóng ngăn terminal prompt treo, helper có thể có native UI nên vẫn cần Cancel/deadline. [Git environment](https://git-scm.com/docs/git#Documentation/git.txt-GITTERMINALPROMPT). Auth/network/non-fast-forward/rejection báo rõ; không auto pull/rebase/force. Cancel/timeout có thể sau remote update, báo outcome chưa xác định khi thiếu evidence và không tự retry.

**Checkpoint:** staged-only/multiline/unborn commit, blank/large/identity/hook errors, token race; local bare remote one-ref push, mirror/followTags config, non-fast-forward/no-upstream/auth diagnostics, timeout/cancel tree cleanup và actual-state reconciliation. Không test push bằng remote thật của project.

## 11. Refresh và lifecycle — Task 6.6

**Deliverable:** coalesced refresh, editor disk notification/reload và native workspace/exit integration.

Triggers: workspace/panel opened, app focus, manual Refresh, successful editor save và mọi operation completion kể cả failure/cancel. Tối đa một refresh in-flight và một queued rerun; generation/token bỏ late workspace A hoặc diff A khi user đã chọn B. Preview cũ giữ immutable data kèm stale indicator, mutation không dùng token cũ.

Mở rộng Editor controller có `notifyDiskChanges(paths)`/`checkExternalChanges` và Reload. Git không truy cập registry trực tiếp hoặc gọi `setValue`/đổi saved baseline. Clean tab disk mới có Reload banner; dirty tab giữ draft/undo/revision và báo conflict/Compare; file missing giữ draft có thể copy. Reload dirty có Discard/Cancel; stage/unstage không mark draft clean. Save pending/edit thêm vẫn giữ dirty như snapshot save contract.

Panel hide giữ selection/message/operation; không cancel hoặc cướp focus. Workspace commit/app exit phối hợp editor guard với active Git: wait hoặc cancel/reap/reconcile rồi mới switch/close. Picker Cancel/error giữ old message/models/PTY. Backend lease chặn old-workspace mutation, frontend generation không thay backend guard.

**Checkpoint:** stale requests/coalescing, dirty text/undo/cursor giữ qua operations/focus, external reload/deletion, save/restore races, switch/picker/close khi push chạy và helper cleanup. Ghép Phase 7 tại C2 theo shared-file owner, kiểm real Git operations cùng shortcut/persistence/restore.

## 12. Files cần tạo/sửa và ownership

| File/nhóm | Responsibility |
| --- | --- |
| `src-tauri/src/git/mod.rs`, `process.rs` — mới | DTO/errors/commands/operation registry, bounded process/cancel/cleanup |
| `src-tauri/src/git/repository.rs`, `status.rs`, `diff.rs` — mới | Repo/token/path validation, byte parser và blob/disk capture |
| Git module tests/fixtures — mới | Owned temporary repos/bare remote và process helpers |
| `src-tauri/src/lib.rs` | Register service/commands và exit cleanup |
| `workspace.rs`, `path_guard.rs`, `file_editor.rs` | Shared lease/lock order, missing-target checks, save/restore coordination |
| `src/git/types.ts`, `gitApi.ts`, `useWorkspaceGit.ts` — mới | Typed IPC, errors, retained state, generation/coalescing và actions |
| `src/components/GitPanel.tsx` — mới | Status/scoped review, rows/message/actions/confirmation/progress |
| `src/editor/types.ts`, `useWorkspaceEditor.ts`, `SharedDiffViewer.tsx` | Preview identity/labels, disk notification/reload và model ownership |
| `App.tsx`, `RightPanel.tsx`, `AppLayout.tsx`, `StatusBar.tsx` | Controller/branch props, transition/focus adapters |
| `src/styles.css` | Compact groups/actions/dialog/progress và fill-height preview |
| Manifests/lockfiles/test config | Runner/helper/test dependencies chỉ khi cần |
| Plan/preview/README/roadmap | Expected/actual/evidence và status |

Chỉ tạo module khi task có responsibility, không scaffold toàn phase. Không expose generic shell/filesystem hoặc sửa generated schemas. Khi làm cùng Phase 7: Git modules/viewer extensions thuộc luồng Git; shared App/workspace/lib/styles/manifests ghép tuần tự bằng một owner tại checkpoint. Giữ các thay đổi Phase 5 đang chưa commit khi chọn baseline/worktree.

## 13. Thứ tự task và nghiệm thu

| Task | Checkpoint chính | Trạng thái |
| --- | --- | --- |
| Baseline + C0 khi phối hợp UX | Phase 5 native + Phase 3/4 regression, shared contracts/owner | Pending |
| 6.1 | Scoped repo/paths, bounded process, lease/cancel/cleanup | Đã triển khai; Rust fixtures đạt |
| 6.2 | NUL-safe parser, status/branch/empty/error UI | Đã triển khai; parser/UI build đạt |
| 6.3 | Đúng snapshot scopes, independent read-only models | Đã triển khai; diff backend/UI build đạt |
| 6.4 | Selected mutations, stale confirmation và dirty guards | Đã triển khai; backend lease + UI confirmation |
| 6.5 | Reviewed index commit, one-ref upstream push, error/cancel | Đã triển khai; automated compile/test đạt |
| 6.6 + C2 | Refresh/editor/workspace/exit và UX integration | Core đã triển khai; native acceptance còn chờ |

Thứ tự: baseline → 6.1 → 6.2 → 6.3 → 6.4 → 6.5 → 6.6 → native acceptance/C3. Generation, lease và cleanup dùng từ task đầu; không đợi 6.6 mới bảo vệ mutations. Khi user yêu cầu implementation, bắt đầu **6.1** sau dependency gate, giải thích data flow và verify checkpoint trước mở rộng.

Tests dùng owned temp repos và local bare remote; identity/config đặt riêng trong fixture, không sửa global config hoặc mutate repository làm việc của user. Frontend cần runner tối thiểu cho races/guards; build không thay parser fixtures, real Monaco/model retention hoặc native Git behavior.

Verification đã chạy: `npm run build`, Rust fmt/check/test/clippy, `git diff --check`, Tauri release `--no-bundle`. Ma trận native/checklist/actual evidence giữ tại [Phase 6 Preview](../../docs/phase-6-git-preview.md#11-verification-và-actual-results); native click-through vẫn pending.

Nghiệm thu cần status/diff/selected mutations/commit đúng fixture; Push UI responsive và không force; native dev/release workers; dirty/undo/PTY retention ở `960 × 600` và layout `4 → 1 → 2 → 4`; workspace/exit/cancel/process cleanup đúng. Case chưa chạy ghi pending, không đổi Phase 3/4/5 build evidence thành Phase 6 evidence.

## 14. Bàn giao và kiến thức đạt được

Phase 7 nhận Git để dogfooding sửa → Save → build/test → review → stage → commit, rồi push khi upstream có sẵn. Phần UX độc lập theo plan Phase 7 có thể chuẩn bị song song; 7.5/toàn bộ nghiệm thu UX chờ Git đạt.

Các read-only DTO/limits của Search và Git chỉ phục vụ IDE core. Không tạo registry agent, AI write layer hoặc command execution workflow mới; add/restore/commit/push vẫn thuộc Git UI với confirmation hiện có.

Concept cần hiểu sau phase: HEAD/index/disk/draft, porcelain parsing, literal paths, process ownership/bounded I/O, confirmation theo revision và lỗi/cancel không đồng nghĩa rollback. Các concept này áp dụng cho desktop integrations gọi CLI và UI review dữ liệu thay đổi ngoài app.
