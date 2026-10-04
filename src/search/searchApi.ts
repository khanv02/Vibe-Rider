import { invoke } from "@tauri-apps/api/core";
import { desktopRuntimeError, isTauriRuntime } from "../tauri/runtime";
import type { SearchError, SearchRequest, SearchResult, SearchStartResult } from "./types";

export interface SearchJobRequest {
  workspaceId: string;
  searchId: string;
}

export function startSearch(request: SearchRequest): Promise<SearchStartResult> {
  if (!isTauriRuntime()) return Promise.reject(desktopRuntimeError());
  return invoke<SearchStartResult>("search_start", { request });
}

export function waitForSearch(request: SearchJobRequest): Promise<SearchResult> {
  if (!isTauriRuntime()) return Promise.reject(desktopRuntimeError());
  return invoke<SearchResult>("search_result", { request });
}

export function cancelSearch(request: SearchJobRequest): Promise<boolean> {
  if (!isTauriRuntime()) return Promise.reject(desktopRuntimeError());
  return invoke<boolean>("search_cancel", { request });
}

export function formatSearchError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const value = error as SearchError;
    if (typeof value.message === "string") {
      return value.code ? `${value.code}: ${value.message}` : value.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}
