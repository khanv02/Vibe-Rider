# Kế hoạch Phase 1 — Workspace

Ngày lập: 2026-10-03. Trạng thái: **Task 1.1 đã triển khai code; native picker interaction đang chờ nghiệm thu.**

Nguồn yêu cầu: [Project Instruction](../rules/Project_Instruction.md), mục 11, 14, 23, 24 và 28; thứ tự task bám theo [Implementation Plan](Implementation_Plan.md#phase-1--workspace).

## 1. Mục tiêu và điều kiện bắt đầu

Sau Phase 1, người dùng chọn một thư mục local làm workspace, thấy tên workspace trong app và duyệt cây thư mục ở panel phải. Mở workspace chỉ đọc cấp đầu; mở một folder trong Explorer mới đọc children của folder đó.

Hiện trạng đã đối chiếu với code:

- React/Tauri shell, terminal mock 2 × 2 và IPC `ping` đã có.
- `RightPanel.tsx` hỗ trợ chuyển Git/Explorer; Explorer hiện mới hiển thị workspace context, chưa có tree.
- `StatusBar.tsx` và header nhận workspace name từ React state.
- `workspace.rs` đã có workspace state, native picker, canonical root và descriptor; path guard/directory API chưa có.
- Kiểm tra ngày lập plan: `rustc 1.99.0`, `cargo 1.99.0`; toolchain mặc định là `stable-x86_64-pc-windows-msvc`.

Task 0.4 đã có native startup evidence. Task 1.1 đã pass build/check; click-through picker trong native window vẫn cần kiểm tra thủ công trước khi chuyển sang task 1.2.

## 2. Phạm vi và quyết định triển khai

| Hạng mục | Quyết định Phase 1 |
| --- | --- |
| Workspace | Một workspace đang active trong mỗi lần chạy app |
| Open Folder | Nút ở header, mở native folder picker; Cancel giữ nguyên workspace/cây hiện tại |
| Filesystem | Rust dùng `std::fs`; frontend gọi custom IPC command |
| Explorer | List một cấp, expand/collapse, chọn entry, refresh và retry |
| Panel phải | Thêm chuyển tối thiểu Git ↔ Explorer; Git vẫn là mặc định khi khởi động, mở folder thành công chuyển sang Explorer |
| State | Một `workspaceStore` nhỏ bằng Zustand cho descriptor và cây; trạng thái panel dùng local state |
| File selection | Chỉ chọn file và lưu relative path để nối với Editor ở Phase 5 |
| Directory links | Hiển thị symlink/junction như entry không expand; chưa duyệt xuyên link trong Phase 1 |
| Refresh | Thực hiện thủ công; chưa có filesystem watcher |
| Khôi phục workspace | Để Phase 7; chưa lưu workspace lên đĩa |

Resize/collapse panel tổng quát thuộc Phase 4; đọc nội dung và ghi file thuộc Phase 5. Terminal thật, Git operations, search và AI giữ đúng thứ tự roadmap.

Chọn dialog chạy từ Rust để đường dẫn mở workspace xuất phát từ lựa chọn trong native picker. Frontend không được truyền một root bất kỳ vào command mở workspace. Dùng `tauri-plugin-dialog` phía Rust và `serde` để serialize contract; không cần thêm npm dialog package hoặc filesystem plugin cho flow này. Tauri hỗ trợ dialog ở cả Rust và JavaScript, với npm package cần khi gọi từ JavaScript. [Tauri Dialog](https://v2.tauri.app/plugin/dialog/).

Đối chiếu tài liệu: [Phase 1 Preview](../../docs/phase-1-workspace-preview.md) và plan này cùng dùng picker phía Rust; `open_workspace` không nhận root path từ frontend.

## 3. Kiến thức cần hiểu

| Concept | Ý nghĩa trong feature này | Cách áp dụng |
| --- | --- | --- |
| `Path` / `PathBuf` | Path có cấu trúc theo hệ điều hành, không chỉ là chuỗi | Rust thao tác bằng path components, giữ canonical root nội bộ |
| Absolute / relative path | Root là absolute; entry được định danh tương đối với root | IPC directory chỉ nhận `workspaceId` và `relativePath` |
| Directory entry | Một child trực tiếp của directory | Trả tên, relative path và loại entry; không đọc nội dung file |
| IPC request/response | React yêu cầu operation, Rust validate và trả dữ liệu/lỗi | Wrapper TypeScript cho command, DTO thống nhất giữa hai phía |
| Containment | Target thực tế phải nằm trong workspace | Validate components và canonical target trước filesystem operation |
| Lazy loading | Chỉ đọc folder mà người dùng cần | Cache children theo directory; expand lần đầu mới gọi IPC |
| Request ownership | Response có thể đến sau khi state đã đổi | Kiểm tra workspace ID và request token trước khi cập nhật cây |

## 4. Architecture và ownership

```text
React App
  ├─ Header: Open Folder
  ├─ TerminalWorkspace: vùng chính
  ├─ RightPanel: Git placeholder / Explorer
  └─ StatusBar: tên workspace hiện tại
          ↕
workspaceStore + workspaceApi
          ↕ Tauri IPC
Rust workspace commands
  ├─ Native folder picker
  ├─ WorkspaceState: ID + canonical root
  ├─ Path Guard
  └─ Directory service: children một cấp
          ↕
Local filesystem
```

Rust là nguồn sự thật về workspace được phép truy cập. React chỉ giữ descriptor và UI state. Path hiển thị trong UI không được dùng như căn cứ cấp quyền.

Workspace state Rust được đăng ký bằng Tauri managed state. Lock chỉ dùng để lấy snapshot hoặc thay descriptor; không giữ lock trong lúc dialog mở hoặc filesystem đang chạy. Đưa filesystem work sang blocking worker để UI tiếp tục phản hồi; chưa cần event bus hay background watcher.

## 5. IPC contract và path guard

Contract dự kiến, dùng camelCase ở JSON:

```ts
type WorkspaceDescriptor = {
  id: string;
  name: string;
  rootPath: string; // Chỉ phục vụ hiển thị; canonical root nằm ở Rust.
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

type WorkspaceError = {
  code: string;
  message: string;
};
```

| Command | Input | Success | Quy tắc |
| --- | --- | --- | --- |
| `open_workspace` | Không nhận root path | `WorkspaceDescriptor` hoặc `null` nếu Cancel | Chỉ commit root sau khi picker trả folder hợp lệ, canonicalize được và mở `read_dir` được |
| `read_directory` | `{ workspaceId, relativePath }` | `DirectoryListing` | Root dùng `relativePath: ""`; đọc đúng children trực tiếp |

Workspace ID là opaque string do Rust cấp, thay đổi sau mỗi lần mở thành công, kể cả mở lại cùng folder. Có thể dùng counter nội bộ và serialize thành string; không cần dependency UUID. `null` là Cancel, không phải lỗi.

Các mã lỗi cần chốt trong task 1.1: `NO_WORKSPACE`, `STALE_WORKSPACE`, `INVALID_PATH`, `INVALID_WORKSPACE`, `OUTSIDE_WORKSPACE`, `LINK_NOT_SUPPORTED`, `NOT_FOUND`, `NOT_DIRECTORY`, `PERMISSION_DENIED`, `UNSUPPORTED_PATH_ENCODING`, `DIRECTORY_TOO_LARGE`, `IO_ERROR`. UI dịch lỗi thành thông báo có thể retry; không trả lỗi giả dưới dạng directory rỗng.

Path guard của task 1.2:

1. Xác nhận `workspaceId` còn active trước khi đọc; snapshot canonical root và ID.
2. Chấp nhận chuỗi rỗng cho root; path còn lại chỉ là relative path. Từ chối `..`, root/prefix components, NUL và Windows alternate-data-stream syntax (`:` trong component).
3. Từ chối cả `C:\...`, `C:relative`, `\rooted`, UNC và device paths trong directory request. Không chỉ kiểm tra `is_absolute()`: trên Windows, `C:relative` và `\rooted` không được coi là absolute. [Rust Path](https://doc.rust-lang.org/std/path/struct.Path.html#method.is_absolute).
4. Join với canonical root bằng `PathBuf`; kiểm tra link/reparse components và từ chối đi xuyên symlink/junction trong Phase 1, kể cả link nằm trong root. Root do picker chọn được canonicalize trước và trở thành boundary thực tế.
5. Canonicalize target hiện hữu và kiểm tra containment bằng `Path::starts_with` trên path components. Không dùng string prefix: `D:\repo-other` không thuộc `D:\repo`. Canonicalization giải quyết symbolic links và trên Windows có thể tạo extended-length path; giữ dạng này trong Rust. [Rust canonicalize](https://doc.rust-lang.org/std/fs/fn.canonicalize.html), [Rust Path containment](https://doc.rust-lang.org/std/path/struct.Path.html#method.starts_with).
6. Kiểm tra target là directory, đọc một cấp; trước khi trả kết quả xác nhận ID vẫn active, nếu đã đổi trả `STALE_WORKSPACE`.

Nhận diện junction/reparse point cần kiểm tra metadata Windows, không chỉ cờ symlink; dùng metadata không follow link và `MetadataExt::file_attributes` để kiểm tra thuộc tính reparse point. [Rust Windows metadata](https://doc.rust-lang.org/std/os/windows/fs/trait.MetadataExt.html#tymethod.file_attributes), [Microsoft Reparse Points](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points). Case test phải có junction thật trên Windows. Tên/path không chuyển được sang contract Unicode phải báo lỗi có mã; không dùng chuỗi lossy làm định danh filesystem.

## 6. Data flow và hành vi UI

Open Folder:

```text
Click Open Folder → invoke open_workspace → Rust native picker
  ├─ Cancel → null → giữ descriptor, selection và cây hiện tại
  ├─ Lỗi validate → error → giữ workspace hiện tại, hiển thị lỗi
  └─ Folder hợp lệ → Rust thay root + ID
       → store thay descriptor, bỏ cache/selection/request cũ
       → chuyển Explorer → read_directory(ID mới, "")
       → hiển thị children root + cập nhật header/status bar
```

Chỉ cho một picker mở tại một thời điểm; nút Open Folder disabled trong lúc chọn. Implementation hiện dùng `blocking_pick_folder` bên trong async Tauri command để giữ picker ở Rust boundary; nếu sau này command chuyển sang main-thread callback, phải giữ nguyên contract Cancel/success/error. [Tauri FileDialogBuilder](https://docs.rs/tauri-plugin-dialog/latest/tauri_plugin_dialog/struct.FileDialogBuilder.html#method.blocking_pick_folder).

Expand/collapse:

- Directory chưa load: đặt loading tại node, gọi `read_directory`; chỉ áp dụng response đúng workspace ID và token của node.
- Directory đã load: dùng cache, không gọi lại khi collapse rồi expand.
- Collapse chỉ đổi trạng thái hiển thị; response đang chạy không được tự expand lại node.
- File chỉ thay selection; link/other là leaf không expand.
- Node lỗi có Retry; directory rỗng có empty state, khác với error state.

Refresh:

- Refresh root hoặc một directory sẽ invalidate cache và token của node/subtree đó rồi đọc lại node, không scan đệ quy.
- Giữ node đang refresh mở; collapse các descendants để chúng load lại khi được expand. Bỏ selection nếu nằm trong subtree bị invalidate.
- Response từ lần đọc cũ không được ghi đè kết quả mới; dùng request token tăng theo node, ngoài workspace ID.
- Folder bị xóa hoặc mất quyền sau khi mở phải hiện lỗi tại node, không làm crash app.

Directory listing xếp directory trước, sau đó file/link/other; sort tên có tie-break ổn định. Hiển thị cả dotfiles và folder lớn như `.git`, `node_modules`, nhưng không đọc children cho đến khi expand. Giới hạn ban đầu 5.000 children mỗi directory: nếu vượt, trả `DIRECTORY_TOO_LARGE` và thông báo rõ thay vì âm thầm cắt danh sách; chưa thêm pagination trong Phase 1.

## 7. Files cần tạo/sửa

Chỉ tạo từng file khi task tương ứng bắt đầu.

| File | Responsibility |
| --- | --- |
| `src-tauri/src/workspace.rs` | Descriptor, managed state, commands và native open-folder flow |
| `src-tauri/src/path_guard.rs` | Validate relative path, link/reparse và containment; unit tests cùng module |
| `src-tauri/src/filesystem.rs` | List children một cấp, sort, limit, phân loại entry và map IO error |
| `src-tauri/src/lib.rs` | Đăng ký modules, managed state, dialog plugin và IPC commands; giữ `ping` |
| `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` | Thêm dialog plugin và serde trực tiếp; khóa dependency đã resolve |
| `src/workspace/types.ts` | TypeScript DTO tương ứng Rust contract |
| `src/workspace/workspaceApi.ts` | Wrapper typed cho invoke và normalize IPC error |
| `src/stores/workspaceStore.ts` | Descriptor, cache theo relative path, loading/error, selection, expansion và request token |
| `src/components/ExplorerPanel.tsx` | Empty state, tree, refresh, retry và selected entry |
| `src/components/ExplorerTreeNode.tsx` | Render entry và children đã load; không tự recursive fetch |
| `src/App.tsx`, `src/components/AppLayout.tsx` | Nối Open Folder, open state và tên workspace vào shell |
| `src/components/RightPanel.tsx` | Chuyển Git/Explorer tối thiểu; giữ Git mặc định lúc startup |
| `src/components/StatusBar.tsx`, `src/styles.css` | Workspace thực tế, tree styles, overflow và focus indicator |
| `package.json`, `package-lock.json` | Thêm Zustand khi cần shared workspace state |
| `docs/phase-1-workspace-preview.md`, `README.md` | Cập nhật khi triển khai, đồng bộ contract và ghi actual result/giới hạn đã kiểm chứng |

Không sửa trực tiếp các file sinh tự động trong `src-tauri/gen/schemas`. Rà soát Tauri capability/config theo cách gọi thực tế; không cấp quyền filesystem rộng cho frontend. Capability điều khiển việc frontend truy cập IPC/plugin, không thay kiểm tra path trong Rust service. [Tauri Capabilities](https://v2.tauri.app/security/capabilities/).

## 8. Task theo thứ tự và điểm dừng kiểm chứng

| Task | Công việc | Kết quả và tiêu chí qua task |
| --- | --- | --- |
| **1.1 — Workspace contract / Open Folder** | Chốt DTO/error; thêm dialog, managed state, open command, API wrapper; nối nút header và descriptor vào status bar | Chọn folder có dấu/khoảng trắng thấy tên/path; Cancel hoặc lỗi không thay workspace; không nhận root từ frontend |
| **1.2 — Path guard** | Tách guard và test Windows path forms, containment, symlink/junction; chốt policy không traverse link | Chấp nhận root/path con hợp lệ; từ chối traversal, prefix/root path, sibling-prefix và link trong mọi vị trí của request |
| **1.3 — Directory API** | List một cấp, classify entry, sort/limit, map IO error, blocking worker và kiểm tra stale ID | Root trả children trực tiếp; không đọc nội dung file/children sâu; link là leaf; errors/limit có mã rõ ràng |
| **1.4 — Explorer UI** | Store/cache, tree node, Git/Explorer switch tối thiểu, expand/collapse, selection, refresh/retry và states | Expand mới fetch; collapse/re-expand dùng cache; node loading/error độc lập; dùng được ở `960 × 600` |
| **1.5 — Workspace switch** | Hoàn thiện reset tree/selection, token invalidation, Rust/React stale checks; kiểm tra switch/refresh khi request chậm | Kết quả của A không xuất hiện ở B; response trước refresh không ghi đè response mới; Cancel giữ state |

Dependency: `0.4 → 1.1 → 1.2 → 1.3 → 1.4 → 1.5`. Thiết kế ID/token từ 1.1, kiểm tra race đầy đủ tại 1.5; không đợi tới cuối phase mới nghĩ về ownership.

Task 1.1 đã được implement theo flow picker → Rust state → IPC descriptor → UI. Bước còn lại của task là click-through picker trong native window; sau đó mới thực hiện **task 1.2**. Chưa nối directory API ra UI trước khi path guard của 1.2 đạt. Sau mỗi task, ghi expected/actual result và kiến thức vừa học theo working style của project.

## 9. Kế hoạch test và nghiệm thu

Rust unit tests tập trung vào boundary có rủi ro: path guard, one-level listing, mã lỗi và stale workspace. Dùng temporary fixtures riêng; không mutate repository thật. Junction test trên Windows phải ghi rõ pass hoặc chưa chạy vì điều kiện môi trường, không coi skip là pass.

| Case | Expected result |
| --- | --- |
| Mở `D:\...\Dự án thử nghiệm` | Đúng tên/path, children root hiển thị, header/status đồng nhất |
| Cancel picker khi đã có workspace | ID, tree, expansion và selection giữ nguyên |
| Folder không tồn tại/mất quyền trước khi commit | Báo lỗi; workspace cũ vẫn active |
| Directory rỗng / folder bị xóa sau khi load | Empty state / `NOT_FOUND` phân biệt rõ, Retry không crash |
| `../`, `..\`, absolute, drive-relative, rooted, UNC/device, ADS | IPC từ chối, không trả children ngoài workspace |
| Target `repo-other` cạnh `repo` | Không vượt qua guard bằng string prefix |
| Symlink/junction tới ngoài root hoặc trỏ vòng trong root | Entry không expand; direct IPC xuyên link bị từ chối |
| Repository nhiều tầng | Mở root chỉ list một cấp; mỗi expand chỉ list một directory |
| Directory trên 5.000 children | Lỗi limit rõ ràng, không hiển thị danh sách thiếu như đầy đủ |
| Collapse → expand / refresh | Dùng cache / fetch lại đúng node, không scan subtree |
| Đọc A chậm rồi mở B; mở lại A với ID mới | Response cũ bị bỏ cả khi root path trùng nhau |
| Hai refresh liên tiếp trả response ngược thứ tự | Chỉ response token mới nhất được áp dụng |
| Cửa sổ `960 × 600`, tên dài và cây sâu | Terminal vẫn là vùng chính; panel scroll, focus/controls dùng được |
| Chạy browser preview | Có thông báo native API chưa khả dụng; không giả thành workspace native đã mở |

Các lệnh kiểm tra sau implementation:

```powershell
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- dev
git diff --check
```

Race ở frontend kiểm tra bằng API stub có điều khiển thời điểm resolve trong quá trình phát triển, cộng với smoke test native. Không dùng browser mock thay bằng chứng native picker/filesystem trên Windows.

Checklist hoàn tất Phase 1:

- [ ] Phase 0 native verification có bằng chứng.
- [ ] Open Folder, Cancel và error giữ đúng workspace state.
- [ ] Header/status và Explorer phản ánh cùng workspace.
- [ ] Directory API luôn qua Rust guard, đọc một cấp và có limit/error contract.
- [ ] Traversal, Windows path forms và junction thực tế được kiểm chứng.
- [ ] Expand/collapse, selection, refresh/retry và loading/empty/error dùng được.
- [ ] Switch/refresh không nhận response lỗi thời.
- [ ] Frontend build, Rust format/check/test và native smoke test đạt.
- [ ] README/preview ghi đúng actual results; mọi mục chưa chạy vẫn để chưa hoàn tất.

## 10. Kiến thức đạt được và bàn giao cho Phase 2

Sau phase này cần giải thích được vì sao Rust giữ canonical root, vì sao relative path/ID không thay thế path guard, cách IPC truyền dữ liệu/lỗi và cách lazy loading/request token giữ cây chính xác. Các concept này cũng dùng được trong file manager, local tools và những API có request chạy đồng thời.

Đầu vào Phase 2 là workspace descriptor còn active và canonical root do Rust quản lý để đặt working directory cho PowerShell PTY. Chỉ chuyển sang Terminal Core sau khi checklist native của Phase 1 đạt.
