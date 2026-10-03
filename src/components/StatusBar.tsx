import type { TerminalViewState } from "../terminal/types";

interface StatusBarProps {
  terminalState: TerminalViewState;
  workspaceName: string | null;
}

export function StatusBar({ terminalState, workspaceName }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <div className="status-terminals" aria-label="Terminal status">
        <span className="status-terminal">
          <span className={`status-terminal-dot status-terminal-dot-${terminalState}`} aria-hidden="true" />
          T1 {terminalState.toUpperCase()}
        </span>
      </div>
      <div className="status-spacer" />
      <div className="status-context">
        <span>Workspace: {workspaceName ?? "none"}</span>
        <span className="status-separator" aria-hidden="true" />
        <span>Phase 2 / Terminal Core / Task 2.5</span>
      </div>
    </footer>
  );
}
