# Kế hoạch Phase 10 — Coding Agent

> Implementation update 2026-10-04: core 10.1–10.6 và MSI/NSIS packaging đã được triển khai trong working tree. `patches.rs` sở hữu proposal/apply/reject; `commands.rs` sở hữu typed verification Run/Cancel; Editor và Activity đã nối IPC. Các đoạn baseline bên dưới mô tả lý do thiết kế ban đầu; acceptance còn lại là native click-through, CSP và clean-machine matrix.

Ngày lập: 2026-10-04. Trạng thái: **core 10.1–10.6 và packaging đã triển khai; còn native/CSP/clean-machine acceptance**.

Nguồn yêu cầu: [Project Instruction](../rules/Project_Instruction.md), mục 16–24 và 27–29; [Implementation Plan](Implementation_Plan.md#phase-10--coding-agent); [Phase 9 Plan](Phase_9_Read_Only_Agent_Plan.md); [README — Product direction](../../README.md#product-direction). Baseline: [Editor](../../docs/phase-5-editor-preview.md), [Git](../../docs/phase-6-git-preview.md), [UX](../../docs/phase-7-ux-preview.md), [Phase 9 Preview](../../docs/phase-9-read-only-agent-preview.md).

## 1. Mục tiêu và hướng sản phẩm

Hoàn thiện workflow `Read → Search → Propose → Review → Accept → Run/Test`: thay đổi được xem trước, chỉ áp dụng đúng nội dung đã duyệt, và command chạy có lifecycle kiểm soát. Terminal tiếp tục là workspace chính; Editor/Diff và activity hỗ trợ review.

Theo quyết định sản phẩm trong hội thoại và README, AI được dùng qua CLI trong terminal, Phase 8 AI Chat đã bỏ. Phase 10 không cần khôi phục AI Chat hoặc thêm một giao diện chat/provider riêng. Phần đọc/tìm của Phase 9 và phần proposal/command của Phase 10 phải dùng được độc lập với provider.

Phân biệt hai đường sử dụng:

| Đường sử dụng | Vai trò của app |
| --- | --- |
| User chạy AI CLI trực tiếp trong PTY | Cung cấp terminal và tools xem code/Git; CLI có thể tự sửa disk theo quyền của nó |
| CLI có adapter tạo proposal có cấu trúc | App nhận candidate, giữ proposal, hiện diff/command và thực thi sau Accept/Run |

Việc CLI chạy trong xterm không tự làm nó đi qua approval của app. Tích hợp cần protocol cụ thể có khả năng đề xuất trước khi ghi/chạy; parse ANSI terminal output hoặc xem Git diff sau khi CLI đã ghi chỉ là review sau thay đổi.

User đã ủy quyền các lựa chọn triển khai trong phạm vi project. Điều đó cho phép chốt contracts/fixtures/cách chia module khi thực hiện; không thay đổi hành vi sản phẩm: Accept và Run của người dùng ứng dụng vẫn là các thao tác riêng cho từng proposal. Plan không thêm chế độ auto-approve toàn workspace.

## 2. Baseline và mức độ hoàn thành thực tế

Baseline đọc từ source tại thời điểm lập plan; working tree có cả staged/unstaged changes và các phần Phase 9/Activity/Editor đang phát triển song song. Đây là plan tài liệu, không phải lượt implementation hoặc verification mới.

| Thành phần | Đã có | Phần cần hoàn thiện |
| --- | --- | --- |
| `src/editor/types.ts` | `PatchProposal` chứa workspace/path, revision, old/new text và model version | Contract độc lập với Monaco; ID, owner và lifecycle do Rust quản lý |
| `useWorkspaceEditor.ts` | Tạo proposal từ dirty draft; Accept gọi `writeFile`; Reject có thể reset draft | Tách proposal khỏi editor controller; giữ edits mới; chống double Accept/Reject trong lúc apply |
| `EditorPanel.tsx`, `SharedDiffViewer.tsx` | Propose patch, diff, Accept & Apply/Reject/Close; diff gắn proposal ID | Tách review draft/Git khỏi approval; pending/busy/stale feedback và đóng/mở review nhất quán |
| `file_editor.rs` | UTF-8/BOM/EOL, revision, path guard, giới hạn 2 MiB và mutation lease | Backend apply bằng proposal đã lưu; revalidate trước commit; kiểm replacement/recovery trên Windows |
| `workspace.rs`, `git/` | Workspace ID, leases, Git operation ownership, wait/cancel và process tree | Admission chung giữa Save/Explorer/Git/apply/command; lifecycle command khi đổi workspace/thoát app |
| `search.rs`, `tools.rs` | Nền tảng Search và registry năm read-only tools của Phase 9 | Không coi registry hiện tại là agent loop hoàn chỉnh hoặc command registry |
| `activity.rs`, `ActivityPanel.tsx`, `src/activity/` | Local Activity Log 9.5a có session/event/history/checkpoint và bounded records | Tái sử dụng contract hiện có cho events của Phase 10; history không phải nguồn approval hoặc quyền replay |
| Manifests/config | Chưa có frontend test script; `bundle.active = false`, CSP hiện là `null` | Chốt test tooling tối thiểu ở task cần thiết; packaging và CSP được kiểm tại 10.6 |

Các khoảng trống nhìn thấy trong bản đầu:

- `acceptProposal` chưa dùng guard in-flight như `saveFile`; callback Reject vẫn có thể chạy khi request ghi đang chờ. UI disabled không thay thế state transition tại backend.
- Sau `await writeFile`, code đặt dirty về false mà chưa bảo toàn edits phát sinh trong thời gian chờ; kết quả async cũng cần kiểm registry/model còn thuộc operation đó.
- Reject hiện hoàn tác draft thủ công nếu model còn khớp. Plan mới quy định Reject proposal không làm mất draft do user tự viết; hành vi discard draft thuộc action riêng của Editor.
- Apply hiện gửi lại content từ frontend đến `write_file`; backend chưa sở hữu proposal bất biến và approval cho proposal ID. Đây là foundation, chưa phải integration Coding Agent hoàn chỉnh.
- File writer đang có fallback `fs::copy` nếu rename thất bại. Revision check và mutation lease không tạo atomic compare-and-swap với CLI/process bên ngoài; cần kiểm commit/recovery và mô tả đúng giới hạn.

Checklist Phase 10 biểu thị nghiệm thu task đầy đủ, không chỉ sự tồn tại của UI. Bản đầu 10.1–10.3 được giữ làm baseline; các mục còn cần hoàn thiện và tests không được ghi là đã nghiệm thu.

## 3. Phạm vi V1 và phối hợp Phase 9

Đợt đầu hỗ trợ sửa **một file text đã tồn tại trong một proposal**, giới hạn tương thích File API. Proposal giữ toàn bộ nội dung trước/sau để có diff chính xác; không cần parser unified diff hoặc fuzzy apply. Không có no-op proposal.

Tạo/xóa folder/file bằng Explorer tiếp tục thuộc tools hiện có. Agent create/delete/rename, multi-file transaction, binary patch, background agent, tự commit/push, persistent executable approvals và dev server dài hạn nằm ngoài phạm vi đợt này. Mở rộng phải có contract và nghiệm thu riêng; không hứa atomic multi-file apply từ loop ghi từng file.

| Công việc | Chạy song song với Phase 9? | Dependency thực tế |
| --- | --- | --- |
| 10.1–10.2: proposal service, fixtures, review UI | Có | File snapshot/revision và Shared Diff Viewer Phase 5 |
| 10.3: apply/recovery và dirty-buffer regression | Có, tích hợp shared files theo checkpoint | Path guard, mutation admission, Git/Editor lifecycle Phase 5–7 |
| 10.4: command service và process fixtures | Có | Workspace ownership, process-tree primitives; command service thuộc Phase 10 |
| 10.5: verify workflow với candidate/fake adapter | Có | Apply + command service, IDs/budgets/result contracts |
| CLI tạo proposal và vòng đọc/sửa thật | Sau khi thống nhất transport | Phase 9.4/9.5b hoặc adapter tương đương, evidence/revision và run cancellation |
| 10.6: nghiệm thu V1 | Sau các phần trên | Native gates liên quan Phase 3–7, Phase 9 và live workflow |

Phase 9 chỉ có read-only registry; **không chờ Phase 9 thêm command registry**. Phase 10 xây `CommandService` và apply boundary riêng. Có thể nghiệm thu nền tảng proposal/command trước live CLI integration, nhưng chưa gọi toàn workflow là Coding Agent hoàn chỉnh.

Shared files (`useWorkspaceEditor.ts`, `types.ts`, `SharedDiffViewer.tsx`, `App.tsx`, `lib.rs`, `workspace.rs`, `preferences.rs`, `styles.css`) có một owner tích hợp tại mỗi checkpoint. Các domain service/fixtures độc lập có thể làm song song; không ghi đè hoặc stage toàn bộ changes của bên đang làm Phase 9/Activity.

## 4. Architecture, ownership và data flow

```text
Phase 9 read/search/evidence      CLI adapter hoặc draft adapter để test
              │                                  │
              └────────────── candidate ─────────┘
                                    │
                         Rust ProposalService
                     owner + immutable snapshot + limits
                                    │
                         Editor / Shared Diff Viewer
                             │               │
                           Reject          Accept
                             │               │
                     discard proposal    validate + Apply
                                             │
                                      ApplyResult/revision
                                             │
                                       Verify proposal
                                             │
                                       Run / Cancel
                                             │
                                      Rust CommandService
                                  child tree / output / timeout
                                             │
                                  result → activity / adapter
```

- Rust sở hữu workspace canonical root, window owner từ Tauri, proposal/operation ID, trạng thái approval, committed revision và child processes.
- Frontend sở hữu review selection, pending display, focus và editor draft/version. Model version là guard của buffer, không phải quyền ghi do caller tự khai.
- CLI/model chỉ tạo candidate và gọi read tools. Nó không gọi IPC Accept/Apply/Run của UI, không đưa `approved: true`, không chọn root/window owner hoặc tự tăng budgets.
- Read-only registry vẫn giữ năm tools. Adapter chuyển ý định sửa/chạy thành candidate cho service riêng; `apply_patch` trong roadmap được thực thi qua approval boundary, không dispatch thẳng từ model vào `write_file`.
- Chỉ tách primitive process-tree spawn/terminate khi có consumer thứ hai. Git environment, args và diagnostics giữ trong Git runner; command runner có policy riêng.

Data flow apply: read snapshot → validate candidate against revision → lưu proposal bất biến → UI lấy exact preview → Accept ID → backend chuyển pending sang applying một lần → lease/revalidate/write → result → cập nhật baseline của model phù hợp.

Data flow command: tạo command spec → backend resolve/validate → UI xem executable/args/cwd và script nếu có → Run ID → đăng ký operation trước spawn → stream bounded output → exit/cancel/timeout → cleanup → publish result. Không gửi lệnh vào PTY đang có shell/AI CLI để đoán kết quả.

## 5. Contracts và giới hạn

Các DTO dưới đây là thiết kế dự kiến; không mô tả APIs đã tồn tại. IPC mới dùng `camelCase`, typed Rust DTO/enum, reject unknown fields và errors bằng code.

| Contract | Trường chính và invariant |
| --- | --- |
| `PatchCandidate` | Relative path, expected disk revision, proposed LF text, optional run/evidence reference; origin được host xác định |
| `PatchProposal` | Backend ID, workspace/owner, path chuẩn hóa, expected revision, original/proposed text, content digest, source run nếu có, state và expiry |
| `EditorReviewGuard` | File/model identity và version lúc review; frontend giữ để không mất draft khi async apply kết thúc |
| `ProposalActionRequest` | `workspaceId`, `proposalId`; Accept không gửi lại path/content/approval boolean |
| `ApplyResult` | Proposal/operation ID, workspace, path, committed revision/bytes và outcome; phân biệt failure trước ghi với commit không xác minh được |
| `CommandCandidate` | Executable key, argument vector, relative cwd, reason và linked applied proposal nếu có |
| `CommandProposal` | Backend ID, resolved executable/spec digest, cwd, relevant input revisions, deadline/output limits và owner |
| `CommandResult` | Operation/proposal ID, outcome, exit code, duration, bounded stdout/stderr, truncation và cleanup state |

Giới hạn khởi đầu, đo trên fixtures trước khi chốt:

| Resource | Giá trị thiết kế |
| --- | --- |
| Pending proposal | Một patch và một command mỗi workspace/window; một mutation operation mỗi workspace |
| File text | Tối đa 2 MiB sau encode, giữ limit File API |
| Proposal memory | Tối đa 8 MiB tổng original/proposed payload mỗi workspace, tính UTF-8 bytes |
| Proposal expiry | 10 phút; hết hạn cần proposal mới, không tự giữ quyền qua restart |
| Command args | Tối đa 64 args, tổng spec tối đa 16 KiB UTF-8; kiểm thêm command-line size Windows |
| Command time | Mặc định 120 giây, cấu hình explicit tối đa 600 giây; adapter không tự nâng |
| Command output | Tổng retained stdout/stderr 1 MiB; giữ bounded tail và báo truncated, tiếp tục drain |
| Verify workflow | Một command đang chạy, tối đa hai attempts explicit, tổng thời gian process tối đa 600 giây |

Thời gian chờ người dùng duyệt không giữ mutation lease và không giữ agent network request mở. Approval expiry khác process timeout. Proposal và quyền pending không persist; activity nếu lưu chỉ chứa metadata cần thiết, không biến restart thành tự chạy lại.

## 6. Task 10.1 — Proposal service và draft adapter

1. Tạo service Rust trong memory, bind workspace ID và window owner; IDs do backend sinh, bảng có cap/expiry. Model/caller không tự cấp owner hoặc revision mới.
2. Guard path như File API; chặn traversal/UNC/ADS/device path, link/reparse, root và Git metadata `.git`. Chỉ nhận regular UTF-8 file, reject read-only/binary/oversize/mixed EOL/bare CR theo contract.
3. Backend đọc snapshot và kiểm expected revision từ lần đọc dùng tạo candidate. Không lấy snapshot mới rồi âm thầm gán proposal cũ vào revision mới. Ranges/excerpts Phase 9 không thay thế full snapshot để apply.
4. Validate proposed text và size sau encode; giữ BOM/EOL của original. Lưu original/proposed bất biến; thay content phải tạo ID mới.
5. Giữ draft adapter để test: user sửa trong Editor → tạo candidate từ baseline + draft. Thêm đường nhận candidate độc lập với tab đang mở để CLI integration không phụ thuộc modelVersion Monaco.

State machine:

```text
pending → applying → applied
   │          └──→ failed / failedUncertain
   ├──→ rejected
   ├──→ stale
   └──→ expired
```

`Close` chỉ đóng preview; `Reject` giải phóng proposal, không gọi writer và không reset manual draft. Backend reject/expire sau applying phải trả busy/state error; không hứa cancel một write đã bước vào commit.

Điều kiện đạt 10.1: candidate không ghi target; snapshot/digest/ID không đổi; no-op/path/schema/size/owner/expiry được kiểm; draft vẫn giữ qua Reject. Dùng fixtures độc lập với live AI.

## 7. Task 10.2 — Review và xử lý draft

- Shared Diff Viewer nhận exact proposal của service; hai cột có nhãn original/proposed và relative path. Git diff/Compare disk/Review draft chỉ có Close; approval actions chỉ hiện khi view gắn đúng proposal ID.
- Pending proposal có action mở lại review dù user đổi tab/tool. Dùng ID của proposal để xác định target; active tab khác không biến thành file được apply.
- UI có pending/applying/stale/error/applied states. Khi applying, khóa Accept/Reject/Reload/Discard của target; callback/backend cũng có state guard để double-click không tạo operation thứ hai.
- Nếu tab chứa unsaved edits khác base của candidate AI, giữ draft và báo conflict. User tự Save/discard bằng Editor action rồi tạo/review proposal mới; không tự merge hoặc lấy draft làm disk snapshot.
- Manual draft adapter vẫn có Review/Save thông thường. Reject proposal không phải Discard draft; không khóa user trong luồng Save All/đổi workspace không có action thoát rõ ràng.
- Hidden/collapsed tool không cancel process hoặc xóa proposal; completion không cướp focus terminal. Monaco models diff được dispose khi view đóng, không dispose model chính.

Điều kiện đạt 10.2: Close/reopen đúng diff, Reject không đổi disk/draft, normal Review/Git không có Apply, keyboard/focus và layout không mất PTY/buffer. Test meaningful async states và native click-through; build chỉ kiểm type/bundle.

## 8. Task 10.3 — Apply, race và recovery

Backend Accept request kiểm window/workspace/ID/expiry/state và chuyển `pending → applying` dưới lock ngắn. Sau đó acquire mutation lease; kiểm mutation Git/Explorer/Save/command qua admission chung, không giả rằng hai mutex ở hai service tự loại trừ nhau.

Thứ tự commit:

1. Resolve/revalidate exact path, metadata và revision; nếu khác snapshot thì stale, không fuzzy apply/rebase tự động.
2. Encode proposal theo BOM/EOL đã review, validate text/limit; chuẩn bị temp file cùng directory, sync bytes và giữ permission metadata cần thiết.
3. Revalidate target/path/revision sát commit. Chọn replacement/recovery phù hợp Windows, kiểm bằng failure fixtures; tránh fallback copy ghi đè nửa chừng mà vẫn báo success.
4. Commit và xác minh bytes/revision trên disk; chỉ trả applied khi khớp nội dung đã duyệt. Revision dùng normalized relative path nhất quán với reader.
5. Cleanup temp và release lease trong mọi nhánh. Nếu commit có thể đã xảy ra nhưng verify thất bại, trả `failedUncertain` và yêu cầu reread/compare, không tự retry hoặc revert lên thay đổi ngoài app.

Không giữ mutex proposal/workspace qua I/O. Mutation lease serializes mutations của app, không chặn CLI bên ngoài. Revalidate thu hẹp race; filesystem replacement không được quảng cáo là atomic CAS chống mọi process khác thay link/file giữa check và commit.

Editor sau result kiểm workspace generation, operation ID và registry/model identity. Baseline cập nhật thành text/revision đã commit. Nếu user tạo edits mới trong lúc chờ, giữ model text/undo và tính dirty so với baseline mới; không unconditional `setDirty(false)`. Polling snapshot cũ không được ghi đè result mới.

Target bị delete/restore/close/reload trong lúc operation cần một policy xuyên suốt Editor/Explorer/Git: app guard admission khi busy, late responses không thao tác model đã dispose. Save/Reload/Reject lỗi dùng structured codes (`STALE_PROPOSAL`, `FILE_CONFLICT`, `WORKSPACE_BUSY`, `INVALID_PROPOSAL_STATE`, …), không phân loại bằng substring ngôn ngữ UI.

Điều kiện đạt 10.3: một Accept chỉ commit đúng proposal; stale/no-approval/wrong owner/Reject không ghi target; async edits vẫn dirty; Windows failures có outcome/recovery rõ. Không kiểm write bằng chính repository của user.

## 9. Task 10.4 — Command proposal, Run/Cancel và process lifecycle

V1 command policy bắt đầu nhỏ: npm script `test`/`build`, Cargo `check`/`test`. Rust resolve trusted toolchain executable ngoài workspace/current-directory shims; validate args theo operation, cwd tương đối được guard, stdin null, hidden console và không nhận arbitrary env overrides. Không nhận shell string, redirection/pipeline hoặc tùy ý `powershell -Command`/`cmd /c`/`bash -c`.

Trên Windows, npm có thể là `.cmd` launcher. Khi triển khai phải xác minh Node/npm installation rồi chọn adapter gọi entry point phù hợp bằng args riêng; không dùng ghép chuỗi shell để xử lý quoting. Nếu toolchain không resolve được, trả missing/unsupported dependency; không tự cài dependencies hoặc dùng executable trong repo.

npm script và Cargo/build configuration là project code có thể chạy lệnh tùy ý. UI cho thấy script thực tế khi chọn npm; spec giữ digest của manifest/config liên quan và reread trước Run. Digest phát hiện các inputs đã capture đổi, không tạo snapshot bất biến của toàn dependency graph. Guard cwd và args là boundary của app, **không phải OS sandbox cho nội dung test/build**.

Command proposal có reason, executable/args/cwd, linked apply revision nếu dùng để verify, timeout và state. UI `Run` xác nhận exact ID/spec; Cancel ở pending không spawn. Specs đổi phải tạo proposal mới. Command không gọi commit/push/install hoặc tự nâng quyền.

```text
pending → starting → running → succeeded / failed
   │           │         ├──→ timedOut
   │           └─────────┴──→ cancelling → cancelled
   ├──→ cancelled
   └──→ stale / expired
```

- Đăng ký operation/owner/control trước spawn; Cancel đến trong starting được ghi intent và kill ngay khi child được bind. Run hai lần không spawn hai process.
- Windows child và descendants nằm trong process tree có kill-on-close. Drain stdout/stderr đồng thời với buffers/IPC bounded; output cap không giữ pipe đầy khiến child treo.
- Cancellation/timeout/shutdown terminate tree, reap child, join readers rồi mới publish terminal result và release admission. Child parent exit không được để helper giữ pipe vô hạn.
- Result phân biệt spawn failure, exit code khác 0, timeout, user cancel và truncated output; Cancel thắng late success khi cancellation đã được chấp nhận.
- Run/test có thể mutate workspace, dùng admission giữ các mutations của app khỏi chạy đồng thời. Không giữ workspace mutex qua cả command. User vẫn dùng PTY; edits ngoài app làm snapshots/evidence cũ stale.
- Workspace picker Cancel/error giữ state; switch thành công invalidate proposals cũ sau xử lý operations. Running command có Wait/Cancel; cancellation chưa cleanup xong thì chưa switch. Restore workspace và app/window close đi qua cùng lifecycle, không chỉ frontend cleanup.

Điều kiện đạt 10.4: pending Cancel không spawn; double Run/starting Cancel, owner mismatch, huge output, timeout/hung descendants, missing toolchain và shutdown đều có fixtures. Test helpers chạy trong temp workspace, không kill process Phase 9 hoặc terminal của user để dọn môi trường test.

## 10. Task 10.5 — Verify workflow và CLI adapter

Sau Apply thành công, tạo đề xuất verify liên kết đúng proposal/revision; không tự chạy command. User chọn Run, xem output/result và quyết định Retry hoặc yêu cầu sửa tiếp. Retry dùng proposal/approval mới khi inputs đổi, không tái sử dụng approval terminal state.

Fake candidate/adapter kiểm workflow trước live integration: read snapshot → đề xuất edit → review → Accept → đề xuất verify → Run → result. Error, no-match, rejected/stale patch và cancelled command không tạo loop tự sửa vô hạn. Mỗi lần sửa lại cần review/Accept mới; mỗi lần chạy lại cần action Run mới, giới hạn attempts/time trong mục 5.

Live CLI integration có checkpoint riêng:

1. Ghi một CLI/protocol/transport cụ thể từ môi trường thực tế và capability propose-before-write/propose-before-run. Bám định hướng CLI đã chọn; không thêm provider/chat UI để vượt dependency.
2. Chốt handshake, schema/version, run/call IDs, owner, cancellation và output limits với Phase 9.4/9.5b; Activity Log 9.5a tái sử dụng cho metadata. Chỉ chọn một adapter V1; bridge/MCP/headless transport nếu thực sự cần có task/files/verification riêng.
3. Validate candidate tại Rust. CLI thất bại/disconnect/malformed output không làm app ghi/chạy; response run cũ không tạo proposal ở workspace mới.
4. Live dogfooding trên fixture: CLI đọc qua contract đã nối, tạo proposal, user review/Apply/Run và nhận result. Record actual evidence cho adapter này.

Nếu CLI đang dùng không có protocol phù hợp, giữ direct terminal workflow và nghiệm thu foundation riêng; không gọi việc scan terminal output/Git diff là tích hợp approval. Cần adapter cụ thể đạt checkpoint mới nghiệm thu toàn 10.5.

Activity hiển thị actions/results thật với proposal/operation/run IDs; không ghi suy luận nội bộ hoặc giả test counts. Exit code 0 chỉ chứng minh command kết thúc thành công theo executable; không tự suy ra số test pass khi không có structured report. Log lỗi không biến thành approval mới; session history không replay pending changes.

## 11. Tasks, files và checkpoints

| Task | Deliverable | Nghiệm thu |
| --- | --- | --- |
| C0 | Baseline, scope một file, contracts/limits, ownership shared files và hướng CLI | Không đánh dấu bản đầu là agent hoàn chỉnh; native gates được ghi đúng |
| 10.1a | Service/backend IDs + immutable proposal + draft fixture adapter | Create/read/reject/expiry không ghi target; reject giữ manual draft |
| 10.1b | Schema/path/text/size validation + independent candidate input | Traversal/metadata/link/schema/no-op/owner fixtures đạt |
| 10.2 | Diff/pending UI + draft preservation + async action guards | Close/reopen, wrong view, double actions, keyboard/native retention đạt |
| 10.3a | Backend Apply bằng ID + mutation coordination + revision/recovery | Exact content, stale/owner/race, temp cleanup và failure outcomes đạt |
| 10.3b / C1 | Editor/Git/Explorer/polling integration | Edits trong lúc apply giữ dirty; native review/apply regression đạt |
| 10.4a | Typed command policy + resolution + approved spec | Cancel pending không spawn, unsafe specs/changed inputs bị reject |
| 10.4b / C2 | Runner/output/cancel/timeouts/switch/shutdown | Process tree/readers/admission cleanup có fixtures và native evidence |
| 10.5a | Verify state machine và deterministic fake adapter | Reject/failure/cancel/retry/budgets không tạo auto-loop |
| 10.5b / C3 | Một live CLI adapter nối Phase 9 và activity | End-to-end proposal-before-write có actual evidence |
| 10.6 / C4 | Release, installer, missing dependencies, dogfooding | V1 acceptance matrix đạt, docs khớp source và actual results |

Thứ tự: `C0 → 10.1 → 10.2 → 10.3/C1`; 10.4 core chuẩn bị song song khi ownership ổn định; sau `C1 + C2 → 10.5 → 10.6`. Task nhỏ đi qua giải thích What/Why/How và expected/actual trước checkpoint kế tiếp.

| File/nhóm file dự kiến | Responsibility |
| --- | --- |
| `src-tauri/src/patches.rs` | Proposal DTO/state/ownership/limits và apply orchestration; tách submodules chỉ khi cần |
| `src-tauri/src/commands.rs` | Command policy/spec/lifecycle và result; không reuse Git-specific runner làm arbitrary command executor |
| `src-tauri/src/process/windows.rs` nếu cần | Tách primitive Job Object dùng chung, giữ Git/search behavior bằng regression fixtures |
| `file_editor.rs`, `path_guard.rs` | Snapshot/encoding/normalized revision, guarded commit/recovery và limits |
| `workspace.rs`, `git/`, `lib.rs`, `preferences.rs` | Admission, registration và lifecycle switch/restore/shutdown của service mới |
| `src/changes/{types,changeApi,useWorkspaceChanges}.ts` | Typed proposal IPC/controller độc lập với Monaco |
| `src/commands/{types,commandApi,useWorkspaceCommands}.ts` | Command spec/output/control state và race guards |
| `EditorPanel.tsx`, `SharedDiffViewer.tsx`, `useWorkspaceEditor.ts`, `types.ts` | Pending review, draft adapter và committed-baseline sync; giữ navigation/undo đã có |
| `src/components/CommandReview.tsx`, `App.tsx`, `RightPanel.tsx`, `styles.css` | Compact command review/result và Wait/Cancel lifecycle UI |
| Phase 9 adapter/activity files đã thống nhất | Candidate transport, run/evidence IDs và events; không viết lại registry read-only |
| `package.json`, Cargo manifests/locks, `tauri.conf.json` | Minimal test dependency và packaging khi bắt đầu task tương ứng |
| `docs/phase-10-coding-agent-preview.md` | Tạo trong implementation để ghi contract thật, expected/actual, native evidence và pending cases |

Đây là responsibility map, không yêu cầu tạo tất cả files/stores trong một lượt. Reuse component/service hiện có khi contract phù hợp; không sửa generated schemas bằng tay.

## 12. Verification, V1 release và bước đầu tiên

Fixtures dùng temp directory riêng, có original hashes và sentinel ngoài root. Failed/Reject/Cancel-before-start cases kiểm target bytes không đổi; không đòi literal toàn filesystem bất biến khi app vẫn lưu preferences/activity riêng.

| Case | Expected |
| --- | --- |
| Candidate → Close/reopen → Reject | Same preview; target không đổi; manual draft và undo giữ |
| Wrong workspace/window/ID, expired hoặc modified candidate | Structured rejection; không lấy caller content để apply |
| Double Accept; Accept rồi Reject/Close/Reload khi đang chờ | Một commit; không outcome mâu thuẫn hoặc thao tác model disposed |
| User edit trong async Apply; tab đóng/poll cũ/dirty conflict | Giữ edits/undo hoặc guard busy; dirty tính theo committed baseline |
| Disk đổi/delete/restore; stale revision; liên kết Phase 9 excerpt | Stale/error rõ, không tự rebase hoặc silently overwrite |
| Traversal/UNC/ADS/.git, symlink/junction/reparse, root | Reject; sentinel ngoài workspace giữ nguyên |
| UTF-8 tiếng Việt/emoji, BOM, LF/CRLF, binary/mixed EOL, size caps | Preview/write đúng encoding hoặc unsupported; size kiểm sau encode |
| Temp/create/sync/replace/verify failures trên Windows | Không false success; cleanup/recovery và uncertain commit phân biệt |
| Unsafe executable/flags/cwd/env; npm manifest đổi sau review | Reject/refresh spec; args là data, không shell injection |
| Double Run; Cancel pending/starting/running; timeout/helpers giữ pipes | Không spawn ngoài approval; tree/readers được reap; release admission |
| stdout/stderr flood, queue cap, non-zero exit, missing toolchain | Bounded output, responsive UI và đúng result/diagnostic |
| Save/Git/Explorer mutation trong Apply/Run; switch/restore/close | Admission/lifecycle nhất quán; không hủy nhầm PTY hoặc process bên khác |
| Fake/live adapter errors, late responses, repeat failed verify | Budgets hữu hạn; không auto Apply/Run/commit/push |
| Restart/history/open activity cũ | Không phục hồi approval hoặc tự chạy operation từ history |
| Layout 1/2/4, Left/Right tools, collapse, `960 × 600`/`1440 × 900` | PTY IDs/PIDs/input và editor buffers giữ, review usable và không giành focus |

Frontend tests tập trung race/lifecycle và draft preservation, chọn tooling tối thiểu khi triển khai; backend fixtures kiểm ownership/path/commit/process behaviors. Native cases phải có ngày, môi trường, expected, actual và ảnh/log; skipped không được ghi pass.

Verification dự kiến khi implement:

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

Task 10.6 bổ sung release installer: chốt Windows bundle target (ví dụ NSIS), icons/metadata và dependency distribution; `bundle.active = false` hiện tại nghĩa là release executable không chứng minh installer đã có. Kiểm clean machine/profile, offline Monaco workers, install/launch/restart/uninstall, dependency thiếu Git/rg/PowerShell/Node/npm/Cargo, paths có dấu/khoảng trắng và large-workspace limits. Thiếu toolchain chỉ vô hiệu workflow phụ thuộc, terminal/tools còn dùng được nếu dependencies của chúng sẵn sàng.

Review CSP/capabilities cho nội dung untrusted và IPC ở packaged app; không coi CSP `null` là thiết kế đã nghiệm thu. Packaging logs/process output không đưa secrets vào persisted history. Uninstall không xóa project workspace của user.

- [x] C0 ghi baseline, contracts và shared-file ownership.
- [x] 10.1 service bất biến/expiry/owner/path/size và draft adapter đạt.
- [x] 10.2 review/Reject/draft retention đạt; native retention còn click-through.
- [x] 10.3/C1 backend exact Apply, recovery và Editor race guard đạt.
- [x] 10.4/C2 command policy/process/cancel/lifecycle đạt ở core runtime.
- [x] 10.5/C3 verification workflow đạt; live CLI adapter không thuộc transport terminal đã chọn.
- [x] 10.6/C4 release executable, icon, MSI và NSIS packaging đạt; CSP/missing-dependency/dogfooding còn native acceptance.
- [x] Roadmap/README/preview đã ghi đúng scope và evidence; không gọi terminal output là live approval.

Core implementation đã hoàn tất qua **C0 → C4**. Bước tiếp theo là native click-through, CSP review, clean-machine dependency matrix và dogfooding; không tự thêm provider/chat hoặc parse output của AI CLI trong terminal thành approval.

Kiến thức cần đạt trong từng task: proposal bất biến khác editor draft; approval gắn exact content khác boolean; model version khác disk revision; cancel intent khác process cleanup; cwd/path guard khác OS sandbox; commit được xác minh khác write request trả về; fake adapter kiểm workflow khác live CLI integration.
