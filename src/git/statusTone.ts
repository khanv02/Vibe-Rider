import type { GitStatusEntry } from "./types";

export type GitFileTone = "clean" | "worktree" | "staged" | "conflict";

export function gitFileTone(entry: GitStatusEntry): GitFileTone {
  if (entry.conflict) return "conflict";
  if (entry.unstaged || entry.untracked) return "worktree";
  if (entry.staged) return "staged";
  return "clean";
}

export function gitToneForPath(relativePath: string, entries: GitStatusEntry[]): GitFileTone {
  const exact = entries.find((entry) => entry.currentPath === relativePath);
  if (exact) return gitFileTone(exact);

  const prefix = relativePath ? `${relativePath}/` : "";
  const descendants = entries.filter((entry) => entry.currentPath.startsWith(prefix));
  if (descendants.some((entry) => gitFileTone(entry) === "conflict")) return "conflict";
  if (descendants.some((entry) => gitFileTone(entry) === "worktree")) return "worktree";
  if (descendants.some((entry) => gitFileTone(entry) === "staged")) return "staged";
  return "clean";
}
