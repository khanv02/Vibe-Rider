# Phase 1 — Workspace

> Tài liệu này mô tả phạm vi, kiến trúc, contract, tiến độ và tiêu chí nghiệm thu của Workspace. Checkbox chỉ được đánh dấu khi có bằng chứng tương ứng.

**Cập nhật:** 2026-10-03  
**Trạng thái:** đã hoàn tất nghiệm thu Phase 1. Automated Rust/frontend verification, native startup và manual picker click-through đều pass.

## 1. Mục tiêu

Phase 1 biến desktop shell của Phase 0 thành ứng dụng có workspace local thật. Người dùng chọn một thư mục, thấy workspace hiện tại trong UI và chuẩn bị duyệt cây thư mục theo từng cấp.

Kết quả cuối phase:

- Chọn folder bằng native folder picker.
- Rust giữ workspace root đã canonicalize và cấp `workspaceId` mới cho mỗi lần mở thành công.
- Explorer ở right panel hiển thị children trực tiếp của root hoặc directory được expand.
- Filesystem request đi qua Tauri IPC và được Rust kiểm tra containment.
- Có loading, empty, error, retry, refresh, expand và collapse state.
- Đổi workspace hoặc refresh không để response cũ ghi đè state mới.

Phase này chưa bao gồm PTY, terminal thật, đọc nội dung file, Monaco Editor, Git operation, ripgrep, AI chat hoặc persistence sau khi restart.

## 2. Phạm vi và nguyên tắc

| Hạng mục | Quyết định |
| --- | --- |
| Workspace | Một workspace active trong mỗi lần chạy app |
| Open Folder | Picker chạy ở Rust qua `tauri-plugin-dialog`; frontend không gửi root path tùy ý |
| Root | Canonical absolute path, chỉ Rust dùng làm boundary; frontend nhận metadata để hiển thị |
| Explorer | Lazy loading, mỗi request chỉ đọc một cấp |
| Path | IPC dùng `workspaceId` và `relativePath`, không dùng absolute path do UI cung cấp |
| Links | Symlink, junction và reparse point được hiển thị như leaf và không được phép traverse |
| Refresh | Thủ công ở root hoặc từng node; chưa có filesystem watcher |
| Persistence | Để Phase 7 |
| Panel | Git vẫn là placeholder; Explorer có workspace context và lazy-loaded tree |

Rust sở hữu native operation, workspace registry, path resolution, containment và filesystem errors. React sở hữu hiển thị, expanded state, loading state, selection và cách cho người dùng retry.

## 3. Trạng thái hiện tại

### Đã triển khai — Workspace contract / UI

- `tauri-plugin-dialog` và `serde` đã được thêm vào Rust dependencies.
- `WorkspaceState` managed state trong Tauri.
- Command `open_workspace` tự mở native folder picker, canonicalize folder và trả descriptor.
- Cancel trả `null` và không thay workspace hiện tại.
- Lỗi được trả theo `{ code, message }`.
- Header có nút `Open Folder` và trạng thái đang mở folder.
- Explorer context hiển thị workspace name/path sau khi mở thành công.
- Status bar hiển thị workspace name và `Phase 1 / Workspace`.
- Tauri generated schemas và `Cargo.lock` đã được cập nhật sau khi thêm plugin.

### Đã triển khai — Path guard / Directory API / Explorer

- Path guard cho `read_directory`: relative path, NUL, traversal, absolute/drive-relative/UNC/device path, ADS và containment theo component.
- Command `read_directory`: one-level listing, classification, sort ổn định, giới hạn 5.000 entry, stale-workspace và error mapping.
- Explorer tree: cache children, expand/collapse, selection, loading/empty/error, retry và refresh.
- Request generation/token để loại bỏ response cũ khi switch workspace hoặc refresh liên tiếp.
- Unit tests cho traversal, containment, one-level listing, empty directory và file-as-directory boundary.

## 4. Hành vi người dùng

### Khi chưa có workspace

App vẫn mở với terminal mock là vùng chính. Explorer hiển thị empty state và action `Open Folder`. Status bar hiển thị `Workspace: none`.

