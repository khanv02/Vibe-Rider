#[cfg(debug_assertions)]
use std::path::PathBuf;

mod external;
mod file_editor;
mod filesystem;
mod git;
mod path_guard;
mod preferences;
mod terminal;
mod workspace;

use external::open_external_url;
use file_editor::{read_file, write_file};
use filesystem::read_directory;
use git::{
    git_add, git_cancel, git_commit, git_create_branch, git_diff, git_operations, git_push,
    git_repository, git_restore, git_status, git_switch_branch, GitService,
};
use preferences::{
    forget_last_workspace, load_ui_preferences, remember_active_workspace, restore_last_workspace,
    save_ui_preferences, PreferencesState,
};
use tauri::Manager;
use terminal::{
    terminal_ack, terminal_close, terminal_close_workspace, terminal_list, terminal_resize,
    terminal_spawn, terminal_write, TerminalManager,
};
use workspace::{open_workspace, WorkspaceState};

#[tauri::command]
fn ping() -> String {
    "pong from Rust".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    let mut context = tauri::generate_context!();

    #[cfg(not(debug_assertions))]
    let context = tauri::generate_context!();

    #[cfg(debug_assertions)]
    {
        let dev_data_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".runtime-data");
        context.config_mut().app.app_directories_override = Some(
            tauri::utils::config::AppDirectoriesOverride::Root(dev_data_dir),
        );
    }

    let app = tauri::Builder::default()
        .manage(WorkspaceState::default())
        .manage(PreferencesState::default())
        .manage(TerminalManager::default())
        .manage(GitService::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            open_external_url,
            open_workspace,
            load_ui_preferences,
            save_ui_preferences,
            remember_active_workspace,
            restore_last_workspace,
            forget_last_workspace,
            read_directory,
            read_file,
            write_file,
            git_repository,
            git_status,
            git_diff,
            git_add,
            git_restore,
            git_commit,
            git_push,
            git_create_branch,
            git_switch_branch,
            git_operations,
            git_cancel,
            terminal_spawn,
            terminal_close,
            terminal_list,
            terminal_close_workspace,
            terminal_write,
            terminal_resize,
            terminal_ack
        ])
        .build(context)
        .expect("error while building Vibe Rider");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app_handle.state::<GitService>().close_all_for_shutdown();
            let manager = app_handle.state::<TerminalManager>();
            manager.close_all_for_shutdown();
        }
    });
}
