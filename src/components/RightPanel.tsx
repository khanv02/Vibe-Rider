import type { WorkspaceDescriptor } from "../workspace/types";
import type { WorkspaceExplorerController } from "../workspace/useWorkspaceExplorer";
import { ExplorerPanel } from "./ExplorerPanel";

type ActiveTool = "git" | "explorer";

interface RightPanelProps {
  activeTool: ActiveTool;
  explorer: WorkspaceExplorerController;
  ipcMessage: string;
  onCheckIpc: () => void;
  onOpenWorkspace: () => void;
  onSelectTool: (tool: ActiveTool) => void;
  workspace: WorkspaceDescriptor | null;
  workspaceError: string | null;
}

const tools: Array<{ icon: string; id: ActiveTool; label: string }> = [
  { icon: "⌘", id: "git", label: "Git" },
  { icon: "▱", id: "explorer", label: "Explorer" },
];

const plannedTools = [
  { icon: "<>", label: "Editor" },
  { icon: "✦", label: "AI" },
];

export function RightPanel({
  activeTool,
  explorer,
  ipcMessage,
  onCheckIpc,
  onOpenWorkspace,
  onSelectTool,
  workspace,
  workspaceError,
}: RightPanelProps) {
  return (
    <aside className="right-panel" aria-label="Supporting tools">
      <nav className="activity-rail" aria-label="Supporting tool navigation">
        <div className="rail-monogram" aria-hidden="true">
          VR
        </div>
        <div className="rail-tools">
          {tools.map((tool) => (
            <button
              aria-current={activeTool === tool.id ? "page" : undefined}
              aria-label={tool.label}
              className={
                "rail-tool rail-tool-enabled" +
                (activeTool === tool.id ? " rail-tool-active" : "")
              }
              key={tool.id}
              onClick={() => onSelectTool(tool.id)}
              title={tool.label}
              type="button"
            >
              <span className="rail-icon" aria-hidden="true">
                {tool.icon}
              </span>
              <span className="rail-label">{tool.label}</span>
            </button>
          ))}
          {plannedTools.map((tool) => (
            <button
              aria-label={tool.label + ", planned tool"}
              className="rail-tool"
              disabled
              key={tool.label}
              title={tool.label + " — planned tool"}
              type="button"
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

      {activeTool === "explorer" ? (
        <section className="tool-panel" aria-labelledby="explorer-panel-title">
          <header className="tool-panel-heading">
            <div>
              <p className="panel-kicker">SUPPORTING TOOL</p>
              <h2 id="explorer-panel-title">Explorer</h2>
            </div>
            <span className="default-badge">PHASE 1</span>
          </header>
          <div className="tool-panel-content">
            {workspace ? (
              <ExplorerPanel
                explorer={explorer}
                onOpenWorkspace={onOpenWorkspace}
                workspace={workspace}
              />
            ) : (
              <div className="tool-placeholder">
                <div className="tool-placeholder-icon" aria-hidden="true">
                  ▱
                </div>
                <h3>Chưa mở workspace</h3>
                <p>Chọn một folder local để bắt đầu duyệt cây thư mục.</p>
                <button
                  className="primary-button workspace-open-panel-button"
                  onClick={onOpenWorkspace}
                  type="button"
                >
                  Open Folder
                </button>
              </div>
            )}
            {workspaceError ? <p className="workspace-error">{workspaceError}</p> : null}
          </div>
        </section>
      ) : (
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
                ⌘
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
      )}
    </aside>
  );
}
