// THE CONNECTORS of the signed-in Claude account, as its own Claude CLI says them -- pure: the probe's command line, its
// requests, and its answer read into a list. Asked through the control protocol (the one the Agent SDK speaks):
// `initialize`, then `mcp_status` until the list has settled -- the account's claude.ai connectors arrive a moment after
// the CLI starts. Nothing else is sent, so no model is called. The probe has no tool and is allowed none (`dontAsk`); it
// reads the user's settings source because the account's connectors come only with it (checked with Claude Code
// 2.1.328: with any other source, or `--restricted`, the CLI lists none).
import { redactSecrets } from "../../infra/security/redact.js";

export const CONNECTORS_PROBE_ARGS = [
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "-p",
  "--no-session-persistence",
  "--tools",
  "",
  "--setting-sources",
  "user",
  "--disable-slash-commands",
  "--permission-mode",
  "dontAsk",
];

export const controlRequest = (id: string, subtype: "initialize" | "mcp_status"): string => `${JSON.stringify({ type: "control_request", request_id: id, request: { subtype } })}\n`;

export interface ProbedConnector {
  name: string;
  status: string;
  tools: number | null;
}

const MAX_CONNECTORS = 100;

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
// eslint-disable-next-line no-control-regex -- control characters are never part of a name kept
const printable = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" && !/[\u0000-\u001f\u007f]/.test(v) ? redactSecrets(v.trim()).slice(0, max) : null);

// The connectors an `mcp_status` answer lists, or null when the line is not that answer.
export function connectorsOf(line: unknown): ProbedConnector[] | null {
  if (!isRecord(line) || line.type !== "control_response" || !isRecord(line.response)) return null;
  const answer = line.response.response;
  if (!isRecord(answer) || !Array.isArray(answer.mcpServers)) return null;
  return answer.mcpServers
    .filter(isRecord)
    .map((s) => ({ name: printable(s.name, 120), status: printable(s.status, 40) ?? "unknown", tools: Array.isArray(s.tools) ? s.tools.length : null }))
    .filter((s): s is ProbedConnector => s.name !== null)
    .slice(0, MAX_CONNECTORS);
}

// Settled: something is listed, nothing is still connecting, and the names are those of the answer before.
export const settledOver = (before: ProbedConnector[] | null, now: ProbedConnector[]): boolean =>
  before !== null && now.length > 0 && now.every((c) => c.status !== "pending") && before.map((c) => c.name).join("\n") === now.map((c) => c.name).join("\n");
