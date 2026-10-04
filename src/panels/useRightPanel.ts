import { useCallback, useMemo, useState } from "react";
import {
  boundsFor,
  clamp,
  geometryForState,
  RIGHT_PANEL_DEFAULT_STATE,
  targetExpandedWidth,
} from "./panelLayout";
import type { EditorPanelSize, RightPanelId, RightPanelSide, RightPanelState } from "./types";

export interface RightPanelController {
  state: RightPanelState;
  geometry: ReturnType<typeof geometryForState>;
  selectPanel: (panel: RightPanelId) => void;
  togglePanel: () => void;
  closePanel: () => void;
  setPanelWidth: (width: number) => void;
  setEditorSize: (size: EditorPanelSize) => void;
  toggleKeepExpandedOnSwitch: () => void;
  setPanelSide: (side: RightPanelSide) => void;
  hydrate: (state: RightPanelState) => void;
}

export function useRightPanel(bodyWidth: number): RightPanelController {
  const [state, setState] = useState<RightPanelState>(RIGHT_PANEL_DEFAULT_STATE);

  const geometry = useMemo(() => geometryForState(state, bodyWidth), [bodyWidth, state]);

  const selectPanel = useCallback((panel: RightPanelId) => {
    setState((current) => ({
      ...current,
      activeRightPanel: panel,
      rightPanelOpen: true,
      editorSize: current.keepExpandedOnSwitch ? current.editorSize : "normal",
    }));
  }, []);

  const togglePanel = useCallback(() => {
    setState((current) => ({ ...current, rightPanelOpen: !current.rightPanelOpen }));
  }, []);

  const closePanel = useCallback(() => {
    setState((current) => ({ ...current, rightPanelOpen: false }));
  }, []);

  const setPanelWidth = useCallback((width: number) => {
    setState((current) => {
      const bounds = boundsFor(bodyWidth, current.activeRightPanel, current.editorSize);
      if (!Number.isFinite(width) || bounds.maxWidth < bounds.minWidth) return current;
      const nextWidth = clamp(width, bounds.minWidth, bounds.maxWidth);
      if ((current.activeRightPanel === "editor" || current.activeRightPanel === "git") && current.editorSize === "expanded") {
        return { ...current, editorExpandedWidth: nextWidth };
      }
      return { ...current, rightPanelWidth: nextWidth };
    });
  }, [bodyWidth]);

  const setEditorSize = useCallback((size: EditorPanelSize) => {
    setState((current) => {
      if (size === "normal") {
        return { ...current, editorSize: "normal" };
      }
      return {
        ...current,
        editorSize: "expanded",
        editorExpandedWidth: current.editorExpandedWidth ?? targetExpandedWidth(bodyWidth),
      };
    });
  }, [bodyWidth]);

  const toggleKeepExpandedOnSwitch = useCallback(() => {
    setState((current) => ({
      ...current,
      keepExpandedOnSwitch: !current.keepExpandedOnSwitch,
    }));
  }, []);

  const setPanelSide = useCallback((side: RightPanelSide) => {
    setState((current) => current.side === side ? current : { ...current, side });
  }, []);

  const hydrate = useCallback((nextState: RightPanelState) => {
    setState(nextState);
  }, []);

  return { state, geometry, selectPanel, togglePanel, closePanel, setPanelWidth, setEditorSize, toggleKeepExpandedOnSwitch, setPanelSide, hydrate };
}
