import { useState } from "react";
import type { WorkspaceDescriptor } from "../workspace/types";
import type { WorkspaceActivityController } from "../activity/useWorkspaceActivity";
import type { ActivitySessionSummary } from "../activity/types";

interface ActivityPanelProps {
  controller: WorkspaceActivityController;
  workspace: WorkspaceDescriptor | null;
}

export function ActivityPanel({ controller, workspace }: ActivityPanelProps) {
  const [note, setNote] = useState("");
  const [selectedKind, setSelectedKind] = useState("checkpoint");

  if (!workspace) {
    return (
      <div className="tool-placeholder">
        <div className="tool-placeholder-icon" aria-hidden="true">◈</div>
        <h3>No workspace open</h3>
        <p>Open a workspace to start a local activity session.</p>
      </div>
    );
  }

  async function addNote() {
    const value = note.trim();
    if (!value) return;
    await controller.record(selectedKind, value);
    setNote("");
  }

  function statusLabel(session: ActivitySessionSummary) {
    if (session.sessionId === controller.currentSession?.sessionId) return "CURRENT";
    if (session.status === "interrupted") return "INTERRUPTED";
    if (session.status === "ended") return "ENDED";
    return "ACTIVE";
  }

  return (
    <div className="activity-panel-content">
      <section className="activity-current-card" aria-labelledby="activity-current-title">
        <div className="activity-section-heading">
          <div>
            <p className="panel-kicker">CURRENT SESSION</p>
            <h3 id="activity-current-title">{controller.currentSession?.title ?? "No activity yet"}</h3>
          </div>
          <button className="size-button" disabled={controller.busy} onClick={() => void controller.refresh()} type="button">
            Refresh
          </button>
        </div>
        <p className="activity-security-note">
          Only structured events are stored in local app data. A session is created only when the first event is saved; empty visits are not persisted.
        </p>
        <div className="activity-note-row">
          <select aria-label="Activity event type" id="activity-event-kind" name="activityEventKind" value={selectedKind} onChange={(event) => setSelectedKind(event.target.value)}>
            <option value="checkpoint">Checkpoint</option>
            <option value="cli">AI CLI note</option>
            <option value="search">Search note</option>
            <option value="tool">Tool note</option>
          </select>
          <input
            aria-label="Activity note"
            disabled={controller.busy}
            id="activity-note"
            name="activityNote"
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void addNote();
            }}
            placeholder="Add a checkpoint for later..."
            value={note}
          />
          <button className="primary-button" disabled={!note.trim() || controller.busy} onClick={() => void addNote()} type="button">
            Save
          </button>
        </div>
      </section>

      {controller.error ? <p className="workspace-error">{controller.error}</p> : null}

      <section className="activity-history" aria-labelledby="activity-history-title">
        <div className="activity-section-heading">
          <div>
            <p className="panel-kicker">SESSION HISTORY</p>
            <h3 id="activity-history-title">Previous sessions</h3>
          </div>
          <span className="default-badge">{controller.sessions.length}</span>
        </div>
        <div className="activity-session-list">
          {controller.sessions.length === 0 ? <p className="muted-copy">No sessions yet.</p> : null}
          {controller.sessions.map((session) => (
            <div
              className={`activity-session-item${controller.selected?.session.sessionId === session.sessionId ? " activity-session-item-active" : ""}`}
              key={session.sessionId}
            >
              <button className="activity-session-open" onClick={() => void controller.select(session.sessionId)} type="button">
                <span className="activity-session-main">
                  <strong>{session.title}</strong>
                  <small>{formatTime(session.updatedAt)} · {session.eventCount} events</small>
                </span>
              </button>
              <span className="activity-session-side">
                <small>{statusLabel(session)}</small>
                {session.sessionId !== controller.currentSession?.sessionId ? (
                  <span className="activity-session-actions">
                    <button aria-label={`Resume ${session.title}`} className="activity-inline-action" onClick={() => void controller.resume(session.sessionId)} type="button">
                      Resume
                    </button>
                    <button aria-label={`Delete ${session.title}`} className="activity-inline-action activity-inline-action-danger" onClick={() => {
                      if (window.confirm(`Move "${session.title}" to Activity Trash?`)) void controller.remove(session.sessionId);
                    }} type="button">
                      Delete
                    </button>
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </section>

      {controller.trash.length > 0 ? (
        <section className="activity-trash" aria-labelledby="activity-trash-title">
          <div className="activity-section-heading">
            <div>
              <p className="panel-kicker">TRASH</p>
              <h3 id="activity-trash-title">Deleted sessions</h3>
            </div>
            <span className="default-badge">{controller.trash.length}</span>
          </div>
          <div className="activity-session-list">
            {controller.trash.map((session) => (
              <div className="activity-session-item activity-trash-item" key={session.sessionId}>
                <span className="activity-session-main">
                  <strong>{session.title}</strong>
                  <small>{formatTime(session.updatedAt)} · {session.eventCount} events</small>
                </span>
                <button className="activity-inline-action" disabled={controller.busy} onClick={() => void controller.restore(session.sessionId)} type="button">
                  Restore
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {controller.selected ? (
        <section className="activity-detail" aria-labelledby="activity-detail-title">
          <div className="activity-section-heading">
            <div>
              <p className="panel-kicker">SESSION DETAIL</p>
              <h3 id="activity-detail-title">{controller.selected.session.title}</h3>
            </div>
            <span className="default-badge">{controller.selected.session.status.toUpperCase()}</span>
          </div>
          <div className="activity-event-list">
            {controller.selected.events.length === 0 ? <p className="muted-copy">This session has no events.</p> : null}
            {controller.selected.events.map((event) => (
              <article className="activity-event" key={`${event.sequence}-${event.at}`}>
                <div className="activity-event-meta"><span>{event.kind}</span><time>{formatTime(event.at)}</time></div>
                <p>{event.summary}</p>
                {event.detail ? <pre>{event.detail}</pre> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function formatTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(timestamp);
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}
