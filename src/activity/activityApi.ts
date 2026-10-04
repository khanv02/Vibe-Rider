import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../tauri/runtime";
import type { ActivityEvent, ActivitySessionDetail, ActivitySessionSummary } from "./types";

function request<T>(command: string, payload: unknown): Promise<T> {
  if (!isTauriRuntime()) {
    return Promise.reject(new Error("Activity is available only in the desktop app."));
  }
  return invoke<T>(command, payload);
}

export function startActivitySession(workspaceId: string, title?: string): Promise<ActivitySessionSummary> {
  return request<ActivitySessionSummary>("activity_session_start", {
    request: { workspaceId, title: title ?? null },
  });
}

export function listActivitySessions(workspaceId: string): Promise<ActivitySessionSummary[]> {
  return request<ActivitySessionSummary[]>("activity_session_list", { request: { workspaceId } });
}

export function listActivityTrash(workspaceId: string): Promise<ActivitySessionSummary[]> {
  return request<ActivitySessionSummary[]>("activity_session_trash_list", { request: { workspaceId } });
}

export function readActivitySession(workspaceId: string, sessionId: string): Promise<ActivitySessionDetail> {
  return request<ActivitySessionDetail>("activity_session_read", { request: { workspaceId, sessionId } });
}

export function appendActivityEvent(
  workspaceId: string,
  sessionId: string,
  kind: string,
  summary: string,
  detail?: string,
): Promise<ActivityEvent> {
  return request<ActivityEvent>("activity_session_append", {
    request: { workspaceId, sessionId, kind, summary, detail: detail ?? null },
  });
}

export function endActivitySession(workspaceId: string, sessionId: string): Promise<void> {
  return request<void>("activity_session_end", { request: { workspaceId, sessionId } });
}

export function deleteActivitySession(workspaceId: string, sessionId: string): Promise<void> {
  return request<void>("activity_session_delete", { request: { workspaceId, sessionId } });
}

export function restoreActivitySession(workspaceId: string, sessionId: string): Promise<ActivitySessionSummary> {
  return request<ActivitySessionSummary>("activity_session_restore", {
    request: { workspaceId, sessionId },
  });
}
