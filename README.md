# Vibe Rider

Vibe Rider là IDE desktop gọn nhẹ cho việc làm việc với các project local. Ứng dụng kết hợp terminal tích hợp, trình duyệt file, editor, tìm kiếm trong workspace, Git và nhật ký hoạt động trong một giao diện tập trung.

Vibe Rider được thiết kế cho developer muốn giữ mã nguồn và thao tác phát triển ngay trên máy của mình, với các thay đổi file và thao tác có ảnh hưởng được hiển thị rõ ràng trước khi thực hiện.

> **Trạng thái:** Vibe Rider hiện đang trong giai đoạn phát triển sớm (`0.1.0`). Một số tính năng coding-agent đang được xây dựng và chưa nên xem là dịch vụ AI hoàn chỉnh độc lập.

## Tính năng chính

- **Workspace local:** mở một thư mục project, ghi nhớ workspace gần nhất và chuyển workspace khi cần.
- **Terminal tích hợp:** tối đa bốn terminal pane, hỗ trợ thay đổi bố cục, resize và chạy shell trực tiếp trong workspace.
- **File Explorer:** duyệt thư mục, mở file, tạo file/thư mục mới, xoá entry và làm mới nội dung.
- **Code editor:** chỉnh sửa file với Monaco Editor, nhiều tab, dirty state, undo/restore và cảnh báo trước khi mất thay đổi chưa lưu.
- **Tìm kiếm workspace:** tìm nội dung trong file theo phạm vi thư mục, phân biệt hoa thường, huỷ tìm kiếm và mở kết quả trực tiếp tại dòng/cột tương ứng.
- **Git tích hợp:** xem branch và status, xem diff, stage/unstage, commit, push, tạo branch và chuyển branch.
- **Review thay đổi:** xem diff dùng chung trước khi chấp nhận hoặc từ chối một patch được đề xuất.
- **Verification có kiểm soát:** đề xuất và chạy một số lệnh kiểm tra được cho phép trong workspace, với giới hạn thời gian và output.
- **Tuỳ chỉnh giao diện:** light/dark theme, vị trí panel công cụ, kích thước panel, bố cục terminal và chế độ xác nhận khi đóng ứng dụng.

## Yêu cầu hệ thống

Để chạy bản phát triển từ source, cần cài đặt:

- Node.js 18 trở lên và npm.
- Rust toolchain stable và Cargo.
- Git nếu muốn sử dụng các tính năng Git trong ứng dụng.
- `ripgrep` (`rg`) trong `PATH` nếu muốn dùng tìm kiếm nội dung trong workspace.
- Bộ công cụ build native phù hợp với hệ điều hành và Tauri 2.

Vibe Rider được kiểm thử chính trên Windows. Tauri hỗ trợ nhiều nền tảng, nhưng khả năng tương thích và quy trình đóng gói trên macOS/Linux có thể cần cấu hình bổ sung.

## Cài đặt và chạy từ source

Clone repository rồi cài dependency frontend:

```bash
git clone <repository-url>
cd vibe-rider
npm install
```

Chạy ứng dụng ở chế độ phát triển:

```bash
npm run tauri dev
```

Ứng dụng sẽ mở dưới dạng desktop app. Chọn **Open Workspace** để mở thư mục project cần làm việc.

## Các lệnh hữu ích

```bash
# Chạy frontend Vite
npm run dev

# Kiểm tra TypeScript và tạo production frontend bundle
npm run build

# Xem thử production bundle trong trình duyệt
npm run preview

# Build ứng dụng Tauri không tạo installer
npm run tauri -- build --no-bundle

# Build binary và installer native
npm run tauri -- build

# Kiểm tra Rust
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --check --manifest-path src-tauri/Cargo.toml
```

Các artifact sau khi build nằm trong `src-tauri/target/release/bundle/` và phụ thuộc vào hệ điều hành/format được Tauri hỗ trợ.

## Cách sử dụng nhanh

