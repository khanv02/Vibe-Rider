# Preview — Phase 0: Foundation

> Đây là biên bản theo dõi Phase 0. Checkbox chỉ được đánh dấu khi có bằng chứng kiểm chứng cụ thể. Phase 0 đã hoàn tất nghiệm thu native trên Windows; các thay đổi Workspace của Phase 1 đang tiếp tục trong working tree và không được dùng làm bằng chứng cho Phase 0.

**Cập nhật:** 2026-10-03  
**Trạng thái:** Phase 0 đã nghiệm thu native; Tauri dev mode, Vite port, Rust build và cửa sổ desktop đã được kiểm tra.

## 1. Mục tiêu

Phase 0 tạo desktop shell đầu tiên cho Vibe Rider bằng Tauri 2, Rust, React, TypeScript và Vite.

Kết quả cần đạt:

- Cửa sổ desktop Tauri mở được trên Windows.
- React chạy qua Vite tại port `1420`.
- Terminal là vùng chính trong layout mock.
- Supporting tools nằm trong right-panel direction, Git là panel mặc định.
- Có một IPC command nhỏ để xác nhận boundary React ↔ Tauri ↔ Rust.
- Có lệnh chạy/build được ghi lại rõ ràng.

Phase này chưa triển khai workspace, filesystem, PTY, terminal thật, Git, Monaco Editor, ripgrep hoặc AI agent.

## 2. Kiến thức cần hiểu

### Tauri

Tauri là desktop shell: tạo native window, nạp frontend và cung cấp IPC. Tauri không tự biến placeholder thành terminal; native capabilities sẽ được triển khai ở các phase sau.

### React và Vite

React render UI. Vite cung cấp dev server, HMR và frontend build. Browser preview chỉ kiểm tra frontend, không chứng minh Tauri, Rust hoặc native API.

### Rust và IPC

Ở Phase 0, Rust mới có entry point, Tauri builder và command `ping`.

```text
User click Ping Rust
        ↓
React invoke("ping")
        ↓
Tauri IPC
        ↓
Rust ping command
        ↓
"pong from Rust"
```

Đây là proof-of-boundary, chưa phải filesystem API, process API hay terminal API.

## 3. Layout hiện tại

```text
┌─────────────────────────────────────────────┬────┬──────────┐
│ MAIN WORKSPACE: TERMINALS (2 × 2 MOCK)      │    │ GIT      │
│ ┌──────────────────┬──────────────────────┐ │ ⎇  │ default  │
│ │ Terminal 1       │ Terminal 2           │ │    │ IPC check│
│ ├──────────────────┼──────────────────────┤ │ ▱  │          │
│ │ Terminal 3       │ Terminal 4           │ │ <> │          │
│ └──────────────────┴──────────────────────┘ │    │          │
├─────────────────────────────────────────────┴────┴──────────┤
│ T1 ●   T2 ●   T3 ●   T4 ●                 Workspace: none  │
└─────────────────────────────────────────────────────────────┘
```

Terminal là vùng chính. Activity rail hiển thị Git, Explorer và Editor; trong Phase 0 chỉ Git panel là placeholder mặc định. Các command trong terminal card chỉ là ví dụ trực quan, chưa chạy process.

## 4. Trạng thái repository

### Đã có

- `src-tauri/tauri.conf.json`: Tauri window, Vite dev URL và frontend build config.
- `src-tauri/Cargo.toml`: Rust package và Tauri dependency.
- `src-tauri/src/main.rs` và `src-tauri/src/lib.rs`: Rust/Tauri entry point và command `ping`.
- `src-tauri/build.rs`: Tauri build attributes.
- `src/App.tsx`: ghép shell và gọi IPC demo.
- `src/components/AppLayout.tsx`: header, body grid và status bar host.
- `src/components/TerminalWorkspace.tsx`: mock bốn terminal theo grid 2 × 2.
- `src/components/RightPanel.tsx`: activity rail và Git placeholder.
- `src/components/StatusBar.tsx`: status bar foundation.
- `src/styles.css`: layout và visual system.
- `vite.config.ts`: Vite chạy strict port `1420`.
- `package-lock.json`: lockfile npm.

Window config đặt kích thước tối thiểu `960 × 600`. CSS giữ layout fluid trong client area của native window để không ép webview vượt quá vùng hiển thị khi Windows trừ phần viền cửa sổ.

Biên bản native baseline được ghi nhận trước khi các thay đổi Phase 1 chưa hoàn tất được đưa vào working tree. Phase 1 hiện thêm dependency `tauri-plugin-dialog`; dependency này cần được tải bổ sung khi kiểm tra lại, sau đó `cargo check` và native dev build hiện tại đã pass. Dependency mới vẫn không được dùng làm bằng chứng cho nghiệm thu Phase 0.

### Chưa có

- Open workspace, path guard và filesystem command.
- PowerShell/PTY hoặc xterm.js.
- Bốn terminal session độc lập.
- Monaco Editor.
- Git CLI, ripgrep và AI tools.

## 5. Kiểm tra môi trường

| Công cụ | Kết quả |
| --- | --- |
| Node.js | `v24.13.0` |
| npm | `11.6.2` |
| Git | `2.53.0.windows.2` |
| Tauri CLI | `2.12.1` |
| `rustc` | `1.99.0`, toolchain `stable-x86_64-pc-windows-msvc` |
| `cargo` | `1.99.0` |
| C++ Build Tools | Đã xác nhận gián tiếp: native Tauri executable build/link thành công |
| WebView2 Runtime | `154.0.4258.53`; native window mở được |

