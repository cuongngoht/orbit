// The shapes control-server answers with for MCP (control-server/src/mcp/*.mjs).
// No field here ever carries a header value, an environment value or a URL
// query value: a managed server NAMES its secrets and says whether each is set;
// an external one shows header and variable names and whether the host has them.

export type Ownership = "orbit-managed" | "external" | "catalog";
export type Selection = "automatic" | "approval" | "disabled";
export type Verdict = "allow" | "approval" | "deny";
export type McpStatus = "connected" | "failed" | "needs-auth" | "pending-approval" | "unknown";

export interface SecretName {
  name: string;
  configured: boolean;
}

export interface Policy {
  default: Verdict;
  capabilities: Record<string, Verdict>;
  operations: Partial<Record<"read" | "write", Verdict>>;
}

/** What every owner's entry shares: the four answers are kept apart. */
interface McpCommon {
  key: string;
  id: string;
  name: string;
  description: string;
  ownership: Ownership;
  transport: "http" | "stdio" | null;
  provides: string[];
  signals: string[];
  requiresSignal: boolean;
  /** A person wants it used at all. */
  enabled: boolean;
  /** It could run here now, whether or not anybody wants it. */
  runtimeReady: boolean;
  /** Enabled and runtime-ready. */
  available: boolean;
  /** The resolver may consider it. Never true for an external server. */
  eligible: boolean;
  selection: Selection;
  state: string;
  why: string | null;
  status: McpStatus;
  checkedAt: string | null;
  lastStatus: McpStatus | null;
  checkFresh: boolean;
  reason: string | null;
  toolCount: number | null;
  catalog: string | null;
}

export interface ManagedDefinition {
  transport: "http" | "stdio";
  url?: string | null;
  requiredHeaders?: { name: string; env: string; set: boolean }[];
  command?: string | null;
  commandRef?: "managed-runtime" | null;
  args?: string[];
  requiredEnv?: { name: string; set: boolean }[];
}

export interface Receipt {
  version: string;
  platform: string;
  arch: string;
  installedAt: string | null;
  source: string | null;
  checksum: string | null;
  /** The runtime it names is actually on the disk right now. */
  verified: boolean;
}

export interface ManagedServer extends McpCommon {
  ownership: "orbit-managed";
  origin: "catalog" | "custom";
  priority: number;
  definition: ManagedDefinition;
  secrets: { missing: string[] };
  runtime: { kind: "remote" | "machine" | "managed"; present: boolean; receipt: Receipt | null };
  install: { strategy: string; supported: boolean; reason: string | null; version: string | null; source: string | null };
  policy: Policy;
  approval: { until: string } | null;
  createdAt: string | null;
  updatedAt: string | null;
  consumers?: Consumer[];
}

export interface ExternalServer extends McpCommon {
  ownership: "external";
  host: string | null;
  scope: string | null;
  url?: string | null;
  command?: string | null;
  args?: string[];
  headers?: SecretName[];
  env?: SecretName[];
  hostEnabled?: boolean;
  observed: true;
  stale: boolean;
  readOnly?: boolean;
}

export interface McpOverview {
  host: string;
  managed: ManagedServer[];
  external: ExternalServer[];
}

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  recommended: boolean;
  provides: string[];
  transport: "http" | "stdio" | null;
  install: { strategy: string; version: string | null; source: string | null };
  addable: boolean;
  added: boolean;
  observedInHost: boolean;
}

export interface Consumer {
  kind: "skill" | "agent";
  id: string;
  requirement: string;
  level: "required" | "optional";
}

export interface McpTool {
  name: string;
  description: string;
}

export interface Check {
  status: McpStatus;
  checkedAt: string;
  reason: string | null;
  toolCount: number | null;
  tools: McpTool[] | null;
}

export interface PoliciesView {
  verdicts: Verdict[];
  selections: Selection[];
  resources: { key: string; id: string; name: string; provides: string[]; selection: Selection; policy: Policy }[];
  workflows: Record<string, Record<string, Verdict>>;
}

export interface ActivityEvent {
  at: string;
  kind: "mcp-started" | "mcp-invoked" | "mcp-failed" | "mcp-blocked";
  resource?: string;
  tool?: string;
  capability?: string;
  workflow?: string;
  operation?: string;
  ms?: number;
  outcome?: string;
  reason?: string;
}

/** What "Add custom" sends: secrets are NAMED, with the variable that supplies each. */
export interface ManagedInput {
  id: string;
  name?: string;
  description?: string;
  transport: "http" | "stdio";
  url?: string;
  requiredHeaders?: { name: string; env: string }[];
  command?: string;
  args?: string[];
  requiredEnv?: string[];
  provides?: string[];
  selection?: Selection;
}
