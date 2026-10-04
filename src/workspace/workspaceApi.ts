import { invoke } from "@tauri-apps/api/core";
import { desktopRuntimeError, isTauriRuntime } from "../tauri/runtime";
import type {
  ClipboardImageResult,
  CreateEntryKind,
  DirectoryListing,
  EntryMutationResult,
  WorkspaceDescriptor,
  WorkspaceError,
} from "./types";

export function openWorkspace(): Promise<WorkspaceDescriptor | null> {
  if (!isTauriRuntime()) return Promise.reject(desktopRuntimeError());
  return invoke<WorkspaceDescriptor | null>("open_workspace");
}

export function readDirectory(
  workspaceId: string,
  relativePath: string,
): Promise<DirectoryListing> {
  if (!isTauriRuntime()) return Promise.reject(desktopRuntimeError());
  return invoke<DirectoryListing>("read_directory", {
    request: {
      workspaceId,
      relativePath,
    },
  });
}

export function createEntry(
  workspaceId: string,
  parentRelativePath: string,
  name: string,
  kind: CreateEntryKind,
): Promise<EntryMutationResult> {
  if (!isTauriRuntime()) return Promise.reject(desktopRuntimeError());
  return invoke<EntryMutationResult>("create_entry", {
    request: { workspaceId, parentRelativePath, name, kind },
  });
}

export function deleteEntry(
  workspaceId: string,
  relativePath: string,
): Promise<EntryMutationResult> {
  if (!isTauriRuntime()) return Promise.reject(desktopRuntimeError());
  return invoke<EntryMutationResult>("delete_entry", {
    request: { workspaceId, relativePath },
  });
}

export function moveEntry(
  workspaceId: string,
  sourceRelativePath: string,
  destinationDirectoryRelativePath: string,
): Promise<EntryMutationResult> {
  if (!isTauriRuntime()) return Promise.reject(desktopRuntimeError());
  return invoke<EntryMutationResult>("move_entry", {
    request: { workspaceId, sourceRelativePath, destinationDirectoryRelativePath },
  });
}

export function saveClipboardImage(
  workspaceId: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<ClipboardImageResult> {
  if (!isTauriRuntime()) return Promise.reject(desktopRuntimeError());
  return invoke<ClipboardImageResult>("save_clipboard_image", {
    request: { workspaceId, mimeType, bytes: Array.from(bytes) },
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
