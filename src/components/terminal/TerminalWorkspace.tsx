import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { DragEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NEXT_TERMINAL_PANE, TERMINAL_PANE_IDS, type TerminalLayoutMode, type TerminalPaneId, type TerminalPaneState } from "../../terminal/types";
import type { WorkspaceDescriptor } from "../../workspace/types";
import type { UiTheme } from "../../preferences/types";
import { TerminalPane } from "./TerminalPane";
import type { TerminalPaneHandle } from "./TerminalPane";
import { dropPointInCssPixels, readDroppedPaths } from "../../shared/fileDrop";
import { isTauriRuntime } from "../../tauri/runtime";

interface TerminalWorkspaceProps {
  theme: UiTheme;
  activePaneId: TerminalPaneId;
  autoStartPaneId?: TerminalPaneId | null;
  layoutMode: TerminalLayoutMode;
  onActivePaneChange: (paneId: TerminalPaneId) => void;
  onLayoutModeChange: (mode: TerminalLayoutMode) => void;
  onPaneStateChange: (state: TerminalPaneState) => void;
  onVisiblePairChange: (pair: [TerminalPaneId, TerminalPaneId]) => void;
  visiblePair: [TerminalPaneId, TerminalPaneId];
  workspace: WorkspaceDescriptor | null;
  onPathDrop: (paths: string[], paneId: TerminalPaneId) => void;
}

export interface TerminalWorkspaceHandle {
  focusActivePane: () => void;
  focusPane: (paneId: TerminalPaneId) => void;
  writeToPane: (paneId: TerminalPaneId, text: string) => void;
}

export const TerminalWorkspace = forwardRef<TerminalWorkspaceHandle, TerminalWorkspaceProps>(function TerminalWorkspace({
  theme,
  activePaneId,
  autoStartPaneId = null,
  layoutMode,
  onActivePaneChange,
  onLayoutModeChange,
  onPaneStateChange,
  onVisiblePairChange,
  visiblePair,
  workspace,
  onPathDrop,
}, ref) {
  const paneRefs = useRef<Record<TerminalPaneId, TerminalPaneHandle | null>>({ T1: null, T2: null, T3: null, T4: null });
  useImperativeHandle(ref, () => ({
    focusActivePane: () => focusPane(activePaneId),
    focusPane,
    writeToPane: (paneId, text) => paneRefs.current[paneId]?.writeText(text),
  }), [activePaneId]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const point = dropPointInCssPixels(event.payload.position);
      const target = document.elementFromPoint(point.x, point.y);
      const pane = target instanceof Element ? target.closest<HTMLElement>("[data-terminal-pane]") : null;
      const paneId = pane?.dataset.terminalPane as TerminalPaneId | undefined;
      if (paneId && TERMINAL_PANE_IDS.includes(paneId)) onPathDrop(event.payload.paths, paneId);
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onPathDrop]);
  const visiblePaneIds = layoutMode === 4
    ? TERMINAL_PANE_IDS
    : layoutMode === 1
      ? [activePaneId]
      : visiblePair;

  function selectPane(paneId: TerminalPaneId) {
    onActivePaneChange(paneId);
    if (layoutMode === 2 && !visiblePair.includes(paneId)) {
      onVisiblePairChange([paneId, NEXT_TERMINAL_PANE[paneId]]);
    }
  }

  function focusPane(paneId: TerminalPaneId) {
    const helper = document.querySelector<HTMLElement>(`[data-terminal-pane="${paneId}"] .xterm-helper-textarea`);
    helper?.focus();
    if (helper) onActivePaneChange(paneId);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-terminal-pane]") : null;
    const paneId = target?.dataset.terminalPane as TerminalPaneId | undefined;
    const paths = readDroppedPaths(event.dataTransfer);
    if (paneId && TERMINAL_PANE_IDS.includes(paneId) && paths.length > 0) onPathDrop(paths, paneId);
  }

  return (
    <section className="terminal-workspace" aria-labelledby="terminal-workspace-title" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <div className="workspace-heading">
        <div>
          <p className="workspace-kicker">MAIN WORKSPACE</p>
          <h2 id="terminal-workspace-title">Terminal Workspace</h2>
        </div>
        <div className="workspace-controls" aria-label="Terminal layout and focus controls">
          <div className="layout-controls" aria-label="Layout mode">
            {[1, 2, 4].map((mode) => (
              <button
                className={`layout-button${layoutMode === mode ? " layout-button-active" : ""}`}
                key={mode}
                onClick={() => onLayoutModeChange(mode as TerminalLayoutMode)}
                type="button"
              >
                {mode}
              </button>
            ))}
          </div>
          <div className="pane-selector" aria-label="Terminal pane selector">
            {TERMINAL_PANE_IDS.map((paneId) => (
              <button
                className={`pane-selector-button${activePaneId === paneId ? " pane-selector-button-active" : ""}`}
                key={paneId}
                onClick={() => selectPane(paneId)}
                type="button"
              >
                {paneId}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={`terminal-grid terminal-grid-mode-${layoutMode}`}>
        {TERMINAL_PANE_IDS.map((paneId) => (
          <TerminalPane
            active={activePaneId === paneId}
            autoStart={autoStartPaneId === paneId}
            key={paneId}
            onFocus={() => selectPane(paneId)}
            onStateChange={onPaneStateChange}
            paneId={paneId}
            ref={(instance) => { paneRefs.current[paneId] = instance; }}
            theme={theme}
            visible={visiblePaneIds.includes(paneId)}
            workspace={workspace}
          />
        ))}
      </div>
    </section>
  );
});
