import { create } from "zustand";
import type { EditorTab, EditorTabStatus } from "./types";

export type EditorPaneId = "E1" | "E2" | "E3" | "E4";
export const EDITOR_PANE_IDS: EditorPaneId[] = ["E1", "E2", "E3", "E4"];

interface EditorPaneState {
  tabs: EditorTab[];
  activeFileId: string | null;
}

const emptyPane = (): EditorPaneState => ({ tabs: [], activeFileId: null });
const initialPanes = (): Record<EditorPaneId, EditorPaneState> => ({ E1: emptyPane(), E2: emptyPane(), E3: emptyPane(), E4: emptyPane() });

interface EditorStoreState {
  workspaceId: string | null;
  panes: Record<EditorPaneId, EditorPaneState>;
  activePaneId: EditorPaneId;
  generation: number;
  reset: (workspaceId: string | null) => void;
  setActivePane: (paneId: EditorPaneId) => void;
  upsertLoading: (paneId: EditorPaneId, fileId: string, relativePath: string) => void;
  setReady: (fileId: string, readOnly: boolean) => void;
  setActive: (paneId: EditorPaneId, fileId: string) => void;
  setDirty: (fileId: string, dirty: boolean) => void;
  setStatus: (fileId: string, status: EditorTabStatus, error?: string | null) => void;
  remove: (paneId: EditorPaneId, fileId: string) => void;
}

export const useEditorStore = create<EditorStoreState>((set) => ({
  workspaceId: null,
  panes: initialPanes(),
  activePaneId: "E1",
  generation: 0,
  reset: (workspaceId) => set((state) => ({ workspaceId, panes: initialPanes(), generation: state.generation + 1 })),
  setActivePane: (activePaneId) => set({ activePaneId }),
  upsertLoading: (paneId, fileId, relativePath) => set((state) => {
    const pane = state.panes[paneId];
    const existing = pane.tabs.find((tab) => tab.fileId === fileId);
    const tab: EditorTab = existing
      ? { ...existing, relativePath, status: "loading", error: null }
      : { fileId, relativePath, status: "loading", dirty: false, error: null, readOnly: false };
    return { panes: { ...state.panes, [paneId]: { tabs: existing ? pane.tabs.map((item) => item.fileId === fileId ? tab : item) : [...pane.tabs, tab], activeFileId: fileId } } };
  }),
  setReady: (fileId, readOnly) => set((state) => ({ panes: Object.fromEntries(EDITOR_PANE_IDS.map((id) => [id, { ...state.panes[id], tabs: state.panes[id].tabs.map((tab) => tab.fileId === fileId ? { ...tab, status: readOnly ? "read-only" : "ready", readOnly, error: null } : tab) }])) as Record<EditorPaneId, EditorPaneState> })),
  setActive: (paneId, fileId) => set((state) => ({ panes: { ...state.panes, [paneId]: { ...state.panes[paneId], activeFileId: state.panes[paneId].tabs.some((tab) => tab.fileId === fileId) ? fileId : state.panes[paneId].activeFileId } }, activePaneId: paneId })),
  setDirty: (fileId, dirty) => set((state) => ({ panes: Object.fromEntries(EDITOR_PANE_IDS.map((id) => [id, { ...state.panes[id], tabs: state.panes[id].tabs.map((tab) => tab.fileId === fileId ? { ...tab, dirty, status: tab.readOnly ? "read-only" : tab.status === "error" || tab.status === "conflict" ? tab.status : "ready" } : tab) }])) as Record<EditorPaneId, EditorPaneState> })),
  setStatus: (fileId, status, error = null) => set((state) => ({ panes: Object.fromEntries(EDITOR_PANE_IDS.map((id) => [id, { ...state.panes[id], tabs: state.panes[id].tabs.map((tab) => tab.fileId === fileId ? { ...tab, status, error } : tab) }])) as Record<EditorPaneId, EditorPaneState> })),
  remove: (paneId, fileId) => set((state) => {
    const pane = state.panes[paneId];
    const tabs = pane.tabs.filter((tab) => tab.fileId !== fileId);
    const index = pane.tabs.findIndex((tab) => tab.fileId === fileId);
    const fallback = tabs[Math.min(index, tabs.length - 1)]?.fileId ?? null;
    return { panes: { ...state.panes, [paneId]: { tabs, activeFileId: pane.activeFileId === fileId ? fallback : pane.activeFileId } } };
  }),
}));
