import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceDescriptor } from "../workspace/types";
import {
  appendActivityEvent,
  deleteActivitySession,
  endActivitySession,
  listActivitySessions,
  listActivityTrash,
  readActivitySession,
  restoreActivitySession,
  startActivitySession,
} from "./activityApi";
import type { ActivitySessionDetail, ActivitySessionSummary } from "./types";

export interface WorkspaceActivityController {
  currentSession: ActivitySessionSummary | null;
  sessions: ActivitySessionSummary[];
  trash: ActivitySessionSummary[];
  selected: ActivitySessionDetail | null;
  busy: boolean;
  error: string | null;
  record: (kind: string, summary: string, detail?: string) => Promise<void>;
  select: (sessionId: string) => Promise<void>;
  clearSelection: () => void;
  resume: (sessionId: string) => Promise<void>;
  remove: (sessionId: string) => Promise<void>;
  restore: (sessionId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

function messageFor(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string") {
      const code = value.match(/^([A-Z][A-Z0-9_]+):/)?.[1];
      const messages: Record<string, string> = {
        NO_WORKSPACE: "Open a workspace before using Activity.",
        STALE_WORKSPACE: "The workspace changed while Activity was running.",
        ACTIVITY_STATE: "Activity state is unavailable.",
        ACTIVITY_PATH: "The Activity storage path is invalid.",
        ACTIVITY_INVALID: "The Activity session data is invalid.",
        ACTIVITY_LIMIT: "The Activity session reached its limit.",
        ACTIVITY_NOT_ACTIVE: "This Activity session is no longer active.",
        ACTIVITY_EXISTS: "A session with this ID already exists.",
      };
      return (code && messages[code]) || "The Activity operation failed. Try again.";
    }
  }
  return error instanceof Error ? error.message : "The Activity operation failed. Try again.";
}

async function discardEmptySessions(
  workspaceId: string,
  existing: ActivitySessionSummary[],
): Promise<ActivitySessionSummary[]> {
  const meaningful: ActivitySessionSummary[] = [];
  for (const session of existing) {
    if (session.eventCount > 0) {
      meaningful.push(session);
      continue;
    }
    if (session.status === "active") {
      await endActivitySession(workspaceId, session.sessionId).catch(() => undefined);
    }
    await deleteActivitySession(workspaceId, session.sessionId).catch(() => undefined);
  }
  return meaningful;
}

