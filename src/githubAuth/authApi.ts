import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../tauri/runtime";
import type { GitHubAuthError, GitHubAuthPollResult, GitHubDeviceChallenge, GitHubSession } from "./types";

function desktopAuthError(): GitHubAuthError {
  return {
    code: "DESKTOP_RUNTIME_REQUIRED",
    message: "GitHub sign-in is only available in the Vibe Rider desktop app.",
    retryable: false,
  };
}

export async function beginGitHubAuth(forceAccountSelection = false): Promise<GitHubDeviceChallenge> {
  if (!isTauriRuntime()) throw desktopAuthError();
  return invoke<GitHubDeviceChallenge>("github_auth_begin", {
    request: { forceAccountSelection },
  });
}

export async function pollGitHubAuth(flowId: string): Promise<GitHubAuthPollResult> {
  if (!isTauriRuntime()) throw desktopAuthError();
  return invoke<GitHubAuthPollResult>("github_auth_poll", { request: { flowId } });
}

export async function cancelGitHubAuth(flowId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("github_auth_cancel", { request: { flowId } });
}

export async function loadGitHubSession(): Promise<GitHubSession | null> {
  if (!isTauriRuntime()) return null;
  return invoke<GitHubSession | null>("github_auth_session");
}

export async function logoutGitHub(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("github_auth_logout");
}

export function formatGitHubAuthError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
