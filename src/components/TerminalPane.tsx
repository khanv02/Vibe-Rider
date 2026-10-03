import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
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

interface TerminalPaneProps {
  active: boolean;
  onFocus: () => void;
  onStateChange: (state: TerminalPaneState) => void;
  paneId: TerminalPaneId;
  visible: boolean;
  workspace: WorkspaceDescriptor | null;
}

export function TerminalPane({
  active,
  onFocus,
  onStateChange,
  paneId,
  visible,
  workspace,
}: TerminalPaneProps) {
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
  const resizeFrameRef = useRef<number | null>(null);
  const lastGeometryRef = useRef({ rows: 0, cols: 0 });
  workspaceRef.current = workspace;
  callbackRef.current = onStateChange;

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
      theme: { background: "#0d1117", foreground: "#d4dce7", cursor: "#91e1c3" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    fitRef.current = fit;
    terminalRef.current = terminal;

    const inputDisposable = terminal.onData((data) => {
      const activeSession = sessionRef.current;
      const activeWorkspace = workspaceRef.current;
      if (!activeSession || !activeWorkspace) return;
      const bytes = new TextEncoder().encode(data);
      const operation = operationRef.current;
      inputQueueRef.current = inputQueueRef.current
        .catch(() => undefined)
        .then(() => {
          if (operation !== operationRef.current) return;
          return writeTerminal(activeWorkspace.id, activeSession.sessionId, bytes);
        })
        .catch((writeError: unknown) => {
          if (operation !== operationRef.current) return;
          const message = formatTerminalError(writeError);
          setError(message);
          publishState("error", message, sessionRef.current);
        });
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
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
    // The pane owns one xterm instance for its entire lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function startTerminal(resetBuffer: boolean) {
    if (!workspace || viewState === "starting" || viewState === "closing") return;
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
}
