export type SearchStatus = "idle" | "starting" | "searching" | "ready" | "noMatch" | "partial" | "cancelled" | "error";

export interface SearchRequest {
  workspaceId: string;
  query: string;
  relativeDirectory: string;
  caseSensitive: boolean;
}

export interface SearchStartResult {
  workspaceId: string;
  searchId: string;
}

export interface SearchRange {
  startColumn: number;
  endColumn: number;
}

export interface SearchMatch {
  relativePath: string;
  line: number;
  column: number;
  endColumn: number;
  snippet: string;
  snippetStart: number;
  ranges: SearchRange[];
}

export interface SearchSuggestion {
  relativePath: string;
  kind: "file" | "directory";
  score: number;
  exact: boolean;
}

export interface SearchResult {
  workspaceId: string;
  searchId: string;
  status: Exclude<SearchStatus, "idle" | "starting" | "searching">;
  matches: SearchMatch[];
  suggestions: SearchSuggestion[];
  partialReason: string | null;
  warnings: string[];
  durationMs: number;
}

export interface SearchError {
  code: string;
  message: string;
}
