import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

let configured = false;

export function configureMonaco(): void {
  if (configured) return;
  configured = true;
  self.MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  };
  monaco.editor.defineTheme("vibe-rider-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#0e141b",
      "editorLineNumber.foreground": "#536174",
      "editorLineNumber.activeForeground": "#91e1c3",
      "editorCursor.foreground": "#91e1c3",
      "editor.selectionBackground": "#24433b",
    },
  });
  monaco.editor.defineTheme("vibe-rider-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#f8fbfd",
      "editor.foreground": "#25313d",
      "editorLineNumber.foreground": "#8a99a8",
      "editorLineNumber.activeForeground": "#087f66",
      "editorCursor.foreground": "#087f66",
      "editor.selectionBackground": "#cceee2",
      "editor.lineHighlightBackground": "#eef6f3",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#d7e0e8",
    },
  });
}

export function languageForPath(relativePath: string): string {
  const extension = relativePath.split(".").pop()?.toLowerCase() ?? "";
  const languages: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", rs: "rust", md: "markdown", html: "html", htm: "html",
    css: "css", scss: "scss", xml: "xml", yaml: "yaml", yml: "yaml",
  };
  return languages[extension] ?? "plaintext";
}

export function modelUri(workspaceId: string, fileId: string): monaco.Uri {
  return monaco.Uri.parse(`vibe-rider://${encodeURIComponent(workspaceId)}/${encodeURIComponent(fileId)}`);
}

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}
