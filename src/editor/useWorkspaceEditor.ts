import { useCallback, useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import type { WorkspaceDescriptor } from "../workspace/types";
import { formatEditorError, readFile, restoreFile, writeFile } from "./editorApi";
import { applyPatch, proposePatch, rejectPatch } from "./patchApi";
import { useEditorStore } from "./editorStore";
import { configureMonaco, languageForPath, modelUri } from "./monacoRuntime";
import { EditorModelRegistry } from "./modelRegistry";
import type { DiffPreview, EditorLocation, EditorModelEntry, FileOperationKind, PatchProposal, PendingFileOperation, TextFileSnapshot } from "./types";

const MAX_OPEN_TABS = 20;
const MAX_OPEN_TEXT_BYTES = 20 * 1024 * 1024;

export interface WorkspaceEditorController {
  tabs: ReturnType<typeof useEditorStore.getState>["tabs"];
  activeFileId: string | null;
  activeEntry: EditorModelEntry | null;
  getEntry: (fileId: string) => EditorModelEntry | null;
  diff: DiffPreview | null;
  proposal: PatchProposal | null;
  proposalError: string | null;
  navigation: EditorLocation | null;
  openFile: (relativePath: string) => Promise<boolean>;
  openFileAtLocation: (relativePath: string, line: number, column: number, endColumn?: number) => Promise<boolean>;
  setActive: (fileId: string) => void;
  updateDraft: (fileId: string, content: string) => void;
  saveFile: (fileId?: string) => Promise<boolean>;
  saveAll: () => Promise<boolean>;
  closeFile: (fileId: string) => void;
  hasDirty: () => boolean;
  prepareWorkspaceChange: () => Promise<boolean>;
  showDiff: (fileId?: string) => Promise<void>;
  acceptProposal: () => Promise<boolean>;
  rejectProposal: () => void;
  compareWithDisk: (fileId?: string) => Promise<void>;
  reloadFromDisk: (fileId?: string) => Promise<void>;
  closeDiff: () => void;
  pendingFilePaths: string[];
  captureFileOperation: (relativePaths: string[], kind: FileOperationKind) => void;
  completeFileOperation: (success: boolean) => void;
  undoLastFileOperation: () => Promise<boolean>;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => Promise<boolean>;
  goForward: () => Promise<boolean>;
}

interface FileUndoSnapshot {
  fileId: string;
  relativePath: string;
  content: string;
  revision: string;
  byteLength: number;
  eol: TextFileSnapshot["eol"];
  bom: boolean;
}

interface FileUndoRecord extends PendingFileOperation {
  workspaceId: string;
  committed: boolean;
  snapshots: FileUndoSnapshot[];
}

export function useWorkspaceEditor(workspace: WorkspaceDescriptor | null): WorkspaceEditorController {
  const tabs = useEditorStore((state) => state.tabs);
  const activeFileId = useEditorStore((state) => state.activeFileId);
  const registryRef = useRef(new EditorModelRegistry());
  const workspaceRef = useRef(workspace);
  const requestGeneration = useRef(0);
  const savingFilesRef = useRef(new Set<string>());
  const diffRef = useRef<DiffPreview | null>(null);
  const proposalRef = useRef<PatchProposal | null>(null);
  const applyingProposalRef = useRef(false);
  const pendingFileOperationRef = useRef<FileUndoRecord | null>(null);
  const undoRunningRef = useRef(false);
  const fileHistoryRef = useRef<{ entries: string[]; index: number }>({ entries: [], index: -1 });
  const [proposal, setProposal] = useState<PatchProposal | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [navigation, setNavigation] = useState<EditorLocation | null>(null);
  const [pendingFilePaths, setPendingFilePaths] = useState<string[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [, setRenderVersion] = useState(0);
  const forceRender = useCallback(() => setRenderVersion((version) => version + 1), []);
  workspaceRef.current = workspace;

  const recordFileNavigation = useCallback((relativePath: string) => {
    const history = fileHistoryRef.current;
    if (history.entries[history.index] === relativePath) return;
    history.entries = history.entries.slice(0, history.index + 1);
    history.entries.push(relativePath);
    history.index = history.entries.length - 1;
    setHistoryVersion((version) => version + 1);
  }, []);

  const captureFileOperation = useCallback((relativePaths: string[], kind: FileOperationKind) => {
    const targets = relativePaths.filter(Boolean);
    const snapshots = [...registryRef.current.values()]
      .filter((entry) => targets.some((target) => entry.snapshot.relativePath === target || entry.snapshot.relativePath.startsWith(`${target}/`)))
      .map((entry) => ({
        fileId: entry.snapshot.fileId,
        relativePath: entry.snapshot.relativePath,
        content: entry.model.getValue(),
        revision: entry.snapshot.revision,
        byteLength: entry.snapshot.byteLength,
        eol: entry.snapshot.eol,
        bom: entry.snapshot.bom,
      }));
    pendingFileOperationRef.current = snapshots.length > 0
      ? { kind, relativePaths: snapshots.map((snapshot) => snapshot.relativePath), workspaceId: workspaceRef.current?.id ?? "", committed: false, snapshots }
      : null;
    setPendingFilePaths([]);
  }, []);

  const completeFileOperation = useCallback((success: boolean) => {
    const operation = pendingFileOperationRef.current;
    if (!operation || !success) {
      pendingFileOperationRef.current = null;
      setPendingFilePaths([]);
      return;
    }
    operation.committed = true;
    setPendingFilePaths(operation.relativePaths);
    const message = operation.kind === "delete"
      ? "File đã bị xóa trên disk. Nhấn Ctrl+Z để phục hồi."
      : "File đã được Restore trên disk. Nhấn Ctrl+Z để hoàn tác.";
    for (const snapshot of operation.snapshots) {
      useEditorStore.getState().setStatus(snapshot.fileId, "conflict", message);
    }
  }, []);

  const undoLastFileOperation = useCallback(async (): Promise<boolean> => {
    const operation = pendingFileOperationRef.current;
    const currentWorkspace = workspaceRef.current;
    if (!operation?.committed || !currentWorkspace || undoRunningRef.current) return false;
    undoRunningRef.current = true;
    try {
      for (const snapshot of operation.snapshots) {
        let result;
        try {
          const current = await readFile(currentWorkspace.id, snapshot.relativePath);
          result = await writeFile(currentWorkspace.id, snapshot.relativePath, current.revision, snapshot.content);
        } catch (error) {
          const code = typeof error === "object" && error !== null && "code" in error
            ? (error as { code?: unknown }).code
            : undefined;
          if (code !== "NOT_FOUND") throw error;
          result = await restoreFile(currentWorkspace.id, snapshot.relativePath, snapshot.content, snapshot.eol, snapshot.bom);
        }
        const entry = registryRef.current.get(snapshot.fileId);
        if (entry) {
          entry.snapshot = { ...entry.snapshot, content: snapshot.content, revision: result.revision, byteLength: result.byteLength };
          entry.baseline = snapshot.content;
          entry.model.setValue(snapshot.content);
          useEditorStore.getState().setReady(snapshot.fileId, !entry.snapshot.writable || entry.snapshot.eol === "mixed" || entry.snapshot.eol === "cr");
        }
      }
      pendingFileOperationRef.current = null;
      setPendingFilePaths([]);
      forceRender();
      return true;
    } catch (error) {
      setProposalError(formatEditorError(error));
      return false;
    } finally {
      undoRunningRef.current = false;
    }
  }, [forceRender]);

  useEffect(() => {
    const onUndo = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      if (!pendingFileOperationRef.current?.committed || undoRunningRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      void undoLastFileOperation();
    };
    window.addEventListener("keydown", onUndo, true);
    return () => window.removeEventListener("keydown", onUndo, true);
  }, [undoLastFileOperation]);

  useEffect(() => {
    registryRef.current.clear();
    requestGeneration.current += 1;
    useEditorStore.getState().reset(workspace?.id ?? null);
    diffRef.current = null;
    proposalRef.current = null;
    applyingProposalRef.current = false;
    pendingFileOperationRef.current = null;
    fileHistoryRef.current = { entries: [], index: -1 };
    setHistoryVersion((version) => version + 1);
    setPendingFilePaths([]);
    setProposal(null);
    setProposalError(null);
    setNavigation(null);
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
        for (const entry of registryRef.current.values()) {
          const fileId = entry.snapshot.fileId;
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

  const openFileInternal = useCallback(async (relativePath: string): Promise<boolean> => {
    const currentWorkspace = workspaceRef.current;
    if (!currentWorkspace) return false;
    configureMonaco();
    const fileId = relativePath;
    const token = ++requestGeneration.current;
    const existing = registryRef.current.get(fileId);
    if (existing) {
      useEditorStore.getState().setActive(fileId);
      forceRender();
      return true;
    }
    if (useEditorStore.getState().tabs.length >= MAX_OPEN_TABS) {
      window.alert(`Editor hỗ trợ tối đa ${MAX_OPEN_TABS} tabs trong Phase 5.`);
      return false;
    }
    useEditorStore.getState().upsertLoading(fileId, relativePath);
    try {
      const snapshot = await readFile(currentWorkspace.id, relativePath);
      if (workspaceRef.current?.id !== currentWorkspace.id) return false;
      if (token !== requestGeneration.current) {
        useEditorStore.getState().remove(fileId);
        return false;
      }
      const currentBytes = Array.from(registryRef.current.values()).reduce((total, entry) => total + entry.snapshot.byteLength, 0);
      if (currentBytes + snapshot.byteLength > MAX_OPEN_TEXT_BYTES) {
        useEditorStore.getState().remove(fileId);
        window.alert("Tổng dung lượng Editor đã vượt giới hạn 20 MiB.");
        return false;
      }
      const model = monaco.editor.createModel(snapshot.content, languageForPath(relativePath), modelUri(currentWorkspace.id, snapshot.fileId));
      registryRef.current.set(fileId, { model, snapshot, baseline: snapshot.content, viewState: null });
      useEditorStore.getState().setReady(fileId, !snapshot.writable || snapshot.eol === "mixed" || snapshot.eol === "cr");
      forceRender();
      return true;
    } catch (error) {
      if (workspaceRef.current?.id === currentWorkspace.id && token !== requestGeneration.current) {
        useEditorStore.getState().remove(fileId);
      } else if (token === requestGeneration.current) {
        useEditorStore.getState().setStatus(fileId, "error", formatEditorError(error));
      }
      forceRender();
      return false;
    }
  }, [forceRender]);

  const openFile = useCallback(async (relativePath: string): Promise<boolean> => {
    const opened = await openFileInternal(relativePath);
    if (opened) recordFileNavigation(relativePath);
    return opened;
  }, [openFileInternal, recordFileNavigation]);

  const setActive = useCallback((fileId: string) => {
    useEditorStore.getState().setActive(fileId);
    const entry = registryRef.current.get(fileId);
    if (entry) recordFileNavigation(entry.snapshot.relativePath);
  }, [recordFileNavigation]);

  const goBack = useCallback(async (): Promise<boolean> => {
    const history = fileHistoryRef.current;
    if (history.index <= 0) return false;
    const previousIndex = history.index;
    const nextIndex = previousIndex - 1;
    history.index = nextIndex;
    setHistoryVersion((version) => version + 1);
    const opened = await openFileInternal(history.entries[nextIndex]);
    if (!opened) {
      history.index = previousIndex;
      setHistoryVersion((version) => version + 1);
    }
    return opened;
  }, [openFileInternal]);

  const goForward = useCallback(async (): Promise<boolean> => {
    const history = fileHistoryRef.current;
    if (history.index >= history.entries.length - 1) return false;
    const previousIndex = history.index;
    const nextIndex = previousIndex + 1;
    history.index = nextIndex;
    setHistoryVersion((version) => version + 1);
    const opened = await openFileInternal(history.entries[nextIndex]);
    if (!opened) {
      history.index = previousIndex;
      setHistoryVersion((version) => version + 1);
    }
    return opened;
  }, [openFileInternal]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void goBack();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        void goForward();
      }
    };
    const onMouseNavigation = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        void goBack();
      } else if (event.button === 4) {
        event.preventDefault();
        void goForward();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("auxclick", onMouseNavigation);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("auxclick", onMouseNavigation);
    };
  }, [goBack, goForward]);

  const openFileAtLocation = useCallback(async (relativePath: string, line: number, column: number, endColumn?: number): Promise<boolean> => {
    const opened = await openFile(relativePath);
    if (!opened) return false;
    setNavigation({
      navigationId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fileId: relativePath,
      line: Math.max(1, line),
      column: Math.max(1, column),
      endColumn: endColumn && endColumn > column ? endColumn : undefined,
    });
    return true;
  }, [openFile]);

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
    if (proposalRef.current?.fileId === fileId || applyingProposalRef.current) {
      setProposalError("Hãy Accept hoặc Reject proposal trước khi Save trực tiếp.");
      forceRender();
      return false;
    }
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
    if (proposalRef.current?.fileId === fileId) {
      proposalRef.current = null;
      setProposal(null);
      setProposalError(null);
      diffRef.current = null;
    }
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

  const showDiff = useCallback(async (fileId = useEditorStore.getState().activeFileId ?? undefined) => {
    if (!fileId) return;
    const entry = registryRef.current.get(fileId);
    if (!entry) return;
    const existingProposal = proposalRef.current;
    if (existingProposal) {
      if (existingProposal.fileId !== fileId) {
        setProposalError(`Đang có proposal chờ duyệt cho ${existingProposal.relativePath}.`);
        forceRender();
        return;
      }
      diffRef.current = {
        fileId: existingProposal.fileId,
        relativePath: existingProposal.relativePath,
        original: existingProposal.original,
        modified: existingProposal.proposed,
        proposalId: existingProposal.proposalId,
        originalLabel: "Reviewed snapshot",
        modifiedLabel: "Pending proposal",
      };
      setProposalError(null);
      forceRender();
      return;
    }
    const modified = entry.model.getValue();
    if (entry.baseline === modified) {
      setProposalError("Chưa có thay đổi để tạo proposal.");
      diffRef.current = null;
      forceRender();
      return;
    }
    const workspaceId = entry.snapshot.workspaceId;
    const relativePath = entry.snapshot.relativePath;
    const expectedRevision = entry.snapshot.revision;
    const original = entry.baseline;
    const modelVersion = entry.model.getVersionId();
    try {
      const backendProposal = await proposePatch(workspaceId, relativePath, expectedRevision, original, modified);
      if (
        workspaceRef.current?.id !== workspaceId
        || entry.model.getVersionId() !== modelVersion
        || entry.model.getValue() !== modified
      ) {
        setProposalError("Draft đã thay đổi trong lúc tạo proposal; hãy mở Review lại.");
        forceRender();
        return;
      }
      const nextProposal: PatchProposal = {
        proposalId: backendProposal.proposalId,
        workspaceId: backendProposal.workspaceId,
        fileId,
        relativePath: backendProposal.relativePath,
        expectedRevision: backendProposal.expectedRevision,
        original: backendProposal.original,
        proposed: backendProposal.proposed,
        modelVersion,
        createdAt: backendProposal.createdAt,
        contentDigest: backendProposal.contentDigest,
        expiresAt: backendProposal.expiresAt,
        state: backendProposal.state,
      };
      proposalRef.current = nextProposal;
      setProposal(nextProposal);
      setProposalError(null);
      diffRef.current = {
        fileId,
        relativePath: nextProposal.relativePath,
        original: nextProposal.original,
        modified: nextProposal.proposed,
        proposalId: nextProposal.proposalId,
        originalLabel: "Reviewed snapshot",
        modifiedLabel: "Pending proposal",
      };
    } catch (error) {
      setProposalError(formatEditorError(error));
    }
    forceRender();
  }, [forceRender]);

  const acceptProposal = useCallback(async () => {
    const currentWorkspace = workspaceRef.current;
    const nextProposal = proposalRef.current;
    if (!currentWorkspace || !nextProposal) return false;
    const entry = registryRef.current.get(nextProposal.fileId);
    const tab = useEditorStore.getState().tabs.find((item) => item.fileId === nextProposal.fileId);
    const staleMessage = "Proposal đã stale. Workspace, file hoặc nội dung đã thay đổi; hãy Reject và tạo proposal mới.";
    if (
      currentWorkspace.id !== nextProposal.workspaceId
      || !entry
      || !tab
      || tab.readOnly
      || entry.snapshot.fileId !== nextProposal.fileId
      || entry.snapshot.relativePath !== nextProposal.relativePath
      || entry.snapshot.revision !== nextProposal.expectedRevision
    ) {
      setProposalError(staleMessage);
      if (tab) useEditorStore.getState().setStatus(tab.fileId, "conflict", staleMessage);
      forceRender();
      return false;
    }

    if (applyingProposalRef.current) return false;
    applyingProposalRef.current = true;
    useEditorStore.getState().setStatus(nextProposal.fileId, "saving");
    try {
      const result = await applyPatch(currentWorkspace.id, nextProposal.proposalId);
      if (workspaceRef.current?.id !== currentWorkspace.id) {
        setProposalError(staleMessage);
        return false;
      }
      entry.snapshot = {
        ...entry.snapshot,
        content: nextProposal.proposed,
        revision: result.writeResult?.revision ?? nextProposal.expectedRevision,
        byteLength: result.writeResult?.byteLength ?? new TextEncoder().encode(nextProposal.proposed).length,
      };
      entry.baseline = nextProposal.proposed;
      useEditorStore.getState().setDirty(nextProposal.fileId, entry.model.getValue() !== nextProposal.proposed);
      useEditorStore.getState().setStatus(nextProposal.fileId, "ready", null);
      proposalRef.current = null;
      setProposal(null);
      setProposalError(null);
      diffRef.current = null;
      forceRender();
      return true;
    } catch (error) {
      const message = formatEditorError(error);
      const conflict = message.includes("FILE_CONFLICT") || message.includes("Conflict") || message.includes("thay đổi");
      setProposalError(conflict ? staleMessage : message);
      useEditorStore.getState().setStatus(nextProposal.fileId, conflict ? "conflict" : "error", conflict ? staleMessage : message);
      forceRender();
      return false;
    } finally {
      applyingProposalRef.current = false;
    }
  }, [forceRender]);

  const rejectProposal = useCallback(() => {
    const nextProposal = proposalRef.current;
    if (!nextProposal) return;
    const entry = registryRef.current.get(nextProposal.fileId);
    if (entry) useEditorStore.getState().setDirty(nextProposal.fileId, entry.model.getValue() !== entry.baseline);
    proposalRef.current = null;
    setProposal(null);
    setProposalError(null);
    diffRef.current = null;
    forceRender();
    void rejectPatch(nextProposal.workspaceId, nextProposal.proposalId).catch(() => undefined);
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
        originalLabel: "Current disk",
        modifiedLabel: "Editor draft",
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
      if (proposalRef.current?.fileId === fileId) {
        proposalRef.current = null;
        setProposal(null);
        setProposalError(null);
        diffRef.current = null;
      }
      useEditorStore.getState().setReady(fileId, !snapshot.writable || snapshot.eol === "mixed" || snapshot.eol === "cr");
      forceRender();
    } catch (error) {
      useEditorStore.getState().setStatus(fileId, "conflict", formatEditorError(error));
      forceRender();
    }
  }, [forceRender]);

  const closeDiff = useCallback(() => { diffRef.current = null; forceRender(); }, [forceRender]);
  const activeEntry = activeFileId ? registryRef.current.get(activeFileId) ?? null : null;
  const getEntry = useCallback((fileId: string) => registryRef.current.get(fileId) ?? null, []);
  const canGoBack = historyVersion >= 0 && fileHistoryRef.current.index > 0;
  const canGoForward = historyVersion >= 0 && fileHistoryRef.current.index < fileHistoryRef.current.entries.length - 1;
  return {
    tabs,
    activeFileId,
    activeEntry,
    getEntry,
    diff: diffRef.current,
    proposal,
    proposalError,
    navigation,
    openFile,
    openFileAtLocation,
    setActive,
    updateDraft,
    saveFile,
    saveAll,
    closeFile,
    hasDirty,
    prepareWorkspaceChange,
    showDiff,
    acceptProposal,
    rejectProposal,
    compareWithDisk,
    reloadFromDisk,
    closeDiff,
    pendingFilePaths,
    captureFileOperation,
    completeFileOperation,
    undoLastFileOperation,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
  };
}
