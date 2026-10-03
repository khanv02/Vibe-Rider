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
  originalLabel?: string;
  modifiedLabel?: string;
}
