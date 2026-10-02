interface RightPanelProps {
  ipcMessage: string;
  onCheckIpc: () => void;
}

const tools = [
  { icon: "⎇", label: "Git", active: true },
  { icon: "▱", label: "Explorer", active: false },
  { icon: "<>", label: "Editor", active: false },
  { icon: "✦", label: "AI", active: false },
];

export function RightPanel({ ipcMessage, onCheckIpc }: RightPanelProps) {
  return (
    <aside className="right-panel" aria-label="Supporting tools">
      <nav className="activity-rail" aria-label="Supporting tool navigation">
        <div className="rail-monogram" aria-hidden="true">
          VR
        </div>
        <div className="rail-tools">
          {tools.map((tool) => (
            <button
              className={`rail-tool${tool.active ? " rail-tool-active" : ""}`}
              disabled={!tool.active}
              key={tool.label}
              title={`${tool.label} — ${tool.active ? "default panel" : "planned tool"}`}
              type="button"
              aria-current={tool.active ? "page" : undefined}
              aria-label={`${tool.label}, ${tool.active ? "default panel" : "planned tool"}`}
            >
              <span className="rail-icon" aria-hidden="true">
                {tool.icon}
              </span>
              <span className="rail-label">{tool.label}</span>
            </button>
          ))}
        </div>
        <div className="rail-footer" aria-hidden="true">
          <span className="rail-footer-dot" />
        </div>
      </nav>

      <section className="tool-panel" aria-labelledby="git-panel-title">
        <header className="tool-panel-heading">
          <div>
            <p className="panel-kicker">SUPPORTING TOOL</p>
            <h2 id="git-panel-title">Git</h2>
          </div>
          <span className="default-badge">DEFAULT</span>
        </header>

        <div className="tool-panel-content">
          <div className="tool-placeholder">
            <div className="tool-placeholder-icon" aria-hidden="true">
              ⎇
            </div>
            <h3>Git panel placeholder</h3>
            <p>
              Git operations are not connected in this foundation mock. Supporting tools stay
              here so the terminal remains the primary workspace.
            </p>
          </div>

          <section className="foundation-check" aria-labelledby="foundation-check-title">
            <div className="foundation-check-heading">
              <div>
                <p className="panel-kicker">FOUNDATION CHECK</p>
                <h3 id="foundation-check-title">React ↔ Rust</h3>
              </div>
              <span className="ipc-dot" aria-hidden="true" />
            </div>
            <div className="ipc-result">
              <span>{ipcMessage}</span>
              <button className="primary-button" type="button" onClick={onCheckIpc}>
                Ping Rust
              </button>
            </div>
          </section>
        </div>
      </section>
    </aside>
  );
}
