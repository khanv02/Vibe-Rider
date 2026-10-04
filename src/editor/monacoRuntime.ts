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
      "editor.background": "#ffffff",
      "editor.foreground": "#263746",
      "editorLineNumber.foreground": "#9aa8b5",
      "editorLineNumber.activeForeground": "#087f66",
      "editorCursor.foreground": "#087f66",
      "editor.selectionBackground": "#bfe9d9",
      "editor.inactiveSelectionBackground": "#e1f3ec",
      "editor.lineHighlightBackground": "#f2f8f5",
      "editorLineNumber.dimmedForeground": "#c0cad2",
      "editorIndentGuide.background": "#edf1f3",
      "editorIndentGuide.activeBackground": "#d4e3dd",
      "editorBracketMatch.background": "#dff3eb",
      "editorBracketMatch.border": "#8fcbb5",
      "editor.findMatchBackground": "#ffe4a8",
      "editor.findMatchHighlightBackground": "#fff3d1",
      "editorWidget.background": "#ffffff",
      "editorWidget.foreground": "#263746",
      "editorWidget.border": "#cbd7df",
      "editorSuggestWidget.background": "#ffffff",
      "editorSuggestWidget.border": "#cbd7df",
      "editorSuggestWidget.selectedBackground": "#e4f4ee",
      "editorHoverWidget.background": "#ffffff",
      "editorHoverWidget.border": "#cbd7df",
      "editorOverviewRuler.border": "#ffffff",
      "scrollbarSlider.background": "#b7c6cf99",
      "scrollbarSlider.hoverBackground": "#91a6b399",
      "scrollbarSlider.activeBackground": "#718b9b99",
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
