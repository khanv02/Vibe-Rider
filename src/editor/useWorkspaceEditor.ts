import { useCallback, useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import type { WorkspaceDescriptor } from "../workspace/types";
import { formatEditorError, readFile, writeFile } from "./editorApi";
import { useEditorStore } from "./editorStore";
import { configureMonaco, languageForPath, modelUri } from "./monacoRuntime";
import { EditorModelRegistry } from "./modelRegistry";
import type { DiffPreview, EditorModelEntry } from "./types";

const MAX_OPEN_TABS = 20;
const MAX_OPEN_TEXT_BYTES = 20 * 1024 * 1024;

export interface WorkspaceEditorController {
  tabs: ReturnType<typeof useEditorStore.getState>["tabs"];
  activeFileId: string | null;
  activeEntry: EditorModelEntry | null;
  diff: DiffPreview | null;
  openFile: (relativePath: string) => Promise<void>;
  setActive: (fileId: string) => void;
  updateDraft: (fileId: string, content: string) => void;
  saveFile: (fileId?: string) => Promise<boolean>;
  saveAll: () => Promise<boolean>;
  closeFile: (fileId: string) => void;
  hasDirty: () => boolean;
  prepareWorkspaceChange: () => Promise<boolean>;
  showDiff: (fileId?: string) => void;
  compareWithDisk: (fileId?: string) => Promise<void>;
  reloadFromDisk: (fileId?: string) => Promise<void>;
  closeDiff: () => void;
}

export function useWorkspaceEditor(workspace: WorkspaceDescriptor | null): WorkspaceEditorController {
  const tabs = useEditorStore((state) => state.tabs);
  const activeFileId = useEditorStore((state) => state.activeFileId);
  const registryRef = useRef(new EditorModelRegistry());
  const workspaceRef = useRef(workspace);
  const requestGeneration = useRef(0);
  const savingFilesRef = useRef(new Set<string>());
  const diffRef = useRef<DiffPreview | null>(null);
  const [, setRenderVersion] = useState(0);
  const forceRender = useCallback(() => setRenderVersion((version) => version + 1), []);
  workspaceRef.current = workspace;

  useEffect(() => {
    registryRef.current.clear();
    requestGeneration.current += 1;
    useEditorStore.getState().reset(workspace?.id ?? null);
    diffRef.current = null;
  }, [workspace?.id]);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    let polling = false;
    const pollDiskChanges = async () => {
      if (polling || cancelled) return;
      polling = true;
      try {
        const currentWorkspace = workspaceRef.current;
        if (!currentWorkspace || currentWorkspace.id !== workspace.id) return;
        for (const [fileId, entry] of registryRef.current) {
          if (cancelled) return;
          try {
            const diskSnapshot = await readFile(currentWorkspace.id, entry.snapshot.relativePath);
            if (diskSnapshot.revision === entry.snapshot.revision) continue;
            const tab = useEditorStore.getState().tabs.find((item) => item.fileId === fileId);
            if (!tab) continue;
            if (tab.dirty || entry.model.getValue() !== entry.baseline) {
              useEditorStore.getState().setStatus(fileId, "conflict", "File trên disk đã thay đổi. Hãy Compare disk hoặc Reload disk trước khi lưu.");
              continue;
            }
            entry.snapshot = diskSnapshot;
            entry.baseline = diskSnapshot.content;
            entry.model.setValue(diskSnapshot.content);
            useEditorStore.getState().setReady(fileId, !diskSnapshot.writable || diskSnapshot.eol === "mixed" || diskSnapshot.eol === "cr");
          } catch (error) {
            const tab = useEditorStore.getState().tabs.find((item) => item.fileId === fileId);
            if (tab && !tab.dirty) useEditorStore.getState().setStatus(fileId, "conflict", formatEditorError(error));
          }
        }
        forceRender();
      } finally {
        polling = false;
      }
    };
    void pollDiskChanges();
    const timer = window.setInterval(() => void pollDiskChanges(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [forceRender, workspace?.id]);

  const openFile = useCallback(async (relativePath: string) => {
    const currentWorkspace = workspaceRef.current;
    if (!currentWorkspace) return;
    configureMonaco();
    const fileId = relativePath;
    const token = ++requestGeneration.current;
    const existing = registryRef.current.get(fileId);
    if (existing) {
      useEditorStore.getState().setActive(fileId);
      forceRender();
      return;
    }
    if (useEditorStore.getState().tabs.length >= MAX_OPEN_TABS) {
      window.alert(`Editor hỗ trợ tối đa ${MAX_OPEN_TABS} tabs trong Phase 5.`);
      return;
    }
    useEditorStore.getState().upsertLoading(fileId, relativePath);
    try {
      const snapshot = await readFile(currentWorkspace.id, relativePath);
      if (workspaceRef.current?.id !== currentWorkspace.id) return;
      if (token !== requestGeneration.current) {
        useEditorStore.getState().remove(fileId);
        return;
      }
      const currentBytes = Array.from(registryRef.current.values()).reduce((total, entry) => total + entry.snapshot.byteLength, 0);
      if (currentBytes + snapshot.byteLength > MAX_OPEN_TEXT_BYTES) {
        useEditorStore.getState().remove(fileId);
        window.alert("Tổng dung lượng Editor đã vượt giới hạn 20 MiB.");
        return;
      }
      const model = monaco.editor.createModel(snapshot.content, languageForPath(relativePath), modelUri(currentWorkspace.id, snapshot.fileId));
      registryRef.current.set(fileId, { model, snapshot, baseline: snapshot.content, viewState: null });
      useEditorStore.getState().setReady(fileId, !snapshot.writable || snapshot.eol === "mixed" || snapshot.eol === "cr");
      forceRender();
    } catch (error) {
      if (workspaceRef.current?.id === currentWorkspace.id && token !== requestGeneration.current) {
        useEditorStore.getState().remove(fileId);
      } else if (token === requestGeneration.current) {
        useEditorStore.getState().setStatus(fileId, "error", formatEditorError(error));
      }
      forceRender();
    }
  }, [forceRender]);

  const updateDraft = useCallback((fileId: string, content: string) => {
    const entry = registryRef.current.get(fileId);
    if (entry) useEditorStore.getState().setDirty(fileId, content !== entry.baseline);
  }, []);

  const saveFile = useCallback(async (fileId = useEditorStore.getState().activeFileId ?? undefined) => {
    const currentWorkspace = workspaceRef.current;
    if (!currentWorkspace || !fileId) return false;
    const entry = registryRef.current.get(fileId);
    const tab = useEditorStore.getState().tabs.find((item) => item.fileId === fileId);
    if (!entry || !tab || tab.readOnly) return false;
    if (savingFilesRef.current.has(fileId)) return false;
    savingFilesRef.current.add(fileId);
    const content = entry.model.getValue();
    const modelVersion = entry.model.getVersionId();
    useEditorStore.getState().setStatus(fileId, "saving");
    try {
      const result = await writeFile(currentWorkspace.id, entry.snapshot.relativePath, entry.snapshot.revision, content);
      if (workspaceRef.current?.id !== currentWorkspace.id) return false;
      entry.snapshot = { ...entry.snapshot, content, revision: result.revision, byteLength: result.byteLength };
      entry.baseline = content;
      const stillChanged = entry.model.getVersionId() !== modelVersion && entry.model.getValue() !== content;
      useEditorStore.getState().setDirty(fileId, stillChanged);
      useEditorStore.getState().setStatus(fileId, stillChanged ? "ready" : "ready", null);
      forceRender();
      return true;
    } catch (error) {
      const message = formatEditorError(error);
      useEditorStore.getState().setStatus(fileId, message.includes("Conflict") || message.includes("thay đổi") ? "conflict" : "error", message);
      return false;
    } finally {
      savingFilesRef.current.delete(fileId);
    }
  }, [forceRender]);

  const saveAll = useCallback(async () => {
    for (const tab of useEditorStore.getState().tabs) {
      if (tab.dirty && !(await saveFile(tab.fileId))) return false;
    }
    return true;
  }, [saveFile]);

  const closeFile = useCallback((fileId: string) => {
    registryRef.current.delete(fileId);
    useEditorStore.getState().remove(fileId);
    forceRender();
  }, [forceRender]);

  const hasDirty = useCallback(() => useEditorStore.getState().tabs.some((tab) => tab.dirty), []);

  const prepareWorkspaceChange = useCallback(async () => {
    if (!hasDirty()) return true;
    const shouldSave = window.confirm("Có file chưa lưu. Nhấn OK để Save All, Cancel để giữ workspace hiện tại.");
    return shouldSave ? saveAll() : false;
  }, [hasDirty, saveAll]);

  const showDiff = useCallback((fileId = useEditorStore.getState().activeFileId ?? undefined) => {
    if (!fileId) return;
    const entry = registryRef.current.get(fileId);
    if (!entry) return;
    diffRef.current = { fileId, relativePath: entry.snapshot.relativePath, original: entry.baseline, modified: entry.model.getValue() };
    forceRender();
  }, [forceRender]);

  const compareWithDisk = useCallback(async (fileId = useEditorStore.getState().activeFileId ?? undefined) => {
    const currentWorkspace = workspaceRef.current;
    if (!currentWorkspace || !fileId) return;
    const entry = registryRef.current.get(fileId);
    if (!entry) return;
    try {
      const diskSnapshot = await readFile(currentWorkspace.id, entry.snapshot.relativePath);
      if (workspaceRef.current?.id !== currentWorkspace.id) return;
      diffRef.current = {
        fileId,
        relativePath: entry.snapshot.relativePath,
        original: diskSnapshot.content,
        modified: entry.model.getValue(),
      };
      forceRender();
    } catch (error) {
      useEditorStore.getState().setStatus(fileId, "conflict", formatEditorError(error));
      forceRender();
    }
  }, [forceRender]);

  const reloadFromDisk = useCallback(async (fileId = useEditorStore.getState().activeFileId ?? undefined) => {
    const currentWorkspace = workspaceRef.current;
    if (!currentWorkspace || !fileId) return;
    const entry = registryRef.current.get(fileId);
    if (!entry) return;
    try {
      const snapshot = await readFile(currentWorkspace.id, entry.snapshot.relativePath);
      if (workspaceRef.current?.id !== currentWorkspace.id) return;
      entry.snapshot = snapshot;
      entry.baseline = snapshot.content;
      entry.model.setValue(snapshot.content);
      useEditorStore.getState().setReady(fileId, !snapshot.writable || snapshot.eol === "mixed" || snapshot.eol === "cr");
      forceRender();
    } catch (error) {
      useEditorStore.getState().setStatus(fileId, "conflict", formatEditorError(error));
      forceRender();
    }
  }, [forceRender]);

  const closeDiff = useCallback(() => { diffRef.current = null; forceRender(); }, [forceRender]);
  const activeEntry = activeFileId ? registryRef.current.get(activeFileId) ?? null : null;
  return { tabs, activeFileId, activeEntry, diff: diffRef.current, openFile, setActive: useEditorStore.getState().setActive, updateDraft, saveFile, saveAll, closeFile, hasDirty, prepareWorkspaceChange, showDiff, compareWithDisk, reloadFromDisk, closeDiff };
}
