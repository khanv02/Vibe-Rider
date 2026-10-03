import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../tauri/runtime";
import { DEFAULT_UI_PREFERENCES, type PreferencesSnapshot, type UiPreferences } from "./types";

const STORAGE_KEY = "vibe-rider.ui-preferences.v1";

function browserSnapshot(): PreferencesSnapshot {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { preferences: DEFAULT_UI_PREFERENCES, rememberedWorkspace: null, warning: null };
    const parsed = JSON.parse(raw) as Partial<PreferencesSnapshot>;
    const panel = parsed.preferences?.panel;
    const activeTool = panel?.activeTool === "git" || panel?.activeTool === "explorer" || panel?.activeTool === "editor"
      ? panel.activeTool
      : DEFAULT_UI_PREFERENCES.panel.activeTool;
    return {
      preferences: parsed.preferences?.version === 1 ? {
        ...DEFAULT_UI_PREFERENCES,
        ...parsed.preferences,
        panel: { ...DEFAULT_UI_PREFERENCES.panel, ...panel, activeTool },
      } as UiPreferences : DEFAULT_UI_PREFERENCES,
      rememberedWorkspace: null,
      warning: null,
    };
  } catch {
    return { preferences: DEFAULT_UI_PREFERENCES, rememberedWorkspace: null, warning: "Không thể đọc thiết lập cục bộ; dùng giá trị mặc định." };
  }
}

export function loadUiPreferences(): Promise<PreferencesSnapshot> {
  if (!isTauriRuntime()) return Promise.resolve(browserSnapshot());
  return invoke<PreferencesSnapshot>("load_ui_preferences");
}

export async function saveUiPreferences(preferences: UiPreferences): Promise<void> {
  if (!isTauriRuntime()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ preferences }));
    return;
  }
  await invoke("save_ui_preferences", { preferences });
}

export function rememberActiveWorkspace(workspaceId: string): Promise<void> {
  if (!isTauriRuntime()) return Promise.resolve();
  return invoke("remember_active_workspace", { request: { workspaceId } });
}

export function restoreLastWorkspace(): Promise<import("../workspace/types").WorkspaceDescriptor | null> {
  if (!isTauriRuntime()) return Promise.resolve(null);
  return invoke("restore_last_workspace");
}

export function forgetLastWorkspace(): Promise<void> {
  if (!isTauriRuntime()) return Promise.resolve();
  return invoke("forget_last_workspace");
}
