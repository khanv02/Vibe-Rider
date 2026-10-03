import { invoke } from "@tauri-apps/api/core";
import type {
  GitDiffSnapshot,
  GitMutationResult,
  GitOperationInfo,
  GitStatus,
} from "./types";

export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export function getGitStatus(
  workspaceId: string,
  requestId: string,
): Promise<GitStatus> {
  return invoke<GitStatus>("git_status", { request: { workspaceId, requestId } });
}

export function getGitDiff(
  workspaceId: string,
  entryId: string,
  scope: "staged" | "unstaged",
  statusToken: string,
): Promise<GitDiffSnapshot> {
  return invoke<GitDiffSnapshot>("git_diff", { request: { workspaceId, entryId, scope, statusToken } });
}

export function stageGitEntries(workspaceId: string, entryIds: string[], statusToken: string): Promise<GitMutationResult> {
  return invoke<GitMutationResult>("git_add", { request: { workspaceId, entryIds, statusToken } });
}

export function restoreGitEntries(
  workspaceId: string,
  selections: Array<{ entryId: string; restoreToken?: string }>,
  statusToken: string,
  mode: "unstage" | "worktree",
): Promise<GitMutationResult> {
  return invoke<GitMutationResult>("git_restore", { request: { workspaceId, selections, statusToken, mode } });
}

export function commitGit(workspaceId: string, message: string, statusToken: string): Promise<GitMutationResult> {
  return invoke<GitMutationResult>("git_commit", { request: { workspaceId, message, statusToken } });
}

export function pushGit(workspaceId: string, statusToken: string): Promise<GitMutationResult> {
  return invoke<GitMutationResult>("git_push", { request: { workspaceId, statusToken } });
}

export function listGitOperations(workspaceId: string): Promise<GitOperationInfo[]> {
  if (!isTauriRuntime()) return Promise.resolve([]);
  return invoke<GitOperationInfo[]>("git_operations", { request: { workspaceId } });
}

export function cancelGitOperation(workspaceId: string, operationId: string): Promise<boolean> {
  return invoke<boolean>("git_cancel", { request: { workspaceId, operationId } });
}

export async function waitForGitIdle(
  workspaceId: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 120;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await listGitOperations(workspaceId)).length === 0) return true;
    await new Promise<void>((resolve) => window.setTimeout(resolve, pollMs));
  }
  return (await listGitOperations(workspaceId)).length === 0;
}
