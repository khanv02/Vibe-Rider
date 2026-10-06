import { useState } from "react";
import type { WorkspaceEditorController } from "../../editor/useWorkspaceEditor";
import { MonacoEditor } from "./MonacoEditor";
import { SharedDiffViewer } from "../common/SharedDiffViewer";
import { UnsavedChangesDialog } from "../common/UnsavedChangesDialog";
import type { UiTheme } from "../../preferences/types";
import type { EditorPaneId } from "../../editor/editorStore";

interface EditorPanelProps {
  theme: UiTheme;
  controller: WorkspaceEditorController;
  filePath?: string | null;
  paneId: EditorPaneId;
  onFileActivate?: (filePath: string) => void;
}

export function EditorPanel({ theme, controller, filePath, paneId, onFileActivate }: EditorPanelProps) {
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const tabs = controller.getTabs(paneId);
  const pendingTab = tabs.find((tab) => tab.fileId === pendingClose);
  const activeTab = filePath ? tabs.find((tab) => tab.relativePath === filePath) : undefined;
  const activeEntry = activeTab ? controller.getEntry(activeTab.fileId) : null;
  const proposalIsActive = Boolean(controller.proposal && controller.proposal.fileId === activeTab?.fileId);
  const proposalIsVisible = Boolean(controller.proposal && activeTab?.fileId === controller.proposal.fileId && controller.diff?.proposalId === controller.proposal.proposalId);

  async function saveAndClose() {
    if (!pendingClose) return;
    const fileId = pendingClose;
    const saved = await controller.saveFile(fileId, paneId);
    if (saved) {
      controller.closeFile(fileId, paneId);
      setPendingClose(null);
    }
  }

  function requestClose(fileId: string) {
    const tab = tabs.find((candidate) => candidate.fileId === fileId);
    if (tab?.dirty) setPendingClose(fileId);
    else controller.closeFile(fileId, paneId);
  }

  return (
    <div className="editor-shell">
      <div className="editor-toolbar">
        <div className="editor-toolbar-copy">
          <span className="panel-kicker">LOCAL EDITOR</span>
          <span className="editor-toolbar-status">{proposalIsActive ? "Proposal pending approval" : activeTab ? (activeTab.dirty ? "Unsaved" : activeTab.status) : "Choose a file"}</span>
        </div>
        <div className="editor-toolbar-actions">
          <div className="editor-navigation" aria-label="File navigation">
            <button
              aria-label="Go back"
              className="editor-quiet-button editor-nav-button"
              disabled={!controller.canGoBack}
              onClick={() => void controller.goBack()}
              title="Go back (Alt+Left or mouse Back button)"
              type="button"
            >
              ←
            </button>
            <button
              aria-label="Go forward"
              className="editor-quiet-button editor-nav-button"
              disabled={!controller.canGoForward}
              onClick={() => void controller.goForward()}
              title="Go forward (Alt+Right or mouse Forward button)"
              type="button"
            >
              →
            </button>
          </div>
          <button className="editor-quiet-button" disabled={!activeTab || activeTab.readOnly || activeTab.status === "saving" || proposalIsActive} onClick={() => void controller.saveFile(activeTab?.fileId, paneId)} type="button">Save</button>
          <button className="editor-quiet-button" disabled={!activeTab || activeTab.readOnly || (!activeTab.dirty && !proposalIsActive)} onClick={() => void controller.showDiff(activeTab?.fileId, paneId)} type="button">{proposalIsActive ? "Review proposal" : "Propose patch"}</button>
        </div>
      </div>
      <div className="editor-tabs" role="tablist" aria-label="Open files">
        {tabs.map((tab) => (
          <div className={`editor-tab${tab.fileId === activeTab?.fileId ? " editor-tab-active" : ""}${controller.pendingFilePaths.includes(tab.relativePath) ? " editor-tab-pending" : ""}`} key={tab.fileId} role="presentation">
            <button aria-selected={tab.fileId === activeTab?.fileId} className="editor-tab-label" onClick={() => { controller.setActive(tab.fileId, paneId); onFileActivate?.(tab.relativePath); }} role="tab" type="button">
              <span className="editor-tab-state" aria-hidden="true">{tab.dirty ? "●" : tab.status === "loading" ? "…" : ""}</span>
              <span className="editor-tab-name" title={tab.relativePath}>{tab.relativePath.split("/").pop()}</span>
            </button>
            <button aria-label={`Close ${tab.relativePath}`} className="editor-tab-close" onClick={() => requestClose(tab.fileId)} type="button">×</button>
          </div>
        ))}
        {tabs.length === 0 ? <span className="editor-tabs-empty">Open a file from Explorer</span> : null}
      </div>
      <div className="editor-stage">
        {activeEntry && activeTab ? (
          <MonacoEditor theme={theme} fileId={activeEntry.snapshot.fileId} model={activeEntry.model} navigation={controller.navigation} onChange={(content) => controller.updateDraft(activeEntry.snapshot.fileId, content)} onSave={() => void controller.saveFile(activeTab.fileId, paneId)} readOnly={activeTab.readOnly} />
        ) : (
          <div className="editor-empty-state"><span className="tool-placeholder-icon" aria-hidden="true">&lt;&gt;</span><h3>Open a file to edit</h3><p>Chọn file thường trong Explorer. Terminal và panel state vẫn được giữ khi Editor ẩn.</p></div>
        )}
        {controller.diff ? (
          <SharedDiffViewer
            theme={theme}
            acceptDisabled={!proposalIsVisible || activeTab?.status === "saving" || activeTab?.readOnly}
            onAccept={proposalIsVisible ? () => void controller.acceptProposal() : undefined}
            onClose={controller.closeDiff}
            onReject={proposalIsVisible ? controller.rejectProposal : undefined}
            preview={controller.diff}
            proposalError={proposalIsVisible ? controller.proposalError : null}
          />
        ) : null}
      </div>
      {controller.proposalError && !controller.diff ? <div className="editor-message editor-message-conflict"><span>{controller.proposalError}</span></div> : null}
      {activeTab?.error ? <div className={`editor-message editor-message-${activeTab.status}`}><span>{activeTab.error}</span>{activeTab.status === "conflict" ? <><button className="editor-message-action" onClick={() => void controller.compareWithDisk(activeTab.fileId, paneId)} type="button">Compare disk</button><button className="editor-message-action" onClick={() => void controller.reloadFromDisk(activeTab.fileId, paneId)} type="button">Reload disk</button></> : null}</div> : null}
      {pendingTab ? <UnsavedChangesDialog fileName={pendingTab.relativePath} onCancel={() => setPendingClose(null)} onDiscard={() => { controller.closeFile(pendingTab.fileId, paneId); setPendingClose(null); }} onSave={() => void saveAndClose()} saving={pendingTab.status === "saving"} /> : null}
    </div>
  );
}
