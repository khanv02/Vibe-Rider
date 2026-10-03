import type {
  EditorPanelSize,
  RightPanelBounds,
  RightPanelGeometry,
  RightPanelState,
} from "./types";

export const RIGHT_PANEL_DEFAULT_WIDTH = 304;
export const RIGHT_PANEL_MIN_WIDTH = 272;
export const RIGHT_PANEL_MAX_WIDTH = 480;
export const RIGHT_PANEL_RAIL_WIDTH = 48;
export const RIGHT_PANEL_SPLITTER_WIDTH = 6;
export const NORMAL_TERMINAL_MIN_WIDTH = 600;
export const EXPANDED_TERMINAL_MIN_WIDTH = 420;

export const RIGHT_PANEL_DEFAULT_STATE: RightPanelState = {
  activeRightPanel: "git",
  rightPanelOpen: true,
  rightPanelWidth: RIGHT_PANEL_DEFAULT_WIDTH,
  editorSize: "normal",
  editorExpandedWidth: null,
  side: "right",
};

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function normalBounds(bodyWidth: number): RightPanelBounds {
  const safeBodyWidth = Math.max(0, bodyWidth);
  if (safeBodyWidth === 0) {
    return { minWidth: RIGHT_PANEL_MIN_WIDTH, maxWidth: RIGHT_PANEL_MAX_WIDTH };
  }
  const maxWidth = Math.min(
    RIGHT_PANEL_MAX_WIDTH,
    Math.floor(safeBodyWidth * 0.4),
    safeBodyWidth - NORMAL_TERMINAL_MIN_WIDTH - RIGHT_PANEL_SPLITTER_WIDTH,
  );
  return {
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    maxWidth,
  };
}

export function expandedBounds(bodyWidth: number): RightPanelBounds {
  const safeBodyWidth = Math.max(0, bodyWidth);
  if (safeBodyWidth === 0) {
    return { minWidth: RIGHT_PANEL_MIN_WIDTH, maxWidth: RIGHT_PANEL_MAX_WIDTH };
  }
  const minWidth = Math.max(
    RIGHT_PANEL_MIN_WIDTH,
    Math.ceil(safeBodyWidth * 0.5),
  );
  const maxWidth = Math.min(
    Math.floor(safeBodyWidth * 0.7),
    safeBodyWidth - EXPANDED_TERMINAL_MIN_WIDTH - RIGHT_PANEL_SPLITTER_WIDTH,
  );
  return {
    minWidth,
    maxWidth,
  };
}

export function boundsFor(
  bodyWidth: number,
  activeRightPanel: RightPanelState["activeRightPanel"],
  editorSize: EditorPanelSize,
): RightPanelBounds {
  return (activeRightPanel === "editor" || activeRightPanel === "git") && editorSize === "expanded"
    ? expandedBounds(bodyWidth)
    : normalBounds(bodyWidth);
}

export function widthForState(state: RightPanelState, bodyWidth: number): number {
  if (!state.rightPanelOpen) return 0;
  const bounds = boundsFor(bodyWidth, state.activeRightPanel, state.editorSize);
  const requested = (state.activeRightPanel === "editor" || state.activeRightPanel === "git") && state.editorSize === "expanded"
    ? state.editorExpandedWidth ?? Math.floor(bodyWidth * 0.6)
    : state.rightPanelWidth;
  if (bodyWidth <= 0) return Math.max(0, requested);
  if (bounds.maxWidth < bounds.minWidth) return 0;
  return clamp(requested, bounds.minWidth, bounds.maxWidth);
}

export function geometryForState(state: RightPanelState, bodyWidth: number): RightPanelGeometry {
  const bounds = boundsFor(bodyWidth, state.activeRightPanel, state.editorSize);
  const effectiveWidth = widthForState(state, bodyWidth);
  const splitterWidth = state.rightPanelOpen && effectiveWidth > 0 ? RIGHT_PANEL_SPLITTER_WIDTH : 0;
  return {
    bodyWidth: Math.max(0, bodyWidth),
    minWidth: bounds.minWidth,
    maxWidth: bounds.maxWidth,
    effectiveWidth,
    splitterWidth,
    terminalWidth: Math.max(0, bodyWidth - splitterWidth - effectiveWidth),
  };
}

export function targetExpandedWidth(bodyWidth: number): number {
  const bounds = expandedBounds(bodyWidth);
  return clamp(Math.floor(bodyWidth * 0.6), bounds.minWidth, bounds.maxWidth);
}
