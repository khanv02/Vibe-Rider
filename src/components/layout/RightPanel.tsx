import type { WorkspaceDescriptor } from "../../workspace/types";
import type { WorkspaceExplorerController } from "../../workspace/useWorkspaceExplorer";
import type { EditorPanelSize, RightPanelId } from "../../panels/types";
import { ExplorerPanel } from "../workspace/ExplorerPanel";
import { GitPanel } from "../git/GitPanel";
import type { DirectoryEntry } from "../../workspace/types";
import type { WorkspaceGitController } from "../../git/useWorkspaceGit";
import { GitAccountBadge } from "../git/GitAccountBadge";
import { GitHubAuthDialog } from "../git/GitHubAuthDialog";
import type { WorkspaceGitHubAuthController } from "../../githubAuth/types";
import type { WorkspaceSearchController } from "../../search/useWorkspaceSearch";
import type { SearchMatch } from "../../search/types";
import type { GitStatusEntry } from "../../git/types";
import type { UiTheme } from "../../preferences/types";

interface RightPanelProps {
  theme: UiTheme;
  activePanel: RightPanelId;
  editorSize: EditorPanelSize;
  explorer: WorkspaceExplorerController;
  git: WorkspaceGitController;
  githubAuth: WorkspaceGitHubAuthController;
  gitEntries: GitStatusEntry[];
  onEditorSizeChange: (size: EditorPanelSize) => void;
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
];

export function RightPanel({
  theme,
  activePanel,
  editorSize,
  git,
  githubAuth,
  gitEntries,
  explorer,
  onEditorSizeChange,
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
      <nav className="tool-rail" aria-label="Supporting tool navigation">
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
            auth={githubAuth}
            remote={git.status?.remote ?? null}
            workspaceAvailable={Boolean(workspace)}
          />
        </div>
      </nav>

      <div className="right-panel-views">
        <section className="tool-panel tool-view" hidden={activePanel !== "git"} aria-labelledby="git-panel-title">
          <ToolHeading id="git-panel-title" title="Git" />
          <div className="tool-panel-content">
            <GitPanel
              auth={githubAuth}
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
          <ToolHeading id="explorer-panel-title" title="Explorer" />
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

      </div>
      <GitHubAuthDialog controller={githubAuth} />
    </aside>
  );
}

function ToolHeading({ id, title }: { id: string; title: string }) {
  return (
    <header className="tool-panel-heading">
      <div>
        <p className="panel-kicker">SUPPORTING TOOL</p>
        <h2 id={id} tabIndex={-1}>{title}</h2>
      </div>
    </header>
  );
}
