import { invoke } from "@tauri-apps/api/core";
import { desktopRuntimeError, isTauriRuntime } from "../tauri/runtime";

export type ReadOnlyToolName = "read_file" | "list_directory" | "search_text" | "git_status" | "git_diff";

export interface ReadOnlyToolResult<T = unknown> {
  callId: string;
  workspaceId: string;
  tool: ReadOnlyToolName;
  status: "success";
  data: T | null;
  error: { code: string; message: string } | null;
  truncated: boolean;
}

export function callReadOnlyTool<T>(
  workspaceId: string,
  tool: ReadOnlyToolName,
  args: unknown,
  callId = `${Date.now()}-${Math.random().toString(36).slice(2)}`,
): Promise<ReadOnlyToolResult<T>> {
  if (!isTauriRuntime()) return Promise.reject(desktopRuntimeError());
  return invoke<ReadOnlyToolResult<T>>("read_only_tool", {
    request: { callId, workspaceId, tool, args },
  });
}
