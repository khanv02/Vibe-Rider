const terminalPreviews = [
  {
    id: "T1",
    title: "TERMINAL 1",
    command: "claude",
    note: "AI CLI preview",
  },
  {
    id: "T2",
    title: "TERMINAL 2",
    command: "codex",
    note: "Parallel CLI preview",
  },
  {
    id: "T3",
    title: "TERMINAL 3",
    command: "npm run dev",
    note: "Dev workflow preview",
  },
  {
    id: "T4",
    title: "TERMINAL 4",
    command: "git status",
    note: "Shell workflow preview",
  },
];

export function TerminalWorkspace() {
  return (
    <section className="terminal-workspace" aria-labelledby="terminal-workspace-title">
      <div className="workspace-heading">
        <div>
          <p className="workspace-kicker">MAIN WORKSPACE</p>
          <h2 id="terminal-workspace-title">Terminals</h2>
        </div>
        <div className="layout-indicator">
          <span className="layout-dot" aria-hidden="true" />
          <span>2 × 2 GRID</span>
          <span className="mock-label">MOCK</span>
        </div>
      </div>

      <div className="terminal-grid">
        {terminalPreviews.map((terminal) => (
          <article className="terminal-card" key={terminal.id}>
            <header className="terminal-card-header">
              <span className="terminal-led" aria-hidden="true" />
              <span className="terminal-id">{terminal.id}</span>
              <span className="terminal-title">{terminal.title}</span>
              <span className="terminal-state">PREVIEW</span>
            </header>
            <div className="terminal-card-body">
              <p className="terminal-note">{terminal.note}</p>
              <p className="terminal-command">
                <span className="terminal-prompt">PS&gt;</span> {terminal.command}
              </p>
              <p className="terminal-placeholder">Native terminal wiring comes after this foundation mock.</p>
              <p className="terminal-cursor-line" aria-hidden="true">
                <span className="terminal-prompt">PS&gt;</span>
                <span className="cursor-block" />
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
