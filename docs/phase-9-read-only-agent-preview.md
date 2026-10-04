# Phase 9 — Read-only Agent

Cập nhật: 2026-10-04. Trạng thái: **nền tảng 9.1–9.3 và local Activity Log đã triển khai; agent loop/CLI adapter và native acceptance còn pending**.

Kế hoạch: [Phase 9 Plan](../agents/plans/Phase_9_Read_Only_Agent_Plan.md). Roadmap: [Implementation Plan](../agents/plans/Implementation_Plan.md#phase-9--read-only-agent).

## Đã triển khai

- Rust `SearchService` chạy literal search qua ripgrep với argument vector, workspace/path guard, không follow link/reparse, giới hạn candidates/depth/file size/query/result/output/deadline và cancel theo job owner.
- Ripgrep resolver tìm trong PATH và trusted app-install locations (`resources` cạnh executable, Codex runtime path trên Windows), không tự download/install và không chấp nhận executable trong workspace/current directory.
- Parser đọc JSONL machine output của ripgrep, giữ path tương đối, dòng 1-based, snippet và đổi UTF-8 byte offsets sang UTF-16 columns cho Monaco.
- Tauri IPC: `search_start`, `search_result`, `search_cancel`.
- Explorer có Files/Search subview. Search có scope tương đối, Match case, Cancel/Clear, no-match/error/partial state và render kết quả dưới dạng text.
- Click search result mở file trong Editor, reveal/select dòng/cột sau khi model attach; dirty buffer, undo state, PTY và tab lifecycle vẫn do owner hiện có giữ.
- Read-only registry Rust và typed frontend API: `read_file`, `list_directory`, `search_text`, `git_status`, `git_diff`. Registry reject unknown tools/args qua allowlist; output file/directory/search bị giới hạn.
- `read_file` kiểm metadata size trước `fs::read`, tái sử dụng path guard và revision/encoding contract hiện có.

## Còn pending

- Chưa chọn LLM provider hoặc CLI protocol vì README hiện định hướng AI chạy qua terminal; không tự tạo provider giả.
- Chưa có agent loop/CLI adapter end-to-end, conversation state và tool activity/evidence answer UI; Activity Log hiện ghi session metadata, checkpoint và terminal lifecycle một cách có giới hạn.
- Native click-through Search/Activity và dogfooding vẫn chưa chạy.
- Native click-through Phase 3–7 và dogfooding vẫn là gate độc lập theo các preview trước; build/test không thay thế evidence native.

## Verification ngày 2026-10-04

| Check | Kết quả |
| --- | --- |
| `npx tsc --noEmit` | Pass |
| `cargo check --manifest-path src-tauri/Cargo.toml --offline` | Pass |
| `cargo test --manifest-path src-tauri/Cargo.toml --offline` | Pass, 61 tests |
| Activity Log redaction/path-limit tests | Pass, 3 tests (included in 61) |
| `npm run build` | Pass; Vite production bundle tạo thành công |
| `npm run tauri -- build --no-bundle` | Pass; release executable tạo tại `src-tauri/target/release/vibe-rider.exe` |
| Native Search/Activity click-through | Chưa chạy |

## Ma trận cần chạy tiếp

- Query Unicode/emoji, filename có dấu/khoảng trắng, query bắt đầu bằng `-`, no-match và scope thư mục.
- Traversal/UNC/ADS/sibling prefix, symlink/junction/reparse, ignored/hidden/binary/oversized file.
- JSON chunk/record lỗi, stdout/stderr lớn, timeout/cancel và Query A → Query B.
- Click result trước/sau external edit, dirty tab, tab cap, file bị xóa; xác nhận không mất draft/PTY.
- `read_only_tool` với schema sai/unknown/write tool, status token Git cũ và repository không hợp lệ.
- Activity Log với secret-like text, session/path id giả, event/dung lượng vượt cap, session cũ sau restart, resume và xoá active session.
- Native Tauri ở `960 × 600` và `1440 × 900`, layout `4 → 1 → 2 → 4`, Left/Right tools, collapse/resize và restart.

Đã chốt hướng **AI CLI + local Activity Log**: log nằm trong app-local data, không nằm trong workspace và không tự động ghi terminal output. Bước tiếp theo là CLI adapter/agent loop và native acceptance.
