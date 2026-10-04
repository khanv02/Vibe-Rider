use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::git::GitService;
use crate::workspace::{activate_workspace, WorkspaceDescriptor, WorkspaceError, WorkspaceState};

const SETTINGS_VERSION: u8 = 1;
const MAX_SETTINGS_BYTES: u64 = 64 * 1024;

#[derive(Default)]
pub struct PreferencesState {
    write_lock: Mutex<()>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiPreferences {
    pub version: u8,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_close_mode")]
    pub close_mode: String,
    pub terminal: TerminalPreferences,
    pub panel: PanelPreferences,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalPreferences {
    pub layout_mode: u8,
    pub active_pane_id: String,
    pub visible_pair: [String; 2],
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelPreferences {
    pub open: bool,
    pub active_tool: String,
    pub normal_width: f64,
    pub editor_size: String,
    pub expanded_width: Option<f64>,
    #[serde(default = "default_keep_expanded_on_switch")]
    pub keep_expanded_on_switch: bool,
    #[serde(default = "default_panel_side")]
    pub side: String,
}

fn default_keep_expanded_on_switch() -> bool {
    true
}

fn default_panel_side() -> String {
    "right".to_string()
}

fn default_close_mode() -> String {
    "always".to_string()
}

fn default_theme() -> String {
    "dark".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RememberedWorkspace {
    pub root_path: String,
    pub identity: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesSnapshot {
    pub preferences: UiPreferences,
    pub remembered_workspace: Option<RememberedWorkspace>,
    pub warning: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PreferencesFile {
    ui: Option<UiPreferences>,
    remembered_workspace: Option<RememberedWorkspace>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RememberedWorkspaceInput {
    workspace_id: String,
}

fn defaults() -> UiPreferences {
    UiPreferences {
        version: SETTINGS_VERSION,
        theme: default_theme(),
        close_mode: default_close_mode(),
        terminal: TerminalPreferences {
            layout_mode: 4,
            active_pane_id: "T1".to_string(),
            visible_pair: ["T1".to_string(), "T2".to_string()],
        },
        panel: PanelPreferences {
            open: true,
            active_tool: "git".to_string(),
            normal_width: 304.0,
            editor_size: "normal".to_string(),
            expanded_width: None,
            keep_expanded_on_switch: default_keep_expanded_on_switch(),
            side: default_panel_side(),
        },
    }
}

fn preferences_path(app: &AppHandle) -> Result<PathBuf, WorkspaceError> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("preferences.json"))
        .map_err(|error| WorkspaceError::new("PREFERENCES_PATH", error.to_string()))
}

fn validate_pane(value: &str) -> bool {
    matches!(value, "T1" | "T2" | "T3" | "T4")
}

fn validate_ui(mut value: UiPreferences) -> Result<UiPreferences, WorkspaceError> {
    if value.version != SETTINGS_VERSION {
        return Err(WorkspaceError::new(
            "PREFERENCES_VERSION",
            "Phiên bản thiết lập chưa được hỗ trợ.",
        ));
    }
    if !matches!(value.terminal.layout_mode, 1 | 2 | 4)
        || !matches!(value.theme.as_str(), "dark" | "light")
        || !matches!(
            value.close_mode.as_str(),
            "always" | "when-needed" | "never"
        )
        || !validate_pane(&value.terminal.active_pane_id)
        || !validate_pane(&value.terminal.visible_pair[0])
        || !validate_pane(&value.terminal.visible_pair[1])
        || value.terminal.visible_pair[0] == value.terminal.visible_pair[1]
        || !matches!(
            value.panel.active_tool.as_str(),
            "git" | "explorer" | "editor"
        )
        || !matches!(value.panel.editor_size.as_str(), "normal" | "expanded")
        || !matches!(value.panel.side.as_str(), "left" | "right")
        || !value.panel.normal_width.is_finite()
        || value.panel.normal_width < 272.0
        || value.panel.normal_width > 480.0
        || value
            .panel
            .expanded_width
            .is_some_and(|width| !width.is_finite() || !(272.0..=1440.0).contains(&width))
    {
        return Err(WorkspaceError::new(
            "PREFERENCES_INVALID",
            "Thiết lập có giá trị không hợp lệ.",
        ));
    }
    value.panel.normal_width = value.panel.normal_width.clamp(272.0, 480.0);
    Ok(value)
}

fn read_file(app: &AppHandle) -> Result<(PreferencesFile, Option<String>), WorkspaceError> {
    let path = preferences_path(app)?;
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((PreferencesFile::default(), None));
        }
        Err(error) => return Err(WorkspaceError::new("PREFERENCES_READ", error.to_string())),
    };
    if metadata.len() > MAX_SETTINGS_BYTES {
        return Ok((
            PreferencesFile::default(),
            Some("Thiết lập vượt quá giới hạn; dùng giá trị mặc định.".to_string()),
        ));
    }
    let text = fs::read_to_string(&path)
        .map_err(|error| WorkspaceError::new("PREFERENCES_READ", error.to_string()))?;
    match serde_json::from_str::<PreferencesFile>(&text) {
        Ok(file) => Ok((file, None)),
        Err(error) => Ok((
            PreferencesFile::default(),
            Some(format!(
                "Thiết lập không hợp lệ; dùng giá trị mặc định: {error}"
            )),
        )),
    }
}

fn write_file_locked(app: &AppHandle, file: &PreferencesFile) -> Result<(), WorkspaceError> {
    let path = preferences_path(app)?;
    let directory = path.parent().ok_or_else(|| {
        WorkspaceError::new("PREFERENCES_PATH", "Không thể xác định thư mục thiết lập.")
    })?;
    fs::create_dir_all(directory)
        .map_err(|error| WorkspaceError::new("PREFERENCES_WRITE", error.to_string()))?;
    let bytes = serde_json::to_vec_pretty(file)
        .map_err(|error| WorkspaceError::new("PREFERENCES_SERIALIZE", error.to_string()))?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, bytes)
        .map_err(|error| WorkspaceError::new("PREFERENCES_WRITE", error.to_string()))?;
    let backup = path.with_extension("json.bak");
    if path.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(&path, &backup)
            .map_err(|error| WorkspaceError::new("PREFERENCES_REPLACE", error.to_string()))?;
    }
    if let Err(error) = fs::rename(&temp, &path) {
        if backup.exists() {
            let _ = fs::rename(&backup, &path);
        }
        let _ = fs::remove_file(&temp);
        return Err(WorkspaceError::new(
            "PREFERENCES_REPLACE",
            error.to_string(),
        ));
    }
    let _ = fs::remove_file(&backup);
    Ok(())
}

#[tauri::command]
pub fn load_ui_preferences(app: AppHandle) -> Result<PreferencesSnapshot, WorkspaceError> {
    let (file, warning) = read_file(&app)?;
    let preferences = match file.ui {
        Some(value) => match validate_ui(value) {
            Ok(value) => value,
            Err(error) => {
                return Ok(PreferencesSnapshot {
                    preferences: defaults(),
                    remembered_workspace: file.remembered_workspace,
                    warning: Some(error.message),
                });
            }
        },
        None => defaults(),
    };
    Ok(PreferencesSnapshot {
        preferences,
        remembered_workspace: file.remembered_workspace,
        warning,
    })
}

#[tauri::command]
pub fn save_ui_preferences(
    app: AppHandle,
    state: State<'_, PreferencesState>,
    preferences: UiPreferences,
) -> Result<(), WorkspaceError> {
    let preferences = validate_ui(preferences)?;
    let _guard = state
        .write_lock
        .lock()
        .map_err(|_| WorkspaceError::new("PREFERENCES_LOCK", "Không thể khóa thiết lập."))?;
    let (mut file, _) = read_file(&app)?;
    file.ui = Some(preferences);
    write_file_locked(&app, &file)
}

#[tauri::command]
pub fn remember_active_workspace(
    app: AppHandle,
    state: State<'_, PreferencesState>,
    workspace_state: State<'_, WorkspaceState>,
    request: RememberedWorkspaceInput,
) -> Result<(), WorkspaceError> {
    let snapshot = workspace_state
        .active_snapshot()?
        .filter(|workspace| workspace.id == request.workspace_id)
        .ok_or_else(|| WorkspaceError::new("STALE_WORKSPACE", "Workspace đã thay đổi."))?;
    let root = fs::canonicalize(&snapshot.root)
        .map_err(|error| WorkspaceError::new("WORKSPACE_UNAVAILABLE", error.to_string()))?;
    let identity = root.to_string_lossy().to_string();
    let _guard = state
        .write_lock
        .lock()
        .map_err(|_| WorkspaceError::new("PREFERENCES_LOCK", "Không thể khóa thiết lập."))?;
    let mut file = read_file(&app)?.0;
    file.remembered_workspace = Some(RememberedWorkspace {
        root_path: identity.clone(),
        identity,
    });
    write_file_locked(&app, &file)
}

#[tauri::command]
pub fn restore_last_workspace(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, WorkspaceState>,
) -> Result<Option<WorkspaceDescriptor>, WorkspaceError> {
    let (file, _) = read_file(&app)?;
    let Some(remembered) = file.remembered_workspace else {
        return Ok(None);
    };
    let root = Path::new(&remembered.root_path);
    let canonical = fs::canonicalize(root).map_err(|error| {
        WorkspaceError::new(
            "WORKSPACE_UNAVAILABLE",
            format!("Không thể khôi phục workspace: {error}"),
        )
    })?;
    if canonical.to_string_lossy() != remembered.identity
        || !fs::metadata(&canonical)
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false)
    {
        return Err(WorkspaceError::new(
            "WORKSPACE_UNAVAILABLE",
            "Workspace đã nhớ không còn hợp lệ.",
        ));
    }
    fs::read_dir(&canonical).map_err(|error| {
        WorkspaceError::new(
            "PERMISSION_DENIED",
            format!("Không thể đọc workspace: {error}"),
        )
    })?;
    let git = app.state::<GitService>();
    activate_workspace(&app, window.label(), &state, &git, canonical).map(Some)
}

