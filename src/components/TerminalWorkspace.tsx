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
import type { TerminalEvent, TerminalSession, TerminalViewState } from "../terminal/types";
import type { WorkspaceDescriptor } from "../workspace/types";

interface TerminalWorkspaceProps {
  onStateChange: (state: TerminalViewState) => void;
  workspace: WorkspaceDescriptor | null;
}

export function TerminalWorkspace({ onStateChange, workspace }: TerminalWorkspaceProps) {
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [sessionRootPath, setSessionRootPath] = useState<string | null>(null);
  const [viewState, setViewState] = useState<TerminalViewState>("idle");
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const operationRef = useRef(0);
  const inputQueueRef = useRef(Promise.resolve());
  const workspaceRef = useRef(workspace);
  const resizeFrameRef = useRef<number | null>(null);
  const lastGeometryRef = useRef({ rows: 0, cols: 0 });
  workspaceRef.current = workspace;

  function transition(nextState: TerminalViewState) {
    setViewState(nextState);
    onStateChange(nextState);
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
    fit.fit();
    terminal.focus();
    terminalRef.current = terminal;
    fitRef.current = fit;

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
          setError(formatTerminalError(writeError));
          transition("error");
        });
    });

    const observer = new ResizeObserver(() => {
      if (resizeFrameRef.current !== null) return;
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        fit.fit();
        const activeSession = sessionRef.current;
        const activeWorkspace = workspaceRef.current;
        if (!activeSession || !activeWorkspace) return;
        if (lastGeometryRef.current.rows === terminal.rows && lastGeometryRef.current.cols === terminal.cols) return;
        lastGeometryRef.current = { rows: terminal.rows, cols: terminal.cols };
        void resizeTerminal(activeWorkspace.id, activeSession.sessionId, terminal.rows, terminal.cols).catch(
          (resizeError: unknown) => setError(formatTerminalError(resizeError)),
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
  }, []);

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
    if (!activeSession || activeSession.workspaceId === workspace?.id) return;
    const operation = ++operationRef.current;
    transition("closing");
    void closeTerminal(activeSession.sessionId)
      .then(() => {
        if (operation !== operationRef.current) return;
        sessionRef.current = null;
        setSession(null);
        setSessionRootPath(null);
        setError(null);
        transition("idle");
      })
      .catch((closeError: unknown) => {
        if (operation !== operationRef.current) return;
        setError(formatTerminalError(closeError));
        transition("error");
      });
  }, [workspace?.id]);

  async function startTerminal() {
    if (!workspace || viewState === "starting" || viewState === "closing") return;
    const terminal = terminalRef.current;
    fitRef.current?.fit();
    const operation = ++operationRef.current;
    setError(null);
    terminal?.reset();
    transition("starting");

    const onEvent = (event: TerminalEvent) => {
      if (operation !== operationRef.current) return;
      if (event.type === "started") {
        sessionRef.current = event.session;
        setSession(event.session);
        setSessionRootPath(workspace.rootPath);
        transition("running");
      } else if (event.type === "data") {
        terminal?.write(new Uint8Array(event.data), () => {
          void acknowledgeTerminal(event.workspaceId, event.sessionId, event.sequence).catch(() => undefined);
        });
      } else if (event.type === "exited") {
        if (sessionRef.current?.sessionId === event.sessionId) sessionRef.current = null;
        setSession(null);
        transition("exited");
      } else {
        setError(event.message);
        transition("error");
      }
    };

    try {
      const nextSession = await spawnTerminal(
        { workspaceId: workspace.id, rows: terminal?.rows ?? 24, cols: terminal?.cols ?? 80 },
        onEvent,
      );
      if (operation !== operationRef.current) {
        await closeTerminal(nextSession.sessionId);
        return;
      }
      sessionRef.current = nextSession;
      setSession(nextSession);
      setSessionRootPath(workspace.rootPath);
      transition("running");
    } catch (spawnError) {
      if (operation !== operationRef.current) return;
      setError(formatTerminalError(spawnError));
      transition("error");
    }
  }

  async function stopTerminal() {
    const activeSession = sessionRef.current;
    const operation = ++operationRef.current;
    setError(null);
    if (!activeSession) {
      setSession(null);
      transition("idle");
      return;
    }
    transition("closing");
    try {
      await closeTerminal(activeSession.sessionId);
      if (operation !== operationRef.current) return;
      sessionRef.current = null;
      setSession(null);
      setSessionRootPath(null);
      transition("idle");
    } catch (closeError) {
      if (operation !== operationRef.current) return;
      setError(formatTerminalError(closeError));
      transition("error");
    }
  }

  const canStart = Boolean(workspace) && viewState !== "starting" && viewState !== "closing";
  return (
    <section className="terminal-workspace" aria-labelledby="terminal-workspace-title">
      <div className="workspace-heading">
        <div>
          <p className="workspace-kicker">MAIN WORKSPACE</p>
          <h2 id="terminal-workspace-title">Terminal Core</h2>
        </div>
        <div className="layout-indicator">
          <span className="layout-dot" aria-hidden="true" />
          <span>1 SESSION</span>
          <span className="mock-label">TASK 2.5</span>
        </div>
      </div>
      <article className="terminal-card terminal-card-single">
        <header className="terminal-card-header">
          <span className={`terminal-led terminal-led-${viewState}`} aria-hidden="true" />
          <span className="terminal-id">T1</span>
          <span className="terminal-title">POWERSHELL PTY / XTERM</span>
          <span className="terminal-state">{viewState.toUpperCase()}</span>
        </header>
        <div className="terminal-card-body terminal-core-body">
          <div ref={hostRef} className="terminal-xterm-host" aria-label="Terminal output" />
          <div className="terminal-runtime-meta">
            <span>{session ? `${session.shell} · PID ${session.pid ?? "?"}` : "No active session"}</span>
            <span title={sessionRootPath ?? undefined}>
              {sessionRootPath ?? workspace?.rootPath ?? "Open a workspace"}
            </span>
          </div>
          {error ? <p className="terminal-error">{error}</p> : null}
          <div className="terminal-actions">
            {session ? (
              <button className="terminal-action-button terminal-stop-button" disabled={viewState === "closing"} onClick={stopTerminal} type="button">
                {viewState === "closing" ? "Closing…" : "Close Terminal"}
              </button>
            ) : (
              <button className="terminal-action-button" disabled={!canStart} onClick={startTerminal} type="button">
                {viewState === "starting" ? "Starting…" : "Start Terminal"}
              </button>
            )}
          </div>
        </div>
      </article>
    </section>
  );
}