export function useWorkspaceActivity(workspace: WorkspaceDescriptor | null): WorkspaceActivityController {
  const [currentSession, setCurrentSession] = useState<ActivitySessionSummary | null>(null);
  const [sessions, setSessions] = useState<ActivitySessionSummary[]>([]);
  const [trash, setTrash] = useState<ActivitySessionSummary[]>([]);
  const [selected, setSelected] = useState<ActivitySessionDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaceRef = useRef(workspace);
  const currentSessionRef = useRef<ActivitySessionSummary | null>(null);
  const sessionStartRef = useRef<Promise<{ session: ActivitySessionSummary; created: boolean }> | null>(null);
  const generationRef = useRef(0);
  workspaceRef.current = workspace;

  const refresh = useCallback(async () => {
    const target = workspaceRef.current;
    if (!target) {
      setSessions([]);
      return;
    }
    try {
      const [existing, deleted] = await Promise.all([listActivitySessions(target.id), listActivityTrash(target.id)]);
      const next = await discardEmptySessions(target.id, existing);
      if (workspaceRef.current?.id !== target.id) return;
      setSessions(next);
      setTrash(deleted);
    } catch (loadError) {
      if (workspaceRef.current?.id === target.id) setError(messageFor(loadError));
    }
  }, []);

  useEffect(() => {
    const target = workspace;
    const generation = ++generationRef.current;
    currentSessionRef.current = null;
    sessionStartRef.current = null;
    setCurrentSession(null);
    setSelected(null);
    setSessions([]);
    setTrash([]);
    setError(null);
    if (!target) return;

    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        const [existing, deleted] = await Promise.all([listActivitySessions(target.id), listActivityTrash(target.id)]);
        if (cancelled || generation !== generationRef.current) return;
        const meaningful = await discardEmptySessions(target.id, existing);
        setSessions(meaningful);
        setTrash(deleted);
        const active = meaningful.find((session) => session.status === "active");
        if (cancelled || generation !== generationRef.current) return;
        if (active) {
          currentSessionRef.current = active;
          setCurrentSession(active);
        }
      } catch (loadError) {
        if (!cancelled && generation === generationRef.current) setError(messageFor(loadError));
      } finally {
        if (!cancelled && generation === generationRef.current) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace?.id]);

  const record = useCallback(async (kind: string, summary: string, detail?: string) => {
    const target = workspaceRef.current;
    if (!target) return;
    let session = currentSessionRef.current;
    let created = false;
    try {
      if (!session || session.status !== "active") {
        if (!sessionStartRef.current) {
          sessionStartRef.current = startActivitySession(target.id, "Workspace activity").then((next) => {
            currentSessionRef.current = next;
            setCurrentSession(next);
            setSessions((current) => [next, ...current.filter((item) => item.sessionId !== next.sessionId)]);
            return { session: next, created: true };
          }).finally(() => {
            sessionStartRef.current = null;
          });
        }
        const started = await sessionStartRef.current;
        session = started.session;
        created = started.created;
      }
      if (!session || session.status !== "active") return;
      const event = await appendActivityEvent(target.id, session.sessionId, kind, summary, detail);
      setSessions((current) => current.map((item) => item.sessionId === session.sessionId
        ? { ...item, updatedAt: event.at, eventCount: item.eventCount + 1 }
        : item));
    } catch (recordError) {
      if (created) {
        const empty = await readActivitySession(target.id, session?.sessionId ?? "").catch(() => null);
        if (empty && empty.events.length === 0) {
          await endActivitySession(target.id, empty.session.sessionId).catch(() => undefined);
          await deleteActivitySession(target.id, empty.session.sessionId).catch(() => undefined);
          currentSessionRef.current = null;
          setCurrentSession(null);
          setSessions((current) => current.filter((item) => item.sessionId !== empty.session.sessionId));
        }
      }
      if (workspaceRef.current?.id === target.id) setError(messageFor(recordError));
    }
  }, []);

  const select = useCallback(async (sessionId: string) => {
    const target = workspaceRef.current;
    if (!target) return;
    setBusy(true);
    try {
      setSelected(await readActivitySession(target.id, sessionId));
      setError(null);
    } catch (readError) {
      setError(messageFor(readError));
    } finally {
      setBusy(false);
    }
  }, []);

  const resume = useCallback(async (sessionId: string) => {
    const target = workspaceRef.current;
    if (!target) return;
    const source = sessions.find((item) => item.sessionId === sessionId);
    const previous = currentSessionRef.current;
    setBusy(true);
    try {
      if (previous) await endActivitySession(target.id, previous.sessionId);
      const next = await startActivitySession(target.id, `Resumed: ${source?.title ?? "previous session"}`);
      currentSessionRef.current = next;
      setCurrentSession(next);
      setSessions((current) => [next, ...current]);
      await appendActivityEvent(target.id, next.sessionId, "system", "Resumed activity log", `Source session: ${sessionId}`);
      setError(null);
    } catch (resumeError) {
      setError(messageFor(resumeError));
    } finally {
      setBusy(false);
    }
  }, [sessions]);

  const remove = useCallback(async (sessionId: string) => {
    const target = workspaceRef.current;
    if (!target || currentSessionRef.current?.sessionId === sessionId) return;
    setBusy(true);
    try {
      await deleteActivitySession(target.id, sessionId);
      setSessions((current) => current.filter((item) => item.sessionId !== sessionId));
      setSelected((current) => current?.session.sessionId === sessionId ? null : current);
      setTrash(await listActivityTrash(target.id));
      setError(null);
    } catch (deleteError) {
      setError(messageFor(deleteError));
    } finally {
      setBusy(false);
    }
  }, []);

  const restore = useCallback(async (sessionId: string) => {
    const target = workspaceRef.current;
    if (!target) return;
    setBusy(true);
    try {
      const restored = await restoreActivitySession(target.id, sessionId);
      setTrash((current) => current.filter((item) => item.sessionId !== sessionId));
      setSessions((current) => [restored, ...current.filter((item) => item.sessionId !== sessionId)]);
      setError(null);
    } catch (restoreError) {
      setError(messageFor(restoreError));
    } finally {
      setBusy(false);
    }
  }, []);

  const clearSelection = useCallback(() => setSelected(null), []);

  return { currentSession, sessions, trash, selected, busy, error, record, select, clearSelection, resume, restore, remove, refresh };
}
