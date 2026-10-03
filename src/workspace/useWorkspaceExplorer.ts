import { useCallback, useEffect, useRef, useState } from "react";
import { formatWorkspaceError, readDirectory } from "./workspaceApi";
import type { DirectoryEntry, DirectoryListing, WorkspaceDescriptor } from "./types";

export const ROOT_PATH = "";

export interface ExplorerState {
  entriesByPath: Record<string, DirectoryEntry[]>;
  errorsByPath: Record<string, string | undefined>;
  expandedPaths: Record<string, boolean>;
  loadingPaths: Record<string, boolean>;
  selectedPath: string | null;
}

export interface WorkspaceExplorerController extends ExplorerState {
  isDirectoryLoaded: (relativePath: string) => boolean;
  refreshDirectory: (relativePath: string) => void;
  retryDirectory: (relativePath: string) => void;
  selectEntry: (entry: DirectoryEntry) => void;
  toggleDirectory: (relativePath: string) => void;
}

function createInitialState(): ExplorerState {
  return {
    entriesByPath: {},
    errorsByPath: {},
    expandedPaths: {},
    loadingPaths: {},
    selectedPath: null,
  };
}

function isSameOrChild(path: string, parent: string): boolean {
  return parent === "" || path === parent || path.startsWith(parent + "/");
}

function hasOwn<T>(record: Record<string, T>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function updateRecord<T>(
  record: Record<string, T>,
  key: string,
  value: T | undefined,
): Record<string, T> {
  const next = { ...record };
  if (value === undefined) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

export function useWorkspaceExplorer(
  workspace: WorkspaceDescriptor | null,
): WorkspaceExplorerController {
  const [state, setState] = useState<ExplorerState>(createInitialState);
  const entriesRef = useRef<Record<string, DirectoryEntry[]>>({});
  const generationRef = useRef(0);
  const requestTokensRef = useRef<Record<string, number>>({});

  const loadDirectory = useCallback(
    async (relativePath: string, force = false): Promise<void> => {
      if (!workspace) {
        return;
      }

      const workspaceId = workspace.id;
      const generation = generationRef.current;
      if (!force && hasOwn(entriesRef.current, relativePath)) {
        return;
      }

      const token = (requestTokensRef.current[relativePath] ?? 0) + 1;
      requestTokensRef.current[relativePath] = token;
      setState((current) => ({
        ...current,
        errorsByPath: updateRecord(current.errorsByPath, relativePath, undefined),
        loadingPaths: updateRecord(current.loadingPaths, relativePath, true),
      }));

      try {
        const listing = await readDirectory(workspaceId, relativePath);
        if (!isCurrentRequest(workspaceId, generation, relativePath, token, workspace.id)) {
          return;
        }
        if (listing.workspaceId !== workspaceId || listing.relativePath !== relativePath) {
          setState((current) => ({
            ...current,
            errorsByPath: updateRecord(
              current.errorsByPath,
              relativePath,
              "Directory response không khớp request hiện tại.",
            ),
            loadingPaths: updateRecord(current.loadingPaths, relativePath, false),
          }));
          return;
        }
        applyListing(listing);
      } catch (error) {
        if (!isCurrentRequest(workspaceId, generation, relativePath, token, workspace.id)) {
          return;
        }
        setState((current) => ({
          ...current,
          errorsByPath: updateRecord(current.errorsByPath, relativePath, formatWorkspaceError(error)),
          loadingPaths: updateRecord(current.loadingPaths, relativePath, false),
        }));
      }
    },
    [workspace],
  );

  function isCurrentRequest(
    workspaceId: string,
    generation: number,
    relativePath: string,
    token: number,
    currentWorkspaceId: string,
  ): boolean {
    return (
      workspaceId === currentWorkspaceId &&
      generation === generationRef.current &&
      token === requestTokensRef.current[relativePath]
    );
  }

  function applyListing(listing: DirectoryListing) {
    setState((current) => {
      const entriesByPath = updateRecord(
        current.entriesByPath,
        listing.relativePath,
        listing.entries,
      );
      entriesRef.current = entriesByPath;
      return {
        ...current,
        entriesByPath,
        errorsByPath: updateRecord(current.errorsByPath, listing.relativePath, undefined),
        loadingPaths: updateRecord(current.loadingPaths, listing.relativePath, false),
      };
    });
  }

  useEffect(() => {
    generationRef.current += 1;
    requestTokensRef.current = {};
    entriesRef.current = {};
    setState(createInitialState());
    if (workspace) {
      void loadDirectory(ROOT_PATH, true);
    }
  }, [loadDirectory, workspace?.id]);

  const isDirectoryLoaded = useCallback(
    (relativePath: string) => hasOwn(state.entriesByPath, relativePath),
    [state.entriesByPath],
  );

  const toggleDirectory = useCallback(
    (relativePath: string) => {
      const isExpanded = state.expandedPaths[relativePath] === true;
      setState((current) => ({
        ...current,
        expandedPaths: updateRecord(current.expandedPaths, relativePath, !isExpanded),
      }));
      if (!isExpanded && !hasOwn(entriesRef.current, relativePath)) {
        void loadDirectory(relativePath);
      }
    },
    [loadDirectory, state.expandedPaths],
  );

  const refreshDirectory = useCallback(
    (relativePath: string) => {
      const nextTokens = { ...requestTokensRef.current };
      Object.keys(nextTokens)
        .filter((path) => isSameOrChild(path, relativePath))
        .forEach((path) => {
          nextTokens[path] = (nextTokens[path] ?? 0) + 1;
        });
      nextTokens[relativePath] = (nextTokens[relativePath] ?? 0) + 1;
      requestTokensRef.current = nextTokens;

      setState((current) => {
        const entriesByPath = { ...current.entriesByPath };
        const errorsByPath = { ...current.errorsByPath };
        const loadingPaths = { ...current.loadingPaths };
        const expandedPaths = { ...current.expandedPaths };
        Object.keys(entriesByPath)
          .filter((path) => isSameOrChild(path, relativePath))
          .forEach((path) => delete entriesByPath[path]);
        Object.keys(errorsByPath)
          .filter((path) => isSameOrChild(path, relativePath))
          .forEach((path) => delete errorsByPath[path]);
        Object.keys(loadingPaths)
          .filter((path) => isSameOrChild(path, relativePath))
          .forEach((path) => delete loadingPaths[path]);
        Object.keys(expandedPaths)
          .filter((path) => path !== relativePath && isSameOrChild(path, relativePath))
          .forEach((path) => delete expandedPaths[path]);

        entriesRef.current = entriesByPath;
        return {
          ...current,
          entriesByPath,
          errorsByPath,
          expandedPaths,
          loadingPaths,
          selectedPath:
            current.selectedPath && isSameOrChild(current.selectedPath, relativePath)
              ? null
              : current.selectedPath,
        };
      });
      void loadDirectory(relativePath, true);
    },
    [loadDirectory],
  );

  const retryDirectory = useCallback(
    (relativePath: string) => {
      void loadDirectory(relativePath, true);
    },
    [loadDirectory],
  );

  const selectEntry = useCallback((entry: DirectoryEntry) => {
    setState((current) => ({ ...current, selectedPath: entry.relativePath }));
  }, []);

  return {
    ...state,
    isDirectoryLoaded,
    refreshDirectory,
    retryDirectory,
    selectEntry,
    toggleDirectory,
  };
}
