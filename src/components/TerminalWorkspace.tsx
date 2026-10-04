import { forwardRef, useImperativeHandle } from "react";
import { TERMINAL_PANE_IDS, type TerminalLayoutMode, type TerminalPaneId, type TerminalPaneState } from "../terminal/types";
import type { WorkspaceDescriptor } from "../workspace/types";
import type { UiTheme } from "../preferences/types";
import { TerminalPane } from "./TerminalPane";

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
}

export interface TerminalWorkspaceHandle {
  focusActivePane: () => void;
  focusPane: (paneId: TerminalPaneId) => void;
}

const nextPane: Record<TerminalPaneId, TerminalPaneId> = {
  T1: "T2",
  T2: "T3",
  T3: "T4",
  T4: "T1",
};

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
}, ref) {
  useImperativeHandle(ref, () => ({
    focusActivePane: () => focusPane(activePaneId),
    focusPane,
  }), [activePaneId]);
  const visiblePaneIds = layoutMode === 4
    ? TERMINAL_PANE_IDS
    : layoutMode === 1
      ? [activePaneId]
      : visiblePair;

  function selectPane(paneId: TerminalPaneId) {
    onActivePaneChange(paneId);
    if (layoutMode === 2 && !visiblePair.includes(paneId)) {
      onVisiblePairChange([paneId, nextPane[paneId]]);
    }
  }

  function focusPane(paneId: TerminalPaneId) {
    const helper = document.querySelector<HTMLElement>(`[data-terminal-pane="${paneId}"] .xterm-helper-textarea`);
    helper?.focus();
    if (helper) onActivePaneChange(paneId);
  }

  return (
    <section className="terminal-workspace" aria-labelledby="terminal-workspace-title">
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
            theme={theme}
            visible={visiblePaneIds.includes(paneId)}
            workspace={workspace}
          />
        ))}
      </div>
    </section>
  );
});
