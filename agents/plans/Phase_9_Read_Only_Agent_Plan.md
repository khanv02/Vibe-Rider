# Kế hoạch Phase 9 — Read-only Agent

Ngày lập: 2026-10-04. Trạng thái: **nền tảng 9.1–9.3 và local Activity Log 9.5a đã triển khai; 9.4/9.5b còn chờ CLI adapter, evidence UI và native acceptance**.

Nguồn yêu cầu: [Project Instruction](../rules/Project_Instruction.md), mục 15–18, 21–24 và 27–29. Roadmap: [Implementation Plan](Implementation_Plan.md#phase-9--read-only-agent). Baseline: [Phase 6 Git](../../docs/phase-6-git-preview.md), [Phase 7 UX](../../docs/phase-7-ux-preview.md).

## 1. Mục tiêu và quyết định phạm vi

Xây nền tảng tìm kiếm và đọc code trong workspace có giới hạn, tái sử dụng filesystem/Git hiện có. Theo roadmap, agent dùng các tools này để trả lời với bằng chứng path/dòng; terminal tiếp tục là main workspace.

Thứ tự phase trong tài liệu nguồn là `7 → 9 → 10`; không tự thêm hoặc đổi tên thành Phase 8.

Có một điểm cần thống nhất trước phần agent: `Project_Instruction.md` yêu cầu LLM tool calling và một provider V1, nhưng [README](../../README.md#product-direction) hiện ghi AI chạy qua CLI, không tích hợp chat/provider riêng. Đã chốt cho lượt này: **AI CLI + local Activity Log**; chưa thêm provider/chat riêng vào app. Plan giữ đầy đủ tasks 9.1–9.5 của roadmap và chia dependency như sau:

| Phần | Deliverable | Quyết định cần có |
| --- | --- | --- |
| 9.1–9.3 — Nền tảng chung | Search service, Search UI và read-only registry | Có thể thiết kế/kiểm chứng độc lập với provider |
| 9.4–9.5 — Agent theo roadmap | CLI adapter/agent loop, activity và câu trả lời có bằng chứng | Chốt CLI/protocol/transport trước adapter; Activity Log local đã có contract riêng |
| Hướng CLI đã chọn | Giữ nền tảng chung; định nghĩa adapter cho CLI cụ thể và không upload raw repository | Registry nội bộ chưa đồng nghĩa CLI đã gọi được tools; cần native/e2e evidence |

Mặc định thiết kế agent trong plan theo tài liệu nguồn. Không cài SDK, chọn model/provider, tạo server/MCP bridge hoặc sửa quy tắc sản phẩm trong lượt lập plan. Nếu chỉ thực hiện 9.1–9.3, ghi là **nền tảng Phase 9 hoàn tất**, chưa nghiệm thu toàn bộ Read-only Agent theo roadmap hiện hành.

Phạm vi V1 của phase:

- Tìm text literal trong file UTF-8 trên disk; có Match case và scope thư mục tương đối.
- Hiển thị path, dòng, snippet; mở đúng vị trí trong Editor hiện có.
- Registry chỉ gồm `read_file`, `list_directory`, `search_text`, `git_status`, `git_diff`.
- Agent chạy từng tool tuần tự, có giới hạn, Cancel và activity gắn workspace/run.
- Kết quả phân biệt no-match, partial, stale, unsupported, error và cancelled.

Regex, replace-all, semantic search, vector database, background indexing, file watcher tổng quát, multi-agent, plugin marketplace, cloud history sync, raw terminal transcript, patch apply và agent command execution nằm ngoài phase. Git mutations vẫn thuộc UI Phase 6; không đưa vào registry read-only.

## 2. Baseline đã kiểm tra từ source

| Thành phần hiện có | Cách tái sử dụng và phần cần bổ sung |
| --- | --- |
| `workspace.rs` | Có canonical root, workspace ID, snapshot và mutation/transition leases. Search/read run cần ownership và stale check riêng; không chiếm mutation lease cho cả run |
| `path_guard.rs` | Có relative-path validation, containment, regular-file guard và chặn symlink/junction/reparse. Phải áp dụng trước traversal/read, không chỉ lọc kết quả sau khi rg đã đọc |
| `filesystem.rs` | `read_directory` đọc một cấp, sort và cap 5.000 entries; quá cap trả lỗi. Dùng làm `list_directory`, không ghép Explorer lazy loading thành recursive search |
| `file_editor.rs` | `read_file` trả UTF-8 snapshot/revision, normalize newline, cap 2 MiB. Hiện `fs::read` xảy ra trước size check; cần bounded read khi tái sử dụng cho tools |
| `git/` | Status/diff và process cancellation đã có. Runner còn gắn `GitError`, Git environment và operation control; không dùng trực tiếp để chạy rg |
| `git/windows.rs` | Có process-tree containment bằng Job Object. Chỉ tách primitive spawn/terminate dùng chung khi Search trở thành consumer thứ hai; giữ nguyên Git behavior |
| `useWorkspaceEditor.ts`, `MonacoEditor.tsx` | Có model/tab retention và `openFile(relativePath)`; chưa có contract open-at-line/selection. Cần bổ sung navigation với token và xác nhận model đã sẵn sàng |
| `ExplorerPanel.tsx`, `panels/types.ts` | Search vẫn đặt trong Explorer; Activity là tool riêng với local-only session state, không trộn vào Search persistence |
| Manifests/runtime | Có `serde_json`, chưa có Search/Agent module hoặc frontend test script. `rg --version` trên máy hiện tại trả `15.2.0`; đây chưa chứng minh packaged app resolve được rg |

Các kết quả build/test 46 tests trong preview Phase 6/7 là evidence ngày 2026-10-03, không phải verification mới của lượt lập plan. Native Phase 3–7 và Task 7.5 dogfooding còn pending theo tài liệu.

## 3. Điều kiện bắt đầu và checkpoints

Preparation contracts, fixtures và search core có thể làm trước. Trước tích hợp UI/agent, hoàn thành native baseline có liên quan và ghi actual results; lỗi mất input, draft hoặc session phải được xử lý trước khi mở rộng.

```text
C0: thống nhất phạm vi + contract + ghi trạng thái native baseline
  → 9.1 Search service và process/path fixtures
  → 9.2 Search UI + Editor navigation + native regression
  → 9.3 Read-only registry + bounded adapters
  → C1: nghiệm thu nền tảng tìm/đọc độc lập với provider
  → 9.4 Agent loop với một provider đã chọn
  → 9.5 Activity + evidence links + native dogfooding
  → C2: nghiệm thu toàn Phase 9
```

| Checkpoint | Điều kiện đạt |
| --- | --- |
| C0 | Hướng CLI/provider được ghi rõ trước task phụ thuộc; baseline 3–7 có expected/actual/evidence, không suy ra acceptance từ build |
| 9.1 | Search đúng trên fixture; không đọc xuyên link/reparse; no-match/caps/cancel/timeout và process cleanup có tests |
| 9.2 | Click/keyboard mở đúng model/dòng, kể cả Unicode; query race và dirty-buffer retention có evidence |
| 9.3 / C1 | Tool allowlist thực thi tại Rust; path/schema/output limits có tests; chỉ đọc disk/HEAD/index, không đưa draft vào tools |
| 9.4 | Tool loop thật chạy end-to-end; invalid call, repeated calls, provider failure và Cancel đều kết thúc hữu hạn |
| 9.5 / C2 | Activity phản ánh dữ liệu thực đọc; evidence link hợp lệ; native workflow và regression matrix đạt |

Không ước lượng ngày trước khi có baseline. Mỗi task là một thay đổi đủ nhỏ để giải thích, review và kiểm chứng theo working style của project.

## 4. Architecture và ownership

```text
Explorer: Files / Search              Agent interaction (sau quyết định C0)
        │                                     │
        └──────── typed Tauri IPC ─────────────┘
                            │
                 Rust workspace/run context
                            │
          ┌─────────────────┴─────────────────┐
          │                                   │
     SearchService                     ReadOnlyToolRegistry
          │                         read/list/search/status/diff
          │                                   │
   guarded enumeration              filesystem + Git services
          │
    bounded rg process
          │
   immutable results/evidence → UI / agent answer
```

- Rust sở hữu canonical root, process, tool validation, budgets và run cancellation. Frontend sở hữu query, selection, rendering và focus.
- Mỗi search/run gắn workspace ID và window owner từ Tauri; không nhận owner/root/executable tùy ý từ caller.
- Registry dispatch theo enum/allowlist; không ánh xạ tool name thành Tauri command name bất kỳ.
- Agent context chỉ cho phép gọi registry. Không có `write_file`, terminal input, add/restore/commit/push, branch mutation, `apply_patch` hoặc `run_command` trong context đó.
- Read-only là giới hạn tools của agent, không phải sandbox cho PowerShell/AI CLI do user tự chạy. Các process bên ngoài vẫn có thể sửa disk/index trong lúc app đọc.
- Services trả immutable snapshots. Search/agent activity không dispose Monaco models, tự Save, Reload hoặc reset PTY.

Nếu giữ agent tích hợp theo roadmap, provider request đi qua backend adapter riêng. Secrets không nằm trong React state, tool output, preferences JSON hoặc logs. Chỉ chọn một provider tại C0; kiểm documentation chính thức và storage/config thực tế trước task tích hợp, không dựng framework nhiều providers trước.

## 5. Search service — Task 9.1

### Contract và limits

Request nghiệp vụ: `workspaceId`, `query`, `relativeDirectory`, `caseSensitive`. `relativeDirectory = ""` nghĩa là root. Query không rỗng/whitespace-only, không NUL/newline, tối đa 4 KiB UTF-8; literal là mode duy nhất ban đầu.

Các giới hạn sau là **giá trị thiết kế ban đầu**, cần đo trên fixture trước khi chốt:

| Resource | Limit |
| --- | --- |
| Đồng thời | Một Search UI job và một agent run mỗi workspace/window; agent chỉ một tool đang chạy |
| Search deadline | 15 giây tổng, gồm enumerate và mọi batch, không reset deadline theo file |
| Candidate scan | 20.000 entries, depth 64; báo partial nếu dừng vì cap |
| File search | Tối đa 2 MiB/file, khớp File API |
| Kết quả | 500 match rows, tối đa 32 ranges/row; UI cho biết số kết quả thực trả |
| Process output | stdout tổng 4 MiB, stderr 64 KiB; JSON record tối đa 3 MiB |
| Snippet | 1 KiB UTF-8/row, cắt ở character boundary và ghi snippet offset |

Không dùng `--max-count` làm global cap vì đó là limit theo file. Khi đạt cap, giữ các JSON records hoàn chỉnh đã parse, terminate/reap process và trả `partial` kèm reason; không coi JSON bị cắt giữa record là kết quả hợp lệ.

### Traversal và executable

1. Lấy workspace snapshot và resolve scope bằng guard; reject traversal, absolute/drive-relative/UNC/device/ADS paths.
2. Rust enumerate ứng viên có giới hạn. Đề xuất dùng crate `ignore` cho ignore matching/traversal thay vì tự viết parser `.gitignore`; chỉ thêm dependency khi triển khai 9.1.
3. Không follow links; kiểm `symlink_metadata` và reparse trước khi descend. Reject cả ignore file là link. Chỉ đọc ignore rules bên trong workspace; tắt parent/global Git config và external exclude discovery. `.git` luôn bị prune. Giữ `.gitignore`, `.ignore`, `.rgignore` trong workspace và mặc định bỏ hidden/generated/dependency directories.
4. Revalidate mỗi regular-file path trước khi spawn. Chuyển **danh sách file đã guard** cho rg, không giao recursive directory traversal của workspace cho child process. Empty candidates trả no-match mà không spawn rg/stdin search.
5. Chia batch theo command-line length Windows, đề xuất tối đa 128 paths và 24.000 UTF-16 code units/batch tính cả quoted arguments. Path quá dài có structured error/skip reason, không ghép command string.
6. Resolve `rg.exe` từ trusted PATH hoặc installation paths do app biết rõ (bundled `resources`, Codex runtime install trên Windows); không ưu tiên executable trong workspace hoặc current directory. Missing/incompatible rg có hướng dẫn, không tự download/install. Dev shell và release executable phải được kiểm riêng.

`ignore::WalkBuilder` cung cấp filter-entry để bỏ cả subtree, cùng cấu hình parent/global filters; vẫn phải áp dụng metadata/path guard của app và kiểm behavior Windows bằng fixture. [WalkBuilder documentation](https://docs.rs/ignore/latest/ignore/struct.WalkBuilder.html).

### Process và parser

Backend gọi `Command` bằng argument vector, cwd canonical root, stdin null, hidden window. Ví dụ args do Rust tạo: `--no-config --json --fixed-strings --encoding none --no-follow --max-filesize 2M -e <query> -- <guarded files>`, cộng case flag có kiểm soát. Không nhận raw flags, `--pre`, PCRE2, external ignore-file hoặc shell string. `--no-config` ngăn `RIPGREP_CONFIG_PATH` đưa flags ngoài contract vào process. [ripgrep flag definitions](https://github.com/BurntSushi/ripgrep/blob/master/crates/core/flags/defs.rs).

Drain stdout/stderr đồng thời; timeout/cancel/output cap đều terminate process tree, reap child và join readers. Nếu tách Job Object primitive từ Git, chỉ tách spawn/terminate; không đổi Git-specific runner/errors/limits.

Exit `0`: có matches; `1`: no-match hợp lệ; `2`/exit khác: lỗi hoặc partial có diagnostic. Forced stop do cap khác user Cancel và timeout; không biến các trạng thái này thành no-match. Đối chiếu `rg --help` của executable đã resolve và fixture khi triển khai.

Parse JSON Lines theo bytes/chunks, không split filename bằng colon/whitespace. Xử lý `begin`, `match`, `end`, `summary`; unknown record không được tạo match. JSON `text`/`bytes` phải phân biệt; unsupported encoding/path không lossy-convert rồi mở nhầm file. Validate path nhận lại với candidate allowlist. Offsets của submatches là UTF-8 byte offsets, cần chuyển sang UTF-16 columns trước Monaco; xử lý BOM, CRLF, tiếng Việt và emoji. [grep-printer JSON format](https://docs.rs/grep-printer/latest/grep_printer/struct.JSON.html).

Search file có binary marker/invalid UTF-8 không tạo navigable text evidence. Mixed/CR newline phải báo unsupported navigation nếu chưa có mapping khớp normalization Editor; không hứa line mapping đúng khi chưa test.

### IPC và lifecycle

- `search_start(request)` đăng ký job/owner ở backend rồi trả opaque `searchId`; `search_result(searchId)` await kết quả; `search_cancel(searchId)` idempotent và chỉ trả hoàn tất sau cleanup.
- Result gồm `workspaceId`, `searchId`, `status`, `matches`, `partialReason`, `warnings`, `durationMs`. Match có exact relative path, line 1-based, original ranges/snippet offset; không trả absolute root làm quyền truy cập.
- Job table có cap; release sau result được lấy hoặc TTL 60 giây, cleanup khi owner/window/app đóng. Cancel đến khi Start chưa resolve được UI giữ intent rồi thực hiện ngay khi nhận ID.
- Query mới tăng generation ngay, cancel/reap job cũ trước Start mới. Chặn race trong cả backend lẫn frontend; query cũ dù hoàn tất muộn cũng không thay results/selection mới.
- Workspace switch thành công cancel run cũ và bỏ responses cũ; picker Cancel/error giữ query/results. Backend revalidate workspace trước publish result/dispatch tool, không chỉ dựa vào frontend cleanup.

Path checks thu hẹp race nhưng không phải OS sandbox chống process khác thay junction giữa check và open. Ghi rõ giới hạn này; fixture static links và concurrent ordinary edits phải đạt, không tuyên bố atomic repository snapshot.

## 6. Search UI và Editor navigation — Task 9.2

Search là subview `Files / Search` trong Explorer, giữ ba tool IDs và default Git hiện có. Form gồm text query, Match case, optional relative-folder scope, Search/Cancel/Retry. Submit bằng Enter hoặc Search; chưa cần search-on-every-keystroke hay shortcut global mới.

State: no-workspace, idle, starting, searching, ready, no-match, partial, cancelled, error. Browser preview hiển thị runtime requirement; không trả mock search success. Results nhóm theo path, row có dòng/snippet và highlight; dùng text rendering, không HTML từ repository.

Data flow:

```text
Submit → validate → Start → await Result → kiểm workspace/generation
  → render path/line/snippet
Click result → revalidate file/line → openFileAtLocation
  → model/tab sẵn sàng → reveal/select trong Monaco → focus Editor
```

Thêm navigation DTO `workspaceId`, `relativePath`, `line`, `column`, optional `endColumn`, `navigationId`. `openFile` cần trả trạng thái thành công/thất bại rõ để navigation không chạy sau tab-cap/load error. Áp dụng selection sau đúng model được attach/layout; không dựa vào timeout cố định hoặc DOM query.

Mở tab dirty hiện có giữ text, undo và dirty flag. Search đọc disk nên nếu dòng/snippet không còn khớp current model, báo stale/draft khác disk, cho mở file nhưng không chọn sai vị trí. External edit/delete giữa search và click có feedback và action Search lại; không tự Reload dirty buffer. UTF-8 byte offset phải được map với dòng hiện tại, không dùng trực tiếp làm Monaco column.

Results/selection giữ qua switch subview/tool, collapse và Left/Right resize; terminal không remount. Chỉ user click/keyboard-open result mới chuyển focus; search completion không cướp terminal input. IME và modal giữ context handling hiện có. Native kiểm `960 × 600`, `1440 × 900`, layouts `4 → 1 → 2 → 4`.

## 7. Read-only registry — Task 9.3

Registry là Rust domain API trước, không yêu cầu transport ngoài app. Dispatch nhận run context backend đã xác thực; model không được chọn workspace ID, root, owner hoặc tăng budget.

| Tool | Arguments nghiệp vụ | Result và policy |
| --- | --- | --- |
| `read_file` | Relative path, startLine, endLine | Disk snapshot, actual line range, revision, UTF-8 content có cap; không đọc editor draft |
| `list_directory` | Relative directory | Một cấp entry metadata; link chỉ là metadata, không follow; reuse error `DIRECTORY_TOO_LARGE` |
| `search_text` | Query, relative directory, Match case | Reuse SearchService, partial/no-match/cancel rõ ràng; tool output có cap nhỏ hơn UI |
| `git_status` | Không có command/ref/path tùy ý | Status/branch từ Git service hiện có, structured entries có truncation metadata |
| `git_diff` | Entry identity/status token, staged/unstaged mode | HEAD/index/disk theo Phase 6; text snapshots có cap, binary/large/stale trả structured state |

Schema reject unknown keys/tool names, sai kiểu, line range đảo/âm/ngoài safe integer. `read_file` giới hạn 200 lines và 64 KiB/tool response; file read tối đa 2 MiB **trong lúc đọc**, không allocate file vô hạn rồi kiểm size. Tách bounded snapshot-read helper từ `file_editor.rs` cho editor/tool dùng chung, giữ BOM/newline/revision/save behavior.

`list_directory` tối đa 200 entries trong tool envelope, nếu listing hợp lệ có nhiều hơn thì `truncated` và actual counts; backend listing >5.000 vẫn trả lỗi hiện có. Search tool tối đa 100 rows. Git diff không cắt text rồi giả thành complete diff; trả unsupported/too-large hoặc excerpt có nhãn và range rõ ràng. `git_status`/diff giữ repository boundary và token của Phase 6.

Tool result envelope: `callId`, tool name, workspace/run ID, status, data/error, source revision/status token, actual bytes, truncation và evidence references. Chỉ issue reference cho file/range thật sự được đọc; list filename đơn thuần không chứng minh nội dung file.

Rust allowlist là boundary ngay cả khi UI vẫn có write/Git buttons hợp lệ. Không đăng ký mutation tool rồi dựa vào prompt “hãy chỉ đọc”. Logs mặc định chỉ giữ metadata/duration/status, không raw repository content hoặc credentials.

## 8. Agent loop và provider dependency — Task 9.4

Task này bắt đầu sau khi quyết định phạm vi tại C0 được ghi. Nếu theo roadmap, dùng một backend provider adapter và conversation tạm trong memory; lựa chọn provider/model/config/storage phải dựa vào môi trường thực tế, không reuse GitHub account badge làm AI authentication.

```text
User question → create run với workspace snapshot + budgets
  → provider response
  → answer hoặc tool call
  → Rust schema/allowlist/budget check
  → đọc qua domain service → lưu evidence → trả tool result
  → provider tiếp tục hoặc kết thúc
```

- Tối đa 8 provider turns, 12 tool calls, 90 giây/run, 256 KiB tổng tool payload; mỗi provider request có timeout tối đa 30 giây trong remaining deadline. Limit context/input cũng kiểm trước request; byte limit không thay thế provider token limit.
- Dispatch tools tuần tự. Invalid tool/args trả structured error; repeated identical failed call tối đa hai lần rồi dừng với lý do. Unknown/write tool tuyệt đối không chạy.
- Không auto-retry vô hạn; auth/rate-limit/network/tool error có trạng thái và Retry chủ động. Retry tạo run mới, không tự chuyển workspace hoặc gửi lại conversation cũ.
- Cancel abort provider request và tool/process đang chạy; không dispatch tiếp từ response đến muộn. Workspace/window ownership kiểm lại trước mỗi step và trước final answer.
- Không giữ workspace mutex/mutation lease trong lúc chờ network; ordinary Save/Git/terminal vẫn hoạt động. Evidence có revision và stale state khi disk/index đổi giữa các reads.
- Repository text/tool output là dữ liệu không đáng tin cậy, không có quyền thay system instructions hoặc mở rộng tools. Không follow command/URL trong source như một chỉ thị tự động.
- Nếu dùng cloud provider, user khởi chạy rõ ràng; UI cho biết selected workspace snippets sẽ được gửi. Không tự upload toàn repository, dirty draft, terminal buffer hoặc secrets/config ngoài workspace.

Dùng deterministic fake provider để test loop/budget/errors trước live integration. Nếu chọn CLI thay cho provider tích hợp, thay task này bằng adapter đặc thù đã chốt; một generic registry chưa đủ để kết luận CLI integration hoàn tất.

## 9. Tool activity, bằng chứng và workflow — Task 9.5

### 9.5a — Local Activity Log (đã triển khai)

Hướng đã chốt là **AI CLI + local Activity Log**. Activity Log không thay thế agent loop: nó cung cấp session history để quay lại context làm việc mà không tự động ghi toàn bộ terminal transcript.

- Session được lưu trong app-local data theo hash workspace root (không phụ thuộc workspace ID ngắn hạn), không tạo file trong repository và không làm bẩn Git working tree; vì vậy session cũ vẫn đọc được sau restart.
- Backend chỉ nhận event kind allowlist, giới hạn session/event/dung lượng, validate workspace/session ownership và reject session đã kết thúc.
- Summary/detail bị giới hạn độ dài và redacted các mẫu secret phổ biến (`token`, `password`, `api-key`, bearer/prefix token); terminal output không tự động ghi.
- Activity UI có current session, checkpoint, terminal lifecycle, history, đọc lại session cũ, resume log sang session mới và xoá session cũ.
- Session cũ được xem là interrupted khi app đóng bất thường; shutdown cố gắng ghi trạng thái interrupted.

Vị trí agent interaction phải được chốt cùng hướng sản phẩm C0. Đề xuất nếu có agent tích hợp: subview Analyze trong Explorer, không tạo central chat workspace hoặc thêm tool ID vào rail. Hiển thị question, Run/Cancel, state, tool activity và answer; không cần token streaming/history trong V1.

Activity hiển thị tool, relative path/scope, range, loading/duration, success/error/partial. Không trình bày suy luận nội bộ của model; chỉ các calls/results/answer cần thiết cho user review.

Answer dùng evidence IDs từ run. UI resolve ID thành `path:line` đã validate; không render arbitrary file/HTTP links của model thành privileged navigation. Reference không tồn tại/range chưa đọc bị đánh dấu invalid; không giả là citation. Trả lời không có bằng chứng phải nói chưa đủ dữ liệu, không suy ra chắc chắn từ no-match hoặc partial search.

Evidence links tái sử dụng `openFileAtLocation`; nội dung đã đổi được đánh dấu stale và có Refresh/run lại. Activity/answer không tự refresh thành bằng chứng mới khi source đổi. Run/call IDs ngăn response run cũ lẫn vào run mới.

Dogfooding: hỏi “Workspace switch được guard ở đâu?” → Search → đọc `workspace.rs`/`App.tsx` → answer có path/range → click mở đúng Editor → kiểm dirty draft/PTY giữ nguyên. Thêm câu hỏi không có matches để kiểm câu trả lời không bịa vị trí.

## 10. Files dự kiến và responsibility

| Nhóm file | Responsibility |
| --- | --- |
| `src-tauri/src/search/{mod,process,parser,tests}.rs` | Search manager, guarded enumeration, rg runner, JSON parsing và fixtures; chỉ tách file khi responsibility cần |
| `src-tauri/src/tools/{mod,read_only}.rs` | Typed tool schema, allowlist, adapters và result/evidence envelope |
| `src-tauri/src/activity.rs` | Local session JSONL, workspace/app-data boundary, limits, redaction, lifecycle và delete/read APIs |
| `src/activity/{types,activityApi,useWorkspaceActivity}.ts`, `src/components/ActivityPanel.tsx` | Typed Activity IPC, session controller và history/checkpoint UI |
| `src-tauri/src/agent/` | Run lifecycle, budgets, provider/CLI adapter và loop tests; chỉ tạo khi bắt đầu 9.4 |
| `src-tauri/src/process/windows.rs` nếu cần | Primitive Job Object dùng chung cho Git/rg; giữ Git runner độc lập |
| `src-tauri/src/file_editor.rs`, `filesystem.rs`, `path_guard.rs` | Bounded read helper, reuse domain logic và scope/ignore-file guard |
| `src-tauri/src/workspace.rs`, `preferences.rs`, `lib.rs` | Search/run cleanup cho cả picker/restore/window/app lifecycle; register commands/state |
| `src/search/{types,searchApi,useWorkspaceSearch}.ts` | Typed IPC, request generation, cancel intent và Search UI state |
| `src/components/WorkspaceSearch.tsx`, `ExplorerPanel.tsx` | Explorer subview, form/results/error/partial states |
| `src/editor/types.ts`, `useWorkspaceEditor.ts`, `MonacoEditor.tsx`, `EditorPanel.tsx` | Open-at-location contract và apply selection sau model attachment |
| `src/agent/`, `src/components/WorkspaceAnalysis.tsx` | Interaction/activity/evidence UI nếu C0 chọn agent tích hợp |
| `src/App.tsx`, `RightPanel.tsx`, `styles.css` | Ghép controller/navigation, retain mounted state, focus và compact layout |
| Manifests/lockfiles | Chỉ thêm dependency thực sự cần: ignore traversal, provider client/test tooling sau checkpoint tương ứng |
| `docs/phase-9-read-only-agent-preview.md` | Tạo khi triển khai để ghi contracts đã chốt, actual results và native evidence |

Shared files tích hợp tuần tự bởi một owner tại mỗi checkpoint. Không spawn agents chỉ vì plan có nhiều modules; không tạo empty modules, global store mới hoặc sửa generated schemas để khớp bảng files.

## 11. Verification và nghiệm thu

Fixtures nằm trong thư mục tạm có owner rõ ràng; không mutate repository user để test. Hash file/index trước/sau tool runs khi cần chứng minh read-only behavior. Môi trường không tạo được junction/symlink phải ghi skipped reason; không ghi pass cho case chưa chạy.

| Nhóm case | Expected |
| --- | --- |
| Literal query bắt đầu `-`, chứa shell characters, Unicode/spaces | Query là data; đúng filename/ranges, không thực thi command hoặc inject flags |
| No matches / empty candidate list / missing rg | Empty hợp lệ hoặc error có hướng dẫn; không fallback shell/stdin search |
| Ignored/hidden/binary/invalid UTF-8/oversized file | Policy thống nhất, skipped/unsupported/partial rõ; không lossy path/text |
| Traversal/UNC/ADS/sibling-prefix, symlink/junction/reparse và linked ignore files | Reject trước đọc/descend; sentinel ngoài root không lọt vào output |
| JSON chunk split, malformed record, huge line, many submatches | Parser bounded; giữ records hoàn chỉnh; không crash hoặc giả complete result |
| stdout/stderr lớn, hung helper, cancel/timeout/cap | UI còn responsive; process tree/readers được cleanup và state đúng |
| Query A chậm rồi B; Cancel khi Start chưa resolve; switch A → B | Chỉ owner/generation mới nhận output; không job mồ côi |
| Tiếng Việt/emoji/BOM/CRLF; click trước/sau external edit | UTF-16 selection đúng hoặc stale feedback; không chọn sai dòng |
| Search result đã có dirty tab / tab cap / file bị xóa | Không mất buffer/undo; navigation chỉ áp dụng sau open success |
| Tool schema sai, unknown/write tool, caller chọn workspace/root khác | Backend reject; không filesystem/Git mutation hoặc terminal input |
| Agent no-match, repeated error, budgets, provider error/cancel | Run kết thúc hữu hạn; không dispatch tool sau Cancel hoặc late response |
| Evidence ID/range bịa, source thay đổi | Invalid/stale có nhãn; chỉ validated reference được mở trong Editor |
| Native layouts/Left–Right/collapse/resize/min window | Terminal IDs/PIDs/buffers và model/draft giữ; không giành focus khi result đến |
| Restart/offline/release với thiếu rg/provider | IDE core vẫn dùng được; lỗi dependency có lý do, không auto-install hoặc giả success |

Frontend behavior tests cần kiểm request races và navigation/dirty retention; `npm run build` không đủ. Chỉ chọn test tooling tối thiểu tại task cần test, không thêm suite mirror implementation.

Lệnh verification khi triển khai:

```powershell
rg --version
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git diff --check
npm run tauri -- dev
npm run tauri -- build --no-bundle
```

Các lệnh compile/runtime ở trên là **kế hoạch kiểm chứng**, chưa được chạy lại trong lượt viết plan. Native evidence phải ghi ngày, môi trường, case, expected, actual và ảnh/log phù hợp; startup/build không thay click-through.

- [x] C0 ghi quyết định hướng **AI CLI + local Activity Log**; baseline acceptance còn thiếu.
- [ ] 9.1 Search service đạt path/process/parser/caps/cancel fixtures.
- [ ] 9.2 Search UI/native navigation đúng và giữ PTY/dirty buffers.
- [ ] 9.3 Read-only registry đạt schema/allowlist/bounded-output tests.
- [ ] C1 nền tảng tìm/đọc được nghiệm thu độc lập với provider.
- [ ] 9.4 Agent loop hoặc CLI adapter đã thống nhất chạy end-to-end.
- [x] 9.5a Local Activity Log bounded/redacted đạt automated checks.
- [ ] 9.5b Tool activity/evidence và native dogfooding đạt.
- [ ] C2 roadmap/README/preview khớp scope và actual evidence; không đánh dấu tasks chưa triển khai.

## 12. Bước thực hiện đầu tiên và kiến thức cần đạt

Lượt implementation đầu tiên bắt đầu bằng **C0 → 9.1a**: ghi baseline/decisions; chốt typed request/result/limits; dựng fixture workspace; implement guarded candidate enumeration và một literal search round-trip trong Rust. Kiểm Unicode, no-match, traversal và junction trước khi nối UI; hoàn thiện cancellation/limits/parser ở 9.1b rồi mới sang 9.2.

Giải thích trong mỗi task: What/Why/How của ownership, boundary và data flow; đưa expected/actual/evidence trước khi tiếp tục. Không generate Search UI, registry, provider và agent loop trong một lượt.

Các concept cần nắm: machine-readable output khác terminal text; UTF-8 byte offsets khác UTF-16 editor columns; path check trước đọc khác lọc output sau đọc; cancellation phải cleanup process chứ không chỉ bỏ response; read-only registry khác prompt yêu cầu đọc; snapshot/revision cho biết evidence thuộc phiên bản nào.

Phase 10 nhận registry, SearchService, run cancellation/budgets và evidence/navigation contracts. Write proposals, approval, apply patch và run command phải có context/permission riêng; không mở rộng ngầm read-only registry.
