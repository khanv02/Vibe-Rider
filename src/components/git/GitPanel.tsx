import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import type { EditorPanelSize } from "../../panels/types";
import type { WorkspaceDescriptor } from "../../workspace/types";
import type { GitStatusEntry } from "../../git/types";
import { isTauriRuntime } from "../../git/gitApi";
import type { WorkspaceGitController } from "../../git/useWorkspaceGit";
import { gitFileTone } from "../../git/statusTone";
import { SharedDiffViewer } from "../common/SharedDiffViewer";
import type { UiTheme } from "../../preferences/types";
import type { WorkspaceGitHubAuthController } from "../../githubAuth/types";

interface GitPanelProps {
  auth: WorkspaceGitHubAuthController;
  theme: UiTheme;
  controller: WorkspaceGitController;
  expanded: boolean;
  onExpandedChange: (size: EditorPanelSize) => void;
  workspace: WorkspaceDescriptor | null;
  onOpenFile: (relativePath: string) => void;
  pendingFilePaths: string[];
}

interface UpstreamTarget {
  remote: string;
  branch: string;
  ref: string;
}

type GitGroupsLayout = "stacked" | "columns";
type GitSelectionGroup = "staged" | "changes" | "untracked";
type GitContextAction = "addBranch" | "open" | "unstage" | "stage" | "review" | "select" | "unselect";

interface GitContextMenuState {
  x: number;
  y: number;
  entry: GitStatusEntry;
  scope: "staged" | "unstaged";
  group: GitSelectionGroup;
}

function selectionKey(group: GitSelectionGroup, entryId: string): string {
  return `${group}\u0000${entryId}`;
}

function parseUpstream(value: string | null): UpstreamTarget | null {
  if (!value) return null;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator >= value.length - 1) return null;
  return {
    remote: value.slice(0, separator),
    branch: value.slice(separator + 1),
    ref: value,
  };
}

function canStageEntry(entry: GitStatusEntry): boolean {
  return !entry.conflict && (entry.unstaged || entry.untracked);
}

function canUnstageEntry(entry: GitStatusEntry): boolean {
  return !entry.conflict && entry.staged;
}