#[tauri::command]
pub fn forget_last_workspace(
    app: AppHandle,
    state: State<'_, PreferencesState>,
) -> Result<(), WorkspaceError> {
    let _guard = state
        .write_lock
        .lock()
        .map_err(|_| WorkspaceError::new("PREFERENCES_LOCK", "Không thể khóa thiết lập."))?;
    let (mut file, _) = read_file(&app)?;
    file.remembered_workspace = None;
    write_file_locked(&app, &file)
}

#[cfg(test)]
mod tests {
    use super::{defaults, validate_ui};

    #[test]
    fn defaults_are_valid_and_versioned() {
        let preferences = defaults();
        assert_eq!(preferences.version, 1);
        assert!(validate_ui(preferences).is_ok());
    }

    #[test]
    fn invalid_layout_or_duplicate_pair_is_rejected() {
        let mut preferences = defaults();
        preferences.terminal.layout_mode = 3;
        assert!(validate_ui(preferences).is_err());

        let mut preferences = defaults();
        preferences.terminal.visible_pair = ["T1".into(), "T1".into()];
        assert!(validate_ui(preferences).is_err());
    }

    #[test]
    fn invalid_panel_width_and_tool_are_rejected() {
        let mut preferences = defaults();
        preferences.panel.normal_width = f64::NAN;
        assert!(validate_ui(preferences).is_err());

        let mut preferences = defaults();
        preferences.panel.active_tool = "shell".into();
        assert!(validate_ui(preferences).is_err());

        let mut preferences = defaults();
        preferences.panel.active_tool = "ai".into();
        assert!(validate_ui(preferences).is_err());
    }
}
