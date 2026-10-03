import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import { configureMonaco, languageForPath } from "../editor/monacoRuntime";
import type { DiffPreview } from "../editor/types";

interface SharedDiffViewerProps {
  preview: DiffPreview;
  onClose: () => void;
}

export function SharedDiffViewer({ preview, onClose }: SharedDiffViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    configureMonaco();
    const diffEditor = monaco.editor.createDiffEditor(host, {
      theme: "vibe-rider-dark",
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
  }, [preview]);

  return (
    <section className="editor-diff-overlay" aria-label={`Changes in ${preview.relativePath}`}>
      <header className="editor-diff-heading">
        <div>
          <span className="panel-kicker">READ-ONLY REVIEW</span>
          <h3>{preview.relativePath}</h3>
          {preview.originalLabel || preview.modifiedLabel ? <span className="editor-diff-labels">{preview.originalLabel ?? "Original"} → {preview.modifiedLabel ?? "Modified"}</span> : null}
        </div>
        <button className="editor-quiet-button" onClick={onClose} type="button">Close</button>
      </header>
      <div className="editor-diff-host" ref={hostRef} />
    </section>
  );
}