### Khi chọn Open Folder

1. Người dùng bấm `Open Folder`.
2. Rust mở native folder picker.
3. Trong lúc picker đang mở, nút được disable.
4. Nếu Cancel, state hiện tại giữ nguyên.
5. Nếu chọn folder hợp lệ, Rust canonicalize và tạo workspace ID mới.
6. React nhận descriptor, cập nhật header/status bar và chuyển sang Explorer context.
7. Explorer gọi `read_directory` để tải root; expand folder mới tải children tương ứng.

### Khi chọn folder mới

Workspace mới chỉ commit sau khi folder hợp lệ. Cache, selection và request thuộc workspace cũ phải bị loại bỏ khi Explorer state được triển khai. ID mới vẫn được cấp kể cả khi người dùng mở lại cùng một path.

## 5. Kiến trúc

```text
React shell
  ├─ Header: Open Folder
  ├─ TerminalWorkspace: vùng chính
  ├─ RightPanel: Git / Explorer
  └─ StatusBar: workspace name
          ↕ invoke()
Tauri IPC
          ↕
Rust workspace service
  ├─ Native folder picker
  ├─ WorkspaceState
  ├─ Path guard
  └─ Directory service
          ↕
Local filesystem
```

### Ownership

| Layer | Sở hữu |
| --- | --- |
| React | UI, active panel, workspace descriptor hiển thị, loading/error presentation |
| IPC wrapper | Tên command, kiểu request/response và chuyển lỗi về UI |
| Rust `WorkspaceState` | Canonical root, active workspace và ID |
| Rust path guard | Relative path validation, containment, link/reparse policy |
| Rust filesystem service | `read_dir`, entry classification, sorting, error mapping |

Frontend không truy cập filesystem trực tiếp và không được quyết định quyền truy cập bằng `rootPath` hiển thị.

## 6. Contract IPC

### Workspace descriptor

```ts
type WorkspaceDescriptor = {
  id: string;
  name: string;
  rootPath: string;
};
```

`rootPath` hiện được trả để hiển thị và debug. Rust vẫn giữ `PathBuf` riêng trong managed state; các command filesystem sau này phải lookup bằng `id`.

### Error contract

```ts
type WorkspaceError = {
  code: string;
  message: string;
};
```

Các mã dự kiến:

`INVALID_PATH`, `INVALID_WORKSPACE`, `NO_WORKSPACE`, `STALE_WORKSPACE`, `OUTSIDE_WORKSPACE`, `LINK_NOT_SUPPORTED`, `NOT_FOUND`, `NOT_DIRECTORY`, `PERMISSION_DENIED`, `UNSUPPORTED_PATH_ENCODING`, `DIRECTORY_TOO_LARGE`, `IO_ERROR`.

UI không biến lỗi đọc directory thành danh sách rỗng. Empty directory và error phải là hai state khác nhau.

### `open_workspace`

```text
open_workspace()
  → WorkspaceDescriptor
  → null                 // user Cancel
  → WorkspaceError
```

Command hiện tại không nhận path từ frontend. Rust nhận kết quả picker, kiểm tra folder, canonicalize, tạo ID và commit state sau khi mọi bước thành công.

### `read_directory` — contract đã triển khai

```ts
type ReadDirectoryRequest = {
  workspaceId: string;
  relativePath: string;
};

type DirectoryEntry = {
  name: string;
  relativePath: string;
  kind: "directory" | "file" | "link" | "other";
};

type DirectoryListing = {
  workspaceId: string;
  relativePath: string;
  entries: DirectoryEntry[];
};
```

`relativePath: ""` đại diện cho root. Response chỉ chứa children trực tiếp, không recursive scan và không đọc nội dung file.

## 7. Path security design

Các kiểm tra bảo mật đã được triển khai trước khi `read_directory` trả kết quả:

