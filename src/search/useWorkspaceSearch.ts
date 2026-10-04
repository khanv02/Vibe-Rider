import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceDescriptor } from "../workspace/types";
import { cancelSearch, formatSearchError, startSearch, waitForSearch } from "./searchApi";
import type { SearchMatch, SearchResult, SearchStatus } from "./types";

interface WorkspaceSearchState {
  status: SearchStatus;
  query: string;
  relativeDirectory: string;
  caseSensitive: boolean;
  matches: SearchMatch[];
  suggestions: SearchResult["suggestions"];
  result: SearchResult | null;
  error: string | null;
}

export interface WorkspaceSearchController extends WorkspaceSearchState {
  run: (query: string, relativeDirectory: string, caseSensitive: boolean) => Promise<void>;
  cancel: () => Promise<void>;
  clear: () => void;
}

function initialState(): WorkspaceSearchState {
  return {
    status: "idle",
    query: "",
    relativeDirectory: "",
    caseSensitive: true,
    matches: [],
    suggestions: [],
    result: null,
    error: null,
  };
}

export function useWorkspaceSearch(workspace: WorkspaceDescriptor | null): WorkspaceSearchController {
  const [state, setState] = useState<WorkspaceSearchState>(initialState);
  const generationRef = useRef(0);
  const activeJobRef = useRef<{ workspaceId: string; searchId: string } | null>(null);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const cancel = useCallback(async () => {
    generationRef.current += 1;
    const job = activeJobRef.current;
    activeJobRef.current = null;
    if (job) {
      try {
        await cancelSearch(job);
      } catch {
        // The job may have finished between the result and cancel request.
      }
    }
    setState((current) => ({ ...current, status: current.status === "searching" || current.status === "starting" ? "cancelled" : current.status }));
  }, []);

  useEffect(() => {
    void cancel();
    setState(initialState());
    // Workspace identity is the ownership boundary for the search job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  const run = useCallback(async (query: string, relativeDirectory: string, caseSensitive: boolean) => {
    const currentWorkspace = workspaceRef.current;
    if (!currentWorkspace) return;
    await cancel();
    const generation = generationRef.current;
    setState({ status: "starting", query, relativeDirectory, caseSensitive, matches: [], suggestions: [], result: null, error: null });
    try {
      const started = await startSearch({ workspaceId: currentWorkspace.id, query, relativeDirectory, caseSensitive });
      if (generation !== generationRef.current || workspaceRef.current?.id !== currentWorkspace.id) return;
      activeJobRef.current = { workspaceId: currentWorkspace.id, searchId: started.searchId };
      setState((current) => ({ ...current, status: "searching" }));
      const result = await waitForSearch({ workspaceId: currentWorkspace.id, searchId: started.searchId });
      if (generation !== generationRef.current || workspaceRef.current?.id !== currentWorkspace.id) return;
      activeJobRef.current = null;
      const status: SearchStatus = result.status === "ready" || result.status === "noMatch" || result.status === "partial" || result.status === "cancelled" ? result.status : "error";
      setState((current) => ({ ...current, status, matches: result.matches, suggestions: result.suggestions, result, error: status === "error" ? result.partialReason : null }));
    } catch (error) {
      if (generation !== generationRef.current || workspaceRef.current?.id !== currentWorkspace.id) return;
      activeJobRef.current = null;
      setState((current) => ({ ...current, status: "error", error: formatSearchError(error) }));
    }
  }, [cancel]);

  const clear = useCallback(() => {
    void cancel();
    setState(initialState());
  }, [cancel]);

  return { ...state, run, cancel, clear };
}
