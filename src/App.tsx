import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppLayout } from "./components/AppLayout";
import { RightPanel } from "./components/RightPanel";
import { TerminalWorkspace } from "./components/TerminalWorkspace";
import { useRightPanel } from "./panels/useRightPanel";
import { TERMINAL_PANE_IDS, type TerminalPaneId, type TerminalPaneState } from "./terminal/types";
import { formatWorkspaceError, openWorkspace } from "./workspace/workspaceApi";
import type { WorkspaceDescriptor } from "./workspace/types";
import { useWorkspaceExplorer } from "./workspace/useWorkspaceExplorer";

function App() {
  const [ipcMessage, setIpcMessage] = useState("Chưa kiểm tra");
  const [workspace, setWorkspace] = useState<WorkspaceDescriptor | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
  const [bodyWidth, setBodyWidth] = useState(0);
  const [activePaneId, setActivePaneId] = useState<TerminalPaneId>("T1");
  const [terminalStates, setTerminalStates] = useState<Record<TerminalPaneId, TerminalPaneState>>(() =>
    Object.fromEntries(
      TERMINAL_PANE_IDS.map((paneId) => [paneId, { paneId, session: null, state: "idle", rootPath: null, error: null, exitCode: null }]),
    ) as Record<TerminalPaneId, TerminalPaneState>,
  );
  const explorer = useWorkspaceExplorer(workspace);
  const rightPanel = useRightPanel(bodyWidth);

  const handleBodyWidthChange = useCallback((width: number) => {
    setBodyWidth((current) => current === width ? current : width);
  }, []);

  async function checkIpc() {
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

    setIsOpeningWorkspace(true);
    setWorkspaceError(null);
    try {
      const nextWorkspace = await openWorkspace();
      if (nextWorkspace) {
        setWorkspace(nextWorkspace);
        rightPanel.selectPanel("explorer");
      }
    } catch (error) {
      rightPanel.selectPanel("explorer");
      setWorkspaceError(formatWorkspaceError(error));
    } finally {
      setIsOpeningWorkspace(false);
    }
  }

  return (
    <AppLayout
      isOpeningWorkspace={isOpeningWorkspace}
      onOpenWorkspace={chooseWorkspace}
      onBodyWidthChange={handleBodyWidthChange}
      onClosePanel={rightPanel.closePanel}
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
      terminalWorkspace={
        <TerminalWorkspace
          onActivePaneChange={setActivePaneId}
          onPaneStateChange={(nextState) => setTerminalStates((current) => ({ ...current, [nextState.paneId]: nextState }))}
          workspace={workspace}
        />
      }
      rightPanel={
        <RightPanel
          activePanel={rightPanel.state.activeRightPanel}
          editorSize={rightPanel.state.editorSize}
          explorer={explorer}
          ipcMessage={ipcMessage}
          onCheckIpc={checkIpc}
          onEditorSizeChange={rightPanel.setEditorSize}
          onOpenWorkspace={chooseWorkspace}
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
