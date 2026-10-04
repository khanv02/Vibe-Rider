import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import { configureMonaco } from "../../editor/monacoRuntime";
import type { EditorLocation } from "../../editor/types";
import type { UiTheme } from "../../preferences/types";

interface MonacoEditorProps {
  theme: UiTheme;
  fileId: string;
  model: monaco.editor.ITextModel;
  readOnly: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
  navigation: EditorLocation | null;
}

export function MonacoEditor({ theme, fileId, model, readOnly, onChange, onSave, navigation }: MonacoEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const modelIdRef = useRef(fileId);
  const viewStatesRef = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    configureMonaco();
    const editor = monaco.editor.create(host, {
      model,
      theme: theme === "light" ? "vibe-rider-light" : "vibe-rider-dark",
      automaticLayout: false,
      minimap: { enabled: false },
      lineNumbers: "on",
      wordWrap: "off",
      padding: { top: 10, bottom: 10 },
      readOnly,
      scrollBeyondLastLine: false,
      fontSize: 12,
      tabSize: 2,
    });
    assignEditorInputIdentifiers(host, editor.getId());
    editorRef.current = editor;
    modelRef.current = model;
    const subscription = editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
    if (!readOnly) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current());
    }
    const resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => editor.layout()));
    resizeObserver.observe(host);
    return () => {
      viewStatesRef.current.set(modelIdRef.current, editor.saveViewState());
      resizeObserver.disconnect();
      subscription.dispose();
      editor.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(theme === "light" ? "vibe-rider-light" : "vibe-rider-dark");
  }, [theme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || modelRef.current === model) return;
    if (modelRef.current) viewStatesRef.current.set(modelIdRef.current, editor.saveViewState());
    editor.setModel(model);
    editor.updateOptions({ readOnly });
    const viewState = viewStatesRef.current.get(fileId);
    if (viewState) editor.restoreViewState(viewState);
    modelRef.current = model;
    modelIdRef.current = fileId;
    editor.focus();
  }, [fileId, model, readOnly]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !navigation || navigation.fileId !== fileId) return;
    const maxLine = model.getLineCount();
    const line = Math.min(Math.max(1, navigation.line), maxLine);
    const maxColumn = model.getLineMaxColumn(line);
    const column = Math.min(Math.max(1, navigation.column), maxColumn);
    const endColumn = Math.min(Math.max(column, navigation.endColumn ?? column), maxColumn);
    editor.setPosition({ lineNumber: line, column });
    editor.setSelection({ startLineNumber: line, startColumn: column, endLineNumber: line, endColumn });
    editor.revealPositionInCenter({ lineNumber: line, column });
    editor.focus();
  }, [fileId, model, navigation]);

  return <div className="monaco-editor-host" ref={hostRef} aria-label={`Editor ${fileId}`} />;
}

function assignEditorInputIdentifiers(host: HTMLElement, editorId: string) {
  const safeEditorId = editorId.replace(/[^a-zA-Z0-9_-]/g, "-");
  host.querySelectorAll<HTMLTextAreaElement>("textarea").forEach((input, index) => {
    const inputId = `monaco-input-${safeEditorId}-${index}`;
    input.id = inputId;
    input.name = inputId;
    input.setAttribute("autocomplete", "off");
  });
}
