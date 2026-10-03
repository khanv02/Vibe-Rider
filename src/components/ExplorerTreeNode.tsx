import type { DirectoryEntry } from "../workspace/types";
import type { ExplorerState } from "../workspace/useWorkspaceExplorer";

interface ExplorerTreeNodeProps {
  depth: number;
  entry: DirectoryEntry;
  explorer: ExplorerState;
  onRetry: (relativePath: string) => void;
  onOpenFile: (entry: DirectoryEntry) => void;
  onSelect: (entry: DirectoryEntry) => void;
  onToggle: (relativePath: string) => void;
}

export function ExplorerTreeNode({
  depth,
  entry,
  explorer,
  onRetry,
  onOpenFile,
  onSelect,
  onToggle,
}: ExplorerTreeNodeProps) {
  const isDirectory = entry.kind === "directory";
  const isExpanded = explorer.expandedPaths[entry.relativePath] === true;
  const isLoading = explorer.loadingPaths[entry.relativePath] === true;
  const error = explorer.errorsByPath[entry.relativePath];
  const children = explorer.entriesByPath[entry.relativePath];
  const isSelected = explorer.selectedPath === entry.relativePath;

  return (
    <li className="explorer-node">
      <div
        className={
          "explorer-entry" + (isSelected ? " explorer-entry-selected" : "")
        }
        style={{ paddingLeft: 8 + depth * 13 + "px" }}
      >
        {isDirectory ? (
          <button
            aria-expanded={isExpanded}
            aria-label={(isExpanded ? "Collapse " : "Expand ") + entry.name}
            className="explorer-toggle"
            onClick={() => onToggle(entry.relativePath)}
            type="button"
          >
            {isExpanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="explorer-toggle explorer-toggle-leaf" aria-hidden="true">
            •
          </span>
        )}
        <button
          className="explorer-entry-label"
          onClick={() => {
            if (isDirectory) onToggle(entry.relativePath);
            else {
              onSelect(entry);
              if (entry.kind === "file") onOpenFile(entry);
            }
          }}
          title={entry.relativePath}
          type="button"
        >
          <span
            className={"explorer-kind explorer-kind-" + entry.kind}
            aria-hidden="true"
          >
            {entry.kind === "directory" ? "DIR" : entry.kind === "link" ? "LNK" : "FILE"}
          </span>
          <span className="explorer-entry-name">{entry.name}</span>
        </button>
      </div>

      {isDirectory && isExpanded ? (
        <ul className="explorer-node-children">
          {isLoading ? <li className="explorer-state">Loading…</li> : null}
          {error ? (
            <li className="explorer-node-error">
              <span>{error}</span>
              <button onClick={() => onRetry(entry.relativePath)} type="button">
                Retry
              </button>
            </li>
          ) : null}
          {!isLoading && !error && children?.length === 0 ? (
            <li className="explorer-state">Empty directory</li>
          ) : null}
          {!isLoading && !error
            ? children?.map((child) => (
                <ExplorerTreeNode
                  depth={depth + 1}
                  entry={child}
                  explorer={explorer}
                  key={child.relativePath}
                  onRetry={onRetry}
                  onOpenFile={onOpenFile}
                  onSelect={onSelect}
                  onToggle={onToggle}
                />
              ))
            : null}
        </ul>
      ) : null}
    </li>
  );
}
