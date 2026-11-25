// THE CONNECTORS a signed-in Claude account brings -- its claude.ai connectors, and the MCP servers of the plugins
// installed for it -- and where each may be used: in a chat, in research. The list is the account's own Claude CLI's
// answer (asked over its control protocol; no model is called); the choices are the person's, kept per account. A
// connector may be used wherever it is checked -- a chat, research (a conversation like a chat, its sources references;
// owner's decision) -- and is checked for both until a person unchecks it. More uses can join `ConnectorUse` later.
export type ConnectorKind = "claude.ai" | "plugin" | "other";

export interface ConnectorUse {
  chat: boolean;
  research: boolean;
}

export const CONNECTOR_USES = ["chat", "research"] as const satisfies readonly (keyof ConnectorUse)[];

// Before anybody chose: research as chats are -- every connector the account has.
export const CONNECTOR_DEFAULTS: ConnectorUse = { chat: true, research: true };

export interface Connector {
  // The CLI's own name ("claude.ai Claude Docs", "plugin:design:figma"): the key the choices are kept under.
  name: string;
  label: string;
  kind: ConnectorKind;
  // The CLI's word for it now: connected, needs-auth (sign in to it at claude.ai), failed, pending, disabled ...
  status: string;
  tools: number | null;
  chat: boolean;
  research: boolean;
}

export interface ConnectorList {
  // account: what the signed-in account's Claude CLI reported; unavailable: it could not be asked (the choices kept so
  // far are listed all the same).
  source: "account" | "unavailable";
  connectors: Connector[];
  detail: string | null;
  readAt: string | null;
}

export interface UpdateConnectorsRequest {
  connectors: Record<string, Partial<ConnectorUse>>;
}

export const CONNECTOR_LIMITS = { names: 100, nameLength: 120 } as const;

// The prefix of the tools one connector gives Claude Code (`mcp__<server>__<tool>`): its name with every character but
// a letter, a digit, `_` and `-` made `_` -- as the CLI names them ("claude.ai Claude Docs" -> mcp__claude_ai_Claude_Docs).
export const connectorToolPrefix = (name: string): string => `mcp__${name.replace(/[^A-Za-z0-9_-]/g, "_")}`;

export const connectorKindOf = (name: string): ConnectorKind => (name.startsWith("claude.ai ") ? "claude.ai" : name.startsWith("plugin:") ? "plugin" : "other");

export const connectorLabelOf = (name: string): string => {
  if (name.startsWith("claude.ai ")) return name.slice("claude.ai ".length);
  if (name.startsWith("plugin:")) return name.split(":").slice(1).join(" · ");
  return name;
};
