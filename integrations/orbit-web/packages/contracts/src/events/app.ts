// The payloads of the APP stream (`GET /api/events`): what any page of this Orbit Web may need to know as it happens --
// the chats in the sidebar, the connectors and their sign-in flows, the projects' skills and plugins. They are
// NOTIFICATIONS: a client that (re)connects reads the read models again (`/api/sessions`, `/api/sources`,
// `/api/customizations`) and then applies these, so none of them is stored or replayed.
import type { LoginSnapshot, SessionSummary } from "../dto.js";
import type { ConnectionState } from "../status.js";

export interface SessionSummaryData {
  // The chat as it is now (created, renamed, its status or its model, effort or mode changed).
  session: SessionSummary;
}

export interface SessionRemovedData {
  sessionId: string;
}

// The repository connectors (the Claude account is not one: it is Orbit Web's own sign-in).
export const CONNECTORS = ["github", "azure"] as const;

export type ConnectorName = (typeof CONNECTORS)[number];

export interface ConnectorStatusData {
  connector: ConnectorName;
  state: ConnectionState;
  // GitHub's login, or the Azure account's user name.
  account: string | null;
}

export interface ConnectorFlowData {
  connector: ConnectorName;
  flow: LoginSnapshot;
}

export interface CustomizationsChangedData {
  // The chat whose project's skills or plugins changed.
  sessionId: string;
}

export interface AppEventDataMap {
  "session.summary": SessionSummaryData;
  "session.removed": SessionRemovedData;
  "connector.status": ConnectorStatusData;
  "connector.flow": ConnectorFlowData;
  "customizations.changed": CustomizationsChangedData;
}
