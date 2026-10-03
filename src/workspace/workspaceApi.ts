import { invoke } from "@tauri-apps/api/core";
import type { DirectoryListing, WorkspaceDescriptor, WorkspaceError } from "./types";

export function openWorkspace(): Promise<WorkspaceDescriptor | null> {
  return invoke<WorkspaceDescriptor | null>("open_workspace");
}

export function readDirectory(
  workspaceId: string,
  relativePath: string,
): Promise<DirectoryListing> {
  return invoke<DirectoryListing>("read_directory", {
    request: {
      workspaceId,
      relativePath,
    },
  });
}

export function formatWorkspaceError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const workspaceError = error as WorkspaceError;
    if (typeof workspaceError.message === "string") {
      return workspaceError.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
