import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceDescriptor } from "../workspace/types";
import type { WorkspaceActivityController } from "../activity/useWorkspaceActivity";
import { cancelCommand, proposeCommand, runCommand } from "./commandApi";
import type { CommandProposal, CommandRunResult } from "./types";

export interface VerificationPreset {
  id: "npm-test" | "npm-build" | "cargo-check" | "cargo-test";
  label: string;
  executable: string;
  args: string[];
  cwd: string;
}

export const verificationPresets: VerificationPreset[] = [
  { id: "npm-test", label: "npm test", executable: "npm.cmd", args: ["run", "test"], cwd: "" },
  { id: "npm-build", label: "npm run build", executable: "npm.cmd", args: ["run", "build"], cwd: "" },
  { id: "cargo-check", label: "cargo check", executable: "cargo.exe", args: ["check", "--manifest-path", "Cargo.toml"], cwd: "src-tauri" },
  { id: "cargo-test", label: "cargo test", executable: "cargo.exe", args: ["test", "--manifest-path", "Cargo.toml"], cwd: "src-tauri" },
];

export interface WorkspaceCommandsController {
  proposal: CommandProposal | null;
  result: CommandRunResult | null;
  busy: boolean;
  error: string | null;
  propose: (preset: VerificationPreset) => Promise<void>;
  run: () => Promise<void>;
  cancel: () => Promise<void>;
  clear: () => void;
}

function messageFor(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function useWorkspaceCommands(
  workspace: WorkspaceDescriptor | null,
  activity: WorkspaceActivityController,
): WorkspaceCommandsController {
  const [proposal, setProposal] = useState<CommandProposal | null>(null);
  const [result, setResult] = useState<CommandRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const runIdRef = useRef<string | null>(null);

  useEffect(() => {
    setProposal(null);
    setResult(null);
    setError(null);
    runIdRef.current = null;
  }, [workspace?.id]);

  const propose = useCallback(async (preset: VerificationPreset) => {
    const target = workspaceRef.current;
    if (!target) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const next = await proposeCommand(target.id, preset.executable, preset.args, preset.cwd);
      setProposal(next);
      await activity.record("command", `Prepared ${preset.label}`, `${preset.executable} ${preset.args.join(" ")}`);
    } catch (proposeError) {
      setError(messageFor(proposeError));
    } finally {
      setBusy(false);
    }
  }, [activity]);

  const run = useCallback(async () => {
    const target = workspaceRef.current;
    const next = proposal;
    if (!target || !next || busy) return;
    setBusy(true);
    setError(null);
    setProposal({ ...next, state: "running" });
    try {
      const runId = `ui-run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      runIdRef.current = runId;
      const runResult = await runCommand(target.id, next.proposalId, runId);
      setResult(runResult);
      await activity.record("command", `${next.executable} finished: ${runResult.outcome}`, trimOutput(runResult));
    } catch (runError) {
      setError(messageFor(runError));
      setProposal(next);
    } finally {
      setBusy(false);
    }
  }, [activity, busy, proposal]);

  const cancel = useCallback(async () => {
    const target = workspaceRef.current;
    const runId = runIdRef.current;
    if (!target || !runId) return;
    try {
      await cancelCommand(target.id, runId);
    } catch (cancelError) {
      setError(messageFor(cancelError));
    }
  }, []);

  const clear = useCallback(() => {
    setProposal(null);
    setResult(null);
    setError(null);
    runIdRef.current = null;
  }, []);

  return { proposal, result, busy, error, propose, run, cancel, clear };
}

function trimOutput(result: CommandRunResult): string {
  const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return combined.length > 2000 ? `${combined.slice(0, 2000)}\n… output truncated in Activity Log` : combined;
}
