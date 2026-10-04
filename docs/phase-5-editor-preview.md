# Phase 5 — Editor

Cập nhật: 2026-10-03. Trạng thái: **core đã triển khai; native click-through đang chờ**.

Kế hoạch chi tiết: [Phase 5 Editor Plan](../agents/plans/Phase_5_Editor_Plan.md). Roadmap: [Implementation Plan](../agents/plans/Implementation_Plan.md#phase-5--editor). Nguồn yêu cầu: [Project Instruction](../agents/rules/Project_Instruction.md).

## 1. Phạm vi

Monaco nằm trong right panel, có Normal/Expanded, mở file thường từ Explorer, edit/save, nhiều tabs, dirty indicator và read-only Diff Viewer. Terminal tiếp tục là workspace chính.

Quyết định chính theo plan:

- Một edit model/tab cho mỗi file trong workspace; giữ text/undo/cursor/scroll qua tab/panel switch hoặc collapse.
- UTF-8 có/không BOM; giữ LF/CRLF và final newline. Mixed EOL/bare CR view read-only; encoding khác/binary/oversized trả lỗi.
- File tối đa 2 MiB; tối đa 20 tabs/20 MiB text đầu vào; không truncate hoặc auto-evict draft.
- Save kiểm disk revision và validated path ở Rust, ghi file tạm cùng parent rồi replace; giữ draft khi conflict/error.
- Dirty close có Save/Discard/Cancel. Workspace guard chạy trước `open_workspace`, staged Discard chỉ dispose khi picker success.
- App X/Alt+F4 có native close guard; resize/focus/worker behavior phải test trong Tauri.
- Diff nhận snapshots, cả hai sides read-only; preview không có write/apply operation.

New file/Save As, autosave, full LSP, persistence/recovery, Git operations và AI apply chưa thuộc phase này. Chi tiết DTO, ownership, commit race limits và metadata policy nằm trong plan.

## 2. Baseline và checkpoint

Phase 4 có implementation và recorded build/native startup evidence; native state-retention smoke vẫn pending. Bug layout 4/tools tự hide từng được báo; active-tool click trong code/tài liệu hiện cần reconcile trước nghiệm thu. Phase 5 core đã nối vào code; không coi việc build pass là native UI nghiệm thu.

- [ ] Xác nhận `1 → 2 → 4`, panel switch/active icon, resize/collapse, focus và session retention (native pending).
- [x] Core baseline đủ ổn định để tích hợp Task 5.2; regression native vẫn cần chạy lại.

## 3. Tiến độ task

| Task | Scope | Trạng thái |
| --- | --- | --- |
| 5.1 — File API | Regular file guard, bounded UTF-8 read/write, BOM/EOL, revision/commit | Đã triển khai; Rust 19/19 tests pass |
| 5.2 — Open file | Local Monaco workers, model registry/controller, Explorer callback | Đã triển khai; `npm run build` và packaged build pass |
| 5.3 — Edit/save | Dirty/Undo, Save/Save All, conflict và save snapshot | Đã triển khai; Rust round-trip/conflict fixture pass |
| 5.4 — Tabs/lifecycle | Tab/view state, Save/Discard/Cancel, workspace/native exit guards | Đã triển khai; native guard/click-through pending |
| 5.5 — Shared Diff Viewer | Saved/disk-vs-draft review, independent read-only models | Đã triển khai; native read-only/layout pending |

Thứ tự: baseline → 5.1 → 5.2 → 5.3 → 5.4 → 5.5 → nghiệm thu. Khi triển khai bắt đầu từ baseline + File API và kiểm chứng từng checkpoint.

## 4. Actual verification

Core Phase 5 đã có build/test evidence; native click-through chưa hoàn tất. Các kết quả Phase 3/4 trước đây không được chuyển thành kết quả Phase 5.

| Nhóm | Expected | Actual |
| --- | --- | --- |
| Rust file API | Path/encoding/size/revision/commit/failure tests pass | `cargo test` 19/19 pass |
| Frontend controller/model | Dedup/race/dirty/save/lifecycle tests pass | TypeScript/Vite build pass; integration runner chưa có |
| Browser Monaco | Real model/undo/worker/layout/focus checks pass | Worker được bundle; click-through chưa chạy |
| Native dev | File open/save/guard và terminal integration pass | Vite `1420` ready, Rust compile và cửa sổ `Vibe Rider` startup pass; click-through pending |
| Native release offline | Local workers/assets load đúng | `tauri build --no-bundle` pass; runtime offline pending |

Commands và ma trận native chi tiết nằm ở mục 12 của plan. Khi triển khai ghi ngày, môi trường, expected, actual và evidence cụ thể; startup thành công không thay thế click-through. Ưu tiên agent chạy test/automation; user chỉ xác nhận những native case công cụ chưa thực hiện được.

## 5. Tiêu chí hoàn tất

- [ ] Phase 4 regression baseline đạt.
- [x] File API scoped workspace và format/size policy được kiểm chứng bằng Rust tests.
- [ ] Monaco/workers chạy offline ở native dev/release.
- [ ] Open/dedup/tabs giữ text, undo/cursor/scroll.
- [x] Save giữ Unicode/BOM/EOL/final newline; conflict/error giữ draft theo implementation và fixture test.
- [ ] Edit trong lúc save và Save All partial failure xử lý đúng.
- [x] Tab close có Save/Discard/Cancel; workspace/native close guard đã nối, native click-through pending.
- [ ] Panel/terminal regression ở minimum window đạt.
- [x] Diff preview read-only và không tự write theo ownership implementation.
- [x] Models/listeners/temp resources có cleanup trong controller/view effects.
- [x] Actual results được ghi; README/roadmap/plan đồng bộ.

## 6. Bàn giao

Phase 6 sử dụng editor snapshot/revision và Shared Diff Viewer cho Git diff; Git refresh không reset dirty buffer. Patch review hiện có chỉ là primitive IDE, không mở rộng thành coding-agent.

Tài liệu liên quan: [Phase 4 Preview](phase-4-right-panel-preview.md), [README](../README.md).