1. Mở Vibe Rider và chọn **Open Workspace**.
2. Chọn một thư mục project local.
3. Dùng Explorer để duyệt file hoặc ô Search để tìm file/nội dung.
4. Mở file trong Editor, chỉnh sửa rồi lưu bằng `Ctrl+S`.
5. Dùng các terminal pane để chạy lệnh trong workspace.
6. Mở panel Git để xem thay đổi, diff và thực hiện thao tác Git.

Khi đổi workspace hoặc đóng ứng dụng, Vibe Rider sẽ kiểm tra các file chưa lưu, terminal đang chạy và thao tác Git đang hoạt động trước khi tiếp tục, tuỳ theo chế độ xác nhận trong phần cài đặt.

## Mô hình an toàn

Vibe Rider thực hiện các thao tác file và process native qua lớp Rust/Tauri. Các đường dẫn được giới hạn trong workspace hiện tại; các thao tác thay đổi quan trọng được kiểm tra lại trước khi ghi xuống disk.

Các patch đề xuất đi theo quy trình:

```text
Draft trong Editor → Review diff → Accept hoặc Reject
```

Việc Reject không ghi thay đổi xuống filesystem. Việc Accept sẽ kiểm tra lại workspace, file, revision trên disk và nội dung gốc để tránh ghi đè thay đổi bên ngoài. Nếu file đã thay đổi kể từ lúc proposal được tạo, proposal có thể bị đánh dấu conflict để người dùng review lại.

Các lệnh verification chỉ được chạy khi người dùng chủ động xác nhận và bị giới hạn bởi allowlist, working directory, timeout và kích thước output. Vibe Rider không tự tải hoặc tự cài `ripgrep`; công cụ này phải có sẵn trong PATH hoặc vị trí cài đặt đáng tin cậy.

## AI coding agent

Vibe Rider cung cấp nền tảng terminal, file tools, search và patch review để hỗ trợ workflow coding-agent. Hiện tại ứng dụng **không tự cung cấp một LLM provider hoặc agent loop độc lập**. Người dùng có thể chạy AI CLI của mình trong terminal; Vibe Rider không tự động diễn giải terminal output thành patch được phê duyệt.

Để tiếp tục phiên cũ, hãy dùng cơ chế native của CLI trong terminal đúng workspace: `codex resume`, `claude --resume` hoặc `gemini --resume`. Các lệnh này chỉ hoạt động khi CLI tương ứng còn lưu session và đang dùng đúng profile/môi trường.

## Cấu trúc project

```text
src/                 React UI, state và các API frontend
src-tauri/src/       Rust commands, filesystem, terminal, Git và safety checks
src-tauri/           Cấu hình Tauri, capability và native build
public/              Asset tĩnh và hình ảnh ứng dụng
docs/                Tài liệu thiết kế và trạng thái phát triển
agents/              Kế hoạch triển khai nội bộ
```

## Xử lý sự cố

- **Ứng dụng không khởi động khi chạy `tauri dev`:** kiểm tra Node.js, Rust và các prerequisite native của Tauri đã được cài đặt.
- **Terminal không chạy được lệnh:** kiểm tra shell và công cụ cần dùng có trong `PATH`; trên Windows, mở lại terminal sau khi thay đổi environment variables.
- **Không có kết quả tìm kiếm:** kiểm tra `rg --version`, scope tìm kiếm và quyền đọc của workspace.
- **Git panel không hiển thị repository:** mở đúng thư mục chứa repository hoặc kiểm tra `git status` trong terminal.
- **Không build được installer:** chạy `npm run build` và `cargo check --manifest-path src-tauri/Cargo.toml` để tách lỗi frontend khỏi lỗi native/toolchain.

## Đóng góp

Trước khi tạo pull request, hãy chạy các kiểm tra liên quan:

```bash
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Khi thay đổi hành vi file, terminal, Git hoặc process, cần bổ sung kiểm thử cho các trường hợp lỗi, huỷ thao tác, workspace switch và thay đổi ngoài ứng dụng.

## License

Repository hiện chưa công bố license open-source. Hãy liên hệ chủ project trước khi phân phối hoặc sử dụng lại mã nguồn ngoài phạm vi được cho phép.
