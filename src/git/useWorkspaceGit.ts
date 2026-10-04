import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceDescriptor } from "../workspace/types";
import {
  commitGit,
  createGitBranch,
  getGitDiff,
  getGitStatus,
  isTauriRuntime,
  cancelGitOperation,
  listGitOperations,
  pushGit,
  restoreGitEntries,
  stageGitEntries,
  switchGitBranch,
} from "./gitApi";
import type { GitDiffSnapshot, GitError, GitOperationInfo, GitStatus, GitStatusEntry } from "./types";

export interface GitFeedback {
  kind: "info" | "success" | "error";
  code: string;
  operation: string;
  message: string;
  guidance: string | null;
}

export interface WorkspaceGitController {
  status: GitStatus | null;
  diff: GitDiffSnapshot | null;
  selectedIds: string[];
  busy: boolean;
  operation: GitOperationInfo | null;
  loading: boolean;
  feedback: GitFeedback | null;
  authVerified: boolean;
  commitMessage: string;
  setCommitMessage: (message: string) => void;
  refresh: () => Promise<void>;
  toggleSelected: (entryId: string) => void;
  toggleEntriesSelected: (entryIds: string[]) => void;
  clearSelection: () => void;
  review: (entry: GitStatusEntry, scope: "staged" | "unstaged") => Promise<void>;
  closeDiff: () => void;
  stageEntries: (entryIds: string[]) => Promise<void>;
  stage: () => Promise<void>;
  unstageEntries: (entryIds: string[]) => Promise<void>;
  unstage: () => Promise<void>;
  restore: () => Promise<void>;
  commit: () => Promise<void>;
  push: () => Promise<void>;
  createBranch: (branchName: string) => Promise<void>;
  switchBranch: (branchName: string) => Promise<void>;
  cancel: () => Promise<void>;
  dismissFeedback: () => void;
}

function feedbackFrom(reason: unknown, operation: string): GitFeedback {
  const error = typeof reason === "object" && reason !== null
    ? reason as Partial<GitError>
    : {};
  const code = typeof error.code === "string" ? error.code : "GIT_FAILED";
  const messages: Record<string, string> = {
    NO_WORKSPACE: "Open a workspace before using Git.",
    STALE_WORKSPACE: "The workspace changed while Git was running.",
    GIT_NOT_FOUND: "Git was not found in PATH. Install Git and restart the app.",
    NO_REPOSITORY: "The workspace is not a Git repository.",
    REPOSITORY_INVALID: "The Git repository is not supported or is invalid.",
    GIT_BUSY: "Another Git operation is already running.",
    GIT_CANCELLED: "The Git operation was cancelled.",
    GIT_IO_ERROR: "Git could not read or write the process stream.",
    GIT_WORKER_FAILED: "The Git worker failed unexpectedly.",
    INVALID_PATH: "The selected Git path is invalid.",
    OUTSIDE_WORKSPACE: "The selected path is outside the workspace.",
    STALE_STATUS: "The repository changed before the operation completed.",
    FILE_CONFLICT: "The file changed on disk. Review it again before retrying.",
    NOTHING_STAGED: "Select files and Stage them before Commit.",
    CONFLICT: "Resolve repository conflicts in the terminal before continuing.",
    INDEX_LOCKED: "The Git index is locked. Close other Git processes and try again.",
    INVALID_MODE: "The selected Git operation mode is invalid.",
    INVALID_BRANCH: "The branch name is invalid.",
    UPSTREAM_REQUIRED: "Configure an upstream branch before Push.",
  };
  const message = messages[code] ?? "The Git operation failed. Check the operation and try again.";
  const guidance: Record<string, string> = {
    AUTH_REQUIRED: "Sign in through SSH or Git Credential Manager, then try Push again. The app does not store passwords or tokens.",
    MISSING_USER_IDENTITY: "Configure git config user.name and git config user.email before Commit.",
    PERMISSION_DENIED: "Check file/repository permissions and the remote credentials.",
    HOOK_FAILED: "Read the Git hook output, fix the issue, then try Commit again.",
    INDEX_LOCKED: "Make sure no other Git process is running, then Refresh status and try again.",
    PUSH_REJECTED: "The remote has changed. Pull or rebase manually in the terminal, then Refresh before Push.",
    STALE_STATUS: "The repository changed. Refresh status and review the files again before retrying.",
    NOTHING_STAGED: "Select files and Stage them before Commit.",
  };
  return {
    kind: "error",
    code,
    operation: typeof error.operation === "string" ? error.operation : operation,
    message,
    guidance: guidance[code] ?? null,
  };
}

