import { invoke } from "@tauri-apps/api/core";
import type { CommandProposal, CommandRunResult } from "./types";

export function proposeCommand(
  workspaceId: string,
  executable: string,
  args: string[],
  cwd = "",
  timeoutMs = 120_000,
  source = "verification-ui",
): Promise<CommandProposal> {
  return invoke<CommandProposal>("command_propose", {
    request: { workspaceId, executable, args, cwd, timeoutMs, source },
  });
}

export function runCommand(workspaceId: string, proposalId: string, runId: string): Promise<CommandRunResult> {
  return invoke<CommandRunResult>("command_run", {
    request: { workspaceId, proposalId, runId },
  });
}

export function cancelCommand(workspaceId: string, runId: string): Promise<boolean> {
  return invoke<boolean>("command_cancel", {
    request: { workspaceId, runId },
  });
}
