import { useState } from "react";
import type { EditorPanelSize } from "../panels/types";
import type { WorkspaceEditorController } from "../editor/useWorkspaceEditor";
import { MonacoEditor } from "./MonacoEditor";
import { SharedDiffViewer } from "./SharedDiffViewer";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";

interface EditorPanelProps {
  controller: WorkspaceEditorController;
  editorSize: EditorPanelSize;
  onEditorSizeChange: (size: EditorPanelSize) => void;
}

export function EditorPanel({ controller, editorSize, onEditorSizeChange }: EditorPanelProps) {
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const pendingTab = controller.tabs.find((tab) => tab.fileId === pendingClose);
  const activeTab = controller.tabs.find((tab) => tab.fileId === controller.activeFileId);

  async function saveAndClose() {
    if (!pendingClose) return;
    const fileId = pendingClose;
    const saved = await controller.saveFile(fileId);
    if (saved) {
      controller.closeFile(fileId);
      setPendingClose(null);
    }
  }

  function requestClose(fileId: string) {
    const tab = controller.tabs.find((candidate) => candidate.fileId === fileId);
    if (tab?.dirty) setPendingClose(fileId);
    else controller.closeFile(fileId);
  }

  return (
    <div className="editor-shell">
      <div className="editor-toolbar">
        <div className="editor-toolbar-copy">
          <span className="panel-kicker">LOCAL EDITOR</span>
          <span className="editor-toolbar-status">{activeTab ? (activeTab.dirty ? "Unsaved" : activeTab.status) : "Choose a file"}</span>
        </div>
        <div className="editor-toolbar-actions">
          <button className="editor-quiet-button" disabled={!activeTab || activeTab.readOnly || activeTab.status === "saving"} onClick={() => void controller.saveFile()} type="button">Save</button>
          <button className="editor-quiet-button" disabled={!activeTab} onClick={() => controller.showDiff()} type="button">Review</button>
          <button className={editorSize === "normal" ? "size-button size-button-active" : "size-button"} onClick={() => onEditorSizeChange("normal")} type="button">Normal</button>
          <button className={editorSize === "expanded" ? "size-button size-button-active" : "size-button"} onClick={() => onEditorSizeChange("expanded")} type="button">Expanded</button>
        </div>
      </div>
      <div className="editor-tabs" role="tablist" aria-label="Open files">
        {controller.tabs.map((tab) => (
          <div className={`editor-tab${tab.fileId === controller.activeFileId ? " editor-tab-active" : ""}`} key={tab.fileId} role="presentation">
            <button aria-selected={tab.fileId === controller.activeFileId} className="editor-tab-label" onClick={() => controller.setActive(tab.fileId)} role="tab" type="button">
              <span className="editor-tab-state" aria-hidden="true">{tab.dirty ? "●" : tab.status === "loading" ? "…" : ""}</span>
              <span className="editor-tab-name" title={tab.relativePath}>{tab.relativePath.split("/").pop()}</span>
            </button>
            <button aria-label={`Close ${tab.relativePath}`} className="editor-tab-close" onClick={() => requestClose(tab.fileId)} type="button">×</button>
          </div>
        ))}
        {controller.tabs.length === 0 ? <span className="editor-tabs-empty">Open a file from Explorer</span> : null}
      </div>
      <div className="editor-stage">
        {controller.activeEntry && activeTab ? (
          <MonacoEditor fileId={controller.activeEntry.snapshot.fileId} model={controller.activeEntry.model} onChange={(content) => controller.updateDraft(controller.activeEntry?.snapshot.fileId ?? "", content)} onSave={() => void controller.saveFile(controller.activeFileId ?? undefined)} readOnly={activeTab.readOnly} />
        ) : (
          <div className="editor-empty-state"><span className="tool-placeholder-icon" aria-hidden="true">&lt;&gt;</span><h3>Open a file to edit</h3><p>Chọn file thường trong Explorer. Terminal và panel state vẫn được giữ khi Editor ẩn.</p></div>
        )}
        {controller.diff ? <SharedDiffViewer onClose={controller.closeDiff} preview={controller.diff} /> : null}
      </div>
      {activeTab?.error ? <div className={`editor-message editor-message-${activeTab.status}`}><span>{activeTab.error}</span>{activeTab.status === "conflict" ? <><button className="editor-message-action" onClick={() => void controller.compareWithDisk(activeTab.fileId)} type="button">Compare disk</button><button className="editor-message-action" onClick={() => void controller.reloadFromDisk(activeTab.fileId)} type="button">Reload disk</button></> : null}</div> : null}
      {pendingTab ? <UnsavedChangesDialog fileName={pendingTab.relativePath} onCancel={() => setPendingClose(null)} onDiscard={() => { controller.closeFile(pendingTab.fileId); setPendingClose(null); }} onSave={() => void saveAndClose()} saving={pendingTab.status === "saving"} /> : null}
    </div>
  );
}
