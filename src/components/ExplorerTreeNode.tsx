import { useEffect, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import type { CreateEntryKind } from "../workspace/types";
import type { DirectoryEntry } from "../workspace/types";
import type { ExplorerState } from "../workspace/useWorkspaceExplorer";
import type { GitStatusEntry } from "../git/types";
import { gitToneForPath } from "../git/statusTone";
import { INTERNAL_FILE_DROP_TYPE } from "./fileDrop";

export interface ExplorerInlineCreate {
  kind: CreateEntryKind;
  parentPath: string;
}

interface ExplorerTreeNodeProps {
  depth: number;
  entry: DirectoryEntry;
  explorer: ExplorerState;
  gitEntries: GitStatusEntry[];
  pendingFilePaths: string[];
  creating: ExplorerInlineCreate | null;
  onRetry: (relativePath: string) => void;
  onOpenFile: (entry: DirectoryEntry) => void;
  onContextMenu: (event: MouseEvent, entry: DirectoryEntry) => void;
  onCreateCommit: (name: string) => void;
  onCreateCancel: () => void;
  onMoveEntry: (sourceRelativePath: string, destinationDirectoryRelativePath: string) => void;
  onSelect: (entry: DirectoryEntry) => void;
  onToggle: (relativePath: string) => void;
}

export function ExplorerTreeNode({
  depth,
  entry,
  explorer,
  gitEntries,
  pendingFilePaths,
  creating,
  onRetry,
  onOpenFile,
  onContextMenu,
  onCreateCommit,
  onCreateCancel,
  onMoveEntry,
  onSelect,
  onToggle,
}: ExplorerTreeNodeProps) {
  const isDirectory = entry.kind === "directory";
  const isExpanded = explorer.expandedPaths[entry.relativePath] === true;
  const isLoading = explorer.loadingPaths[entry.relativePath] === true;
  const error = explorer.errorsByPath[entry.relativePath];
  const children = explorer.entriesByPath[entry.relativePath];
  const isSelected = explorer.selectedPath === entry.relativePath;
  const gitTone = gitToneForPath(entry.relativePath, gitEntries);
  const isPending = pendingFilePaths.includes(entry.relativePath);
  const [isDropTarget, setIsDropTarget] = useState(false);

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!isDirectory) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setIsDropTarget(true);
  }

  function startDrag(event: DragEvent<HTMLElement>) {
    if (entry.kind !== "file" && entry.kind !== "directory") return;
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(INTERNAL_FILE_DROP_TYPE, entry.relativePath);
    event.dataTransfer.setData("text/plain", entry.relativePath);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!isDirectory) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDropTarget(false);
    const sourceRelativePath = event.dataTransfer.getData(INTERNAL_FILE_DROP_TYPE).trim();
    if (sourceRelativePath && sourceRelativePath !== entry.relativePath) {
      onMoveEntry(sourceRelativePath, entry.relativePath);
    }
  }

  return (
    <li className="explorer-node">
      <div
        className={`explorer-entry${isSelected ? " explorer-entry-selected" : ""}${gitTone === "clean" ? "" : ` explorer-entry-git-${gitTone}`}${isPending ? " explorer-entry-pending" : ""}${isDropTarget ? " explorer-entry-drop-target" : ""}`}
        draggable={entry.kind === "file" || entry.kind === "directory"}
        onDragStart={startDrag}
        onDragOver={handleDragOver}
        onDragLeave={(event) => {
          const relatedTarget = event.relatedTarget;
          if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
            setIsDropTarget(false);
          }
        }}
        onDrop={handleDrop}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest(".explorer-toggle")) return;
          onSelect(entry);
          if (isDirectory) onToggle(entry.relativePath);
          else if (entry.kind === "file") onOpenFile(entry);
        }}
        onContextMenu={(event) => onContextMenu(event, entry)}
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
          draggable={entry.kind === "file" || entry.kind === "directory"}
          onDragStart={startDrag}
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
          {creating?.parentPath === entry.relativePath ? (
            <ExplorerInlineEntry
              depth={depth + 1}
              kind={creating.kind}
              onCancel={onCreateCancel}
              onCommit={onCreateCommit}
            />
          ) : null}
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
                  gitEntries={gitEntries}
                  pendingFilePaths={pendingFilePaths}
                  creating={creating}
                  key={child.relativePath}
                  onRetry={onRetry}
                  onOpenFile={onOpenFile}
                  onContextMenu={onContextMenu}
                  onCreateCommit={onCreateCommit}
                  onCreateCancel={onCreateCancel}
                  onMoveEntry={onMoveEntry}
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

export function ExplorerInlineEntry({
  depth,
  kind,
  onCancel,
  onCommit,
}: {
  depth: number;
  kind: CreateEntryKind;
  onCancel: () => void;
  onCommit: (name: string) => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function commit() {
    const name = value.trim();
    if (!name) {
      onCancel();
      return;
    }
    onCommit(name);
  }

  return (
    <li className="explorer-node explorer-inline-node">
      <div
        className="explorer-entry explorer-inline-entry"
        onClick={(event) => event.stopPropagation()}
        style={{ paddingLeft: 8 + depth * 13 + "px" }}
      >
        <span className={`explorer-kind explorer-kind-${kind}`} aria-hidden="true">
          {kind === "directory" ? "DIR" : "FILE"}
        </span>
        <input
          aria-label={kind === "directory" ? "New folder name" : "New file name"}
          autoComplete="off"
          className="explorer-inline-input"
          id={kind === "directory" ? "explorer-new-folder" : "explorer-new-file"}
          name="newEntryName"
          onBlur={() => {
            if (!value.trim()) onCancel();
          }}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          ref={inputRef}
          spellCheck={false}
          value={value}
        />
      </div>
    </li>
  );
}
