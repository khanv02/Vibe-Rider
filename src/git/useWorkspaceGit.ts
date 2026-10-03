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
  const message = typeof error.message === "string" ? error.message : String(reason);
  const guidance: Record<string, string> = {
    AUTH_REQUIRED: "Hãy đăng nhập qua SSH/Git Credential Manager rồi thử Push lại. App không lưu password/token.",
    MISSING_USER_IDENTITY: "Cấu hình git config user.name và git config user.email trước khi Commit.",
    PERMISSION_DENIED: "Kiểm tra quyền file/repository và credential của remote.",
    HOOK_FAILED: "Đọc output của Git hook trong thông báo, sửa lỗi rồi thử Commit lại.",
    INDEX_LOCKED: "Đảm bảo không còn Git process khác chạy; sau đó Refresh status rồi thử lại.",
    PUSH_REJECTED: "Remote đã có thay đổi; Pull/rebase thủ công trong terminal rồi Refresh trước khi Push.",
    STALE_STATUS: "Repository đã thay đổi; Refresh status và review lại file trước khi thử lại.",
    NOTHING_STAGED: "Chọn file rồi Stage trước khi Commit.",
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

  const runMutation = useCallback(async (task: () => Promise<unknown>, operation: string) => {
    if (busy) return;
    setBusy(true);
    setOperation(null);
    setFeedback({ kind: "info", code: "RUNNING", operation, message: `${operation} đang chạy…`, guidance: null });
    try {
      await task();
      setSelected(new Set());
      await refresh();
      if (operation === "Push") setAuthVerified(true);
      setFeedback({ kind: "success", code: "OK", operation, message: `${operation} thành công.`, guidance: null });
    } catch (reason) {
      setFeedback(feedbackFrom(reason, operation));
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
      const confirmed = window.confirm("Restore sẽ bỏ các thay đổi đã lưu trên disk về nội dung trong Index. Draft chưa Save của Editor không bị tự động ghi đè. Tiếp tục?");
      if (!confirmed) return;
      await runMutation(() => restoreGitEntries(currentWorkspace.id, currentEntries.map((entry) => ({ entryId: entry.entryId, restoreToken: entry.restoreToken })), currentStatus.statusToken, "worktree"), "Restore");
    })();
  }, [prepareRestore, refresh, runMutation, selected, selectedEntries.length, status, workspace]);

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
      setFeedback({ kind: "info", code: "CANCEL_REQUESTED", operation: operation.operation, message: "Đã gửi yêu cầu huỷ; đang chờ process kết thúc an toàn.", guidance: null });
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
