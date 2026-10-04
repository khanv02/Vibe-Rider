# Phase 10 — Coding Agent

Cập nhật: 2026-10-04. Trạng thái: **core 10.1–10.6 đã triển khai; còn CSP/clean-machine/native click-through acceptance**.

Kế hoạch: [Phase 10 Coding Agent Plan](../agents/plans/Phase_10_Coding_Agent_Plan.md). Roadmap: [Implementation Plan](../agents/plans/Implementation_Plan.md#phase-10--coding-agent).

## Đã triển khai

- Rust tạo và sở hữu `PatchProposal` trong memory từ baseline và draft hiện tại; proposal có owner/window, digest, TTL và state machine.
- Proposal lưu workspace ID, file ID/path, expected disk revision, model version và original/proposed content.
- Shared Diff Viewer hiển thị proposal với trạng thái `Pending proposal`.
- Người dùng có thể Review, Accept hoặc Reject.
- Reject không ghi filesystem và giữ lại draft thủ công.
- Accept chỉ gửi `proposalId`; Rust revalidate workspace, file, writable state, disk revision và original content rồi mới Apply.
- Proposal stale bị từ chối và chuyển tab sang trạng thái conflict để người dùng review lại.
- Save trực tiếp bị chặn khi file đang có proposal/apply.
- Activity có verification command proposal với allowlist `npm run test/build`, `cargo check/test`, cwd trong workspace, Run/Cancel, timeout 120–600 giây và output cap 1 MiB.

## Boundary an toàn

```text
Draft trong Monaco
      ↓ Propose patch
Proposal + snapshot/revision
      ↓ Review
Accept ──→ `patch_apply(proposalId)` ──→ Rust revalidate + mutation lease ──→ disk
Reject ──→ `patch_reject(proposalId)`, không ghi disk, giữ draft
```

Frontend quản lý draft/review display; Rust sở hữu proposal, approval boundary, canonical path, revision conflict, mutation lease và command lifecycle. Proposal không tự chạy command.

## Phần đã hoàn thiện trong core

- Command proposal typed cho executable/arguments/cwd.
- Run/Cancel, timeout, output cap, process-tree cleanup và workspace admission.
- Verification UI có approval rõ ràng và bounded result được ghi vào Activity Log.
- `cargo test` 65/65 và `cargo clippy -D warnings` pass.

## Còn ở acceptance release/native

- Live adapter của một AI CLI bên ngoài không được tự động thêm: AI CLI tiếp tục chạy trực tiếp trong terminal, không parse ANSI/Git diff thành approval.
- Bundle icon, MSI và NSIS installer đã tạo thành công; CSP review, clean-machine matrix và install/uninstall click-through chưa được đánh dấu pass.
- Native click-through cho stale patch, workspace switch, Cancel và app close cần chạy trên máy kiểm thử.

## Verification ngày 2026-10-04

| Check | Kết quả |
| --- | --- |
| `npx tsc --noEmit` | Pass |
| `npm run build` | Pass; Vite production bundle tạo thành công |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Pass |
| `cargo fmt --check --manifest-path src-tauri/Cargo.toml` | Pass |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Pass; 65/65 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` | Pass |
| `npm run tauri -- build --no-bundle` | Pass; `src-tauri/target/release/vibe-rider.exe` |
| `npm run tauri -- build` | Pass; MSI 6.64 MiB và NSIS setup 5.33 MiB |
| `git diff --check` | Pass |
| Native Patch/Review/Accept click-through | Chưa chạy trong lượt này |

## Ma trận cần chạy tiếp

- Proposal khi file dirty, read-only, không còn tồn tại hoặc đã bị external edit.
- Reject trước/sau external disk change.
- Accept sau workspace switch hoặc khi model version thay đổi.
- Hai proposal liên tiếp và proposal khác file đang chờ.
- Path Unicode, khoảng trắng, nested path và path traversal.
- Restart/app close khi proposal đang mở.
- Native: timeout, Cancel, output lớn, process con và cleanup khi đóng app.

Phase 10 chỉ hoàn tất khi approval boundary, command lifecycle và native evidence đều đạt; build pass riêng không đủ để đánh dấu hoàn tất.
