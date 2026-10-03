import { Channel, invoke } from "@tauri-apps/api/core";
import type { TerminalError, TerminalEvent, TerminalPaneId, TerminalSession } from "./types";

interface SpawnTerminalRequest {
  workspaceId: string;
  paneId: TerminalPaneId;
  rows: number;
  cols: number;
}

export function spawnTerminal(
  request: SpawnTerminalRequest,
  onEvent: (event: TerminalEvent) => void,
): Promise<TerminalSession> {
  const channel = new Channel<TerminalEvent>();
  channel.onmessage = onEvent;
  return invoke<TerminalSession>("terminal_spawn", { request, onEvent: channel });
}

export function closeTerminal(sessionId: string): Promise<void> {
  return invoke<void>("terminal_close", { sessionId });
}

export function listTerminals(workspaceId: string): Promise<unknown[]> {
  return invoke<unknown[]>("terminal_list", { workspaceId });
}

export function writeTerminal(
  workspaceId: string,
  sessionId: string,
  data: Uint8Array,
): Promise<void> {
  return invoke<void>("terminal_write", {
    workspaceId,
    sessionId,
    data: Array.from(data),
  });
}

export function resizeTerminal(
  workspaceId: string,
  sessionId: string,
  rows: number,
  cols: number,
): Promise<void> {
  return invoke<void>("terminal_resize", { workspaceId, sessionId, rows, cols });
}

export function acknowledgeTerminal(
  workspaceId: string,
  sessionId: string,
  sequence: number,
): Promise<void> {
  return invoke<void>("terminal_ack", { workspaceId, sessionId, sequence });
}

export function formatTerminalError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const terminalError = error as TerminalError;
    if (typeof terminalError.message === "string") {
      return terminalError.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
