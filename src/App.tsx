import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppLayout, type WorkspaceMode } from "./components/AppLayout";
import { RightPanel } from "./components/RightPanel";
import { TerminalWorkspace } from "./components/TerminalWorkspace";
import { EditorWorkspace } from "./components/EditorWorkspace";
import { quotePowerShellPath } from "./components/fileDrop";
import { useRightPanel } from "./panels/useRightPanel";
import { TERMINAL_PANE_IDS, type TerminalPaneId, type TerminalPaneState } from "./terminal/types";
import { formatWorkspaceError, openWorkspace } from "./workspace/workspaceApi";
import type { WorkspaceDescriptor } from "./workspace/types";
import { useWorkspaceExplorer } from "./workspace/useWorkspaceExplorer";
import { useWorkspaceEditor } from "./editor/useWorkspaceEditor";
import type { DirectoryEntry } from "./workspace/types";
import { loadUiPreferences, rememberActiveWorkspace, restoreLastWorkspace, saveUiPreferences } from "./preferences/preferencesApi";
import { DEFAULT_UI_PREFERENCES, preferencesFromPanel, type CloseConfirmMode, type UiPreferences, type UiTheme } from "./preferences/types";
import { useAppShortcuts, type AppShortcutActions } from "./ux/useAppShortcuts";
import type { TerminalLayoutMode } from "./terminal/types";
import { RIGHT_PANEL_DEFAULT_STATE } from "./panels/panelLayout";
import type { TerminalWorkspaceHandle } from "./components/TerminalWorkspace";
import { cancelGitOperation, listGitOperations, waitForGitIdle } from "./git/gitApi";
import { useWorkspaceGit } from "./git/useWorkspaceGit";
import { hasTauriWindowMetadata, isTauriRuntime } from "./tauri/runtime";
import { useWorkspaceSearch } from "./search/useWorkspaceSearch";
import type { SearchMatch } from "./search/types";

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceDescriptor | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
  const [bodyWidth, setBodyWidth] = useState(0);
  const [activePaneId, setActivePaneId] = useState<TerminalPaneId>("T1");
  const [layoutMode, setLayoutMode] = useState<TerminalLayoutMode>(4);
  const [visiblePair, setVisiblePair] = useState<[TerminalPaneId, TerminalPaneId]>(["T1", "T2"]);
  const [autoStartPaneId, setAutoStartPaneId] = useState<TerminalPaneId | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("terminal");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [theme, setTheme] = useState<UiTheme>(DEFAULT_UI_PREFERENCES.theme);
  const [closeMode, setCloseMode] = useState<CloseConfirmMode>(DEFAULT_UI_PREFERENCES.closeMode);
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const terminalWorkspaceRef = useRef<TerminalWorkspaceHandle>(null);
  const bootstrapPromiseRef = useRef<Promise<void> | null>(null);
  const closeModeRef = useRef<CloseConfirmMode>(DEFAULT_UI_PREFERENCES.closeMode);
  const closeApprovedRef = useRef(false);
  const closeRequestInFlightRef = useRef(false);
  const hasCloseBlockersRef = useRef<() => Promise<boolean>>(async () => false);
  const requestApplicationCloseRef = useRef<(skipConfirmations?: boolean) => Promise<void>>(async () => undefined);
  const [terminalStates, setTerminalStates] = useState<Record<TerminalPaneId, TerminalPaneState>>(() =>
    Object.fromEntries(
      TERMINAL_PANE_IDS.map((paneId) => [paneId, { paneId, session: null, state: "idle", rootPath: null, error: null, exitCode: null }]),
    ) as Record<TerminalPaneId, TerminalPaneState>,
  );
  const explorer = useWorkspaceExplorer(workspace);
  const rightPanel = useRightPanel(bodyWidth);
  const editor = useWorkspaceEditor(workspace);
  const search = useWorkspaceSearch(workspace);
  const git = useWorkspaceGit(workspace, editor.prepareWorkspaceChange, editor.captureFileOperation, editor.completeFileOperation);
  closeModeRef.current = closeMode;

  useEffect(() => {
    if (!preferencesReady) return;
    const splash = document.getElementById("initial-splash");
    if (!splash) return;
    splash.classList.add("is-hidden");
    const timer = window.setTimeout(() => splash.remove(), 220);
    return () => window.clearTimeout(timer);
  }, [preferencesReady]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const deleteExplorerEntry = useCallback(async (relativePath: string) => {
    editor.captureFileOperation([relativePath], "delete");
    const success = await explorer.deleteEntry(relativePath);
    editor.completeFileOperation(success);
  }, [editor.captureFileOperation, editor.completeFileOperation, explorer.deleteEntry]);

  useEffect(() => {
    if (bootstrapPromiseRef.current) return;
    const hydrate = rightPanel.hydrate;
    const selectPanel = rightPanel.selectPanel;
    bootstrapPromiseRef.current = (async () => {
      try {
        const snapshot = await loadUiPreferences();
        const next = snapshot.preferences;
        setLayoutMode(next.terminal.layoutMode);
        setActivePaneId(next.terminal.activePaneId);
        setVisiblePair(next.terminal.visiblePair);
        setTheme(next.theme);
        setCloseMode(next.closeMode);
        hydrate({
          ...RIGHT_PANEL_DEFAULT_STATE,
          rightPanelOpen: next.panel.open,
          activeRightPanel: next.panel.activeTool === "git" ? "git" : "explorer",
          rightPanelWidth: next.panel.normalWidth,
          editorSize: next.panel.editorSize,
          editorExpandedWidth: next.panel.expandedWidth,
          keepExpandedOnSwitch: next.panel.keepExpandedOnSwitch,
          side: next.panel.side,
        });
        setPreferencesError(snapshot.warning);
        if (snapshot.rememberedWorkspace) {
          try {
            const restored = await restoreLastWorkspace();
            if (restored) {
              setWorkspace(restored);
              setAutoStartPaneId(next.terminal.activePaneId);
            }
          } catch (error) {
        setWorkspaceError(formatWorkspaceError(error));
            selectPanel("explorer");
          }
        }
      } catch (error) {
        setPreferencesError(formatWorkspaceError(error));
      }
      setPreferencesReady(true);
    })();
  }, [rightPanel.hydrate, rightPanel.selectPanel]);

  const currentPreferences = useMemo<UiPreferences>(() => ({
    version: 1,
    theme,
    closeMode,
    terminal: { layoutMode, activePaneId, visiblePair },
    panel: preferencesFromPanel(rightPanel.state),
  }), [activePaneId, closeMode, layoutMode, rightPanel.state, theme, visiblePair]);

  useEffect(() => {
    if (!preferencesReady) return;
    const timer = window.setTimeout(() => {
      void saveUiPreferences(currentPreferences).catch((error) => setPreferencesError(formatWorkspaceError(error)));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [currentPreferences, preferencesReady]);

  const prepareGitTransitionCore = useCallback(async () => {
    const currentWorkspace = workspace;
    if (!currentWorkspace) return true;
    let operations;
    try {
      operations = await listGitOperations(currentWorkspace.id);
    } catch (error) {
      setWorkspaceError(formatWorkspaceError(error));
      return false;
    }
    if (operations.length === 0) return true;

    const summary = operations.map((item) => item.operation).join(", ");
    const shouldWait = window.confirm(
      `Git operation đang chạy (${summary}).\n\nOK = chờ hoàn tất; Cancel = yêu cầu huỷ và giữ workspace hiện tại nếu chưa kết thúc.`,
    );
    if (shouldWait) {
      const idle = await waitForGitIdle(currentWorkspace.id);
      if (!idle) setWorkspaceError("Git operation chưa kết thúc trong thời gian chờ.");
      return idle;
    }

    try {
      await Promise.all(operations.map((item) => cancelGitOperation(currentWorkspace.id, item.operationId)));
      const idle = await waitForGitIdle(currentWorkspace.id);
      if (!idle) setWorkspaceError("Đã yêu cầu huỷ Git nhưng process chưa được reap.");
      return idle;
    } catch (error) {
      setWorkspaceError(formatWorkspaceError(error));
      return false;
    }
  }, [workspace]);

  const prepareWorkspaceTransition = useCallback(async () => {
    if (!(await prepareGitTransitionCore())) return false;
    return editor.prepareWorkspaceChange();
  }, [editor.prepareWorkspaceChange, prepareGitTransitionCore]);

  const hasCloseBlockers = useCallback(async () => {
    if (editor.hasDirty()) return true;
    if (TERMINAL_PANE_IDS.some((paneId) => ["starting", "running", "closing"].includes(terminalStates[paneId].state))) {
      return true;
    }
    if (!workspace) return false;
    try {
      return (await listGitOperations(workspace.id)).length > 0;
    } catch {
      return false;
    }
  }, [editor.hasDirty, terminalStates, workspace]);

  const requestApplicationClose = useCallback(async (skipConfirmations = false) => {
    if (closeRequestInFlightRef.current) return;
    closeRequestInFlightRef.current = true;
    setCloseBusy(true);
    setCloseError(null);
    try {
      if (!skipConfirmations && !(await prepareWorkspaceTransition())) return;
      closeApprovedRef.current = true;
      setClosePromptOpen(false);
      await getCurrentWindow().close();
    } catch (error) {
      closeApprovedRef.current = false;
      setClosePromptOpen(true);
      setCloseError(formatWorkspaceError(error));
    } finally {
      closeRequestInFlightRef.current = false;
      setCloseBusy(false);
    }
  }, [prepareWorkspaceTransition]);

  hasCloseBlockersRef.current = hasCloseBlockers;
  requestApplicationCloseRef.current = requestApplicationClose;

  useEffect(() => {
    if (!isTauriRuntime() || !hasTauriWindowMetadata()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const closeRequested = getCurrentWindow().onCloseRequested(async (event) => {
      if (closeApprovedRef.current) return;
      event.preventDefault();
      if (closeModeRef.current === "always") {
        setCloseError(null);
        setClosePromptOpen(true);
        return;
      }
      if (closeModeRef.current === "never") {
        void requestApplicationCloseRef.current(true);
        return;
      }
      if (await hasCloseBlockersRef.current()) {
        setCloseError(null);
        setClosePromptOpen(true);
        return;
      }
      void requestApplicationCloseRef.current();
    });
    void closeRequested.then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const handleBodyWidthChange = useCallback((width: number) => {
    setBodyWidth((current) => current === width ? current : width);
  }, []);

  async function chooseWorkspace() {
    if (isOpeningWorkspace) {
      return;
    }

    if (!(await prepareWorkspaceTransition())) return;

    setIsOpeningWorkspace(true);
    setWorkspaceError(null);
    try {
      const nextWorkspace = await openWorkspace();
      if (nextWorkspace) {
        setWorkspace(nextWorkspace);
        setAutoStartPaneId(null);
        void rememberActiveWorkspace(nextWorkspace.id).catch((error) => setPreferencesError(formatWorkspaceError(error)));
        rightPanel.selectPanel("explorer");
      }
    } catch (error) {
      rightPanel.selectPanel("explorer");
      setWorkspaceError(formatWorkspaceError(error));
    } finally {
      setIsOpeningWorkspace(false);
    }
  }

  /* const prepareGitTransition = useCallback(async () => {
    const currentWorkspace = workspace;
    if (!currentWorkspace) return true;
    let operations;
    try {
      operations = await listGitOperations(currentWorkspace.id);
    } catch (error) {
      setWorkspaceError(formatWorkspaceError(error));
      return false;
    }
    if (operations.length === 0) return true;

    const summary = operations.map((item) => item.operation).join(", ");
    const shouldWait = window.confirm(
      `Git operation Ä‘ang cháº¡y (${summary}).\n\nOK = chá» hoÃ n táº¥t; Cancel = yÃªu cáº§u huá»· vÃ  giá»¯ workspace hiá»‡n táº¡i náº¿u chÆ°a káº¿t thÃºc.`,
    );
    if (shouldWait) {
      const idle = await waitForGitIdle(currentWorkspace.id);
      if (!idle) setWorkspaceError("Git operation chÆ°a káº¿t thÃºc trong thá»i gian chá».");
      return idle;
    }

    try {
      await Promise.all(operations.map((item) => cancelGitOperation(currentWorkspace.id, item.operationId)));
      const idle = await waitForGitIdle(currentWorkspace.id);
      if (!idle) setWorkspaceError("ÄÃ£ yÃªu cáº§u huá»· Git nhÆ°ng process chÆ°a Ä‘Æ°á»£c reap.");
      return idle;
    } catch (error) {
      setWorkspaceError(formatWorkspaceError(error));
      return false;
    }
  }, [workspace]);

  const prepareWorkspaceTransitionLegacy = useCallback(async () => {
    if (!(await prepareGitTransition())) return false;
    return editor.prepareWorkspaceChange();
  }, [editor.prepareWorkspaceChange, prepareGitTransition]); */

  function openFile(entry: DirectoryEntry) {
    if (entry.kind !== "file") return;
    setWorkspaceMode("editor");
    rightPanel.selectPanel("explorer");
    void editor.openFile(entry.relativePath);
  }

  const openSearchResult = useCallback(async (match: SearchMatch) => {
    const opened = await editor.openFileAtLocation(match.relativePath, match.line, match.column, match.endColumn);
    if (opened) {
      setWorkspaceMode("editor");
      rightPanel.selectPanel("explorer");
    }
  }, [editor.openFileAtLocation, rightPanel.selectPanel]);

  const openDroppedFile = useCallback(async (path: string): Promise<string | null> => {
    const relativePath = relativeWorkspacePath(path, workspace?.rootPath ?? null);
    if (!relativePath) {
      setWorkspaceError("Only files inside the current workspace can be opened in Editor.");
      return null;
    }
    const opened = await editor.openFile(relativePath);
    if (!opened) return null;
    setWorkspaceMode("editor");
    rightPanel.selectPanel("explorer");
    return relativePath;
  }, [editor.openFile, rightPanel.selectPanel, workspace?.rootPath]);

  const handleTerminalPathDrop = useCallback((paths: string[], paneId: TerminalPaneId) => {
    const terminalPaths = paths
      .map((path) => absoluteWorkspacePath(path, workspace?.rootPath ?? null))
      .filter((path): path is string => Boolean(path));
    if (terminalPaths.length === 0) return;
    setWorkspaceMode("terminal");
    setActivePaneId(paneId);
    requestAnimationFrame(() => {
      terminalWorkspaceRef.current?.writeToPane(paneId, `${terminalPaths.map(quotePowerShellPath).join(" ")} `);
      terminalWorkspaceRef.current?.focusPane(paneId);
    });
  }, [workspace?.rootPath]);

  const focusActiveTerminal = useCallback(() => {
    setWorkspaceMode("terminal");
    requestAnimationFrame(() => terminalWorkspaceRef.current?.focusActivePane());
  }, []);
  const setLayout = useCallback((mode: TerminalLayoutMode) => setLayoutMode(mode), []);
  const focusPane = useCallback((paneId: TerminalPaneId) => {
    setWorkspaceMode("terminal");
    setActivePaneId(paneId);
    setVisiblePair((current) => layoutMode === 2 && !current.includes(paneId) ? [paneId, nextPane[paneId]] : current);
    requestAnimationFrame(() => terminalWorkspaceRef.current?.focusPane(paneId));
  }, [layoutMode]);
  const toggleTools = useCallback(() => {
    if (rightPanel.state.rightPanelOpen) {
      rightPanel.closePanel();
      requestAnimationFrame(focusActiveTerminal);
    } else {
      rightPanel.togglePanel();
    }
  }, [focusActiveTerminal, rightPanel]);
  const focusTool = useCallback((panel: "git" | "explorer" | "editor") => {
    if (panel === "editor") {
      setWorkspaceMode("editor");
      rightPanel.selectPanel("explorer");
      return;
    }
    rightPanel.selectPanel(panel);
    requestAnimationFrame(() => document.getElementById(`${panel}-panel-title`)?.focus());
  }, [rightPanel]);
  const shortcutActions = useMemo<AppShortcutActions>(() => ({ setLayoutMode: setLayout, focusPane, toggleTools, focusTool }), [focusPane, focusTool, setLayout, toggleTools]);
  useAppShortcuts(shortcutActions);

  const nextPane: Record<TerminalPaneId, TerminalPaneId> = { T1: "T2", T2: "T3", T3: "T4", T4: "T1" };

  if (!preferencesReady) {
    return <StartupScreen />;
  }

  return (
    <>
      <AppLayout
      theme={theme}
      onThemeChange={setTheme}
      workspaceMode={workspaceMode}
      onWorkspaceModeChange={(mode) => {
        setWorkspaceMode(mode);
        if (mode === "terminal") requestAnimationFrame(focusActiveTerminal);
      }}
      isOpeningWorkspace={isOpeningWorkspace}
      onOpenWorkspace={chooseWorkspace}
      onBodyWidthChange={handleBodyWidthChange}
      onClosePanel={rightPanel.closePanel}
      onFocusActiveTerminal={focusActiveTerminal}
      notice={preferencesError}
      onPanelWidthChange={rightPanel.setPanelWidth}
      onTogglePanel={rightPanel.togglePanel}
      panelOpen={rightPanel.state.rightPanelOpen}
      panelWidth={rightPanel.geometry.effectiveWidth}
      panelMinWidth={rightPanel.geometry.minWidth}
      panelMaxWidth={rightPanel.geometry.maxWidth}
      splitterWidth={rightPanel.geometry.splitterWidth}
      activePaneId={activePaneId}
      terminalStates={terminalStates}
      workspaceName={workspace?.name ?? null}
      gitBranch={git.status?.branch ?? null}
      panelSide={rightPanel.state.side}
      onPanelSideChange={rightPanel.setPanelSide}
      closeMode={closeMode}
      onCloseModeChange={setCloseMode}
      terminalWorkspace={
        <TerminalWorkspace
          activePaneId={activePaneId}
          autoStartPaneId={autoStartPaneId}
          layoutMode={layoutMode}
          onActivePaneChange={setActivePaneId}
          onLayoutModeChange={setLayoutMode}
          onPaneStateChange={(nextState) => setTerminalStates((current) => ({ ...current, [nextState.paneId]: nextState }))}
          onVisiblePairChange={setVisiblePair}
          onPathDrop={handleTerminalPathDrop}
          ref={terminalWorkspaceRef}
          theme={theme}
          visiblePair={visiblePair}
          workspace={workspace}
        />
      }
      rightPanel={
          <RightPanel
            activePanel={rightPanel.state.activeRightPanel}
            git={git}
            gitEntries={git.status?.entries ?? []}
          editorSize={rightPanel.state.editorSize}
          explorer={explorer}
            onEditorSizeChange={rightPanel.setEditorSize}
            onToggleKeepExpandedOnSwitch={rightPanel.toggleKeepExpandedOnSwitch}
          onDeleteEntry={deleteExplorerEntry}
          onOpenWorkspace={chooseWorkspace}
            onOpenFile={openFile}
            onOpenSearchResult={openSearchResult}
            onSelectPanel={rightPanel.selectPanel}
            open={rightPanel.state.rightPanelOpen}
            pendingFilePaths={editor.pendingFilePaths}
            search={search}
            theme={theme}
            workspace={workspace}
          workspaceError={workspaceError}
        />
      }
      editorWorkspace={
        <EditorWorkspace
          controller={editor}
          editorSize={rightPanel.state.editorSize}
          onEditorSizeChange={rightPanel.setEditorSize}
          onOpenFile={openDroppedFile}
          theme={theme}
        />
      }
      />
      {closePromptOpen ? (
        <div className="close-dialog-backdrop" role="presentation">
          <section aria-labelledby="close-dialog-title" aria-modal="true" className="close-dialog" role="dialog">
            <img alt="Sad Vibe Rider chibi mascot" className="close-dialog-mascot" src="/assets/vibe-rider-splash-oguri-chibi.png" />
            <div className="close-dialog-copy">
              <p className="panel-kicker">VIBE RIDER</p>
              <h2 id="close-dialog-title">Close the app?</h2>
              <p>Confirm close? Unsaved work or running operations may still need your attention.</p>
              {closeError ? <p className="close-dialog-error">{closeError}</p> : null}
            </div>
            <div className="close-dialog-actions">
              <button className="size-button" disabled={closeBusy} onClick={() => setClosePromptOpen(false)} type="button">Cancel</button>
              <button className="primary-button" disabled={closeBusy} onClick={() => void requestApplicationClose()} type="button">{closeBusy ? "Closing…" : "Close"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function relativeWorkspacePath(path: string, rootPath: string | null): string | null {
  if (!path) return null;
  const normalizedPath = path.replaceAll("\\", "/").replace(/^file:\/\//, "");
  const looksAbsolute = /^[A-Za-z]:\//.test(normalizedPath) || normalizedPath.startsWith("/");
  if (!looksAbsolute) return normalizedPath.replace(/^\.\//, "");
  if (!rootPath) return null;
  const normalizedRoot = rootPath.replaceAll("\\", "/").replace(/\/$/, "");
  const pathLower = normalizedPath.toLowerCase();
  const rootLower = normalizedRoot.toLowerCase();
  if (!pathLower.startsWith(`${rootLower}/`)) return null;
  return normalizedPath.slice(normalizedRoot.length + 1);
}

function absoluteWorkspacePath(path: string, rootPath: string | null): string | null {
  if (!path) return null;
  const normalizedPath = path.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(normalizedPath) || normalizedPath.startsWith("/")) return path;
  if (!rootPath) return null;
  return `${rootPath.replace(/[\\/]$/, "")}\\${normalizedPath.replaceAll("/", "\\")}`;
}

function StartupScreen() {
  return (
    <main className="startup-screen" aria-label="Loading Vibe Rider">
      <div className="startup-card">
        <div className="startup-chrome"><span>...</span></div>
        <div className="startup-content">
          <img alt="Cheerful Oguri Cap chibi mascot" className="startup-character" src="/assets/vibe-rider-splash-oguri-smile.png" />
          <h1>Vibe Rider</h1>
          <p>&gt; initializing workspace...</p>
        </div>
        <div className="startup-progress" aria-hidden="true"><span /></div>
      </div>
    </main>
  );
}

export default App;
