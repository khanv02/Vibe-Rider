interface StatusBarProps {
  workspaceName: string | null;
}

const terminalIds = ["T1", "T2", "T3", "T4"];

export function StatusBar({ workspaceName }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <div className="status-terminals" aria-label="Terminal preview status">
        {terminalIds.map((terminalId) => (
          <span className="status-terminal" key={terminalId}>
            <span className="status-terminal-dot" aria-hidden="true" />
            {terminalId}
          </span>
        ))}
      </div>
      <div className="status-spacer" />
      <div className="status-context">
        <span>Workspace: {workspaceName ?? "none"}</span>
        <span className="status-separator" aria-hidden="true" />
        <span>Phase 1 / Workspace</span>
      </div>
    </footer>
  );
}
