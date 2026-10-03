#[cfg(debug_assertions)]
use std::path::PathBuf;

mod filesystem;
mod path_guard;
mod terminal;
mod workspace;

use filesystem::read_directory;
use tauri::Manager;
use terminal::{
    terminal_ack, terminal_close, terminal_resize, terminal_spawn, terminal_write, TerminalManager,
};
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

    let app = tauri::Builder::default()
        .manage(WorkspaceState::default())
        .manage(TerminalManager::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            open_workspace,
            read_directory,
            terminal_spawn,
            terminal_close,
            terminal_write,
            terminal_resize,
            terminal_ack
        ])
        .build(context)
        .expect("error while building Vibe Rider");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let manager = app_handle.state::<TerminalManager>();
            manager.close_active_for_shutdown();
        }
    });
}
