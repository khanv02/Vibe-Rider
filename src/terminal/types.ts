export type TerminalShell = "pwsh" | "powershell";

export type TerminalViewState = "idle" | "starting" | "running" | "closing" | "exited" | "error";

export type TerminalPaneId = "T1" | "T2" | "T3" | "T4";
export type TerminalLayoutMode = 1 | 2 | 4;

export interface TerminalSession {
  sessionId: string;
  workspaceId: string;
  paneId: TerminalPaneId;
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
      paneId: TerminalPaneId;
      sequence: number;
      data: number[];
    }
  | {
      type: "exited";
      sessionId: string;
      workspaceId: string;
      paneId: TerminalPaneId;
      exitCode: number | null;
      reason: string;
    }
  | {
      type: "error";
      sessionId: string;
      workspaceId: string;
      paneId: TerminalPaneId;
      code: string;
      message: string;
    };

export interface TerminalPaneState {
  paneId: TerminalPaneId;
  session: TerminalSession | null;
  state: TerminalViewState;
  rootPath: string | null;
  error: string | null;
  exitCode: number | null;
}

export const TERMINAL_PANE_IDS: TerminalPaneId[] = ["T1", "T2", "T3", "T4"];
