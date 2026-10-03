import { ExplorerTreeNode } from "./ExplorerTreeNode";
import type { DirectoryEntry, WorkspaceDescriptor } from "../workspace/types";
import type { WorkspaceExplorerController } from "../workspace/useWorkspaceExplorer";
import { ROOT_PATH } from "../workspace/useWorkspaceExplorer";

interface ExplorerPanelProps {
  explorer: WorkspaceExplorerController;
  onOpenWorkspace: () => void;
  onOpenFile: (entry: DirectoryEntry) => void;
  workspace: WorkspaceDescriptor;
}

export function ExplorerPanel({ explorer, onOpenFile, onOpenWorkspace, workspace }: ExplorerPanelProps) {
  const rootEntries = explorer.entriesByPath[ROOT_PATH];
  const rootLoading = explorer.loadingPaths[ROOT_PATH] === true;
  const rootError = explorer.errorsByPath[ROOT_PATH];
  const selectedEntry = findEntry(rootEntries, explorer);

  return (
    <div className="explorer-panel">
      <div className="explorer-workspace-heading">
        <div className="workspace-summary">
          <div className="tool-placeholder-icon" aria-hidden="true">
            ▱
          </div>
          <h3>{workspace.name}</h3>
          <p className="workspace-path" title={workspace.rootPath}>
            {workspace.rootPath}
          </p>
        </div>
        <div className="explorer-actions">
          <button
            aria-label="Refresh workspace"
            className="explorer-icon-button"
            onClick={() => explorer.refreshDirectory(ROOT_PATH)}
            title="Refresh workspace"
            type="button"
          >
            ↻
          </button>
          <button className="explorer-open-button" onClick={onOpenWorkspace} type="button">
            Switch
          </button>
        </div>
      </div>

      <div className="explorer-tree" aria-label="Workspace files" role="tree">
        {rootLoading ? <p className="explorer-state">Loading workspace…</p> : null}
        {rootError ? (
          <div className="explorer-error">
            <p>{rootError}</p>
            <button onClick={() => explorer.retryDirectory(ROOT_PATH)} type="button">
              Retry
            </button>
          </div>
        ) : null}
        {!rootLoading && !rootError && rootEntries?.length === 0 ? (
          <p className="explorer-state">Empty directory</p>
        ) : null}
        {!rootLoading && !rootError
          ? rootEntries?.map((entry) => (
              <ExplorerTreeNode
                depth={0}
                entry={entry}
                explorer={explorer}
                key={entry.relativePath}
                onRetry={explorer.retryDirectory}
                onOpenFile={onOpenFile}
                onSelect={explorer.selectEntry}
                onToggle={explorer.toggleDirectory}
              />
            ))
          : null}
      </div>

      <div className="explorer-selection" aria-live="polite">
        <span className="panel-kicker">SELECTION</span>
        <span title={explorer.selectedPath ?? undefined}>
          {selectedEntry?.relativePath ?? explorer.selectedPath ?? "No file selected"}
        </span>
      </div>
    </div>
  );
}

function findEntry(
  rootEntries: DirectoryEntry[] | undefined,
  explorer: WorkspaceExplorerController,
): DirectoryEntry | undefined {
  if (!explorer.selectedPath) {
    return undefined;
  }

  if (rootEntries) {
    const rootEntry = rootEntries.find((entry) => entry.relativePath === explorer.selectedPath);
    if (rootEntry) {
      return rootEntry;
    }
  }

  for (const entries of Object.values(explorer.entriesByPath)) {
    const entry = entries.find((candidate) => candidate.relativePath === explorer.selectedPath);
    if (entry) {
      return entry;
    }
  }
  return undefined;
}