export function GitPanel({ auth, theme, controller, expanded, onExpandedChange, onOpenFile, pendingFilePaths, workspace }: GitPanelProps) {
  const [groupsLayout, setGroupsLayout] = useState<GitGroupsLayout>("stacked");
  const [newBranchName, setNewBranchName] = useState("");
  const [contextMenu, setContextMenu] = useState<GitContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const { status } = controller;

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

  function openGitContextMenu(event: MouseEvent, entry: GitStatusEntry, scope: "staged" | "unstaged", group: GitSelectionGroup) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 184;
    const menuHeight = 246;
    setContextMenu({
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8)),
      entry,
      scope,
      group,
    });
  }

  function handleContextAction(action: GitContextAction) {
    const target = contextMenu;
    if (!target) return;
    setContextMenu(null);

    switch (action) {
      case "addBranch": {
        const branchName = window.prompt("Add branch from the current HEAD:", "feature/my-branch");
        if (branchName?.trim()) void controller.createBranch(branchName.trim());
        return;
      }
      case "open":
        if (target.entry.indexStatus !== "D" && target.entry.worktreeStatus !== "D") {
          onOpenFile(target.entry.currentPath);
        }
        return;
      case "unstage":
        if (canUnstageEntry(target.entry)) void controller.unstageEntries([target.entry.entryId]);
        return;
      case "stage":
        if (canStageEntry(target.entry)) void controller.stageEntries([target.entry.entryId]);
        return;
      case "review":
        void controller.review(target.entry, target.scope);
        return;
      case "select":
        if (!controller.selectedKeys.includes(selectionKey(target.group, target.entry.entryId))) controller.toggleSelected(target.entry.entryId, selectionKey(target.group, target.entry.entryId));
        return;
      case "unselect":
        if (controller.selectedKeys.includes(selectionKey(target.group, target.entry.entryId))) controller.toggleSelected(target.entry.entryId, selectionKey(target.group, target.entry.entryId));
        return;
    }
  }
  if (!workspace) {
    return (
      <div className="tool-placeholder">
        <div className="tool-placeholder-icon" aria-hidden="true">⌘</div>
        <h3>No workspace open</h3>
        <p>Open a local folder so Git can inspect the repository at the workspace root.</p>
      </div>
    );
  }

  if (!isTauriRuntime()) {
    return (
      <div className="git-runtime-warning" role="status">
        <span className="panel-kicker">DESKTOP RUNTIME REQUIRED</span>
        <h3>Git actions are unavailable in browser preview</h3>
        <p>Open the app through Tauri so Rust can read the repository and run Stage, Commit, Restore and Push.</p>
        <code>npm run tauri -- dev</code>
      </div>
    );
  }

  if (!auth.session) {
    return (
      <div className="tool-placeholder">
        <div className="tool-placeholder-icon" aria-hidden="true">⌘</div>
        <h3>GitHub sign-in required</h3>
        <p>Sign in to GitHub to inspect or change this workspace with Git.</p>
        <button className="primary-button" onClick={() => void auth.begin()} type="button">Login with GitHub</button>
      </div>
    );
  }

  if (!status && controller.loading) return <div className="git-state">Reading Git status…</div>;

  const staged = status?.entries.filter((entry) => entry.staged) ?? [];
  const changes = status?.entries.filter((entry) => entry.unstaged && !entry.untracked) ?? [];
  const untracked = status?.entries.filter((entry) => entry.untracked) ?? [];
  const selectedEntries = status?.entries.filter((entry) => controller.selectedIds.includes(entry.entryId)) ?? [];
  const canStageSelection = selectedEntries.length > 0 && selectedEntries.every((entry) => !entry.conflict && (entry.unstaged || entry.untracked));
  const canUnstageSelection = selectedEntries.length > 0 && selectedEntries.every((entry) => !entry.conflict && entry.staged);
  const canRestoreSelection = selectedEntries.length > 0 && selectedEntries.every((entry) => (
    entry.unstaged && !entry.untracked && !entry.conflict && entry.kind !== "rename"
  ));
  const upstreamTarget = parseUpstream(status?.branch.upstream ?? null);
  const hasUpstream = Boolean(status?.branch.head && upstreamTarget && !status.branch.detached);
  const remoteProvider = status?.remote?.provider;
  const remoteLabel = remoteProvider ? `${status?.remote?.host ?? "Remote"}` : "No remote detected";

  function handleCreateBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const branchName = newBranchName.trim();
    if (!branchName || controller.busy) return;
    setNewBranchName("");
    void controller.createBranch(branchName);
  }

  return (
    <div className={`git-panel${expanded ? " git-panel-expanded" : ""}`}>
      <header className="git-summary">
        <div className="git-summary-copy">
          <span className="panel-kicker">REPOSITORY</span>
          <h3>{status?.branch.detached ? "Detached HEAD" : status?.branch.head ?? "Unborn branch"}</h3>
          <div className="git-summary-target" title={status?.branch.upstream ?? "No configured upstream"}>
            <span className="git-summary-target-label">Upstream</span>
            {upstreamTarget ? (
              <>
                <span className="git-ref-remote">{upstreamTarget.remote}</span>
                <span className="git-ref-separator">/</span>
                <strong>{upstreamTarget.branch}</strong>
              </>
            ) : (
              <span>{status?.branch.upstream ? "Invalid upstream" : "Not configured"}</span>
            )}
          </div>
        </div>
        <div className="git-summary-actions">
          <div className="editor-size-controls" aria-label="Git panel size">
            <button
              aria-pressed={expanded}
              className="size-button size-button-active"
              onClick={() => onExpandedChange(expanded ? "normal" : "expanded")}
              title={expanded ? "Thu nhỏ Git panel" : "Mở rộng Git panel"}
              type="button"
            >{expanded ? "Collapse" : "Expand"}</button>
          </div>
          <button className="editor-quiet-button" disabled={controller.loading || controller.busy} onClick={() => void controller.refresh()} type="button">Refresh</button>
        </div>
      </header>

      {controller.feedback ? (
        <div className={`git-feedback git-feedback-${controller.feedback.kind}`} role={controller.feedback.kind === "error" ? "alert" : "status"} aria-live="polite">
          <div className="git-feedback-heading"><strong>{controller.feedback.operation}</strong><code>{controller.feedback.code}</code></div>
          <p>{controller.feedback.message}</p>
          {controller.feedback.guidance ? <p className="git-feedback-guidance">{controller.feedback.guidance}</p> : null}
          <div className="git-feedback-actions">
            {controller.feedback.kind === "error" ? <button className="editor-quiet-button" disabled={controller.busy} onClick={() => void controller.refresh()} type="button">Refresh status</button> : null}
            <button className="editor-quiet-button" onClick={controller.dismissFeedback} type="button">Dismiss</button>
          </div>
        </div>
      ) : null}
      {pendingFilePaths.length > 0 ? (
        <div className="git-undo-notice" role="status">
          <span className="panel-kicker">UNDO</span>
          <span className="git-pending-path">{pendingFilePaths.join(", ")}</span>
          <kbd>Ctrl+Z</kbd>
        </div>
      ) : null}
      {controller.operation ? <div className="git-operation"><span>Running: {controller.operation.operation}{controller.operation.cancellationRequested ? " (cancelling…)" : ""}</span><button className="editor-quiet-button" disabled={controller.operation.cancellationRequested} onClick={() => void controller.cancel()} type="button">Cancel</button></div> : null}
      {status ? (
        <>
          <section className="git-branch-manager" aria-label="Branch management">
            <div className="git-branch-manager-heading">
              <div>
                <span className="panel-kicker">BRANCHES</span>
                <h3>{status.branch.detached ? "Detached HEAD" : status.branch.head ?? "No branch yet"}</h3>
              </div>
              <span className="git-branch-count">{status.localBranches.length} local</span>
            </div>
            <div className="git-branch-controls">
              <label className="git-branch-switcher">
                <span>Switch branch</span>
                <select
                  aria-label="Switch branch"
                  disabled={controller.busy || status.localBranches.length === 0}
                  id="git-branch-switcher"
                  name="branch"
                  onChange={(event) => {
                    if (event.target.value && event.target.value !== status.branch.head) {
                      void controller.switchBranch(event.target.value);
                    }
                  }}
                  value={status.branch.detached ? "" : status.branch.head ?? ""}
                >
                  <option disabled value="">Select a local branch</option>
                  {status.localBranches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
                </select>
              </label>
              <form className="git-create-branch" onSubmit={handleCreateBranch}>
                <label htmlFor="git-new-branch">Create branch</label>
                <div>
                  <input
                    id="git-new-branch"
                    name="newBranchName"
                    maxLength={255}
                    onChange={(event) => setNewBranchName(event.target.value)}
                    placeholder="feature/my-branch"
                    value={newBranchName}
                  />
                  <button className="editor-quiet-button" disabled={controller.busy || !newBranchName.trim()} type="submit">Create</button>
                </div>
              </form>
            </div>
            <div className="git-branch-visual" aria-label="Local branches">
              {status.localBranches.length > 0 ? status.localBranches.map((branch) => (
                <div className={`git-branch-node${branch.current ? " git-branch-node-current" : ""}`} key={branch.name}>
                  <span className="git-branch-node-line" aria-hidden="true"><span /></span>
                  <span className="git-branch-node-name">{branch.name}</span>
                  {branch.current ? <span className="git-branch-current-label">Current</span> : null}
                  {branch.upstream ? <span className="git-branch-upstream">↗ {branch.upstream}</span> : null}
                </div>
              )) : <span className="git-empty">No local branches</span>}
            </div>
            {status.remoteBranches.length > 0 ? (
              <details className="git-remote-branches">
                <summary>Remote branches <span>{status.remoteBranches.length}</span></summary>
                <div>{status.remoteBranches.map((branch) => <code key={branch}>{branch}</code>)}</div>
              </details>
            ) : null}
            <p className="git-branch-note">
              {status.entries.length > 0
                ? "Switching branches requires a clean working tree; commit or stash changes first."
                : "The new branch was created from the current commit."
              }
            </p>
          </section>
          <div className="git-branch-stats" aria-label="Branch status">
            <span>Ahead {status.branch.ahead}</span>
            <span>Behind {status.branch.behind}</span>
            <span>{status.entries.length} changed</span>
          </div>
          <div className="git-actions">
            <button className="primary-button" disabled={controller.busy || !canStageSelection} onClick={() => void controller.stage()} title={canStageSelection ? "Stage selected files from disk" : "Select unstaged or untracked files only"} type="button">Stage selected</button>
            <button className="editor-quiet-button" disabled={controller.busy || !canUnstageSelection} onClick={() => void controller.unstage()} title={canUnstageSelection ? "Keep disk content and remove selected files from the index" : "Select staged files only"} type="button">Unstage</button>
            <button className="editor-quiet-button" disabled={controller.busy || !canRestoreSelection} onClick={() => void controller.restore()} title={canRestoreSelection ? "Restore tracked disk content from the index" : "Select tracked regular files with unstaged changes only"} type="button">Restore</button>
            {controller.selectedIds.length > 0 ? <button className="editor-quiet-button" onClick={controller.clearSelection} type="button">Clear selection</button> : null}
          </div>
          <p className="git-selection-note">{controller.selectedIds.length === 0 ? "Select files to enable the appropriate actions." : `${controller.selectedIds.length} file(s) selected · actions apply only to compatible states.`}</p>
          <p className="git-disk-note">Git actions use saved disk bytes. Save an editor draft before Stage if it should be included.</p>

          {controller.diff ? (
            <section className="git-preview-panel" aria-label="Git old and new state preview">
              <div className="git-preview-heading">
                <div>
                  <span className="panel-kicker">PREVIEW / {controller.diff.scope === "staged" ? "STAGED" : "WORKTREE"}</span>
                  <h3>{controller.diff.relativePath}</h3>
                </div>
                <span className="git-preview-scope">{controller.diff.scope === "staged" ? "HEAD → Index" : "Index → Working tree"}</span>
              </div>
              {controller.diff.binary || controller.diff.unsupportedReason ? (
                <div className="git-diff-unsupported" role="status">
                  <strong>{controller.diff.relativePath}</strong>
                  <span>{controller.diff.unsupportedReason ?? "Binary diff metadata only."}</span>
                  <button className="editor-quiet-button" onClick={controller.closeDiff} type="button">Close</button>
                </div>
              ) : (
                <>
                  <div className="git-preview-states" aria-label="Old and new states">
                    <div><span className="panel-kicker">OLD STATE</span><strong>{controller.diff.originalLabel}</strong></div>
                    <span aria-hidden="true">→</span>
                    <div><span className="panel-kicker">NEW STATE</span><strong>{controller.diff.modifiedLabel}</strong></div>
                  </div>
                  <SharedDiffViewer
                    theme={theme}
                    onClose={controller.closeDiff}
                    preview={{
                      fileId: controller.diff.previewId,
                      relativePath: controller.diff.relativePath,
                      original: controller.diff.original,
                      modified: controller.diff.modified,
                      originalLabel: controller.diff.originalLabel,
                      modifiedLabel: controller.diff.modifiedLabel,
                    }}
                  />
                </>
              )}
            </section>
          ) : null}

          <section className="git-groups-frame" aria-label="Git changes">
            <div className="git-groups-toolbar">
              <div>
                <span className="panel-kicker">CHANGES</span>
                <span className="git-groups-count">{status.entries.length} entries</span>
              </div>
              <div className="git-layout-options" aria-label="Changes layout">
                <button aria-pressed={groupsLayout === "stacked"} className={groupsLayout === "stacked" ? "size-button size-button-active" : "size-button"} onClick={() => setGroupsLayout("stacked")} type="button">List</button>
                <button aria-pressed={groupsLayout === "columns"} className={groupsLayout === "columns" ? "size-button size-button-active" : "size-button"} onClick={() => { setGroupsLayout("columns"); onExpandedChange("expanded"); }} type="button">3 columns</button>
              </div>
            </div>
            <div className={`git-groups${groupsLayout === "columns" ? " git-groups-columns" : ""}`}>
              <GitGroup controller={controller} entries={staged} group="staged" label="Staged Changes" onContextMenu={openGitContextMenu} onOpenFile={onOpenFile} pendingFilePaths={pendingFilePaths} scope="staged" empty="No staged changes" />
              <GitGroup controller={controller} entries={changes} group="changes" label="Changes" onContextMenu={openGitContextMenu} onOpenFile={onOpenFile} pendingFilePaths={pendingFilePaths} scope="unstaged" empty="No unstaged changes" />
              <GitGroup controller={controller} entries={untracked} group="untracked" label="Untracked" onContextMenu={openGitContextMenu} onOpenFile={onOpenFile} pendingFilePaths={pendingFilePaths} scope="unstaged" empty="No untracked files" />
            </div>
          </section>

          <section className="git-commit-box" aria-labelledby="git-commit-title">
            <div className="git-section-heading"><span className="panel-kicker">REVIEWED INDEX</span><h3 id="git-commit-title">Commit</h3></div>
            <textarea aria-label="Commit message" disabled={controller.busy} id="git-commit-message" name="commitMessage" onChange={(event) => controller.setCommitMessage(event.target.value)} placeholder="Commit message" value={controller.commitMessage} />
            <button className="primary-button" disabled={controller.busy || staged.length === 0 || !controller.commitMessage.trim()} onClick={() => void controller.commit()} type="button">Commit staged changes</button>
            <p className="git-form-note">{staged.length === 0 ? "Stage at least one change before committing." : !controller.commitMessage.trim() ? "Enter a commit message to enable Commit." : "Only the reviewed Index will be committed."}</p>
          </section>

          <section className="git-push-box" aria-label="Push">
            <div className="git-push-target">
              <span className="panel-kicker">PUSH TARGET</span>
              {upstreamTarget ? (
                <div className="git-ref-pair">
                  <span>{status.branch.head ?? "HEAD"}</span>
                  <span aria-hidden="true">→</span>
                  <strong>{upstreamTarget.ref}</strong>
                </div>
              ) : (
                <strong>Configure an upstream in terminal</strong>
              )}
            </div>
            <button className="editor-quiet-button" disabled={controller.busy || !hasUpstream} title={hasUpstream ? `Push ${status.branch.head} to ${upstreamTarget?.ref}` : "Push requires a valid current branch and upstream"} onClick={() => void controller.push()} type="button">Push current branch</button>
            <p className="git-form-note">{hasUpstream ? "Push uses the configured upstream only." : "Push requires a current branch and valid upstream."}</p>
          </section>

          <details className="git-account-section">
            <summary>
              <span><span className="panel-kicker">ACCOUNT</span><strong>{status.identity.name ?? "Git identity missing"}</strong></span>
              <span>{remoteProvider === "github" ? "GitHub" : remoteLabel}</span>
            </summary>
            <div className="git-account-details">
              <div><span>Commit email</span><code>{status.identity.email ?? "Not configured"}</code></div>
              <div><span>Remote</span><code>{status.remote?.host ?? "Not detected"}</code></div>
              <div><span>Git remote access</span><code>{controller.authVerified ? "Verified after successful Push" : "Checked when Push runs"}</code></div>
            </div>
          </details>
        </>
      ) : (
        <div className="git-state">{controller.feedback?.kind === "error" ? "Git status is unavailable." : "No Git status available."}</div>
      )}
      {contextMenu ? (
        <div
          className="explorer-context-menu git-context-menu"
          onContextMenu={(event) => event.preventDefault()}
          ref={contextMenuRef}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button disabled={controller.busy} onClick={() => handleContextAction("addBranch")} role="menuitem" type="button">
            <span aria-hidden="true">＋</span> Add Branch
          </button>
          <div className="explorer-context-divider" />
          <button disabled={contextMenu.entry.indexStatus === "D" || contextMenu.entry.worktreeStatus === "D"} onClick={() => handleContextAction("open")} role="menuitem" type="button">
            <span aria-hidden="true">↗</span> Open
          </button>
          <button disabled={controller.busy || !canUnstageEntry(contextMenu.entry)} onClick={() => handleContextAction("unstage")} role="menuitem" type="button">
            <span aria-hidden="true">−</span> Unstage
          </button>
          <button disabled={controller.busy || !canStageEntry(contextMenu.entry)} onClick={() => handleContextAction("stage")} role="menuitem" type="button">
            <span aria-hidden="true">＋</span> Stage
          </button>
          <button onClick={() => handleContextAction("review")} role="menuitem" type="button">
            <span aria-hidden="true">⌕</span> Review
          </button>
          <div className="explorer-context-divider" />
          <button disabled={controller.selectedKeys.includes(selectionKey(contextMenu.group, contextMenu.entry.entryId))} onClick={() => handleContextAction("select")} role="menuitem" type="button">
            <span aria-hidden="true">✓</span> Select
          </button>
          <button disabled={!controller.selectedKeys.includes(selectionKey(contextMenu.group, contextMenu.entry.entryId))} onClick={() => handleContextAction("unselect")} role="menuitem" type="button">
            <span aria-hidden="true">−</span> Unselect
          </button>
        </div>
      ) : null}
    </div>
  );
}

