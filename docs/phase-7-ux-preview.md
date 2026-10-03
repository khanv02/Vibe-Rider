# Phase 7 — UX

Cập nhật: 2026-10-03. Trạng thái: **core 7.1–7.4, guard workspace/Git và Git UI review đã triển khai; native click-through và dogfooding đang chờ**.

Kế hoạch: [Phase 7 UX Plan](../agents/plans/Phase_7_UX_Plan.md). Phase 6 phối hợp: [Phase 6 Git](phase-6-git-preview.md). Roadmap: [Implementation Plan](../agents/plans/Implementation_Plan.md#phase-7--ux).

## Phạm vi đã triển khai

- Layout terminal `1 / 2 / 4`, active pane và visible pair được App sở hữu; đổi layout không remount PTY.
- Terminal có explicit focus handle. Collapse tools trả focus về pane active; shortcuts gọi đúng layout, pane hoặc tool.
- Shortcuts hiện có: `Ctrl+Alt+1/2/4` đổi layout, `Ctrl+Shift+1..4` focus pane, `Ctrl+Alt+B` ẩn/hiện tools, `Ctrl+Alt+G/E/M/A` focus Git/Explorer/Editor/AI.
- Shortcut bị chặn trong modal; text input/IME, Monaco và xterm giữ input thông thường. `Ctrl+S` vẫn do Monaco xử lý khi Editor focus.
- UI preferences version `1` gồm layout, pane, panel, width và Editor mode. Native lưu JSON trong app config directory qua Rust, giới hạn 64 KiB, validate enum/width/pair và replace có backup.
- Settings load/write có sequence debounce ở frontend; lỗi đọc/ghi chỉ tạo notice, không làm crash app. Browser preview có localStorage fallback.
- Workspace đã mở được nhớ sau khi backend commit thành công. Startup restore dùng Rust canonicalization và `WorkspaceState`, không nhận path tùy ý từ frontend; chỉ spawn một shell mới ở pane active sau restore.
- Remembered workspace lỗi, mất hoặc không đọc được chuyển về error state và cho phép Open Folder; không replay command, output, PID hoặc draft cũ.
- Git UI review đã bổ sung runtime guard cho browser preview, Normal/Expanded, push target có cấu trúc `local → remote/branch`, preview old/new, tùy chọn List/3 columns và Stage all/Unstage all. Commit/Push hiển thị lý do disabled; branch create/switch vẫn ngoài scope.

## Files chính

| File | Responsibility |
| --- | --- |
| `src/ux/useAppShortcuts.ts` | Context-aware shortcut routing |
| `src/preferences/types.ts`, `preferencesApi.ts` | UI preference DTO và typed IPC/browser fallback |
| `src-tauri/src/preferences.rs` | Validate, atomic settings write, remembered workspace và restore command |
| `src/components/TerminalWorkspace.tsx` | Controlled layout, visible pair và focus handle |
| `src/components/TerminalPane.tsx` | Stable pane identity và restore-only auto-start |
| `src/panels/useRightPanel.ts` | Hydrate/persist panel state |
| `src/App.tsx`, `AppLayout.tsx`, `StatusBar.tsx` | App ownership, bootstrap, save debounce, focus integration |
| `src/git/`, `src/components/GitPanel.tsx` | Git status/diff/mutation controller, operation lifecycle và UI review được Phase 7 ghép vào panel |

## Checkpoint và giới hạn

Core implementation đạt C0 và phần lớn C1. App đã có typed Git operation polling, wait/cancel trước workspace switch/app exit; backend giữ transition lease và từ chối switch khi operation chưa reap. Git panel, branch state, diff, mutation UI và Git review polish đã được ghép; C2 còn cần native evidence và Task 7.5 dogfooding.

Native click-through vẫn cần xác nhận trong Tauri/WebView2 ở cửa sổ `960 × 600` và `1440 × 900`:

| Case | Expected | Actual |
| --- | --- | --- |
| `Ctrl+Alt+1/2/4`, `Ctrl+Shift+1..4` trong xterm/Monaco | Không mất hoặc nhân đôi input; pane được reveal/focus đúng | Chưa chạy native |
| Collapse/show/resize và switch tools | Focus có chủ đích; PTY/model giữ nguyên | Chưa chạy native |
| Restart với settings hợp lệ/hỏng/unsupported | Layout/panel khôi phục hoặc fallback an toàn | Chưa chạy native |
| Restore workspace Unicode/path có khoảng trắng | Root canonical đúng, ID mới, tối đa một shell mới | Chưa chạy native |
| Restore chậm rồi Open Folder | Workspace mới thắng; không stale commit | Chưa chạy native |
| Dirty editor/pending save rồi switch/close | Guard Phase 5 giữ draft; settings không bypass guard | Chưa chạy native |
| Git commit/push đang chạy rồi switch/close | Chờ hoặc cancel/reap đúng | Guard đã nối; Git operation thật đã có automated fixture |
| Git panel trong browser preview | Không cho action giả chạy; nêu rõ cần Tauri runtime | Runtime warning đã có; native action vẫn pending |
| Vòng sửa → build/test → review → commit | Dogfooding hoàn tất | Chưa chạy trong native IDE |

## Verification đã chạy

```powershell
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

Kết quả hiện tại: frontend build pass; Rust check/clippy/release check pass; Rust test suite pass với 46 tests (bao gồm Git status/diff/mutation fixtures và operation ownership/transition guard); `tauri build --no-bundle` tạo được `src-tauri/target/release/vibe-rider.exe`. Native interaction và dogfooding chưa được dùng làm evidence.

## Checklist bàn giao

- [x] Layout/focus state được nâng lên App ownership.
- [x] Context-aware shortcuts và explicit terminal focus handle.
- [x] Versioned preferences, validation, bounded atomic write và hydrate race guard.
- [x] Remembered workspace restore qua Rust boundary, không arbitrary frontend path.
- [x] Restore-only shell mới, không replay process/command/output.
- [ ] Native shortcut/focus/layout/persistence/restore matrix.
- [x] Git operation wait/cancel phối hợp workspace/app exit và mutation lifecycle.
- [ ] Task 7.5 dogfooding và nghiệm thu toàn Phase 7.

Sau khi native matrix pass, cập nhật C2/C3 bằng evidence click-through và chạy vòng dogfooding trên fixture repository có local remote.
