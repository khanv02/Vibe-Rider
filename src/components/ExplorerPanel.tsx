import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { ExplorerInlineEntry, ExplorerTreeNode, type ExplorerInlineCreate } from "./ExplorerTreeNode";
import { WorkspaceSearch } from "./WorkspaceSearch";
import type { CreateEntryKind, DirectoryEntry, WorkspaceDescriptor } from "../workspace/types";
import type { WorkspaceExplorerController } from "../workspace/useWorkspaceExplorer";
import { ROOT_PATH } from "../workspace/useWorkspaceExplorer";
import type { WorkspaceSearchController } from "../search/useWorkspaceSearch";
import type { SearchMatch, SearchSuggestion } from "../search/types";
import type { GitStatusEntry } from "../git/types";

interface ExplorerPanelProps {
  explorer: WorkspaceExplorerController;
  gitEntries: GitStatusEntry[];
  pendingFilePaths: string[];
  onDeleteEntry: (relativePath: string) => Promise<void>;
  onOpenWorkspace: () => void;
  onOpenFile: (entry: DirectoryEntry) => void;
  onOpenSearchResult: (match: SearchMatch) => Promise<void>;
  search: WorkspaceSearchController;
  workspace: WorkspaceDescriptor;
}

interface ExplorerContextMenuState {
  x: number;
  y: number;
  target: DirectoryEntry | null;
}

