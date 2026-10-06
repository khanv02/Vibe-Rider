export interface GitHubSession {
  githubUserId: number;
  login: string;
  displayName: string | null;
  avatarUrl: string;
  expiresAt: number | null;
  lastValidatedAt: number;
}

export interface GitHubDeviceChallenge {
  flowId: string;
  verificationUri: string;
  userCode: string;
  expiresAt: number;
  pollIntervalSeconds: number;
}

export type GitHubAuthPollResult =
  | { status: "pending"; nextPollIntervalSeconds: number }
  | { status: "slowDown"; nextPollIntervalSeconds: number }
  | { status: "verified"; session: GitHubSession };

export interface GitHubAuthError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface WorkspaceGitHubAuthController {
  session: GitHubSession | null;
  canAuthenticate: boolean;
  challenge: GitHubDeviceChallenge | null;
  dialogOpen: boolean;
  status: "idle" | "loading" | "waiting" | "success" | "error";
  error: string | null;
  begin: () => Promise<void>;
  openVerification: () => Promise<void>;
  cancel: () => Promise<void>;
  logout: () => Promise<void>;
  copyUserCode: () => Promise<boolean>;
}
