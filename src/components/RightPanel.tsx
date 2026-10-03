import type { WorkspaceDescriptor } from "../workspace/types";
import type { WorkspaceExplorerController } from "../workspace/useWorkspaceExplorer";
import type { EditorPanelSize, RightPanelId } from "../panels/types";
import { ExplorerPanel } from "./ExplorerPanel";

interface RightPanelProps {
  activePanel: RightPanelId;
  editorSize: EditorPanelSize;
  explorer: WorkspaceExplorerController;
  ipcMessage: string;
  onCheckIpc: () => void;
  onEditorSizeChange: (size: EditorPanelSize) => void;
  onOpenWorkspace: () => void;
  onSelectPanel: (panel: RightPanelId) => void;
  open: boolean;
  workspace: WorkspaceDescriptor | null;
  workspaceError: string | null;
}

const tools: Array<{ icon: string; id: RightPanelId; label: string }> = [
  { icon: "⌘", id: "git", label: "Git" },
  { icon: "◱", id: "explorer", label: "Explorer" },
  { icon: "<>", id: "editor", label: "Editor" },
  { icon: "✦", id: "ai", label: "AI" },
];

export function RightPanel({
  activePanel,
  editorSize,
  explorer,
  ipcMessage,
  onCheckIpc,
  onEditorSizeChange,
  onOpenWorkspace,
  onSelectPanel,
  open,
  workspace,
  workspaceError,
}: RightPanelProps) {
  function selectTool(panel: RightPanelId) {
    if (panel === activePanel && open) {
      return;
    }
    onSelectPanel(panel);
  }

  return (
    <aside
      aria-hidden={!open}
      aria-label="Supporting tools"
      className={`right-panel${open ? "" : " right-panel-collapsed"}`}
      id="right-panel"
    >
      <nav className="activity-rail" aria-label="Supporting tool navigation">
        <div className="rail-monogram" aria-hidden="true">VR</div>
        <div className="rail-tools">
          {tools.map((tool) => (
            <button
              aria-current={activePanel === tool.id && open ? "page" : undefined}
              aria-label={tool.label}
              className={`rail-tool rail-tool-enabled${activePanel === tool.id && open ? " rail-tool-active" : ""}`}
              key={tool.id}
              onClick={() => selectTool(tool.id)}
              tabIndex={open ? 0 : -1}
              title={tool.label}
              type="button"
            >
              <span className="rail-icon" aria-hidden="true">{tool.icon}</span>
              <span className="rail-label">{tool.label}</span>
            </button>
          ))}
        </div>
        <div className="rail-footer" aria-hidden="true">
          <span className="rail-footer-dot" />
        </div>
      </nav>

      <div className="right-panel-views">
        <section className="tool-panel tool-view" hidden={activePanel !== "git"} aria-labelledby="git-panel-title">
          <ToolHeading badge="DEFAULT" id="git-panel-title" title="Git" />
          <div className="tool-panel-content">
            <div className="tool-placeholder">
              <div className="tool-placeholder-icon" aria-hidden="true">⌘</div>
              <h3>Git panel placeholder</h3>
              <p>Git operations sẽ được tích hợp ở Phase 6. Panel hiện giữ slot ổn định cho workspace.</p>
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
                <button className="primary-button" type="button" onClick={onCheckIpc}>Ping Rust</button>
              </div>
            </section>
          </div>
        </section>

        <section className="tool-panel tool-view" hidden={activePanel !== "explorer"} aria-labelledby="explorer-panel-title">
          <ToolHeading badge="PHASE 1" id="explorer-panel-title" title="Explorer" />
          <div className="tool-panel-content">
            {workspace ? (
              <ExplorerPanel explorer={explorer} onOpenWorkspace={onOpenWorkspace} workspace={workspace} />
            ) : (
              <div className="tool-placeholder">
                <div className="tool-placeholder-icon" aria-hidden="true">◱</div>
                <h3>Chưa mở workspace</h3>
                <p>Chọn một folder local để bắt đầu duyệt cây thư mục.</p>
                <button className="primary-button workspace-open-panel-button" onClick={onOpenWorkspace} type="button">Open Folder</button>
              </div>
            )}
            {workspaceError ? <p className="workspace-error">{workspaceError}</p> : null}
          </div>
        </section>

        <section className="tool-panel tool-view" hidden={activePanel !== "editor"} aria-labelledby="editor-panel-title">
          <ToolHeading badge={editorSize === "expanded" ? "EXPANDED" : "NORMAL"} id="editor-panel-title" title="Editor" />
          <div className="tool-panel-content editor-panel-content">
            <div className="tool-placeholder">
              <div className="tool-placeholder-icon" aria-hidden="true">&lt;&gt;</div>
              <h3>Editor placeholder</h3>
              <p>Monaco, file tabs và model state sẽ được tích hợp ở Phase 5.</p>
              <div className="editor-size-controls" aria-label="Editor panel size">
                <button className={editorSize === "normal" ? "size-button size-button-active" : "size-button"} onClick={() => onEditorSizeChange("normal")} type="button">Normal</button>
                <button className={editorSize === "expanded" ? "size-button size-button-active" : "size-button"} onClick={() => onEditorSizeChange("expanded")} type="button">Expanded</button>
              </div>
            </div>
          </div>
        </section>

        <section className="tool-panel tool-view" hidden={activePanel !== "ai"} aria-labelledby="ai-panel-title">
          <ToolHeading badge="PLANNED" id="ai-panel-title" title="AI" />
          <div className="tool-panel-content">
            <div className="tool-placeholder">
              <div className="tool-placeholder-icon" aria-hidden="true">✦</div>
              <h3>AI panel placeholder</h3>
              <p>Chat, provider và context actions sẽ được tích hợp ở Phase 8.</p>
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
}

function ToolHeading({ badge, id, title }: { badge: string; id: string; title: string }) {
  return (
    <header className="tool-panel-heading">
      <div>
        <p className="panel-kicker">SUPPORTING TOOL</p>
        <h2 id={id}>{title}</h2>
      </div>
      <span className="default-badge">{badge}</span>
    </header>
  );
}
