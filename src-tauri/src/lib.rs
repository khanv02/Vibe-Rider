#[cfg(debug_assertions)]
use std::path::PathBuf;

mod commands;
mod external;
mod file_editor;
mod filesystem;
mod git;
mod patches;
mod path_guard;
mod preferences;
mod search;
mod terminal;
mod tools;
mod workspace;

use commands::{command_cancel, command_propose, command_run, CommandService};
use external::open_external_url;
use file_editor::{read_file, restore_file, write_file};
use filesystem::{create_entry, delete_entry, move_entry, read_directory, save_clipboard_image};
use git::{
    git_add, git_cancel, git_commit, git_create_branch, git_diff, git_operations, git_push,
    git_repository, git_restore, git_status, git_switch_branch, GitService,
};
use patches::{patch_apply, patch_propose, patch_reject, PatchService};
use preferences::{
    forget_last_workspace, load_ui_preferences, remember_active_workspace, restore_last_workspace,
    save_ui_preferences, PreferencesState,
};
use search::{search_cancel, search_result, search_start, SearchService};
use tauri::Manager;
use terminal::{
    terminal_ack, terminal_close, terminal_close_workspace, terminal_list, terminal_resize,
    terminal_spawn, terminal_write, TerminalManager,
};
use tools::read_only_tool;
use workspace::{open_workspace, WorkspaceState};

#[tauri::command]
fn ping() -> String {
    "pong from Rust".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();

    #[cfg(not(debug_assertions))]
    {
        if let Ok(executable) = std::env::current_exe() {
            if let Some(directory) = executable.parent() {
                let portable_data_dir = directory.join(".vibe-rider-data");
                context.config_mut().app.app_directories_override = Some(
                    tauri::utils::config::AppDirectoriesOverride::Root(portable_data_dir),
                );
            }
        }
    }

    #[cfg(debug_assertions)]
    {
        let dev_data_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".runtime-data");
        context.config_mut().app.app_directories_override = Some(
            tauri::utils::config::AppDirectoriesOverride::Root(dev_data_dir),
        );
    }

    let app = tauri::Builder::default()
        .manage(WorkspaceState::default())
        .manage(CommandService::default())
        .manage(PatchService::default())
        .manage(PreferencesState::default())
        .manage(SearchService::default())
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
            search_start,
            search_result,
            search_cancel,
            patch_propose,
            patch_apply,
            patch_reject,
            command_propose,
            command_run,
            command_cancel,
            read_only_tool,
            read_directory,
            create_entry,
            delete_entry,
            move_entry,
            save_clipboard_image,
            read_file,
            write_file,
            restore_file,
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
            app_handle.state::<SearchService>().close_all_for_shutdown();
            app_handle.state::<PatchService>().close_all_for_shutdown();
            app_handle
                .state::<CommandService>()
                .close_all_for_shutdown();
            let manager = app_handle.state::<TerminalManager>();
            manager.close_all_for_shutdown();
        }
    });
}
