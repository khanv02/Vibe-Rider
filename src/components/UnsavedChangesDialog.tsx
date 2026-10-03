interface UnsavedChangesDialogProps {
  fileName: string;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
  saving: boolean;
}

export function UnsavedChangesDialog({ fileName, onCancel, onDiscard, onSave, saving }: UnsavedChangesDialogProps) {
  return (
    <div className="editor-dialog-backdrop" role="presentation">
      <section aria-labelledby="unsaved-title" aria-modal="true" className="editor-dialog" role="dialog">
        <p className="panel-kicker">UNSAVED CHANGES</p>
        <h3 id="unsaved-title">Save changes to {fileName}?</h3>
        <p>Draft sẽ được giữ lại nếu bạn huỷ thao tác.</p>
        <div className="editor-dialog-actions">
          <button className="editor-quiet-button" disabled={saving} onClick={onCancel} type="button">Cancel</button>
          <button className="editor-danger-button" disabled={saving} onClick={onDiscard} type="button">Discard</button>
          <button className="editor-primary-button" disabled={saving} onClick={onSave} type="button">{saving ? "Saving…" : "Save"}</button>
        </div>
      </section>
    </div>
  );
}