export function useWorkspaceGit(
  workspace: WorkspaceDescriptor | null,
  prepareRestore?: () => Promise<boolean>,
  captureFileOperation?: (relativePaths: string[], kind: "delete" | "restore") => void,
  completeFileOperation?: (success: boolean) => void,
): WorkspaceGitController {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState<GitDiffSnapshot | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<GitOperationInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<GitFeedback | null>(null);
  const [authVerified, setAuthVerified] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const requestNumber = useRef(0);
  const refreshPromise = useRef<Promise<void> | null>(null);
  const workspaceRef = useRef(workspace);
  const statusRef = useRef<GitStatus | null>(status);
  workspaceRef.current = workspace;
  statusRef.current = status;

  const refresh = useCallback(async () => {
    const current = workspaceRef.current;
    if (!current || !isTauriRuntime()) {
      setStatus(null);
      statusRef.current = null;
      return;
    }
    if (refreshPromise.current) return refreshPromise.current;
    const requestId = `${current.id}:${++requestNumber.current}`;
    setLoading(true);
    const request = getGitStatus(current.id, requestId)
      .then((next) => {
        if (workspaceRef.current?.id !== current.id || next.requestId !== requestId) return;
        statusRef.current = next;
        setStatus(next);
        setSelected((previous) => new Set([...previous].filter((id) => next.entries.some((entry) => entry.entryId === id))));
      })
      .catch((reason) => {
        if (workspaceRef.current?.id === current.id) setFeedback(feedbackFrom(reason, "status"));
      })
      .finally(() => {
        if (workspaceRef.current?.id === current.id) setLoading(false);
        refreshPromise.current = null;
      });
    refreshPromise.current = request;
    return request;
  }, []);

  useEffect(() => {
    setStatus(null);
    setDiff(null);
    setSelected(new Set());
    setCommitMessage("");
    setFeedback(null);
    setAuthVerified(false);
    if (!workspace) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, workspace?.id]);

  useEffect(() => {
    if (!busy || !workspace || !isTauriRuntime()) {
      if (!busy) setOperation(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const operations = await listGitOperations(workspace.id);
        if (!cancelled) setOperation(operations.find((item) => item.mutation) ?? operations[0] ?? null);
      } catch (reason) {
        if (!cancelled) setFeedback(feedbackFrom(reason, "operation"));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 180);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [busy, workspace]);

  const toggleSelected = useCallback((entryId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }, []);

  const toggleEntriesSelected = useCallback((entryIds: string[]) => {
    setSelected((previous) => {
      const next = new Set(previous);
      const allSelected = entryIds.length > 0 && entryIds.every((entryId) => next.has(entryId));
      entryIds.forEach((entryId) => {
        if (allSelected) next.delete(entryId);
        else next.add(entryId);
      });
      return next;
    });
  }, []);

  const runMutation = useCallback(async (task: () => Promise<unknown>, operation: string) => {
    if (busy) return false;
    setBusy(true);
    setOperation(null);
    setFeedback({ kind: "info", code: "RUNNING", operation, message: `${operation} is running…`, guidance: null });
    try {
      await task();
      setSelected(new Set());
      await refresh();
      if (operation === "Push") setAuthVerified(true);
      setFeedback({ kind: "success", code: "OK", operation, message: `${operation} completed successfully.`, guidance: null });
      return true;
    } catch (reason) {
      setFeedback(feedbackFrom(reason, operation));
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const selectedEntries = useMemo(
    () => status?.entries.filter((entry) => selected.has(entry.entryId)) ?? [],
    [selected, status],
  );

  const stageEntries = useCallback((entryIds: string[]) => {
    if (!status || !workspace || entryIds.length === 0) return Promise.resolve();
    return runMutation(() => stageGitEntries(workspace.id, entryIds, status.statusToken), "Stage");
  }, [runMutation, status, workspace]);

  const unstageEntries = useCallback((entryIds: string[]) => {
    if (!status || !workspace || entryIds.length === 0) return Promise.resolve();
    return runMutation(() => restoreGitEntries(workspace.id, entryIds.map((entryId) => ({ entryId })), status.statusToken, "unstage"), "Unstage");
  }, [runMutation, status, workspace]);

  const review = useCallback(async (entry: GitStatusEntry, scope: "staged" | "unstaged") => {
    if (!status || !workspace) return;
    try {
      setDiff(await getGitDiff(workspace.id, entry.entryId, scope, status.statusToken));
    } catch (reason) {
      setFeedback(feedbackFrom(reason, "Review diff"));
    }
  }, [status, workspace]);

  const stage = useCallback(() => {
    return stageEntries(selectedIds);
  }, [selectedIds, stageEntries]);

  const unstage = useCallback(() => {
    return unstageEntries(selectedIds);
  }, [selectedIds, unstageEntries]);

  const restore = useCallback(() => {
    if (!status || !workspace || selectedEntries.length === 0) return Promise.resolve();
    return (async () => {
      if (prepareRestore && !(await prepareRestore())) return;
      await refresh();
      const currentStatus = statusRef.current;
      const currentWorkspace = workspaceRef.current;
      if (!currentStatus || !currentWorkspace) return;
      const currentEntries = currentStatus.entries.filter((entry) => selected.has(entry.entryId));
      if (currentEntries.length === 0) return;
      const confirmed = window.confirm("Restore will replace saved disk changes with the content from the Index. Unsaved Editor drafts will not be overwritten automatically. Continue?");
      if (!confirmed) return;
      captureFileOperation?.(currentEntries.map((entry) => entry.currentPath), "restore");
      const success = await runMutation(() => restoreGitEntries(currentWorkspace.id, currentEntries.map((entry) => ({ entryId: entry.entryId, restoreToken: entry.restoreToken })), currentStatus.statusToken, "worktree"), "Restore");
      completeFileOperation?.(success);
    })();
  }, [captureFileOperation, completeFileOperation, prepareRestore, refresh, runMutation, selected, selectedEntries.length, status, workspace]);

  const commit = useCallback(() => {
    if (!status || !workspace || !commitMessage.trim()) return Promise.resolve();
    return runMutation(() => commitGit(workspace.id, commitMessage, status.statusToken).then((result) => {
      setCommitMessage("");
      return result;
    }), "Commit");
  }, [commitMessage, runMutation, status, workspace]);

  const push = useCallback(() => {
    if (!status || !workspace) return Promise.resolve();
    return runMutation(() => pushGit(workspace.id, status.statusToken), "Push");
  }, [runMutation, status, workspace]);

  const createBranch = useCallback((branchName: string) => {
    if (!status || !workspace) return Promise.resolve();
    return runMutation(
      () => createGitBranch(workspace.id, branchName.trim(), status.statusToken),
      "Create branch",
    );
  }, [runMutation, status, workspace]);

  const switchBranch = useCallback((branchName: string) => {
    if (!status || !workspace) return Promise.resolve();
    return runMutation(
      () => switchGitBranch(workspace.id, branchName, status.statusToken),
      "Switch branch",
    );
  }, [runMutation, status, workspace]);

  const cancel = useCallback(async () => {
    if (!workspace || !operation) return;
    try {
      await cancelGitOperation(workspace.id, operation.operationId);
      setFeedback({ kind: "info", code: "CANCEL_REQUESTED", operation: operation.operation, message: "Cancellation requested; waiting for the process to exit safely.", guidance: null });
    } catch (reason) {
      setFeedback(feedbackFrom(reason, "Cancel"));
    }
  }, [operation, workspace]);

  return {
    status,
    diff,
    selectedIds,
    busy,
    operation,
    loading,
    feedback,
    authVerified,
    commitMessage,
    setCommitMessage,
    refresh,
    toggleSelected,
    toggleEntriesSelected,
    clearSelection: () => setSelected(new Set()),
    review,
    closeDiff: () => setDiff(null),
    stageEntries,
    stage,
    unstageEntries,
    unstage,
    restore,
    commit,
    push,
    createBranch,
    switchBranch,
    cancel,
    dismissFeedback: () => setFeedback(null),
  };
}