1. Kiểm tra `workspaceId` còn active và lấy canonical root từ Rust state.
2. Chỉ nhận path tương đối; chuỗi rỗng là root.
3. Từ chối `..`, NUL, root/prefix component, UNC, device path, drive-relative path và absolute path.
4. Join path bằng `PathBuf`, không nối chuỗi.
5. Canonicalize target hiện hữu và kiểm tra containment theo path components, không dùng string prefix.
6. Kiểm tra target là directory.
7. Nhận diện symlink/junction/reparse point và từ chối traverse theo policy của phase.
8. Kiểm tra lại workspace generation trước khi trả kết quả nếu operation chạy bất đồng bộ.

Các case bắt buộc gồm `../`, `..\`, `C:\...`, `C:relative`, `\rooted`, UNC, sibling path như `repo-other`, symlink/junction ra ngoài root và link vòng.

## 8. Data flow

### Open workspace

```text
User click Open Folder
        ↓
React invoke("open_workspace")
        ↓
Rust native folder picker
        ├─ Cancel → null → giữ state hiện tại
        └─ Folder → canonicalize + validate + cấp ID
                     ↓
              WorkspaceDescriptor
                     ↓
              React cập nhật shell
```

### Expand directory

```text
User expand node "src"
        ↓
workspaceApi.readDirectory({ workspaceId, relativePath: "src" })
        ↓
Rust lookup workspaceId
        ↓
Path guard resolve root/src
        ↓
read_dir một cấp
        ↓
DirectoryListing
        ↓
Explorer state kiểm tra workspaceId + request token
        ↓
Explorer render children
```

### Response cũ

```text
Request A: workspace A / src
        ↓
User mở workspace B
        ↓
Store tăng generation, reset cache A
        ↓
Response A về trễ
        ↓
