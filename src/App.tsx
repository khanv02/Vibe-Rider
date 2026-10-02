import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppLayout } from "./components/AppLayout";
import { RightPanel } from "./components/RightPanel";
import { TerminalWorkspace } from "./components/TerminalWorkspace";

function App() {
  const [ipcMessage, setIpcMessage] = useState("Chưa kiểm tra");

  async function checkIpc() {
    try {
      const response = await invoke<string>("ping");
      setIpcMessage(response);
    } catch (error) {
      setIpcMessage(`Lỗi IPC: ${String(error)}`);
    }
  }

  return (
    <AppLayout>
      <TerminalWorkspace />
      <RightPanel ipcMessage={ipcMessage} onCheckIpc={checkIpc} />
    </AppLayout>
  );
}

export default App;
