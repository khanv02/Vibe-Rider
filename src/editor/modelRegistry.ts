import type * as monaco from "monaco-editor";
import type { EditorModelEntry } from "./types";

export class EditorModelRegistry {
  private entries = new Map<string, EditorModelEntry>();

  get(fileId: string): EditorModelEntry | undefined { return this.entries.get(fileId); }
  set(fileId: string, entry: EditorModelEntry): void { this.entries.set(fileId, entry); }
  delete(fileId: string): void {
    const entry = this.entries.get(fileId);
    entry?.model.dispose();
    this.entries.delete(fileId);
  }
  values(): IterableIterator<EditorModelEntry> { return this.entries.values(); }
  clear(): void {
    for (const entry of this.entries.values()) entry.model.dispose();
    this.entries.clear();
  }
}