export function ExplorerPanel({ explorer, gitEntries, onDeleteEntry, onOpenFile, onOpenSearchResult, onOpenWorkspace, pendingFilePaths, search, workspace }: ExplorerPanelProps) {
  const rootEntries = explorer.entriesByPath[ROOT_PATH];
  const rootLoading = explorer.loadingPaths[ROOT_PATH] === true;
  const rootError = explorer.errorsByPath[ROOT_PATH];
  const selectedEntry = findEntry(rootEntries, explorer);
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenuState | null>(null);
  const [inlineCreate, setInlineCreate] = useState<ExplorerInlineCreate | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const selectedDirectory = selectedEntry?.kind === "directory"
    ? selectedEntry.relativePath
    : parentPath(explorer.selectedPath);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) return;
      setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  function beginCreate(kind: CreateEntryKind, parentRelativePath: string) {
    setContextMenu(null);
    setInlineCreate({ kind, parentPath: parentRelativePath });
    if (parentRelativePath && explorer.expandedPaths[parentRelativePath] !== true) {
      explorer.toggleDirectory(parentRelativePath);
    }
  }

  function openContextMenu(event: MouseEvent, target: DirectoryEntry | null) {
    event.preventDefault();
    event.stopPropagation();
    if (target) explorer.selectEntry(target);
    const menuWidth = 184;
    const menuHeight = 142;
    setContextMenu({
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8)),
      target,
    });
  }

  function createFromContextMenu(kind: "file" | "directory") {
    const target = contextMenu ? contextMenu.target : selectedEntry;
    const parentRelativePath = target?.kind === "directory"
      ? target.relativePath
      : parentPath(target?.relativePath ?? null);
    beginCreate(kind, parentRelativePath);
  }

  async function commitInlineCreate(name: string) {
    const current = inlineCreate;
    if (!current) return;
    const created = await explorer.createEntry(current.parentPath, name, current.kind);
    if (created) setInlineCreate(null);
  }

  function cancelInlineCreate() {
    setInlineCreate(null);
  }

  function openSearchSuggestion(suggestion: SearchSuggestion) {
    const name = suggestion.relativePath.split("/").pop() ?? suggestion.relativePath;
    if (suggestion.kind === "file") {
      onOpenFile({ name, relativePath: suggestion.relativePath, kind: "file" });
      return;
    }
    const entry = { name, relativePath: suggestion.relativePath, kind: "directory" as const };
    explorer.selectEntry(entry);
    if (explorer.expandedPaths[suggestion.relativePath] !== true) {
      explorer.toggleDirectory(suggestion.relativePath);
    }
  }

  function deleteFromContextMenu() {
    const target = contextMenu ? contextMenu.target : selectedEntry;
    if (!target || (target.kind !== "file" && target.kind !== "directory")) return;
    setContextMenu(null);
    if (window.confirm(`Delete ${target.relativePath}? This also deletes everything inside a folder.`)) {
      void onDeleteEntry(target.relativePath);
    }
  }

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
            aria-label="New file"
            className="explorer-icon-button"
            disabled={explorer.mutationBusy || inlineCreate !== null}
            onClick={() => beginCreate("file", selectedDirectory)}
            title={`New file in ${selectedDirectory || "workspace"}`}
            type="button"
          >
            <FilePlusIcon />
          </button>
          <button
            aria-label="New folder"
            className="explorer-icon-button"
            disabled={explorer.mutationBusy || inlineCreate !== null}
            onClick={() => beginCreate("directory", selectedDirectory)}
            title={`New folder in ${selectedDirectory || "workspace"}`}
            type="button"
          >
            <FolderPlusIcon />
          </button>
          <button
            aria-label="Refresh workspace"
            className="explorer-icon-button"
            disabled={explorer.mutationBusy}
            onClick={() => explorer.refreshDirectory(ROOT_PATH)}
            title="Refresh workspace"
            type="button"
          >
            <RefreshIcon />
          </button>
          <button className="explorer-open-button" onClick={onOpenWorkspace} type="button">
            Switch
          </button>
        </div>
      </div>

      <div className="explorer-files-toolbar">
        <span className="explorer-files-label">Files</span>
        <WorkspaceSearch compact controller={search} onOpenResult={onOpenSearchResult} onOpenSuggestion={openSearchSuggestion} />
      </div>

      {explorer.mutationError ? (
        <div className="explorer-error explorer-mutation-error" role="alert">
          <span>{explorer.mutationError}</span>
          <button onClick={explorer.clearMutationError} type="button">Dismiss</button>
        </div>
      ) : null}

      <div
        className="explorer-tree"
        aria-label="Workspace files"
        onContextMenu={(event) => openContextMenu(event, null)}
        role="tree"
      >
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
                gitEntries={gitEntries}
                pendingFilePaths={pendingFilePaths}
                creating={inlineCreate}
                key={entry.relativePath}
                onRetry={explorer.retryDirectory}
                onOpenFile={onOpenFile}
                onContextMenu={openContextMenu}
                onCreateCommit={commitInlineCreate}
                onCreateCancel={cancelInlineCreate}
                onMoveEntry={(sourceRelativePath, destinationDirectoryRelativePath) => {
                  void explorer.moveEntry(sourceRelativePath, destinationDirectoryRelativePath);
                }}
                onSelect={explorer.selectEntry}
                onToggle={explorer.toggleDirectory}
              />
            ))
          : null}
        {!rootLoading && !rootError && inlineCreate?.parentPath === ROOT_PATH ? (
          <ExplorerInlineEntry
            depth={0}
            kind={inlineCreate.kind}
            onCancel={cancelInlineCreate}
            onCommit={commitInlineCreate}
          />
        ) : null}
      </div>

      {contextMenu ? (
        <div
          className="explorer-context-menu"
          onContextMenu={(event) => event.preventDefault()}
          ref={contextMenuRef}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button disabled={explorer.mutationBusy || inlineCreate !== null} onClick={() => createFromContextMenu("file")} role="menuitem" type="button">
            <span aria-hidden="true">＋</span> New File
          </button>
          <button disabled={explorer.mutationBusy || inlineCreate !== null} onClick={() => createFromContextMenu("directory")} role="menuitem" type="button">
            <span aria-hidden="true">＋</span> New Folder
          </button>
          <div className="explorer-context-divider" />
          <button
            disabled={!contextMenu.target || !["file", "directory"].includes(contextMenu.target.kind) || explorer.mutationBusy}
            onClick={deleteFromContextMenu}
            role="menuitem"
            type="button"
          >
            <span aria-hidden="true">⌫</span> Delete
          </button>
        </div>
      ) : null}

      <div className="explorer-selection" aria-live="polite">
        <span className="panel-kicker">SELECTION</span>
        <span title={explorer.selectedPath ?? undefined}>
          {selectedEntry?.relativePath ?? explorer.selectedPath ?? "No file selected"}
        </span>
      </div>
      {pendingFilePaths.length > 0 ? (
        <div className="explorer-undo-notice" role="status">
          <span className="panel-kicker">UNDO</span>
          <span className="explorer-pending-path">{pendingFilePaths.join(", ")}</span>
          <kbd>Ctrl+Z</kbd>
        </div>
      ) : null}
    </div>
  );
}

function parentPath(relativePath: string | null): string {
  if (!relativePath) return ROOT_PATH;
  const separator = relativePath.lastIndexOf("/");
  return separator === -1 ? ROOT_PATH : relativePath.slice(0, separator);
}

function FilePlusIcon() {
  return (
    <svg aria-hidden="true" className="explorer-action-icon" viewBox="0 0 16 16">
      <path d="M3.5 1.5h5l4 4v9h-9z" fill="none" stroke="currentColor" />
      <path d="M8.5 1.5v4h4M8 8v5M5.5 10.5h5" fill="none" stroke="currentColor" />
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg aria-hidden="true" className="explorer-action-icon" viewBox="0 0 16 16">
      <path d="M1.5 4.5h4l1.3 1.4h7.7v7.6h-13z" fill="none" stroke="currentColor" />
      <path d="M8.5 8v4M6.5 10h4" fill="none" stroke="currentColor" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" className="explorer-action-icon" viewBox="0 0 16 16">
      <path d="M13 6a5 5 0 0 0-8.6-1.7L3 5.7M3 5.7V2.5M3 5.7h3.2M3 10a5 5 0 0 0 8.6 1.7l1.4-1.4m0 0v3.2m0-3.2H9.8" fill="none" stroke="currentColor" />
    </svg>
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
