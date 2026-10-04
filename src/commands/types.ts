export type CommandOutcome = "success" | "failed" | "cancelled" | "timedOut" | "outputLimit" | "spawnFailed";

export interface CommandProposal {
  proposalId: string;
  workspaceId: string;
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  source?: string;
  state: "pending" | "running" | "finished" | "cancelled";
  createdAt: number;
}

export interface CommandRunResult {
  runId: string;
  proposalId: string;
  outcome: CommandOutcome;
  exitCode?: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
}
