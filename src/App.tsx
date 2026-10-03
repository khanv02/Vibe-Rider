import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppLayout } from "./components/AppLayout";
import { RightPanel } from "./components/RightPanel";
import { TerminalWorkspace } from "./components/TerminalWorkspace";
import type { TerminalViewState } from "./terminal/types";
import { formatWorkspaceError, openWorkspace } from "./workspace/workspaceApi";
import type { WorkspaceDescriptor } from "./workspace/types";
import { useWorkspaceExplorer } from "./workspace/useWorkspaceExplorer";

function App() {
  const [ipcMessage, setIpcMessage] = useState("Chưa kiểm tra");
  const [workspace, setWorkspace] = useState<WorkspaceDescriptor | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
  const [activeTool, setActiveTool] = useState<"git" | "explorer">("git");
  const [terminalState, setTerminalState] = useState<TerminalViewState>("idle");
  const explorer = useWorkspaceExplorer(workspace);

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
        setActiveTool("explorer");
      }
    } catch (error) {
      setActiveTool("explorer");
      setWorkspaceError(formatWorkspaceError(error));
    } finally {
      setIsOpeningWorkspace(false);
    }
  }

  return (
    <AppLayout
      isOpeningWorkspace={isOpeningWorkspace}
      onOpenWorkspace={chooseWorkspace}
      terminalState={terminalState}
      workspaceName={workspace?.name ?? null}
    >
      <TerminalWorkspace onStateChange={setTerminalState} workspace={workspace} />
      <RightPanel
        activeTool={activeTool}
        explorer={explorer}
        ipcMessage={ipcMessage}
        onCheckIpc={checkIpc}
        onOpenWorkspace={chooseWorkspace}
        onSelectTool={setActiveTool}
        workspace={workspace}
        workspaceError={workspaceError}
      />
    </AppLayout>
  );
}

export default App;
