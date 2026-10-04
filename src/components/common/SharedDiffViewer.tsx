import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import { configureMonaco, languageForPath } from "../../editor/monacoRuntime";
import type { DiffPreview } from "../../editor/types";
import type { UiTheme } from "../../preferences/types";

interface SharedDiffViewerProps {
  theme: UiTheme;
  preview: DiffPreview;
  onClose: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  acceptDisabled?: boolean;
  proposalError?: string | null;
}

export function SharedDiffViewer({ theme, preview, onClose, onAccept, onReject, acceptDisabled = false, proposalError = null }: SharedDiffViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    configureMonaco();
    const diffEditor = monaco.editor.createDiffEditor(host, {
      theme: theme === "light" ? "vibe-rider-light" : "vibe-rider-dark",
      readOnly: true,
      renderSideBySide: host.clientWidth >= 500,
      minimap: { enabled: false },
      automaticLayout: false,
      fontSize: 11,
      scrollBeyondLastLine: false,
    });
    const original = monaco.editor.createModel(preview.original, languageForPath(preview.relativePath), monaco.Uri.parse(`vibe-rider-diff://original/${encodeURIComponent(preview.fileId)}`));
    const modified = monaco.editor.createModel(preview.modified, languageForPath(preview.relativePath), monaco.Uri.parse(`vibe-rider-diff://modified/${encodeURIComponent(preview.fileId)}`));
    diffEditor.setModel({ original, modified });
    assignEditorInputIdentifiers(host, diffEditor.getId());
    const resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => {
      diffEditor.updateOptions({ renderSideBySide: host.clientWidth >= 500 });
      diffEditor.layout();
    }));
    resizeObserver.observe(host);
    return () => {
      resizeObserver.disconnect();
      diffEditor.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [preview, theme]);

  return (
    <section className="editor-diff-overlay" aria-label={`Changes in ${preview.relativePath}`}>
      <header className="editor-diff-heading">
        <div>
          <span className="panel-kicker">READ-ONLY REVIEW</span>
          <h3>{preview.relativePath}</h3>
          {preview.originalLabel || preview.modifiedLabel ? <span className="editor-diff-labels">{preview.originalLabel ?? "Original"} → {preview.modifiedLabel ?? "Modified"}</span> : null}
        </div>
        <div className="editor-diff-actions">
          {onReject && onAccept ? <button className="editor-danger-button" onClick={onReject} type="button">Reject</button> : null}
          {onAccept ? <button className="editor-primary-button" disabled={acceptDisabled} onClick={onAccept} type="button">Accept &amp; Apply</button> : null}
          <button className="editor-quiet-button" onClick={onClose} type="button">Close</button>
        </div>
      </header>
      {proposalError ? <p className="editor-diff-error" role="alert">{proposalError}</p> : null}
      <div className="editor-diff-host" ref={hostRef} />
    </section>
  );
}

function assignEditorInputIdentifiers(host: HTMLElement, editorId: string) {
  const safeEditorId = editorId.replace(/[^a-zA-Z0-9_-]/g, "-");
  host.querySelectorAll<HTMLTextAreaElement>("textarea").forEach((input, index) => {
    const inputId = `monaco-diff-input-${safeEditorId}-${index}`;
    input.id = inputId;
    input.name = inputId;
    input.setAttribute("autocomplete", "off");
  });
}