function GitGroup({
  controller,
  entries,
  group,
  label,
  onContextMenu,
  onOpenFile,
  pendingFilePaths,
  scope,
  empty,
}: {
  controller: WorkspaceGitController;
  entries: GitStatusEntry[];
  group: GitSelectionGroup;
  label: string;
  onContextMenu: (event: MouseEvent, entry: GitStatusEntry, scope: "staged" | "unstaged", group: GitSelectionGroup) => void;
  onOpenFile: (relativePath: string) => void;
  pendingFilePaths: string[];
  scope: "staged" | "unstaged";
  empty: string;
}) {
  return (
    <section className="git-group" aria-labelledby={`git-group-${label}`}>
      <div className="git-section-heading">
        <div className="git-group-title"><span className="panel-kicker">{label.toUpperCase()}</span><span>{entries.length}</span></div>
        {entries.length > 0 ? (
          <div className="git-group-actions">
            <button
              className="editor-quiet-button git-group-action"
              disabled={controller.busy}
              onClick={() => controller.toggleEntriesSelected(entries.map((entry) => entry.entryId), entries.map((entry) => selectionKey(group, entry.entryId)))}
              type="button"
            >
              {entries.every((entry) => controller.selectedKeys.includes(selectionKey(group, entry.entryId))) ? "Unselect all" : "Select all"}
            </button>
            {scope === "staged" ? (
              <button className="editor-quiet-button git-group-action" disabled={controller.busy || !entries.some(canUnstageEntry)} onClick={() => void controller.unstageEntries(entries.filter(canUnstageEntry).map((entry) => entry.entryId))} type="button">Unstage all</button>
            ) : (
              <button className="editor-quiet-button git-group-action" disabled={controller.busy || !entries.some(canStageEntry)} onClick={() => void controller.stageEntries(entries.filter(canStageEntry).map((entry) => entry.entryId))} type="button">Stage all</button>
            )}
          </div>
        ) : null}
      </div>
      <div className="git-entry-list" id={`git-group-${label}`}>
        {entries.length === 0 ? <span className="git-empty">{empty}</span> : entries.map((entry) => (
          <div className={`git-entry git-entry-${gitFileTone(entry)}${pendingFilePaths.includes(entry.currentPath) ? " git-entry-pending" : ""}`} key={`${group}-${entry.entryId}`} onContextMenu={(event) => onContextMenu(event, entry, scope, group)}>
            <label className="git-entry-select">
              <input checked={controller.selectedKeys.includes(selectionKey(group, entry.entryId))} id={`git-entry-${group}-${entry.entryId}`} name={`gitSelectedEntries-${group}`} onChange={() => controller.toggleSelected(entry.entryId, selectionKey(group, entry.entryId))} type="checkbox" />
              <span className={`git-status-letter git-status-${entry.indexStatus === "?" ? "untracked" : entry.worktreeStatus !== " " ? entry.worktreeStatus : entry.indexStatus}`}>{entry.indexStatus === "?" ? "?" : scope === "staged" ? entry.indexStatus : entry.worktreeStatus}</span>
              <span className="git-entry-path" title={entry.originalPath ? `${entry.originalPath} → ${entry.currentPath}` : entry.currentPath}>{entry.originalPath ? `${entry.originalPath} → ${entry.currentPath}` : entry.currentPath}</span>
            </label>
            <div className="git-entry-actions">
              {entry.indexStatus !== "D" && entry.worktreeStatus !== "D" ? <button aria-label={`Open ${entry.currentPath}`} className="editor-quiet-button git-review-button" onClick={() => onOpenFile(entry.currentPath)} type="button">Open</button> : null}
              <button aria-label={`Review ${entry.currentPath}`} className="editor-quiet-button git-review-button" onClick={() => void controller.review(entry, scope)} type="button">Review</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
