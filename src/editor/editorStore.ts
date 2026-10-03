import { create } from "zustand";
import type { EditorTab, EditorTabStatus } from "./types";

interface EditorStoreState {
  workspaceId: string | null;
  tabs: EditorTab[];
  activeFileId: string | null;
  generation: number;
  reset: (workspaceId: string | null) => void;
  upsertLoading: (fileId: string, relativePath: string) => void;
  setReady: (fileId: string, readOnly: boolean) => void;
  setActive: (fileId: string) => void;
  setDirty: (fileId: string, dirty: boolean) => void;
  setStatus: (fileId: string, status: EditorTabStatus, error?: string | null) => void;
  remove: (fileId: string) => void;
}

export const useEditorStore = create<EditorStoreState>((set) => ({
  workspaceId: null,
  tabs: [],
  activeFileId: null,
  generation: 0,
  reset: (workspaceId) => set((state) => ({ workspaceId, tabs: [], activeFileId: null, generation: state.generation + 1 })),
  upsertLoading: (fileId, relativePath) => set((state) => {
    const existing = state.tabs.find((tab) => tab.fileId === fileId);
    const tab: EditorTab = existing
      ? { ...existing, relativePath, status: "loading", error: null }
      : { fileId, relativePath, status: "loading", dirty: false, error: null, readOnly: false };
    return { tabs: existing ? state.tabs.map((item) => item.fileId === fileId ? tab : item) : [...state.tabs, tab], activeFileId: fileId };
  }),
  setReady: (fileId, readOnly) => set((state) => ({ tabs: state.tabs.map((tab) => tab.fileId === fileId ? { ...tab, status: readOnly ? "read-only" : "ready", readOnly, error: null } : tab) })),
  setActive: (fileId) => set((state) => ({ activeFileId: state.tabs.some((tab) => tab.fileId === fileId) ? fileId : state.activeFileId })),
  setDirty: (fileId, dirty) => set((state) => ({ tabs: state.tabs.map((tab) => tab.fileId === fileId ? { ...tab, dirty, status: tab.readOnly ? "read-only" : tab.status === "error" || tab.status === "conflict" ? tab.status : "ready" } : tab) })),
  setStatus: (fileId, status, error = null) => set((state) => ({ tabs: state.tabs.map((tab) => tab.fileId === fileId ? { ...tab, status, error } : tab) })),
  remove: (fileId) => set((state) => {
    const tabs = state.tabs.filter((tab) => tab.fileId !== fileId);
    const index = state.tabs.findIndex((tab) => tab.fileId === fileId);
    const fallback = tabs[Math.min(index, tabs.length - 1)]?.fileId ?? null;
    return { tabs, activeFileId: state.activeFileId === fileId ? fallback : state.activeFileId };
  }),
}));
