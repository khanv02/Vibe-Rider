import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceDescriptor } from "../workspace/types";
import { formatWorkspaceError } from "../workspace/workspaceApi";
import {
  commitGit,
  getGitDiff,
  getGitStatus,
  isTauriRuntime,
  cancelGitOperation,
  listGitOperations,
  pushGit,
  restoreGitEntries,
  stageGitEntries,
} from "./gitApi";
import type { GitDiffSnapshot, GitOperationInfo, GitStatus, GitStatusEntry } from "./types";

export interface WorkspaceGitController {
  status: GitStatus | null;
  diff: GitDiffSnapshot | null;
  selectedIds: string[];
  busy: boolean;
  operation: GitOperationInfo | null;
  loading: boolean;
  error: string | null;
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
  cancel: () => Promise<void>;
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
  const [error, setError] = useState<string | null>(null);
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
        setError(null);
        setSelected((previous) => new Set([...previous].filter((id) => next.entries.some((entry) => entry.entryId === id))));
      })
      .catch((reason) => {
        if (workspaceRef.current?.id === current.id) setError(formatWorkspaceError(reason));
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
    setError(null);
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
        if (!cancelled) setError(formatWorkspaceError(reason));
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

  const runMutation = useCallback(async (task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setOperation(null);
    try {
      await task();
      setSelected(new Set());
      await refresh();
    } catch (reason) {
      setError(formatWorkspaceError(reason));
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
    return runMutation(() => stageGitEntries(workspace.id, entryIds, status.statusToken));
  }, [runMutation, status, workspace]);

  const unstageEntries = useCallback((entryIds: string[]) => {
    if (!status || !workspace || entryIds.length === 0) return Promise.resolve();
    return runMutation(() => restoreGitEntries(workspace.id, entryIds.map((entryId) => ({ entryId })), status.statusToken, "unstage"));
  }, [runMutation, status, workspace]);

  const review = useCallback(async (entry: GitStatusEntry, scope: "staged" | "unstaged") => {
    if (!status || !workspace) return;
    try {
      setError(null);
      setDiff(await getGitDiff(workspace.id, entry.entryId, scope, status.statusToken));
    } catch (reason) {
      setError(formatWorkspaceError(reason));
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
      await runMutation(() => restoreGitEntries(currentWorkspace.id, currentEntries.map((entry) => ({ entryId: entry.entryId, restoreToken: entry.restoreToken })), currentStatus.statusToken, "worktree"));
    })();
  }, [prepareRestore, refresh, runMutation, selected, selectedEntries.length, status, workspace]);

  const commit = useCallback(() => {
    if (!status || !workspace || !commitMessage.trim()) return Promise.resolve();
    return runMutation(() => commitGit(workspace.id, commitMessage, status.statusToken).then((result) => {
      setCommitMessage("");
      return result;
    }));
  }, [commitMessage, runMutation, status, workspace]);

  const push = useCallback(() => {
    if (!status || !workspace) return Promise.resolve();
    return runMutation(() => pushGit(workspace.id, status.statusToken));
  }, [runMutation, status, workspace]);

  const cancel = useCallback(async () => {
    if (!workspace || !operation) return;
    try {
      await cancelGitOperation(workspace.id, operation.operationId);
      setError("Đã gửi yêu cầu huỷ Git operation; đang chờ process kết thúc an toàn.");
    } catch (reason) {
      setError(formatWorkspaceError(reason));
    }
  }, [operation, workspace]);

  return {
    status,
    diff,
    selectedIds,
    busy,
    operation,
    loading,
    error,
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
    cancel,
  };
}
