import { useState } from "react";
import { TERMINAL_PANE_IDS, type TerminalLayoutMode, type TerminalPaneId, type TerminalPaneState } from "../terminal/types";
import type { WorkspaceDescriptor } from "../workspace/types";
import { TerminalPane } from "./TerminalPane";

interface TerminalWorkspaceProps {
  onActivePaneChange: (paneId: TerminalPaneId) => void;
  onPaneStateChange: (state: TerminalPaneState) => void;
  workspace: WorkspaceDescriptor | null;
}

const nextPane: Record<TerminalPaneId, TerminalPaneId> = {
  T1: "T2",
  T2: "T3",
  T3: "T4",
  T4: "T1",
};

export function TerminalWorkspace({ onActivePaneChange, onPaneStateChange, workspace }: TerminalWorkspaceProps) {
  const [layoutMode, setLayoutMode] = useState<TerminalLayoutMode>(4);
  const [activePaneId, setActivePaneId] = useState<TerminalPaneId>("T1");
  const [visiblePair, setVisiblePair] = useState<[TerminalPaneId, TerminalPaneId]>(["T1", "T2"]);

  const visiblePaneIds = layoutMode === 4
    ? TERMINAL_PANE_IDS
    : layoutMode === 1
      ? [activePaneId]
      : visiblePair;

  function selectPane(paneId: TerminalPaneId) {
    setActivePaneId(paneId);
    onActivePaneChange(paneId);
    if (layoutMode === 2 && !visiblePair.includes(paneId)) {
      setVisiblePair([paneId, nextPane[paneId]]);
    }
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
                onClick={() => setLayoutMode(mode as TerminalLayoutMode)}
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
            key={paneId}
            onFocus={() => selectPane(paneId)}
            onStateChange={onPaneStateChange}
            paneId={paneId}
            visible={visiblePaneIds.includes(paneId)}
            workspace={workspace}
          />
        ))}
      </div>
    </section>
  );
}
