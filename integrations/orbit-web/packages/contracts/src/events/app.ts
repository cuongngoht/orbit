// The payloads of the APP stream (`GET /api/events`): what any page of this Orbit Web may need to know as it happens --
// the chats in the sidebar, the connectors and their sign-in flows, the projects' skills and plugins. They are
// NOTIFICATIONS: a client that (re)connects reads the read models again (`/api/sessions`, `/api/sources`,
// `/api/customizations`) and then applies these, so none of them is stored or replayed.
import type { LoginSnapshot, SessionSummary } from "../dto.js";
import type { ModelCatalog } from "../models.js";
import type { ResearchSessionSummary, ResearchSourceSummary, ResearchWorkspaceSummary } from "../research.js";
import type { ConnectionState } from "../status.js";
import type { OfficeChangedData } from "../workforce.js";
import type { ConnectionsChangedData } from "../ai-connections.js";

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

// What governance changed: a page that shows it reads it again. Ids only -- sent to the account it concerns, and what
// changed is read through the routes the account's owner reaches.
export const GOVERNANCE_AREAS = ["policy", "overrides", "resources", "audit", "findings", "reports", "isolation"] as const;

export type GovernanceArea = (typeof GOVERNANCE_AREAS)[number];

export interface GovernanceChangedData {
  area: GovernanceArea;
  id: string | null;
}

export interface ApprovalChangedData {
  approvalId: string;
  state: string;
}

export interface ClaudeModelsData {
  catalog: ModelCatalog;
}

export interface ResearchWorkspaceChangedData {
  workspace: ResearchWorkspaceSummary;
}

export interface ResearchWorkspaceRemovedData {
  workspaceId: string;
}

export interface ResearchSessionSummaryData {
  session: ResearchSessionSummary;
}

export interface ResearchSessionRemovedData {
  sessionId: string;
  workspaceId: string;
}

export interface ResearchSourceChangedData {
  source: ResearchSourceSummary;
}

export interface ResearchSourceRemovedData {
  workspaceId: string;
  sourceId: string;
}

export interface ResearchEvidenceChangedData {
  workspaceId: string;
  kind: "note" | "finding";
  id: string;
  removed: boolean;
}

export interface AppEventDataMap {
  "session.summary": SessionSummaryData;
  "session.removed": SessionRemovedData;
  "connector.status": ConnectorStatusData;
  "connector.flow": ConnectorFlowData;
  "customizations.changed": CustomizationsChangedData;
  "governance.changed": GovernanceChangedData;
  "approval.changed": ApprovalChangedData;
  "claude.models": ClaudeModelsData;
  "research.workspace.changed": ResearchWorkspaceChangedData;
  "research.workspace.removed": ResearchWorkspaceRemovedData;
  "research.session.summary": ResearchSessionSummaryData;
  "research.session.removed": ResearchSessionRemovedData;
  "research.source.changed": ResearchSourceChangedData;
  "research.source.removed": ResearchSourceRemovedData;
  "research.evidence.changed": ResearchEvidenceChangedData;
  "office.changed": OfficeChangedData;
  "connections.changed": ConnectionsChangedData;
}
