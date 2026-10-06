import { useCallback, useEffect, useRef, useState } from "react";
import { openExternalUrl } from "../git/accountApi";
import { isTauriRuntime } from "../tauri/runtime";
import { beginGitHubAuth, cancelGitHubAuth, formatGitHubAuthError, loadGitHubSession, logoutGitHub, pollGitHubAuth } from "./authApi";
import type { WorkspaceGitHubAuthController, GitHubDeviceChallenge, GitHubSession } from "./types";

export function useGitHubAuth(canAuthenticate: boolean): WorkspaceGitHubAuthController {
  const [session, setSession] = useState<GitHubSession | null>(null);
  const [challenge, setChallenge] = useState<GitHubDeviceChallenge | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState<WorkspaceGitHubAuthController["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(5);
  const [pollCycle, setPollCycle] = useState(0);
  const disposedRef = useRef(false);
  const authOperationRef = useRef(0);

  useEffect(() => {
    disposedRef.current = false;
    if (!isTauriRuntime()) return () => { disposedRef.current = true; };
    void loadGitHubSession()
      .then((loaded) => {
        if (disposedRef.current) return;
        setSession(loaded);
        setStatus(loaded ? "success" : "idle");
      })
      .catch((loadError) => {
        if (disposedRef.current) return;
        setError(formatGitHubAuthError(loadError));
        setStatus("error");
      });
    return () => { disposedRef.current = true; };
  }, []);

  const begin = useCallback(async () => {
    if (!canAuthenticate) {
      setError("Open a workspace folder before signing in to GitHub.");
      return;
    }
    const operation = ++authOperationRef.current;
    setDialogOpen(true);
    setError(null);
    setStatus("loading");
    try {
      const nextChallenge = await beginGitHubAuth(true);
      if (disposedRef.current || operation !== authOperationRef.current) {
        try {
          await cancelGitHubAuth(nextChallenge.flowId);
        } catch {
          // A newer auth operation already owns the backend state.
        }
        return;
      }
      setChallenge(nextChallenge);
      setPollIntervalSeconds(nextChallenge.pollIntervalSeconds);
      setPollCycle(0);
      setStatus("waiting");
      try {
        await openExternalUrl(nextChallenge.verificationUri);
      } catch (openError) {
        // The device flow is still valid when Windows cannot launch the
        // browser. Keep polling and let the user retry with "Open GitHub".
        setError(formatGitHubAuthError(openError));
      }
    } catch (beginError) {
      if (disposedRef.current || operation !== authOperationRef.current) return;
      setError(formatGitHubAuthError(beginError));
      setStatus("error");
    }
  }, [canAuthenticate]);

  useEffect(() => {
    if (!challenge || status !== "waiting") return;
    let cancelled = false;
    const flowId = challenge.flowId;
    const operation = authOperationRef.current;
    const timer = window.setTimeout(async () => {
      try {
        const result = await pollGitHubAuth(flowId);
        if (cancelled || disposedRef.current || operation !== authOperationRef.current) return;
        if (result.status === "verified") {
          setSession(result.session);
          setChallenge(null);
          setDialogOpen(false);
          setStatus("success");
          setError(null);
          return;
        }
        const nextInterval = result.nextPollIntervalSeconds;
        setPollIntervalSeconds(Number.isFinite(nextInterval) ? Math.max(5, nextInterval) : 5);
        // A pending response commonly keeps the same status and interval.
        // Advance an explicit cycle so the effect always schedules the next poll.
        setPollCycle((cycle) => cycle + 1);
      } catch (pollError) {
        if (cancelled || disposedRef.current || operation !== authOperationRef.current) return;
        setError(formatGitHubAuthError(pollError));
        setStatus("error");
      }
    }, pollIntervalSeconds * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [challenge, pollCycle, pollIntervalSeconds, status]);

  const openVerification = useCallback(async () => {
    if (!challenge) return;
    try {
      await openExternalUrl(challenge.verificationUri);
      setError(null);
    } catch (openError) {
      setError(formatGitHubAuthError(openError));
    }
  }, [challenge]);

  const cancel = useCallback(async () => {
    authOperationRef.current += 1;
    const currentChallenge = challenge;
    setDialogOpen(false);
    setChallenge(null);
    setStatus(session ? "success" : "idle");
    setError(null);
    if (!currentChallenge) return;
    try {
      await cancelGitHubAuth(currentChallenge.flowId);
    } catch (cancelError) {
      setError(formatGitHubAuthError(cancelError));
      setStatus("error");
    }
  }, [challenge, session]);

  const logout = useCallback(async () => {
    authOperationRef.current += 1;
    setError(null);
    try {
      await logoutGitHub();
      setSession(null);
      setChallenge(null);
      setDialogOpen(false);
      setStatus("idle");
    } catch (logoutError) {
      setError(formatGitHubAuthError(logoutError));
      setStatus("error");
    }
  }, []);

  const copyUserCode = useCallback(async () => {
    if (!challenge) return false;
    try {
      await navigator.clipboard.writeText(challenge.userCode);
      setError(null);
      return true;
    } catch {
      setError("Could not copy the sign-in code. Please select and copy it manually.");
      return false;
    }
  }, [challenge]);

  return { session, canAuthenticate, challenge, dialogOpen, status, error, begin, openVerification, cancel, logout, copyUserCode };
}