Bị bỏ qua vì workspaceId/generation không còn khớp
```

## 9. Task breakdown

### Task 1.1 — Workspace contract / Open Folder

**Mục tiêu:** tạo workspace descriptor thật qua native picker.

**Đã làm:** Rust state, dialog plugin, canonical root, ID, error shape, frontend button và workspace context.

**Đã kiểm tra qua code/build:** picker success/cancel contract, canonical root, descriptor và giữ state khi Cancel. Click-through từng nhánh native vẫn cần manual verification.

### Task 1.2 — Path guard

**Mục tiêu:** mọi directory request chỉ được truy cập bên trong active workspace.

**Đã hoàn tất:** module guard độc lập, test path Windows, containment theo component và link/reparse policy.

### Task 1.3 — Directory API

**Mục tiêu:** trả metadata một cấp từ Rust.

**Đã hoàn tất:** `read_directory`, classification, sort ổn định, giới hạn entry, stale check và mã lỗi cho missing/permission/empty/too large.

### Task 1.4 — Explorer UI

**Mục tiêu:** biến Explorer context thành tree lazy-loaded.

**Đã hoàn tất:** root node, expand/collapse, cache children, loading/error/empty, retry, refresh và selected entry.

### Task 1.5 — Workspace switch và lifecycle

**Mục tiêu:** workspace mới cô lập hoàn toàn với request và cache cũ.

**Đã hoàn tất:** generation/token, reset subtree, stale response checks và cleanup khi workspace đổi.

### Task 1.6 — Native verification

**Mục tiêu:** xác nhận hành vi trong Tauri thật trên Windows.

**Đã chạy:** native startup/build smoke test, Rust test suite, cleanup process và manual picker click-through cho success/cancel/error.

## 10. Files và trách nhiệm

### Đã triển khai

| File | Trách nhiệm |
| --- | --- |
| `src-tauri/src/workspace.rs` | Workspace state, descriptor, error và `open_workspace` |
| `src-tauri/src/lib.rs` | Register managed state, dialog plugin và commands |
| `src-tauri/Cargo.toml` | `serde` và `tauri-plugin-dialog` |
| `src/workspace/types.ts` | DTO phía frontend |
| `src/workspace/workspaceApi.ts` | Typed invoke và error formatting |
| `src/App.tsx` | Workspace UI state và open flow |
| `src/components/AppLayout.tsx` | Header button và workspace status |
| `src/components/RightPanel.tsx` | Git/Explorer switch và context |
| `src/components/StatusBar.tsx` | Workspace name |

### Files liên quan sau khi hoàn tất Phase 1

| File | Trách nhiệm |
| --- | --- |
| `src-tauri/src/path_guard.rs` | Relative path, containment và link/reparse validation |
| `src-tauri/src/filesystem.rs` | One-level listing, classification, sorting và error mapping |
| `src/workspace/useWorkspaceExplorer.ts` | Cache, expanded/loading/error/selection và request token |
| `src/components/ExplorerPanel.tsx` | Tree container và panel states |
| `src/components/ExplorerTreeNode.tsx` | Một node và children lazy-loaded |

## 11. Kiểm thử và bằng chứng

### Đã chạy

| Lệnh | Kết quả |
| --- | --- |
| `npm run build` | Pass |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | Pass |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Pass |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Pass; 13 tests pass |
| `npm run tauri -- dev` | Native startup pass; Vite dùng port `1420`, binary Rust build/run được |
| `git diff --check` | Pass; chỉ có cảnh báo line ending từ Git |

### Bằng chứng nghiệm thu native

- Click `Open Folder` và xác nhận từng nhánh success/cancel/error bằng thao tác tay trong native window: đã pass.

Các boundary còn lại đã có automated evidence qua unit tests, build/check, native startup và manual UI click-through.

### Ma trận nghiệm thu cuối phase

| Case | Kết quả mong đợi |
| --- | --- |
| Chọn folder bình thường | Workspace mở, name/path đồng nhất ở header/status/Explorer |
| Cancel khi đã có workspace | Workspace, cache, selection và tree giữ nguyên |
| Folder có dấu, khoảng trắng, Unicode | Mở được và hiển thị đúng tên/path |
| Folder rỗng | Empty state, không phải error |
| Folder mất quyền hoặc bị xóa | Error state và Retry, không crash |
| Repository nhiều tầng | Chỉ đọc root; expand mới đọc directory tương ứng |
| `..`, absolute, drive-relative, UNC/device | Rust từ chối |
| Sibling prefix `repo-other` | Không vượt guard bằng string prefix |
| Symlink/junction ra ngoài root | Không expand hoặc đọc xuyên link |
| Workspace A → B khi request A đang chạy | Response A bị bỏ qua |
| Hai refresh trả ngược thứ tự | Chỉ token mới nhất được áp dụng |
| Cửa sổ tối thiểu `960 × 600` | Terminal vẫn là vùng chính, Explorer scroll được |

## 12. Tiêu chí hoàn tất Phase 1

- [x] Native picker contract mở folder, Cancel và error được Rust xử lý đúng; manual click-through đã pass.
- [x] Workspace descriptor và status bar/header/Explorer đồng nhất.
- [x] Root được canonicalize trong Rust; frontend không cấp root tùy ý.
- [x] `read_directory` chỉ đọc một cấp và có error contract ổn định.
- [x] Path traversal, absolute path, drive-relative, UNC/device và sibling prefix bị chặn.
- [x] Symlink/junction/reparse policy được xử lý trên Windows.
- [x] Explorer có lazy loading, expand/collapse, refresh, retry, loading/empty/error.
- [x] Workspace switch và request token loại bỏ stale response.
- [x] `npm run build`, `cargo fmt --check`, `cargo check`, `cargo test` pass.
- [x] Native startup smoke test và picker click-through hoàn tất.

Phase 1 đã hoàn tất implementation, automated verification và nghiệm thu giao diện native.

## 13. Bước tiếp theo

1. Duy trì workspace descriptor/canonical root làm đầu vào ổn định cho terminal.
2. Chuyển sang Phase 2 theo kế hoạch Terminal Core.

Tài liệu liên quan:

- [Project Instruction](../agents/rules/Project_Instruction.md)
- [Implementation Plan](../agents/plans/Implementation_Plan.md)
- [Phase 1 Workspace Plan](../agents/plans/Phase_1_Workspace_Plan.md)
- [Phase 0 Preview](./phase-0-foundation-preview.md)
- [README](../README.md)
