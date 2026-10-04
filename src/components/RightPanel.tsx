import type { WorkspaceDescriptor } from "../workspace/types";
import type { WorkspaceExplorerController } from "../workspace/useWorkspaceExplorer";
import type { EditorPanelSize, RightPanelId } from "../panels/types";
import { ExplorerPanel } from "./ExplorerPanel";
import { EditorPanel } from "./EditorPanel";
import { GitPanel } from "./GitPanel";
import type { WorkspaceEditorController } from "../editor/useWorkspaceEditor";
import type { DirectoryEntry } from "../workspace/types";
import type { WorkspaceGitController } from "../git/useWorkspaceGit";
import { GitAccountBadge } from "./GitAccountBadge";
import { ActivityPanel } from "./ActivityPanel";
import type { WorkspaceActivityController } from "../activity/useWorkspaceActivity";
import type { WorkspaceSearchController } from "../search/useWorkspaceSearch";
import type { SearchMatch } from "../search/types";
import type { GitStatusEntry } from "../git/types";
import type { WorkspaceCommandsController } from "../commands/useWorkspaceCommands";
import type { UiTheme } from "../preferences/types";

interface RightPanelProps {
  theme: UiTheme;
  activePanel: RightPanelId;
  activity: WorkspaceActivityController;
  commands: WorkspaceCommandsController;
  editorSize: EditorPanelSize;
  keepExpandedOnSwitch: boolean;
  explorer: WorkspaceExplorerController;
  editor: WorkspaceEditorController;
  git: WorkspaceGitController;
  gitEntries: GitStatusEntry[];
  onEditorSizeChange: (size: EditorPanelSize) => void;
  onToggleKeepExpandedOnSwitch: () => void;
  onOpenWorkspace: () => void;
  onDeleteEntry: (relativePath: string) => Promise<void>;
  onOpenFile: (entry: DirectoryEntry) => void;
  onOpenSearchResult: (match: SearchMatch) => Promise<void>;
  onSelectPanel: (panel: RightPanelId) => void;
  open: boolean;
  pendingFilePaths: string[];
  search: WorkspaceSearchController;
  workspace: WorkspaceDescriptor | null;
  workspaceError: string | null;
}

const tools: Array<{ icon: string; id: RightPanelId; label: string }> = [
  { icon: "⌘", id: "git", label: "Git" },
  { icon: "◱", id: "explorer", label: "Explorer" },
  { icon: "<>", id: "editor", label: "Editor" },
  { icon: "◷", id: "activity", label: "Activity" },
];

export function RightPanel({
  theme,
  activePanel,
  activity,
  commands,
  editorSize,
  keepExpandedOnSwitch,
  editor,
  git,
  gitEntries,
  explorer,
  onEditorSizeChange,
  onToggleKeepExpandedOnSwitch,
  onOpenWorkspace,
  onDeleteEntry,
  onOpenFile,
  onOpenSearchResult,
  onSelectPanel,
  open,
  pendingFilePaths,
  search,
  workspace,
  workspaceError,
}: RightPanelProps) {
  function selectTool(panel: RightPanelId) {
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
        <div className="rail-footer">
          <GitAccountBadge
            authVerified={git.authVerified}
            identity={git.status?.identity ?? null}
            remote={git.status?.remote ?? null}
          />
        </div>
      </nav>

      <div className="right-panel-views">
        <section className="tool-panel tool-view" hidden={activePanel !== "git"} aria-labelledby="git-panel-title">
          <ToolHeading badge={editorSize === "expanded" ? "EXPANDED" : "NORMAL"} id="git-panel-title" keepExpandedOnSwitch={keepExpandedOnSwitch} onToggleKeepExpandedOnSwitch={onToggleKeepExpandedOnSwitch} title="Git" />
          <div className="tool-panel-content">
            <GitPanel
              theme={theme}
              controller={git}
              expanded={editorSize === "expanded"}
              onExpandedChange={onEditorSizeChange}
              onOpenFile={(relativePath) => onOpenFile({ name: relativePath.split("/").pop() ?? relativePath, relativePath, kind: "file" })}
              pendingFilePaths={pendingFilePaths}
              workspace={workspace}
            />
          </div>
        </section>

        <section className="tool-panel tool-view" hidden={activePanel !== "explorer"} aria-labelledby="explorer-panel-title">
          <ToolHeading badge="PHASE 1" id="explorer-panel-title" keepExpandedOnSwitch={keepExpandedOnSwitch} onToggleKeepExpandedOnSwitch={onToggleKeepExpandedOnSwitch} title="Explorer" />
          <div className="tool-panel-content">
            {workspace ? (
              <ExplorerPanel explorer={explorer} gitEntries={gitEntries} onDeleteEntry={onDeleteEntry} onOpenFile={onOpenFile} onOpenSearchResult={onOpenSearchResult} onOpenWorkspace={onOpenWorkspace} pendingFilePaths={pendingFilePaths} search={search} workspace={workspace} />
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
          <ToolHeading badge={editorSize === "expanded" ? "EXPANDED" : "NORMAL"} id="editor-panel-title" keepExpandedOnSwitch={keepExpandedOnSwitch} onToggleKeepExpandedOnSwitch={onToggleKeepExpandedOnSwitch} title="Editor" />
          <div className="tool-panel-content editor-panel-content">
            <EditorPanel theme={theme} controller={editor} editorSize={editorSize} onEditorSizeChange={onEditorSizeChange} />
          </div>
        </section>

        <section className="tool-panel tool-view" hidden={activePanel !== "activity"} aria-labelledby="activity-panel-title">
          <ToolHeading badge="LOCAL" id="activity-panel-title" keepExpandedOnSwitch={keepExpandedOnSwitch} onToggleKeepExpandedOnSwitch={onToggleKeepExpandedOnSwitch} title="Activity" />
          <div className="tool-panel-content">
            <ActivityPanel commands={commands} controller={activity} workspace={workspace} />
          </div>
        </section>
      </div>
    </aside>
  );
}

function ToolHeading({ badge, id, keepExpandedOnSwitch, onToggleKeepExpandedOnSwitch, title }: { badge: string; id: string; keepExpandedOnSwitch: boolean; onToggleKeepExpandedOnSwitch: () => void; title: string }) {
  return (
    <header className="tool-panel-heading">
      <div>
        <p className="panel-kicker">SUPPORTING TOOL</p>
        <h2 id={id} tabIndex={-1}>{title}</h2>
      </div>
      <div className="tool-panel-heading-actions">
        <button
          aria-pressed={keepExpandedOnSwitch}
          className={keepExpandedOnSwitch ? "size-button size-button-active" : "size-button"}
          onClick={onToggleKeepExpandedOnSwitch}
          title="Giữ Expanded khi chuyển giữa các panel"
          type="button"
        >
          Keep Expanded
        </button>
        <span className="default-badge">{badge}</span>
      </div>
    </header>
  );
}
