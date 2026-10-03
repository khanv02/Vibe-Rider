import { useState, type FormEvent } from "react";
import type { EditorPanelSize } from "../panels/types";
import type { WorkspaceDescriptor } from "../workspace/types";
import type { GitStatusEntry } from "../git/types";
import { isTauriRuntime } from "../git/gitApi";
import type { WorkspaceGitController } from "../git/useWorkspaceGit";
import { SharedDiffViewer } from "./SharedDiffViewer";

interface GitPanelProps {
  controller: WorkspaceGitController;
  expanded: boolean;
  onExpandedChange: (size: EditorPanelSize) => void;
  workspace: WorkspaceDescriptor | null;
  onOpenFile: (relativePath: string) => void;
}

interface UpstreamTarget {
  remote: string;
  branch: string;
  ref: string;
}

type GitGroupsLayout = "stacked" | "columns";

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

export function GitPanel({ controller, expanded, onExpandedChange, onOpenFile, workspace }: GitPanelProps) {
  const [groupsLayout, setGroupsLayout] = useState<GitGroupsLayout>("stacked");
  const [newBranchName, setNewBranchName] = useState("");
  const { status } = controller;
  if (!workspace) {
    return (
      <div className="tool-placeholder">
        <div className="tool-placeholder-icon" aria-hidden="true">⌘</div>
        <h3>Chưa mở workspace</h3>
        <p>Mở một folder local để Git kiểm tra repository ở đúng workspace root.</p>
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

  if (!status && controller.loading) return <div className="git-state">Đang đọc Git status…</div>;

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
  const remoteLabel = remoteProvider ? `${status?.remote?.host ?? "Remote"} · auth checked on Push` : "No remote detected";

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
              aria-pressed={!expanded}
              className={!expanded ? "size-button size-button-active" : "size-button"}
              onClick={() => onExpandedChange("normal")}
              type="button"
            >Normal</button>
            <button
              aria-pressed={expanded}
              className={expanded ? "size-button size-button-active" : "size-button"}
              onClick={() => onExpandedChange("expanded")}
              type="button"
            >Expanded</button>
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
                ? "Switch branch yêu cầu working tree sạch; hãy commit hoặc stash thay đổi trước."
                : "Branch mới được tạo từ commit hiện tại."
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
            <details className="git-options">
              <summary>Optional actions</summary>
              <div className="git-options-menu">
                <button className="editor-quiet-button" disabled={controller.busy || !canRestoreSelection} onClick={() => void controller.restore()} title={canRestoreSelection ? "Restore tracked disk content from the index" : "Restore only tracked regular files with unstaged changes"} type="button">Restore working tree</button>
                {controller.selectedIds.length > 0 ? <button className="editor-quiet-button" onClick={controller.clearSelection} type="button">Clear selection</button> : null}
                <button className="editor-quiet-button" disabled={controller.loading || controller.busy} onClick={() => void controller.refresh()} type="button">Refresh status</button>
              </div>
              <p>Restore bỏ thay đổi đã lưu trên disk về nội dung trong Index; untracked, rename và conflict không được phép.</p>
            </details>
          </div>
          <p className="git-selection-note">{controller.selectedIds.length === 0 ? "Chọn file để bật action phù hợp." : `${controller.selectedIds.length} file selected · action chỉ áp dụng cho đúng trạng thái đã chọn.`}</p>
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
                  <span>{controller.diff.unsupportedReason ?? "Binary diff chỉ hiển thị metadata."}</span>
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
                <button aria-pressed={groupsLayout === "columns"} className={groupsLayout === "columns" ? "size-button size-button-active" : "size-button"} onClick={() => setGroupsLayout("columns")} type="button">3 columns</button>
              </div>
            </div>
            <div className={`git-groups${groupsLayout === "columns" ? " git-groups-columns" : ""}`}>
              <GitGroup controller={controller} entries={staged} label="Staged Changes" onOpenFile={onOpenFile} scope="staged" empty="No staged changes" />
              <GitGroup controller={controller} entries={changes} label="Changes" onOpenFile={onOpenFile} scope="unstaged" empty="No unstaged changes" />
              <GitGroup controller={controller} entries={untracked} label="Untracked" onOpenFile={onOpenFile} scope="unstaged" empty="No untracked files" />
            </div>
          </section>

          <section className="git-commit-box" aria-labelledby="git-commit-title">
            <div className="git-section-heading"><span className="panel-kicker">REVIEWED INDEX</span><h3 id="git-commit-title">Commit</h3></div>
            <textarea aria-label="Commit message" disabled={controller.busy} onChange={(event) => controller.setCommitMessage(event.target.value)} placeholder="Commit message" value={controller.commitMessage} />
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
              <div><span>Authentication</span><code>{controller.authVerified ? "Verified after successful Push" : "Checked when Push runs"}</code></div>
            </div>
          </details>
        </>
      ) : (
        <div className="git-state">{controller.feedback?.kind === "error" ? "Git status không khả dụng." : "Chưa có Git status."}</div>
      )}
    </div>
  );
}

function GitGroup({
  controller,
  entries,
  label,
  onOpenFile,
  scope,
  empty,
}: {
  controller: WorkspaceGitController;
  entries: GitStatusEntry[];
  label: string;
  onOpenFile: (relativePath: string) => void;
  scope: "staged" | "unstaged";
  empty: string;
}) {
  return (
    <section className="git-group" aria-labelledby={`git-group-${label}`}>
      <div className="git-section-heading">
        <div className="git-group-title"><span className="panel-kicker">{label.toUpperCase()}</span><span>{entries.length}</span></div>
        {entries.length > 0 ? (
          scope === "staged" ? (
            <button className="editor-quiet-button git-group-action" disabled={controller.busy || !entries.some(canUnstageEntry)} onClick={() => void controller.unstageEntries(entries.filter(canUnstageEntry).map((entry) => entry.entryId))} type="button">Unstage all</button>
          ) : (
            <button className="editor-quiet-button git-group-action" disabled={controller.busy || !entries.some(canStageEntry)} onClick={() => void controller.stageEntries(entries.filter(canStageEntry).map((entry) => entry.entryId))} type="button">Stage all</button>
          )
        ) : null}
      </div>
      <div className="git-entry-list" id={`git-group-${label}`}>
        {entries.length === 0 ? <span className="git-empty">{empty}</span> : entries.map((entry) => (
          <div className="git-entry" key={`${scope}-${entry.entryId}`}>
            <label className="git-entry-select">
              <input checked={controller.selectedIds.includes(entry.entryId)} onChange={() => controller.toggleSelected(entry.entryId)} type="checkbox" />
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
