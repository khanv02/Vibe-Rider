import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppLayout } from "./components/AppLayout";
import { RightPanel } from "./components/RightPanel";
import { TerminalWorkspace } from "./components/TerminalWorkspace";
import { useRightPanel } from "./panels/useRightPanel";
import { TERMINAL_PANE_IDS, type TerminalPaneId, type TerminalPaneState } from "./terminal/types";
import { formatWorkspaceError, openWorkspace } from "./workspace/workspaceApi";
import type { WorkspaceDescriptor } from "./workspace/types";
import { useWorkspaceExplorer } from "./workspace/useWorkspaceExplorer";
import { useWorkspaceEditor } from "./editor/useWorkspaceEditor";
import type { DirectoryEntry } from "./workspace/types";
import { loadUiPreferences, rememberActiveWorkspace, restoreLastWorkspace, saveUiPreferences } from "./preferences/preferencesApi";
import { preferencesFromPanel, type UiPreferences } from "./preferences/types";
import { useAppShortcuts, type AppShortcutActions } from "./ux/useAppShortcuts";
import type { TerminalLayoutMode } from "./terminal/types";
import { RIGHT_PANEL_DEFAULT_STATE } from "./panels/panelLayout";
import type { TerminalWorkspaceHandle } from "./components/TerminalWorkspace";
import { cancelGitOperation, listGitOperations, waitForGitIdle } from "./git/gitApi";
import { useWorkspaceGit } from "./git/useWorkspaceGit";
import { hasTauriWindowMetadata, isTauriRuntime } from "./tauri/runtime";

function App() {
  const [ipcMessage, setIpcMessage] = useState("Chưa kiểm tra");
  const [workspace, setWorkspace] = useState<WorkspaceDescriptor | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
  const [bodyWidth, setBodyWidth] = useState(0);
  const [activePaneId, setActivePaneId] = useState<TerminalPaneId>("T1");
  const [layoutMode, setLayoutMode] = useState<TerminalLayoutMode>(4);
  const [visiblePair, setVisiblePair] = useState<[TerminalPaneId, TerminalPaneId]>(["T1", "T2"]);
  const [autoStartPaneId, setAutoStartPaneId] = useState<TerminalPaneId | null>(null);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const terminalWorkspaceRef = useRef<TerminalWorkspaceHandle>(null);
  const bootstrapPromiseRef = useRef<Promise<void> | null>(null);
  const [terminalStates, setTerminalStates] = useState<Record<TerminalPaneId, TerminalPaneState>>(() =>
    Object.fromEntries(
      TERMINAL_PANE_IDS.map((paneId) => [paneId, { paneId, session: null, state: "idle", rootPath: null, error: null, exitCode: null }]),
    ) as Record<TerminalPaneId, TerminalPaneState>,
  );
  const explorer = useWorkspaceExplorer(workspace);
  const rightPanel = useRightPanel(bodyWidth);
  const editor = useWorkspaceEditor(workspace);
  const git = useWorkspaceGit(workspace, editor.prepareWorkspaceChange);

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
        hydrate({
          ...RIGHT_PANEL_DEFAULT_STATE,
          rightPanelOpen: next.panel.open,
          activeRightPanel: next.panel.activeTool,
          rightPanelWidth: next.panel.normalWidth,
          editorSize: next.panel.editorSize,
          editorExpandedWidth: next.panel.expandedWidth,
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
    terminal: { layoutMode, activePaneId, visiblePair },
    panel: preferencesFromPanel(rightPanel.state),
  }), [activePaneId, layoutMode, rightPanel.state, visiblePair]);

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

  useEffect(() => {
    if (!isTauriRuntime() || !hasTauriWindowMetadata()) return;
    let approved = false;
    let unlisten: (() => void) | undefined;
    const closeRequested = getCurrentWindow().onCloseRequested(async (event) => {
      if (approved) return;
      event.preventDefault();
      if (await prepareWorkspaceTransition()) {
        approved = true;
        await getCurrentWindow().close();
      }
    });
    void closeRequested.then((dispose) => { unlisten = dispose; });
    return () => {
      unlisten?.();
    };
  }, [prepareWorkspaceTransition]);

  const handleBodyWidthChange = useCallback((width: number) => {
    setBodyWidth((current) => current === width ? current : width);
  }, []);

  async function checkIpc() {
    if (!isTauriRuntime()) {
      setIpcMessage("IPC chỉ khả dụng trong desktop app");
      return;
    }
    try {
      const response = await invoke<string>("ping");
      setIpcMessage(response);
    } catch (error) {
      setIpcMessage(`Lỗi IPC: ${String(error)}`);
    }
  }

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
    rightPanel.selectPanel("editor");
    void editor.openFile(entry.relativePath);
  }

  const focusActiveTerminal = useCallback(() => terminalWorkspaceRef.current?.focusActivePane(), []);
  const setLayout = useCallback((mode: TerminalLayoutMode) => setLayoutMode(mode), []);
  const focusPane = useCallback((paneId: TerminalPaneId) => {
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
    rightPanel.selectPanel(panel);
    requestAnimationFrame(() => document.getElementById(`${panel}-panel-title`)?.focus());
  }, [rightPanel]);
  const shortcutActions = useMemo<AppShortcutActions>(() => ({ setLayoutMode: setLayout, focusPane, toggleTools, focusTool }), [focusPane, focusTool, setLayout, toggleTools]);
  useAppShortcuts(shortcutActions);

  const nextPane: Record<TerminalPaneId, TerminalPaneId> = { T1: "T2", T2: "T3", T3: "T4", T4: "T1" };

  return (
    <AppLayout
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
      terminalWorkspace={
        <TerminalWorkspace
          activePaneId={activePaneId}
          autoStartPaneId={autoStartPaneId}
          layoutMode={layoutMode}
          onActivePaneChange={setActivePaneId}
          onLayoutModeChange={setLayoutMode}
          onPaneStateChange={(nextState) => setTerminalStates((current) => ({ ...current, [nextState.paneId]: nextState }))}
          onVisiblePairChange={setVisiblePair}
          ref={terminalWorkspaceRef}
          visiblePair={visiblePair}
          workspace={workspace}
        />
      }
      rightPanel={
          <RightPanel
            activePanel={rightPanel.state.activeRightPanel}
            editor={editor}
            git={git}
          editorSize={rightPanel.state.editorSize}
          explorer={explorer}
          ipcMessage={ipcMessage}
          onCheckIpc={checkIpc}
          onEditorSizeChange={rightPanel.setEditorSize}
          onOpenWorkspace={chooseWorkspace}
          onOpenFile={openFile}
          onSelectPanel={rightPanel.selectPanel}
          open={rightPanel.state.rightPanelOpen}
          workspace={workspace}
          workspaceError={workspaceError}
        />
      }
    />
  );
}

export default App;
