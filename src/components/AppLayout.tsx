import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { RightPanelResizeHandle } from "./RightPanelResizeHandle";
import type { TerminalPaneId, TerminalPaneState } from "../terminal/types";
import { StatusBar } from "./StatusBar";
import type { GitBranch } from "../git/types";
import type { RightPanelSide } from "../panels/types";
import type { CloseConfirmMode, UiTheme } from "../preferences/types";

interface AppLayoutProps {
  theme: UiTheme;
  onThemeChange: (theme: UiTheme) => void;
  terminalWorkspace: ReactNode;
  rightPanel: ReactNode;
  isOpeningWorkspace: boolean;
  onOpenWorkspace: () => void;
  onBodyWidthChange: (width: number) => void;
  onClosePanel: () => void;
  onFocusActiveTerminal: () => void;
  notice?: string | null;
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
  gitBranch: GitBranch | null;
  panelSide: RightPanelSide;
  onPanelSideChange: (side: RightPanelSide) => void;
  closeMode: CloseConfirmMode;
  onCloseModeChange: (mode: CloseConfirmMode) => void;
}

export function AppLayout({
  theme,
  onThemeChange,
  terminalWorkspace,
  rightPanel,
  isOpeningWorkspace,
  onOpenWorkspace,
  onBodyWidthChange,
  onClosePanel,
  onFocusActiveTerminal,
  notice,
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
  gitBranch,
  panelSide,
  onPanelSideChange,
  closeMode,
  onCloseModeChange,
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
    requestAnimationFrame(onFocusActiveTerminal);
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
        <button
          className="header-open-button"
          disabled={isOpeningWorkspace}
          onClick={onOpenWorkspace}
          type="button"
        >
          {isOpeningWorkspace ? "Opening…" : "Open Folder"}
        </button>
        <div className="header-panel-side" aria-label="Tools position">
          <span className="header-panel-side-label">TOOLS</span>
          <button className={panelSide === "left" ? "size-button size-button-active" : "size-button"} onClick={() => onPanelSideChange("left")} type="button">Left</button>
          <button className={panelSide === "right" ? "size-button size-button-active" : "size-button"} onClick={() => onPanelSideChange("right")} type="button">Right</button>
        </div>
        <label className="header-theme-control">
          <span>Theme</span>
          <select aria-label="Theme" id="theme-select" name="theme" value={theme} onChange={(event) => onThemeChange(event.target.value as UiTheme)}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <label className="header-close-mode">
          <span>Close</span>
          <select aria-label="Close confirmation mode" id="close-mode-select" name="closeMode" value={closeMode} onChange={(event) => onCloseModeChange(event.target.value as CloseConfirmMode)}>
            <option value="always">Confirm before close</option>
            <option value="when-needed">Confirm when needed</option>
            <option value="never">Close without confirm</option>
          </select>
        </label>
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
          {notice ? <span className="header-notice" title={notice}>Setup warning</span> : null}
        </div>
      </header>
      <section
        className={`app-body app-body-panel-${panelSide}${panelOpen ? "" : " app-body-panel-collapsed"}`}
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
          side={panelSide}
          width={panelWidth}
        />
        <div className={`right-panel-slot${panelOpen ? "" : " right-panel-slot-collapsed"}`}>
          {rightPanel}
        </div>
      </section>
      <StatusBar activePaneId={activePaneId} gitBranch={gitBranch} terminalStates={terminalStates} workspaceName={workspaceName} />
    </main>
  );
}
