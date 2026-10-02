import type { ReactNode } from "react";
import { StatusBar } from "./StatusBar";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">
          <span className="brand-slash brand-slash-primary" />
          <span className="brand-slash brand-slash-muted" />
        </div>
        <div className="app-title-group">
          <h1>Vibe Rider</h1>
          <span className="app-mode">FOUNDATION</span>
        </div>
        <div className="header-context">
          <span className="header-context-label">LOCAL / TERMINAL-FIRST</span>
          <span className="header-context-divider" aria-hidden="true" />
          <span>Desktop shell preview</span>
        </div>
        <div className="header-status">
          <span className="status-indicator" />
          <span>Native verification pending</span>
        </div>
      </header>
      <section className="app-body">{children}</section>
      <StatusBar />
    </main>
  );
}
