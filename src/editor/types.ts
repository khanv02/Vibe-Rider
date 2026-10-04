import type * as monaco from "monaco-editor";

export type EditorTabStatus = "loading" | "ready" | "saving" | "error" | "conflict" | "read-only";

export interface TextFileSnapshot {
  workspaceId: string;
  fileId: string;
  relativePath: string;
  content: string;
  revision: string;
  byteLength: number;
  encoding: "utf8";
  bom: boolean;
  eol: "lf" | "crlf" | "none" | "mixed" | "cr";
  writable: boolean;
}

export interface WriteFileResult {
  workspaceId: string;
  fileId: string;
  relativePath: string;
  revision: string;
  byteLength: number;
}

export interface EditorTab {
  fileId: string;
  relativePath: string;
  status: EditorTabStatus;
  dirty: boolean;
  error: string | null;
  readOnly: boolean;
}

export interface EditorModelEntry {
  model: monaco.editor.ITextModel;
  snapshot: TextFileSnapshot;
  baseline: string;
  viewState: monaco.editor.ICodeEditorViewState | null;
}

export interface DiffPreview {
  fileId: string;
  relativePath: string;
  original: string;
  modified: string;
  proposalId?: string;
  originalLabel?: string;
  modifiedLabel?: string;
}

/**
 * An in-memory change proposal. The expected revision is the snapshot that
 * was reviewed; it is never allowed to silently drift before Apply.
 */
export interface PatchProposal {
  proposalId: string;
  workspaceId: string;
  fileId: string;
  relativePath: string;
  expectedRevision: string;
  original: string;
  proposed: string;
  modelVersion: number;
  createdAt: number;
  contentDigest?: string;
  expiresAt?: number;
  state?: "pending" | "applying" | "applied" | "rejected" | "stale" | "failed" | "expired";
}

export interface EditorLocation {
  navigationId: string;
  fileId: string;
  line: number;
  column: number;
  endColumn?: number;
}

export type FileOperationKind = "delete" | "restore";

export interface PendingFileOperation {
  kind: FileOperationKind;
  relativePaths: string[];
}
