export interface WorkspaceDescriptor {
  id: string;
  name: string;
  rootPath: string;
}

export interface WorkspaceError {
  code: string;
  message: string;
}

export type DirectoryEntryKind = "directory" | "file" | "link" | "other";

export interface DirectoryEntry {
  name: string;
  relativePath: string;
  kind: DirectoryEntryKind;
}

export interface DirectoryListing {
  workspaceId: string;
  relativePath: string;
  entries: DirectoryEntry[];
}

export type CreateEntryKind = "directory" | "file";

export interface EntryMutationResult {
  workspaceId: string;
  relativePath: string;
  kind: DirectoryEntryKind;
}

export interface ClipboardImageResult {
  workspaceId: string;
  relativePath: string;
  absolutePath: string;
  mimeType: string;
}
