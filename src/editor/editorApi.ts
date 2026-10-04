import { invoke } from "@tauri-apps/api/core";
import type { TextFileSnapshot, WriteFileResult } from "./types";

export function readFile(workspaceId: string, relativePath: string): Promise<TextFileSnapshot> {
  return invoke<TextFileSnapshot>("read_file", {
    request: { workspaceId, relativePath },
  });
}

export function writeFile(
  workspaceId: string,
  relativePath: string,
  expectedRevision: string,
  content: string,
): Promise<WriteFileResult> {
  return invoke<WriteFileResult>("write_file", {
    request: { workspaceId, relativePath, expectedRevision, content },
  });
}

export function restoreFile(
  workspaceId: string,
  relativePath: string,
  content: string,
  eol: TextFileSnapshot["eol"],
  bom: boolean,
): Promise<WriteFileResult> {
  return invoke<WriteFileResult>("restore_file", {
    request: { workspaceId, relativePath, content, eol, bom },
  });
}

export function formatEditorError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return error instanceof Error ? error.message : String(error);
}
