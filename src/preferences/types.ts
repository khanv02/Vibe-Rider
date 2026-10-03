import type { RightPanelId, RightPanelState } from "../panels/types";
import type { TerminalLayoutMode, TerminalPaneId } from "../terminal/types";

export interface UiPreferences {
  version: 1;
  terminal: {
    layoutMode: TerminalLayoutMode;
    activePaneId: TerminalPaneId;
    visiblePair: [TerminalPaneId, TerminalPaneId];
  };
  panel: {
    open: boolean;
    activeTool: RightPanelId;
    normalWidth: number;
    editorSize: "normal" | "expanded";
    expandedWidth: number | null;
    side: "left" | "right";
  };
}

export interface RememberedWorkspace {
  rootPath: string;
  identity: string;
}

export interface PreferencesSnapshot {
  preferences: UiPreferences;
  rememberedWorkspace: RememberedWorkspace | null;
  warning: string | null;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  version: 1,
  terminal: {
    layoutMode: 4,
    activePaneId: "T1",
    visiblePair: ["T1", "T2"],
  },
  panel: {
    open: true,
    activeTool: "git",
    normalWidth: 304,
    editorSize: "normal",
    expandedWidth: null,
    side: "right",
  },
};

export function preferencesFromPanel(state: RightPanelState): UiPreferences["panel"] {
  return {
    open: state.rightPanelOpen,
    activeTool: state.activeRightPanel,
    normalWidth: state.rightPanelWidth,
    editorSize: state.editorSize,
    expandedWidth: state.editorExpandedWidth,
    side: state.side,
  };
}
