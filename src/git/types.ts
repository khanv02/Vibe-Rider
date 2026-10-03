export interface GitOperationInfo {
  operationId: string;
  workspaceId: string;
  operation: string;
  mutation: boolean;
  cancellationRequested: boolean;
}

export interface GitError {
  code: string;
  operation: string;
  message: string;
  exitCode?: number | null;
}

export interface GitIdentity {
  name: string | null;
  email: string | null;
}

export type GitRemoteProvider = "github" | "gitlab" | "bitbucket" | "other";

export interface GitRemoteInfo {
  name: string;
  host: string | null;
  provider: GitRemoteProvider;
  repositoryUrl: string | null;
}

export interface GitBranch {
  head: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
}

export interface GitBranchInfo {
  name: string;
  upstream: string | null;
  current: boolean;
}

export interface GitStatusEntry {
  entryId: string;
  currentPath: string;
  originalPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  kind: "tracked" | "rename" | "conflict" | "untracked" | string;
  conflict: boolean;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  restoreToken: string;
}

export interface GitStatus {
  workspaceId: string;
  repositoryId: string;
  requestId: string | null;
  statusToken: string;
  branch: GitBranch;
  localBranches: GitBranchInfo[];
  remoteBranches: string[];
  identity: GitIdentity;
  remote: GitRemoteInfo | null;
  entries: GitStatusEntry[];
}

export interface GitDiffSnapshot {
  workspaceId: string;
  repositoryId: string;
  previewId: string;
  entryId: string;
  scope: "staged" | "unstaged";
  relativePath: string;
  originalPath: string | null;
  original: string;
  modified: string;
  originalLabel: string;
  modifiedLabel: string;
  originalBytes: number;
  modifiedBytes: number;
  binary: boolean;
  unsupportedReason: string | null;
}

export interface GitMutationResult {
  operationId: string;
  affectedPaths: string[];
  commitId: string | null;
  target: string | null;
}
