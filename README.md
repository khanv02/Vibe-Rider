# Vibe Rider

> Một desktop workspace **local-first, terminal-first** dành cho người làm việc với AI CLI và quy trình **CLI Vibe Coding**.

![Vibe Rider](public/assets/vibe-rider-horse-logo.png)

Vibe Rider gom terminal, workspace, file explorer, editor hỗ trợ nhanh, tìm kiếm và Git vào một cửa sổ gọn nhẹ. Mục tiêu không phải là xây thêm một IDE khổng lồ, mà là tạo ra một không gian làm việc nhanh, rõ ràng và tiện lợi để chạy Claude Code, Codex CLI, Gemini CLI hoặc bất kỳ CLI nào người dùng yêu thích.

> **Lưu ý quan trọng:** Vibe Rider **không phải IDE đầy đủ để lập trình code** và không nhằm cạnh tranh với VS Code, Cursor, Windsurf, Zed hay các IDE JetBrains. Editor trong ứng dụng chỉ để xem, chỉnh sửa nhanh và review thay đổi; terminal mới là workspace chính.

## Mục lục

- [Vấn đề](#vấn-đề)
- [Định vị sản phẩm](#định-vị-sản-phẩm)
- [Đối tượng sử dụng](#đối-tượng-sử-dụng)
- [Tính năng](#tính-năng)
- [Công nghệ](#công-nghệ)
- [Mục tiêu và nguyên tắc](#mục-tiêu-và-nguyên-tắc)
- [Trạng thái hiện tại](#trạng-thái-hiện-tại)
- [Bắt đầu sử dụng](#bắt-đầu-sử-dụng)
- [Customize](#customize)
- [Khả năng mở rộng](#khả-năng-mở-rộng)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Dành cho người muốn mở source](#dành-cho-người-muốn-mở-source)
- [Đóng góp](#đóng-góp)
- [Giấy phép](#giấy-phép)

## Vấn đề

Khi làm việc với AI CLI, người dùng thường phải chuyển qua lại giữa nhiều cửa sổ:

```text
Terminal chạy AI CLI
File Explorer
Text Editor
Search
Git client
```

Điều này làm mất ngữ cảnh, đặc biệt khi có nhiều terminal hoặc nhiều project. Vibe Rider giải quyết phần “workspace glue” này bằng một ứng dụng desktop nhỏ, chạy trực tiếp trên máy local và đặt terminal ở vị trí trung tâm.

## Định vị sản phẩm

```text
Terminal = Main Workspace

Explorer  ┐
Editor    ├─ Supporting Tools
Search    │
Git       ┘
```

Workflow điển hình:

```text
Open Folder → Mở terminal → Chạy AI CLI → Review file/diff → Search → Git commit/push
```

Vibe Rider không tự quản lý hội thoại, provider AI, session history hay agent loop. Mỗi CLI vẫn chạy theo cơ chế native của chính nó trong terminal. Người dùng có thể dùng cơ chế resume/session của CLI tương ứng mà không bị khóa vào một hệ sinh thái riêng.

## Đối tượng sử dụng

Vibe Rider hướng tới:

- **CLI Vibe Coder** muốn làm việc với AI CLI bằng terminal native.
- Developer thích workflow local, tối giản và kiểm soát trực tiếp filesystem.
- Người muốn nhiều terminal độc lập trong cùng một project.
- Người cần xem nhanh file, tìm kiếm, kiểm tra diff và thao tác Git mà không mở thêm nhiều ứng dụng.
- Người học về terminal, PTY, filesystem, process, Git, IPC và kiến trúc developer tooling.

Vibe Rider không phù hợp nếu bạn cần một IDE đầy đủ với debugger, LSP toàn diện, marketplace extension, cloud workspace, collaboration hoặc hệ sinh thái plugin có sẵn.

## Tính năng

### Terminal-first workspace

- Mở một thư mục local làm workspace.
- Tối đa **4 terminal độc lập** trong layout 1 / 2 / 4.
- Shell chạy trực tiếp trong workspace với PTY native.
- Resize, focus pane và chuyển layout bằng shortcut.
- Kéo file/folder vào terminal để chèn đường dẫn.
- Giữ session terminal khi chuyển Explorer, Editor, Search hoặc Git.

### Workspace và Explorer

- Nhớ workspace gần nhất.
- Duyệt cây thư mục trong workspace.
- Tạo, xóa và di chuyển file/folder bằng drag-and-drop.
- Kéo file vào Editor để mở nhanh.
- Path guard giới hạn thao tác trong workspace.

### Editor hỗ trợ nhanh

- Monaco Editor với tabs.
- Dirty state, save, undo và giới hạn tab.
- Review diff trước khi áp dụng thay đổi.
- Giữ draft khi chuyển panel hoặc terminal.
- Phù hợp để sửa nhanh, đọc file và kiểm tra kết quả của AI CLI; không thay thế code editor chuyên dụng.

### Search

- Literal search trong workspace thông qua ripgrep.
- Hiển thị file, dòng và cột khớp.
- Mở kết quả trực tiếp tại vị trí tương ứng trong Editor.
- Hỗ trợ cancel, no-match, partial result và giới hạn kích thước/kết quả.
- Read-only tools có allowlist và giới hạn output.

### Git workflow

- Xem branch, upstream, ahead/behind và trạng thái repository.
- Xem diff, stage/unstage, stage all và unstage all.
- Restore file theo entry.
- Commit các thay đổi đã stage.
- Push branch hiện tại lên upstream.
- Hiển thị feedback, error code và hướng xử lý khi operation thất bại.
- Git operation có lifecycle, cancel/wait và guard khi chuyển workspace.

### UX và an toàn

- Light/dark theme.
- Right panel có thể đặt bên trái hoặc bên phải, collapse và resize.
- UI preferences được lưu và khôi phục.
- Shortcut có context-aware routing, không can thiệp input của xterm hoặc Monaco.
- Filesystem, process, PTY, Git và Search đi qua Rust/Tauri boundary.
- Từ chối path traversal, absolute path ngoài workspace, symlink/junction/reparse không hợp lệ và executable nằm trong workspace.

### Ảnh, asset và dữ liệu local

- Hỗ trợ asset giao diện như logo, favicon, splash screen và mascot trong thư mục public.
- Asset tĩnh đi cùng source/build, không tự động tải lên cloud.
- Hiện chưa có tính năng chụp ảnh, upload ảnh hoặc image hosting; muốn thêm workflow này có thể tích hợp bằng panel/extension riêng trong tương lai.
- Preferences, workspace memory, WebView data và runtime data được lưu local trong thư mục .vibe-rider-data khi chạy bản portable.
- Khi di chuyển bản portable sang máy khác, cần đi cùng executable và thư mục dữ liệu này.
- File project được Editor ghi trực tiếp vào filesystem local sau khi người dùng Save; draft chưa lưu chỉ nằm trong phiên chạy hiện tại.
- File project, draft, terminal output và Git repository vẫn thuộc workspace local của người dùng; Vibe Rider không đồng bộ lên server riêng.

### Patch review và verification primitive

Vibe Rider có các primitive nhỏ cho workflow review an toàn:

- Tạo proposal từ draft và snapshot hiện tại.
- Review, Accept hoặc Reject rõ ràng.
- Rust revalidate workspace, file, revision và nội dung trước khi apply.
- Chạy một số verification command có allowlist, timeout và output cap.

Đây không phải coding-agent tích hợp sẵn. AI CLI bên ngoài vẫn chạy trực tiếp trong terminal và không bị Vibe Rider parse thành hội thoại hoặc agent loop.

## Công nghệ

| Lớp | Công nghệ | Vai trò |
| --- | --- | --- |
| Desktop shell | Tauri 2 | Cửa sổ native, IPC, permission và packaging |
| System core | Rust | Filesystem, process, PTY, Git, Search và safety boundary |
| UI | React 18 + TypeScript | Component, panel và application UI |
| Build | Vite 5 | Dev server, HMR và production bundle |
| State | Zustand | Workspace, terminal, editor và UI state |
| Terminal | xterm.js + xterm addon fit | Terminal rendering và resize |
| Editor | Monaco Editor | Text editing và diff review |
| Search | ripgrep | Tìm kiếm literal nhanh trong workspace |
| Version control | Git CLI | Status, diff, stage, commit, push và restore |

Kiến trúc tổng quát:

```text
React / TypeScript UI
          ↓
      Tauri IPC
          ↓
       Rust core
          ↓
 Operating System / Shell / Filesystem / Git
```

## Mục tiêu và nguyên tắc

### Mục tiêu

- Nhẹ, nhanh, local-first và dễ hiểu.
- Terminal là trung tâm, các panel còn lại là công cụ hỗ trợ.
- Giảm việc chuyển đổi giữa các ứng dụng khi Vibe Coding.
- Giữ boundary an toàn giữa UI và các thao tác hệ thống.
- Có thể mở source, đọc kiến trúc và tự điều chỉnh theo workflow cá nhân.

### Không phải mục tiêu

- Clone VS Code hoặc xây full-featured IDE.
- Cạnh tranh với bất kỳ IDE/editor nào.
- Cloud backend, collaboration hoặc account system riêng; Phase 8 chỉ thêm GitHub account local cho API profile.
- AI chat provider, agent loop, session manager hay database cho hội thoại.
- Full LSP, debugger, Docker orchestration hoặc plugin marketplace ngay trong V1.

## Trạng thái hiện tại

- Phiên bản package hiện tại: **0.1.0**.
- Nền tảng được kiểm tra chính: **Windows**.
- Core workspace, terminal, Explorer, Editor, Search, Git và UX đã có trong source.
- Automated verification hiện có frontend build, Rust check/test và release build.
- Native click-through, dogfooding, clean-machine và một số acceptance matrix vẫn cần được tiếp tục trước khi coi là release production hoàn chỉnh.

Roadmap/preview chi tiết nằm trong thư mục [docs](docs/), đặc biệt:

- [Phase 1 — Workspace](docs/phase-1-workspace-preview.md)
- [Phase 2 — Terminal Core](docs/phase-2-terminal-core-preview.md)
- [Phase 3 — Four Terminals](docs/phase-3-four-terminals-preview.md)
- [Phase 4 — Right Panel](docs/phase-4-right-panel-preview.md)
- [Phase 5 — Editor](docs/phase-5-editor-preview.md)
- [Phase 6 — Git](docs/phase-6-git-preview.md)
- [Phase 7 — UX](docs/phase-7-ux-preview.md)
- [Phase 8 — GitHub Account & API Authentication](docs/phase-8-github-auth-preview.md)

## Bắt đầu sử dụng

### Yêu cầu

- Windows là nền tảng được kiểm tra chính.
- Node.js 18+ và npm.
- Rust stable và Cargo.
- Git nếu muốn dùng Git integration.
- ripgrep (rg) trong PATH nếu muốn dùng Search.

### Chạy từ source

```bash
git clone <repository-url>
cd vibe-rider
npm install
npm run tauri -- dev
```

Sau khi ứng dụng mở, chọn **Open Folder** để chọn project local.

### GitHub Login (Phase 8)

Phase 8 dùng GitHub OAuth Device Flow. Tạo GitHub OAuth App và bật Device Flow, sau đó đặt public Client ID trong môi trường build/dev. Không cần và không được đặt Client Secret trong app:

```powershell
$env:GITHUB_OAUTH_CLIENT_ID = "your-github-oauth-client-id"
npm run tauri -- dev
```

Token chỉ được lưu trong Windows Credential Manager; GitHub OAuth không thay thế SSH hoặc Git Credential Manager của Git.

### Lệnh phát triển

```bash
# Type-check và tạo frontend production bundle
npm run build

# Chạy Tauri desktop ở development mode
npm run tauri -- dev

# Build native executable, không tạo installer
npm run tauri -- build --no-bundle

# Build executable portable và copy ra root project
npm run build:portable

# Rust verification
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --offline
cargo test --manifest-path src-tauri/Cargo.toml --offline
```

Executable sau khi build nằm tại:

```text
src-tauri/target/release/vibe-rider.exe
```

Lệnh npm run build:portable cũng copy bản quick-launch ra root:

```text
vibe-rider.exe
```

## Customize

Vibe Rider được thiết kế để người dùng có thể tự điều chỉnh theo workflow của mình:

- Thay đổi layout, theme, kích thước panel và shortcut trong frontend.
- Chỉnh cách startup/restore workspace trong preferences và Rust commands.
- Thêm panel mới vào right-panel architecture.
- Thêm command hoặc tool mới qua typed frontend API và Tauri command.
- Điều chỉnh shell, terminal layout, Explorer behavior hoặc Search UI.
- Thay đổi icon, splash asset và metadata trong public, src-tauri/icons và src-tauri/tauri.conf.json.
- Tạo build portable để mang theo executable cùng .vibe-rider-data.

Khi customize các thao tác filesystem/process/Git, cần giữ nguyên các nguyên tắc path guard, workspace ownership, mutation lease, timeout và output limit.

## Khả năng mở rộng

V1 hiện không có plugin marketplace hoặc extension API ổn định. Tuy nhiên kiến trúc Tauri IPC + Rust command + typed frontend API tạo nền tảng để mở rộng trong tương lai, ví dụ:

- Plugin/extension cho panel, command palette hoặc workflow riêng.
- Adapter cho các CLI tool khác nhau.
- Tool provider cho Search, Git, test runner hoặc project task.
- Theme, keymap và workspace profile.
- Integration với terminal multiplexer, container hoặc remote workspace.
- Community extension và registry nếu nhu cầu thực tế đủ lớn.

Đây là hướng mở rộng, không phải tính năng đã cam kết trong phiên bản hiện tại. Mọi extension tương lai nên chạy qua permission boundary rõ ràng và không phá vỡ tính local-first, predictable và maintainable của ứng dụng.

## Cấu trúc thư mục

```text
.
├── src/                         # React UI, state và frontend APIs
│   ├── app/                     # App bootstrap và startup flow
│   ├── components/              # UI components grouped by feature
│   │   ├── common/              # Shared dialogs, diff viewer và error boundary
│   │   ├── editor/              # Editor workspace, panes và Monaco host
│   │   ├── git/                 # Git panel và account badge
│   │   ├── layout/              # App shell, right panel và status bar
│   │   ├── terminal/            # Terminal workspace và panes
│   │   └── workspace/           # Explorer tree, search và workspace panel
│   ├── editor/                  # Editor store, model, patch và API
│   ├── git/                     # Git controller và typed API
│   ├── preferences/             # UI preferences và persistence API
│   ├── search/                  # Search state và API
│   ├── terminal/                # Terminal state và API
│   ├── workspace/               # Workspace state, explorer và path helpers
│   ├── shared/                  # Helpers dùng chung giữa nhiều feature
│   └── styles.css               # Global styling
├── src-tauri/                   # Native desktop layer
│   ├── src/                     # Rust commands và services
│   │   ├── terminal/            # PTY và shell session
│   │   ├── git/                 # Git process, repository và operations
│   │   ├── filesystem.rs        # Filesystem operations
│   │   ├── search.rs            # ripgrep search service
│   │   ├── path_guard.rs        # Workspace/path safety
│   │   └── patches.rs           # Patch proposal và approval boundary
│   ├── capabilities/            # Tauri permissions
│   ├── icons/                   # Native app icons
│   └── tauri.conf.json          # Tauri build/runtime configuration
├── public/                      # Favicon, splash và static assets
├── docs/                        # Phase preview, verification và acceptance notes
├── agents/                      # Project rules và implementation plans
├── scripts/                     # Build/release helper scripts
├── package.json                 # Frontend scripts và dependencies
└── vite.config.ts               # Vite configuration
```

## Dành cho người muốn mở source

Nếu bạn muốn một “IDE open source” để mở source, đọc kiến trúc và tự customize, Vibe Rider là một điểm bắt đầu phù hợp ở quy mô nhỏ:

1. Mở workspace bằng npm run tauri -- dev.
2. Bắt đầu từ src/app/ và src/components/layout/ để hiểu UI flow.
3. Đọc src-tauri/src/commands.rs và các module Rust để hiểu IPC/native boundary.
4. Xem agents/rules/Project_Instruction.md để hiểu product direction.
5. Chạy build/test trước khi thay đổi các phần terminal, filesystem, Git hoặc workspace.

Bạn có thể fork, thay đổi giao diện, thêm panel, thay workflow hoặc tích hợp công cụ riêng. Vibe Rider không cố áp đặt một cách làm duy nhất; nó chỉ cung cấp một nền tảng nhỏ để bạn có thể **vibe code nhẹ, nhanh và tiện lợi hơn**.

## Đóng góp

Trước khi mở pull request:

```bash
npm run build
git diff --check
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --offline
cargo test --manifest-path src-tauri/Cargo.toml --offline
```

Các thay đổi ảnh hưởng terminal, workspace, filesystem, Editor hoặc Git nên có native verification trên Windows; build pass riêng không thay thế kiểm tra ứng dụng thật.

## Giấy phép
Không có, đừng dùng cho mục đích thương mại. Vibe Rider là một dự án cá nhân, không có giấy phép open source. Bạn có thể fork và customize cho mục đích cá nhân, học tập hoặc nghiên cứu, nhưng không được dùng cho thương mại hoặc phân phối lại.

---

Made for people who want to vibe code with less friction — nhẹ, nhanh và tiện lợi. 🐎
