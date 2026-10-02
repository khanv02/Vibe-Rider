use std::{env, fs, path::PathBuf};

fn main() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is set by Cargo"));
    let icon_path = out_dir.join("vibe-rider.ico");
    fs::write(&icon_path, minimal_icon()).expect("write development icon");

    let windows = tauri_build::WindowsAttributes::new().window_icon_path(&icon_path);
    let attributes = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attributes).expect("failed to run Tauri build script");
}

fn minimal_icon() -> Vec<u8> {
    // A 1x1 32-bit ICO is enough for the Phase 0 desktop resource.
    // A branded multi-size icon belongs to the productization phase.
    let mut bytes = Vec::with_capacity(70);
    bytes.extend_from_slice(&[0, 0, 1, 0, 1, 0]);
    bytes.extend_from_slice(&[1, 1, 0, 0, 1, 0, 32, 0]);
    bytes.extend_from_slice(&48u32.to_le_bytes());
    bytes.extend_from_slice(&22u32.to_le_bytes());
    bytes.extend_from_slice(&40u32.to_le_bytes());
    bytes.extend_from_slice(&1i32.to_le_bytes());
    bytes.extend_from_slice(&2i32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&32u16.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(&8u32.to_le_bytes());
    bytes.extend_from_slice(&0i32.to_le_bytes());
    bytes.extend_from_slice(&0i32.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(&[195, 225, 145, 255, 0, 0, 0, 0]);
    bytes
}
