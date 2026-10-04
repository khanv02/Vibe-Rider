export type ActivitySessionStatus = "active" | "ended" | "interrupted";

export interface ActivitySessionSummary {
  sessionId: string;
  workspaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: ActivitySessionStatus;
  eventCount: number;
}

export interface ActivityEvent {
  sequence: number;
  at: number;
  kind: string;
  summary: string;
  detail: string | null;
}

export interface ActivitySessionDetail {
  session: ActivitySessionSummary;
  events: ActivityEvent[];
}
