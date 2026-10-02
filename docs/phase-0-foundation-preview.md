# Preview — Phase 0: Foundation

> Đây là tài liệu theo dõi Phase 0. Checkbox chỉ được đánh dấu khi có bằng chứng kiểm chứng cụ thể. Phase 0 chưa hoàn tất nghiệm thu native.

**Cập nhật:** 2026-10-03  
**Trạng thái:** scaffold và frontend đã xác minh; native verification đang chờ Rust toolchain.

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
│ └──────────────────┴──────────────────────┘ │ ✦  │          │
├─────────────────────────────────────────────┴────┴──────────┤
│ T1 ●   T2 ●   T3 ●   T4 ●                 Workspace: none  │
└─────────────────────────────────────────────────────────────┘
```

Terminal là vùng chính. Activity rail hiển thị Git, Explorer, Editor và AI; trong Phase 0 chỉ Git panel là placeholder mặc định. Các command trong terminal card chỉ là ví dụ trực quan, chưa chạy process.

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

Window config và CSS đều đặt kích thước tối thiểu `960 × 600`; việc hiển thị ổn định ở kích thước này trong native window vẫn chưa được kiểm tra.

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
| `rustc` | Chưa có trong `PATH` |
| `cargo` | Chưa có trong `PATH` |
| C++ Build Tools | Chưa xác nhận |
| WebView2 Runtime | Chưa xác nhận |

Rust/Cargo chưa sẵn sàng nên chưa thể xác nhận Tauri native build. Đây là blocker môi trường, không phải tính năng được đánh dấu hoàn tất. Tauri CLI vẫn có thể kiểm tra độc lập bằng `npm run tauri -- --version`.

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

**Trạng thái:** một phần. Node, npm và Git đã có; Rust/Cargo chưa có trong `PATH`; C++ Build Tools và WebView2 chưa xác nhận.

### Task 0.2 — Hoàn thiện scaffold

- [x] Tauri 2, React, TypeScript và Vite có trong scaffold.
- [x] npm và `package-lock.json` đang được dùng.
- [x] Vite và Tauri cùng dùng `http://localhost:1420`.
- [x] Tauri CLI có thể gọi qua npm script.
- [x] `npm run build` pass.
- [ ] Tauri native dev mode được xác nhận trên Windows.
- [ ] IPC `ping` được kiểm tra trong cửa sổ Tauri native.

**Trạng thái:** frontend scaffold có; native verification chờ Rust toolchain.

### Task 0.3 — Dựng app shell

- [x] Terminal mock là vùng trung tâm với grid 2 × 2.
- [x] Supporting tools nằm trong activity rail/right panel bên phải.
- [x] Git là panel mặc định và có foundation IPC check.
- [x] Không còn component/badge layout cũ gây hiểu nhầm Phase 0.
- [x] Window/CSS đã cấu hình kích thước tối thiểu `960 × 600`.
- [ ] Kiểm tra trực quan ở kích thước cửa sổ tối thiểu `960 × 600` trong Tauri native window.

**Trạng thái:** code shell đã triển khai; native visual verification còn chờ toolchain.

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
- `cargo check --manifest-path src-tauri/Cargo.toml`: chưa chạy được vì `cargo` chưa có trong `PATH`.
- `npm run tauri -- dev`: chưa xác nhận vì Rust toolchain chưa sẵn sàng.

## 7. Tiêu chí nghiệm thu Phase 0

- [ ] Cửa sổ native mở bằng `npm run tauri -- dev`.
- [x] Frontend build thành công bằng `npm run build`.
- [ ] Tauri dev URL và Vite port khớp khi chạy thực tế.
- [ ] Layout foundation không overflow ở tối thiểu `960 × 600`.
- [ ] IPC `ping` hoạt động trong Tauri native window.
- [x] README và preview dùng đúng command hiện tại.
- [ ] Rust/Cargo, C++ Build Tools và WebView2 được xác nhận sẵn sàng.
- [x] Không còn badge/component layout cũ làm Phase 0 trông như đã có functionality tương lai.

Chỉ chuyển sang Phase 1 sau khi các mục native cần thiết được kiểm tra; frontend build một mình không đủ nghiệm thu.

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

1. Cài Rust toolchain `stable-msvc` và đưa Cargo vào `PATH`.
2. Xác nhận Microsoft C++ Build Tools và WebView2.
3. Chạy `cargo check --manifest-path src-tauri/Cargo.toml`.
4. Chạy `npm run tauri -- dev`.
5. Kiểm tra IPC `ping`, layout `960 × 600` và cleanup process khi đóng app.

Tài liệu liên quan:

- [Project Instruction](../agents/rules/Project_Instruction.md)
- [README](../README.md)
