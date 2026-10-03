import type { ReactNode } from "react";
import type { TerminalViewState } from "../terminal/types";
import { StatusBar } from "./StatusBar";

interface AppLayoutProps {
  children: ReactNode;
  isOpeningWorkspace: boolean;
  onOpenWorkspace: () => void;
  terminalState: TerminalViewState;
  workspaceName: string | null;
}

export function AppLayout({
  children,
  isOpeningWorkspace,
  onOpenWorkspace,
  terminalState,
  workspaceName,
}: AppLayoutProps) {
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">
          <span className="brand-slash brand-slash-primary" />
          <span className="brand-slash brand-slash-muted" />
        </div>
        <div className="app-title-group">
          <h1>Vibe Rider</h1>
          <span className="app-mode">WORKSPACE</span>
        </div>
        <div className="header-context">
          <span className="header-context-label">LOCAL / TERMINAL-FIRST</span>
          <span className="header-context-divider" aria-hidden="true" />
          <span>Desktop shell preview</span>
        </div>
        <button
          className="header-open-button"
          disabled={isOpeningWorkspace}
          onClick={onOpenWorkspace}
          type="button"
        >
          {isOpeningWorkspace ? "Opening…" : "Open Folder"}
        </button>
        <div className="header-status">
          <span className="status-indicator" />
          <span>{workspaceName ?? "No workspace"}</span>
        </div>
      </header>
      <section className="app-body">{children}</section>
      <StatusBar terminalState={terminalState} workspaceName={workspaceName} />
    </main>
  );
}
