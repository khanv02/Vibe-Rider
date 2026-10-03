import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { RightPanelResizeHandle } from "./RightPanelResizeHandle";
import type { TerminalPaneId, TerminalPaneState } from "../terminal/types";
import { StatusBar } from "./StatusBar";

interface AppLayoutProps {
  terminalWorkspace: ReactNode;
  rightPanel: ReactNode;
  isOpeningWorkspace: boolean;
  onOpenWorkspace: () => void;
  onBodyWidthChange: (width: number) => void;
  onClosePanel: () => void;
  onPanelWidthChange: (width: number) => void;
  onTogglePanel: () => void;
  panelOpen: boolean;
  panelWidth: number;
  panelMinWidth: number;
  panelMaxWidth: number;
  splitterWidth: number;
  activePaneId: TerminalPaneId;
  terminalStates: Record<TerminalPaneId, TerminalPaneState>;
  workspaceName: string | null;
}

export function AppLayout({
  terminalWorkspace,
  rightPanel,
  isOpeningWorkspace,
  onOpenWorkspace,
  onBodyWidthChange,
  onClosePanel,
  onPanelWidthChange,
  onTogglePanel,
  panelOpen,
  panelWidth,
  panelMinWidth,
  panelMaxWidth,
  splitterWidth,
  activePaneId,
  terminalStates,
  workspaceName,
}: AppLayoutProps) {
  const bodyRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const reportSize = () => onBodyWidthChange(body.clientWidth);
    reportSize();
    const observer = new ResizeObserver(reportSize);
    observer.observe(body);
    return () => observer.disconnect();
  }, [onBodyWidthChange]);

  function collapsePanel() {
    onClosePanel();
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".terminal-card-active .xterm-helper-textarea")?.focus();
    });
  }

  function toggleTools() {
    if (panelOpen) {
      collapsePanel();
      return;
    }
    onTogglePanel();
  }

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
        <button
          aria-controls="right-panel"
          aria-expanded={panelOpen}
          className="header-tools-button"
          onClick={toggleTools}
          type="button"
        >
          {panelOpen ? "Hide tools" : "Show tools"}
        </button>
        <div className="header-status">
          <span className="status-indicator" />
          <span>{workspaceName ?? "No workspace"}</span>
        </div>
      </header>
      <section
        className={`app-body${panelOpen ? "" : " app-body-panel-collapsed"}`}
        ref={bodyRef}
        style={{
          "--right-panel-width": `${panelOpen ? panelWidth : 0}px`,
          "--right-panel-splitter-width": `${panelOpen ? splitterWidth : 0}px`,
        } as CSSProperties}
      >
        <div className="terminal-workspace-slot">{terminalWorkspace}</div>
        <RightPanelResizeHandle
          disabled={!panelOpen}
          maxWidth={panelMaxWidth}
          minWidth={panelMinWidth}
          onCollapse={collapsePanel}
          onWidthChange={onPanelWidthChange}
          width={panelWidth}
        />
        <div className={`right-panel-slot${panelOpen ? "" : " right-panel-slot-collapsed"}`}>
          {rightPanel}
        </div>
      </section>
      <StatusBar activePaneId={activePaneId} terminalStates={terminalStates} workspaceName={workspaceName} />
    </main>
  );
}
