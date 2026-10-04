use std::{env, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by Cargo"));
    let icon_path = manifest_dir.join("icons").join("icon.ico");
    assert!(icon_path.is_file(), "app icon not found: {}", icon_path.display());

    let windows = tauri_build::WindowsAttributes::new().window_icon_path(&icon_path);
    let attributes = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attributes).expect("failed to run Tauri build script");
}
