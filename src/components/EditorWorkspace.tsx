import { useEffect, useState } from "react";
import type { DragEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { EditorPanelSize } from "../panels/types";
import type { UiTheme } from "../preferences/types";
import type { WorkspaceEditorController } from "../editor/useWorkspaceEditor";
import { isTauriRuntime } from "../tauri/runtime";
import { dropPointInCssPixels, readDroppedPaths } from "./fileDrop";
import { EditorPanel } from "./EditorPanel";

type EditorLayoutMode = 1 | 2 | 4;
type EditorPaneId = "E1" | "E2" | "E3" | "E4";

const EDITOR_PANE_IDS: EditorPaneId[] = ["E1", "E2", "E3", "E4"];

interface EditorWorkspaceProps {
  controller: WorkspaceEditorController;
  editorSize: EditorPanelSize;
  onEditorSizeChange: (size: EditorPanelSize) => void;
  onOpenFile: (path: string) => Promise<string | null>;
  theme: UiTheme;
}

export function EditorWorkspace({ controller, editorSize, onEditorSizeChange, onOpenFile, theme }: EditorWorkspaceProps) {
  const [layoutMode, setLayoutMode] = useState<EditorLayoutMode>(1);
  const [activePaneId, setActivePaneId] = useState<EditorPaneId>("E1");
  const [panePaths, setPanePaths] = useState<Record<EditorPaneId, string | null>>({ E1: null, E2: null, E3: null, E4: null });
  const visiblePaneIds = layoutMode === 4 ? EDITOR_PANE_IDS : layoutMode === 2 ? ["E1", "E2"] : [activePaneId];

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const point = dropPointInCssPixels(event.payload.position);
      const target = document.elementFromPoint(point.x, point.y);
      const pane = target instanceof Element ? target.closest<HTMLElement>("[data-editor-pane]") : null;
      const paneId = pane?.dataset.editorPane as EditorPaneId | undefined;
      if (paneId && EDITOR_PANE_IDS.includes(paneId)) {
        void openInPane(event.payload.paths, resolveDropPane(paneId, point.x, point.y));
      }
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [layoutMode, onOpenFile]);

  function resolveDropPane(paneId: EditorPaneId, x?: number, y?: number): EditorPaneId {
    if (x === undefined || y === undefined) return paneId;
    const element = document.querySelector<HTMLElement>(`[data-editor-pane="${paneId}"]`);
    if (!element) return paneId;
    const rect = element.getBoundingClientRect();
    if (layoutMode === 1 && x > rect.left + rect.width / 2) {
      setLayoutMode(2);
      return "E2";
    }
    if (layoutMode === 2 && y > rect.top + rect.height / 2) {
      setLayoutMode(4);
      return paneId === "E1" ? "E3" : "E4";
    }
    return paneId;
  }

  async function openInPane(paths: string[], paneId: EditorPaneId) {
    const path = paths.find(Boolean);
    if (!path) return;
    const openedPath = await onOpenFile(path);
    if (openedPath) {
      setPanePaths((current) => ({ ...current, [paneId]: openedPath }));
      setActivePaneId(paneId);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>, paneId: EditorPaneId) {
    event.preventDefault();
    const paths = readDroppedPaths(event.dataTransfer);
    if (paths.length > 0) void openInPane(paths, resolveDropPane(paneId, event.clientX, event.clientY));
  }

  function activateFile(paneId: EditorPaneId, filePath: string) {
    setPanePaths((current) => ({ ...current, [paneId]: filePath }));
    setActivePaneId(paneId);
  }

  return (
    <section className="editor-workspace" aria-labelledby="editor-workspace-title">
      <div className="workspace-heading">
        <div>
          <p className="workspace-kicker">MAIN WORKSPACE</p>
          <h2 id="editor-workspace-title">Editor Workspace</h2>
        </div>
        <div className="workspace-controls" aria-label="Editor layout and focus controls">
          <div className="layout-controls" aria-label="Editor layout mode">
            {[1, 2, 4].map((mode) => (
              <button className={`layout-button${layoutMode === mode ? " layout-button-active" : ""}`} key={mode} onClick={() => setLayoutMode(mode as EditorLayoutMode)} type="button">{mode}</button>
            ))}
          </div>
          <div className="pane-selector" aria-label="Editor pane selector">
            {EDITOR_PANE_IDS.map((paneId) => (
              <button className={`pane-selector-button${activePaneId === paneId ? " pane-selector-button-active" : ""}`} key={paneId} onClick={() => setActivePaneId(paneId)} type="button">{paneId}</button>
            ))}
          </div>
        </div>
      </div>
      <div className={`editor-grid editor-grid-mode-${layoutMode}`}>
        {EDITOR_PANE_IDS.map((paneId) => (
          <div
            className={`editor-pane${activePaneId === paneId ? " editor-pane-active" : ""}`}
            data-editor-pane={paneId}
            key={paneId}
            onClick={() => setActivePaneId(paneId)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(event, paneId)}
            style={{ display: visiblePaneIds.includes(paneId) ? undefined : "none" }}
          >
            <EditorPanel
              controller={controller}
              editorSize={editorSize}
              filePath={panePaths[paneId]}
              onEditorSizeChange={onEditorSizeChange}
              onFileActivate={(filePath) => activateFile(paneId, filePath)}
              theme={theme}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
