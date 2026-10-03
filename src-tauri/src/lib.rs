#[cfg(debug_assertions)]
use std::path::PathBuf;

mod workspace;

use workspace::{open_workspace, WorkspaceState};

#[tauri::command]
fn ping() -> String {
    "pong from Rust".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();

    #[cfg(debug_assertions)]
    {
        let dev_data_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".runtime-data");
        context.config_mut().app.app_directories_override = Some(
            tauri::utils::config::AppDirectoriesOverride::Root(dev_data_dir),
        );
    }

    tauri::Builder::default()
        .manage(WorkspaceState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![ping, open_workspace])
        .run(context)
        .expect("error while running Vibe Rider");
}
