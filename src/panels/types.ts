export type RightPanelId = "git" | "explorer" | "editor" | "activity";

export type EditorPanelSize = "normal" | "expanded";
export type RightPanelSide = "left" | "right";

export interface RightPanelState {
  activeRightPanel: RightPanelId;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  editorSize: EditorPanelSize;
  editorExpandedWidth: number | null;
  keepExpandedOnSwitch: boolean;
  side: RightPanelSide;
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
