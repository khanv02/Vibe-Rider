export type RightPanelId = "git" | "explorer" | "editor" | "ai";

export type EditorPanelSize = "normal" | "expanded";

export interface RightPanelState {
  activeRightPanel: RightPanelId;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  editorSize: EditorPanelSize;
  editorExpandedWidth: number | null;
}

export interface RightPanelBounds {
  minWidth: number;
  maxWidth: number;
}

export interface RightPanelGeometry extends RightPanelBounds {
  bodyWidth: number;
  effectiveWidth: number;
  splitterWidth: number;
  terminalWidth: number;
}