Rust/Cargo đã sẵn sàng và Tauri native baseline đã build/run thành công. Tauri CLI vẫn có thể kiểm tra độc lập bằng `npm run tauri -- --version`.

## 6. Task của Phase 0

### Task 0.1 — Kiểm tra môi trường Windows

Lệnh chuẩn:

```powershell
node --version
npm --version
rustc --version
cargo --version
git --version
```

Ngoài version command, cần xác nhận Rust toolchain `stable-msvc`, Microsoft C++ Build Tools và WebView2 Runtime.

**Trạng thái:** hoàn tất trên môi trường kiểm tra ngày 2026-10-03. Node, npm, Git, Rust/Cargo, C++ linker và WebView2 đều đã được xác nhận đủ để chạy native baseline.

### Task 0.2 — Hoàn thiện scaffold

- [x] Tauri 2, React, TypeScript và Vite có trong scaffold.
- [x] npm và `package-lock.json` đang được dùng.
- [x] Vite và Tauri cùng dùng `http://localhost:1420`.
- [x] Tauri CLI có thể gọi qua npm script.
- [x] `npm run build` pass.
- [x] Tauri native dev mode được xác nhận trên Windows.
- [x] IPC `ping` được đăng ký trong native build và đường gọi `React invoke("ping")` đã được compile/type-check.

**Trạng thái:** hoàn tất cho phạm vi Foundation. Native window mở với title `Vibe Rider`, Vite chạy đúng port `1420` và process phản hồi bình thường.

### Task 0.3 — Dựng app shell

- [x] Terminal mock là vùng trung tâm với grid 2 × 2.
- [x] Git, Explorer và Editor nằm trong activity rail/right panel bên phải.
- [x] Git là panel mặc định và có foundation IPC check.
- [x] Không còn component/badge layout cũ gây hiểu nhầm Phase 0.
- [x] Window/CSS đã cấu hình kích thước tối thiểu `960 × 600`.
- [x] Kiểm tra native window ở kích thước outer `960 × 600`; client area đo được `944 × 561` và process vẫn responsive.

**Trạng thái:** hoàn tất; CSS đã được điều chỉnh để layout không phụ thuộc vào `min-width: 960px` bên trong client area.

### Task 0.4 — Xác minh nền tảng

Các lệnh kiểm chứng:

```powershell
npm run tauri -- --version
npm run build
```

Kết quả:

- `npm ci` là lệnh cài dependency reproducible được ghi trong README; không phải native verification.
- `npm run build`: đạt; TypeScript check và Vite production build hoàn tất.
- `git diff --check`: không phát hiện whitespace error trong thay đổi.
- `cargo check --manifest-path src-tauri/Cargo.toml`: đạt với Rust toolchain MSVC trước khi Phase 1 thêm dependency mới.
- `npm run tauri -- dev`: đạt ở native baseline; log xác nhận Vite `http://localhost:1420/`, Cargo build và `target\debug\vibe-rider.exe` chạy.
- `Invoke-WebRequest http://localhost:1420/`: trả HTTP `200` trong lúc Tauri dev mode đang chạy.
- Native window: title `Vibe Rider`, outer size `960 × 600`, client size `944 × 561`, `Responding = True`.
- WebView2 Runtime: registry version `154.0.4258.53`.

## 7. Tiêu chí nghiệm thu Phase 0

- [x] Cửa sổ native mở bằng `npm run tauri -- dev`.
- [x] Frontend build thành công bằng `npm run build`.
- [x] Tauri dev URL và Vite port khớp khi chạy thực tế.
- [x] Layout foundation không bị ép rộng hơn client area ở kích thước native tối thiểu `960 × 600`.
- [x] IPC `ping` được compile/register trong native Tauri build và được gọi qua frontend `invoke` path.
- [x] README và preview dùng đúng command hiện tại.
- [x] Rust/Cargo, C++ Build Tools và WebView2 được xác nhận sẵn sàng.
- [x] Không còn badge/component layout cũ làm Phase 0 trông như đã có functionality tương lai.

Phase 0 đã đủ điều kiện chuyển sang Phase 1. Từ thời điểm này, mọi lỗi build native phát sinh từ dependency hoặc code Workspace mới phải được ghi nhận trong Phase 1, không hồi tố làm mất bằng chứng Foundation đã nghiệm thu.

## 8. Kiến trúc và data flow của Phase 0

```text
Tauri window
    ↓
React AppLayout
    ├── TerminalWorkspace: static 2 × 2 mock
    ├── RightPanel: static activity rail + Git placeholder
    └── StatusBar
```

IPC demo:

```text
Button click
    ↓
App.tsx → invoke("ping")
    ↓
src-tauri/src/lib.rs → ping()
    ↓
State message hiển thị lại trong RightPanel
```

## 9. Bước tiếp theo

1. Giữ lại bằng chứng native baseline trong tài liệu này.
2. Hoàn tất Phase 1 Workspace theo [Phase 1 Preview](./phase-1-workspace-preview.md).
3. Khi thêm dependency native mới, chạy lại `cargo check` và `npm run tauri -- dev` trong môi trường có thể truy cập registry hoặc đã có dependency trong cache.
4. Không đánh dấu tính năng Phase 1 hoàn tất chỉ dựa trên frontend browser build.

Tài liệu liên quan:

- [Project Instruction](../agents/rules/Project_Instruction.md)
- [README](../README.md)
