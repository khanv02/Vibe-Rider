import { TERMINAL_PANE_IDS, type TerminalPaneId, type TerminalPaneState } from "../terminal/types";

interface StatusBarProps {
  activePaneId: TerminalPaneId;
  terminalStates: Record<TerminalPaneId, TerminalPaneState>;
  workspaceName: string | null;
}

export function StatusBar({ activePaneId, terminalStates, workspaceName }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <div className="status-terminals" aria-label="Terminal status">
        {TERMINAL_PANE_IDS.map((paneId) => {
          const state = terminalStates[paneId];
          return (
            <span className={`status-terminal${activePaneId === paneId ? " status-terminal-active" : ""}`} key={paneId}>
              <span className={`status-terminal-dot status-terminal-dot-${state.state}`} aria-hidden="true" />
              {paneId} {state.state.toUpperCase()}
            </span>
          );
        })}
      </div>
      <div className="status-spacer" />
      <div className="status-context">
        <span>Workspace: {workspaceName ?? "none"}</span>
        <span className="status-separator" aria-hidden="true" />
        <span>Phase 3 / Four Terminals</span>
      </div>
    </footer>
  );
}
