import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  acknowledgeTerminal,
  closeTerminal,
  formatTerminalError,
  resizeTerminal,
  spawnTerminal,
  writeTerminal,
} from "../terminal/terminalApi";
import type {
  TerminalEvent,
  TerminalPaneId,
  TerminalPaneState,
  TerminalSession,
  TerminalViewState,
} from "../terminal/types";
import type { WorkspaceDescriptor } from "../workspace/types";
import { saveClipboardImage } from "../workspace/workspaceApi";
import type { UiTheme } from "../preferences/types";

interface TerminalPaneProps {
  theme: UiTheme;
  active: boolean;
  autoStart?: boolean;
  onFocus: () => void;
  onStateChange: (state: TerminalPaneState) => void;
  paneId: TerminalPaneId;
  visible: boolean;
  workspace: WorkspaceDescriptor | null;
}

export interface TerminalPaneHandle {
  focus: () => void;
  writeText: (text: string) => void;
}

export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(function TerminalPane({
  theme,
  active,
  autoStart = false,
  onFocus,
  onStateChange,
  paneId,
  visible,
  workspace,
}: TerminalPaneProps, ref) {
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [viewState, setViewState] = useState<TerminalViewState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const workspaceRef = useRef(workspace);
  const callbackRef = useRef(onStateChange);
  const operationRef = useRef(0);
  const inputQueueRef = useRef(Promise.resolve());
  const writeInputRef = useRef<(data: string) => void>(() => undefined);
  const resizeFrameRef = useRef<number | null>(null);
  const lastGeometryRef = useRef({ rows: 0, cols: 0 });
  const autoStartedWorkspaceRef = useRef<string | null>(null);
  workspaceRef.current = workspace;
  callbackRef.current = onStateChange;
  useImperativeHandle(ref, () => ({
    focus: () => terminalRef.current?.focus(),
    writeText: (text) => writeInputRef.current(text),
  }), []);

  function publishState(
    nextState: TerminalViewState,
    nextError = error,
    nextSession = session,
    nextExitCode = exitCode,
  ) {
    setViewState(nextState);
    callbackRef.current({
      paneId,
      session: nextSession,
      state: nextState,
      rootPath,
      error: nextError,
      exitCode: nextExitCode,
    });
  }

  useEffect(() => {
    if (!hostRef.current) return;
    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: '"Cascadia Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: 12,
      scrollback: 5000,
      theme: terminalTheme(theme),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    if (terminal.textarea) {
      const inputId = `terminal-input-${paneId.toLowerCase()}`;
      terminal.textarea.id = inputId;
      terminal.textarea.name = inputId;
      terminal.textarea.setAttribute("autocomplete", "off");
    }
    fitRef.current = fit;
    terminalRef.current = terminal;

    function queueInput(
      data: string,
      targetWorkspace = workspaceRef.current,
      targetSession = sessionRef.current,
      operation = operationRef.current,
    ) {
      if (!targetSession || !targetWorkspace) return;
      const bytes = new TextEncoder().encode(data);
      inputQueueRef.current = inputQueueRef.current
        .catch(() => undefined)
        .then(() => {
          if (
            operation !== operationRef.current
            || sessionRef.current?.sessionId !== targetSession.sessionId
          ) return;
          return writeTerminal(targetWorkspace.id, targetSession.sessionId, bytes);
        })
        .catch((writeError: unknown) => {
          if (operation !== operationRef.current) return;
          const message = formatTerminalError(writeError);
          setError(message);
          publishState("error", message, sessionRef.current);
        });
    }
    writeInputRef.current = (data) => queueInput(data);

    const inputDisposable = terminal.onData((data) => queueInput(data));
    let imagePasteInFlight = false;

    async function readClipboardImage(): Promise<{ blob: Blob; mimeType: string } | null> {
      if (!navigator.clipboard?.read) return null;
      const clipboardItems = await navigator.clipboard.read();
      for (const clipboardItem of clipboardItems) {
        const mimeType = clipboardItem.types.find((type) => type.toLowerCase().startsWith("image/"));
        if (!mimeType) continue;
        return { blob: await clipboardItem.getType(mimeType), mimeType };
      }
      return null;
    }

    async function pasteImage(blob: Blob, mimeType: string) {
      const targetSession = sessionRef.current;
      const targetWorkspace = workspaceRef.current;
      if (!targetSession || !targetWorkspace || imagePasteInFlight) return;
      imagePasteInFlight = true;
      const operation = operationRef.current;
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const saved = await saveClipboardImage(targetWorkspace.id, mimeType, bytes);
        if (
          operation !== operationRef.current
          || sessionRef.current?.sessionId !== targetSession.sessionId
        ) return;
        setError(null);
        queueInput(
          quotePowerShellPath(saved.absolutePath),
          targetWorkspace,
          targetSession,
          operation,
        );
      } catch (pasteError: unknown) {
        if (operation === operationRef.current) {
          setError(`Cannot paste clipboard image: ${formatTerminalError(pasteError)}`);
        }
      } finally {
        imagePasteInFlight = false;
      }
    }

    const pasteHandler = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return;
      const imageItem = Array.from(clipboardData.items)
        .find((item) => item.type.toLowerCase().startsWith("image/"));
      const html = clipboardData.getData("text/html");
      const hasImageHint = Boolean(imageItem)
        || Array.from(clipboardData.types).some((type) => type.toLowerCase().startsWith("image/"))
        || /<img[\s>]|data:image\//i.test(html);
      if (!hasImageHint) return;

      event.preventDefault();
      event.stopPropagation();
      const image = imageItem?.getAsFile();
      if (image) {
        void pasteImage(image, image.type || imageItem?.type || "image/png");
        return;
      }
      void readClipboardImage()
        .then((clipboardImage) => {
          if (clipboardImage) void pasteImage(clipboardImage.blob, clipboardImage.mimeType);
          else setError("Cannot read an image from the clipboard.");
        })
        .catch((pasteError: unknown) => {
          setError(`Cannot read clipboard image: ${formatTerminalError(pasteError)}`);
        });
    };
    hostRef.current.addEventListener("paste", pasteHandler, true);
    terminal.textarea?.addEventListener("paste", pasteHandler, true);
    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown"
        && (event.ctrlKey || event.metaKey)
        && event.key.toLowerCase() === "v"
      ) {
        window.setTimeout(() => {
          if (imagePasteInFlight) return;
          void readClipboardImage()
            .then((clipboardImage) => {
              if (clipboardImage) void pasteImage(clipboardImage.blob, clipboardImage.mimeType);
            })
            .catch(() => undefined);
        }, 0);
      }
      return true;
    });

    const observer = new ResizeObserver(() => {
      if (resizeFrameRef.current !== null) return;
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        const host = hostRef.current;
        if (!host || host.offsetWidth === 0 || host.offsetHeight === 0) return;
        fit.fit();
        const activeSession = sessionRef.current;
        const activeWorkspace = workspaceRef.current;
        if (!activeSession || !activeWorkspace) return;
        if (
          lastGeometryRef.current.rows === terminal.rows &&
          lastGeometryRef.current.cols === terminal.cols
        ) {
          return;
        }
        lastGeometryRef.current = { rows: terminal.rows, cols: terminal.cols };
        void resizeTerminal(activeWorkspace.id, activeSession.sessionId, terminal.rows, terminal.cols).catch(
          (resizeError: unknown) => {
            const message = formatTerminalError(resizeError);
            setError(message);
            callbackRef.current({ paneId, session: sessionRef.current, state: "error", rootPath, error: message, exitCode });
          },
        );
      });
    });
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
      inputDisposable.dispose();
      hostRef.current?.removeEventListener("paste", pasteHandler, true);
      terminal.textarea?.removeEventListener("paste", pasteHandler, true);
      terminal.dispose();
      terminalRef.current = null;
      writeInputRef.current = () => undefined;
      fitRef.current = null;
    };
    // The pane owns one xterm instance for its entire lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = terminalTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      const host = hostRef.current;
      const terminal = terminalRef.current;
      if (!host || !terminal || host.offsetWidth === 0 || host.offsetHeight === 0) return;
      fitRef.current?.fit();
      const activeSession = sessionRef.current;
      const activeWorkspace = workspaceRef.current;
      if (!activeSession || !activeWorkspace) return;
      if (lastGeometryRef.current.rows === terminal.rows && lastGeometryRef.current.cols === terminal.cols) return;
      lastGeometryRef.current = { rows: terminal.rows, cols: terminal.cols };
      void resizeTerminal(activeWorkspace.id, activeSession.sessionId, terminal.rows, terminal.cols).catch(() => undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  useEffect(() => {
    return () => {
      operationRef.current += 1;
      const activeSession = sessionRef.current;
      sessionRef.current = null;
      if (activeSession) void closeTerminal(activeSession.sessionId);
    };
  }, []);

  useEffect(() => {
    const activeSession = sessionRef.current;
    if (activeSession && activeSession.workspaceId !== workspace?.id) {
      const operation = ++operationRef.current;
      publishState("closing", null, activeSession, null);
      void closeTerminal(activeSession.sessionId)
        .catch(() => undefined)
        .then(() => {
          if (operation !== operationRef.current) return;
          sessionRef.current = null;
          setSession(null);
          setRootPath(null);
          setError(null);
          terminalRef.current?.reset();
          publishState("idle", null, null, null);
        });
    } else {
      setRootPath(null);
      setError(null);
      setExitCode(null);
      terminalRef.current?.reset();
      publishState("idle", null, null, null);
    }
  }, [workspace?.id]);

  useEffect(() => {
    if (!autoStart || !workspace || autoStartedWorkspaceRef.current === workspace.id) return;
    if (viewState !== "idle") return;
    autoStartedWorkspaceRef.current = workspace.id;
    void startTerminal(false);
  }, [autoStart, viewState, workspace?.id]);

  async function startTerminal(resetBuffer: boolean) {
    if (!workspace || sessionRef.current || viewState === "starting" || viewState === "running" || viewState === "closing") return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    const operation = ++operationRef.current;
    setError(null);
    setExitCode(null);
    if (resetBuffer) terminal.reset();
    fitRef.current?.fit();
    publishState("starting", null, null, null);

    const onEvent = (event: TerminalEvent) => {
      if (operation !== operationRef.current) return;
      if (event.type !== "started" && event.paneId !== paneId) return;
      if (event.type === "started") {
        sessionRef.current = event.session;
        setSession(event.session);
        setRootPath(workspace.rootPath);
        setExitCode(null);
        publishState("running", null, event.session, null);
      } else if (event.type === "data") {
        terminal.write(new Uint8Array(event.data), () => {
          void acknowledgeTerminal(event.workspaceId, event.sessionId, event.sequence).catch(() => undefined);
        });
      } else if (event.type === "exited") {
        if (sessionRef.current?.sessionId === event.sessionId) sessionRef.current = null;
        setSession(null);
        setExitCode(event.exitCode);
        publishState("exited", null, null, event.exitCode);
      } else {
        setError(event.message);
        publishState("error", event.message, sessionRef.current);
      }
    };

    try {
      const nextSession = await spawnTerminal(
        { workspaceId: workspace.id, paneId, rows: terminal.rows || 24, cols: terminal.cols || 80 },
        onEvent,
      );
      if (operation !== operationRef.current) {
        await closeTerminal(nextSession.sessionId);
        return;
      }
      sessionRef.current = nextSession;
      setSession(nextSession);
      setRootPath(workspace.rootPath);
      publishState("running", null, nextSession, null);
    } catch (spawnError) {
      if (operation !== operationRef.current) return;
      const message = formatTerminalError(spawnError);
      setError(message);
      publishState("error", message, null);
    }
  }

  async function closeSession() {
    const activeSession = sessionRef.current;
    const operation = ++operationRef.current;
    setError(null);
    setExitCode(null);
    if (!activeSession) {
      publishState("idle", null, null, null);
      return;
    }
    publishState("closing", null, activeSession, null);
    try {
      await closeTerminal(activeSession.sessionId);
      if (operation !== operationRef.current) return;
      sessionRef.current = null;
      setSession(null);
      setExitCode(null);
      publishState("idle", null, null, null);
    } catch (closeError) {
      if (operation !== operationRef.current) return;
      const message = formatTerminalError(closeError);
      setError(message);
      publishState("error", message, activeSession);
    }
  }

  async function restartSession() {
    if (!sessionRef.current || viewState === "closing") return;
    const activeSession = sessionRef.current;
    const operation = ++operationRef.current;
      publishState("closing", null, activeSession, null);
    try {
      await closeTerminal(activeSession.sessionId);
      if (operation !== operationRef.current) return;
      sessionRef.current = null;
      setSession(null);
      setExitCode(null);
      publishState("idle", null, null, null);
      await startTerminal(true);
    } catch (restartError) {
      if (operation !== operationRef.current) return;
      const message = formatTerminalError(restartError);
      setError(message);
      publishState("error", message, null);
    }
  }

  const canStart = Boolean(workspace) && viewState !== "starting" && viewState !== "closing";
  return (
    <article
      className={`terminal-card${active ? " terminal-card-active" : ""}`}
      data-terminal-pane={paneId}
      onClick={onFocus}
      style={{ display: visible ? undefined : "none" }}
    >
      <header className="terminal-card-header">
        <span className={`terminal-led terminal-led-${viewState}`} aria-hidden="true" />
        <span className="terminal-id">{paneId}</span>
        <span className="terminal-title">POWERSHELL PTY / XTERM</span>
        <span className="terminal-state">{viewState.toUpperCase()}</span>
        {session ? (
          <button className="terminal-header-button" disabled={viewState === "closing"} onClick={(event) => { event.stopPropagation(); void restartSession(); }} type="button">
            Restart
          </button>
        ) : null}
      </header>
      <div className="terminal-card-body terminal-core-body">
        <div ref={hostRef} className="terminal-xterm-host" aria-label={`${paneId} terminal output`} />
        <div className="terminal-runtime-meta">
          <span>{session ? `${session.shell} · PID ${session.pid ?? "?"}` : viewState === "exited" ? `Exited · code ${exitCode ?? "?"}` : "No active session"}</span>
          <span title={rootPath ?? workspace?.rootPath ?? undefined}>{rootPath ?? workspace?.rootPath ?? "Open a workspace"}</span>
        </div>
        {error ? <p className="terminal-error">{error}</p> : null}
        <div className="terminal-actions">
          {session ? (
            <button className="terminal-action-button terminal-stop-button" disabled={viewState === "closing"} onClick={(event) => { event.stopPropagation(); void closeSession(); }} type="button">
              {viewState === "closing" ? "Closing…" : "Close Terminal"}
            </button>
          ) : (
            <button className="terminal-action-button" disabled={!canStart} onClick={(event) => { event.stopPropagation(); void startTerminal(false); }} type="button">
              {viewState === "starting" ? "Starting…" : "Start Terminal"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
});

function terminalTheme(theme: UiTheme) {
  return theme === "light"
    ? { background: "#f8fbfd", foreground: "#25313d", cursor: "#087f66", selectionBackground: "#cceee2" }
    : { background: "#0d1117", foreground: "#d4dce7", cursor: "#91e1c3", selectionBackground: "#24433b" };
}

function quotePowerShellPath(path: string): string {
  return `'${path.replaceAll("'", "''")}'`;
}
