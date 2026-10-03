export type TerminalShell = "pwsh" | "powershell";

export type TerminalViewState = "idle" | "starting" | "running" | "closing" | "exited" | "error";

export interface TerminalSession {
  sessionId: string;
  workspaceId: string;
  shell: TerminalShell;
  pid: number | null;
  state: "running";
}

export interface TerminalError {
  code: string;
  message: string;
}

export type TerminalEvent =
  | { type: "started"; session: TerminalSession }
  | {
      type: "data";
      sessionId: string;
      workspaceId: string;
      sequence: number;
      data: number[];
    }
  | {
      type: "exited";
      sessionId: string;
      workspaceId: string;
      exitCode: number | null;
      reason: string;
    }
  | {
      type: "error";
      sessionId: string;
      workspaceId: string;
      code: string;
      message: string;
    };
