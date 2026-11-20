// THE MODEL CATALOG of the signed-in Claude account, as the account's own Claude CLI says it -- pure: the probe's
// command line, and its answer read into Orbit Web's catalog. The CLI is asked through its control protocol (the one the
// Agent SDK speaks): one `initialize` request on stdin, and its `control_response` lists the models this account may use,
// each with the effort levels it takes and whether auto mode is available with it. Nothing else is sent, so no model is
// called. The probe runs restricted: no tool, no settings file (so no hook), no MCP server, no slash command, nothing
// persisted.
import { EFFORT_CHOICES, isEffortChoice, isModelChoice, type ModelCatalog, type ModelOption } from "@orbit-web/contracts";
import { redactSecrets } from "../../infra/security/redact.js";

export const PROBE_ARGS = [
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "-p",
  "--no-session-persistence",
  "--tools",
  "",
  "--restricted",
  "--strict-mcp-config",
  "--disable-slash-commands",
];

export const PROBE_REQUEST = `${JSON.stringify({ type: "control_request", request_id: "orbit-web-models", request: { subtype: "initialize" } })}\n`;

const MAX_MODELS = 60;
const LABEL_LIMIT = 80;
const DESCRIPTION_LIMIT = 200;

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

// eslint-disable-next-line no-control-regex -- control characters are removed from what is shown
const printable = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? redactSecrets(v.replace(/[\u0000-\u001f\u007f]/g, " ").trim()).slice(0, max) : null);

function optionOf(m: Json): ModelOption | null {
  if (!isModelChoice(m.value) || m.value === "default") return null;
  const levels = Array.isArray(m.supportedEffortLevels) ? m.supportedEffortLevels.filter(isEffortChoice) : null;
  const efforts = m.supportsEffort === true ? (levels !== null && levels.length > 0 ? [...new Set(levels)] : [...EFFORT_CHOICES]) : [];
  return { id: m.value, label: printable(m.displayName, LABEL_LIMIT) ?? m.value, description: printable(m.description, DESCRIPTION_LIMIT), efforts, autoMode: m.supportsAutoMode === true };
}

// The model the CLI's own default (`default`) resolves to, named as one of the account's models.
function recommendedOf(entries: Json[], options: ModelOption[]): string {
  const resolved = entries.find((m) => m.value === "default")?.resolvedModel;
  const byResolved = entries.find((m) => m.value !== "default" && m.resolvedModel === resolved && options.some((o) => o.id === m.value));
  return typeof byResolved?.value === "string" ? byResolved.value : (options[0]?.id ?? "");
}

// The catalog in the CLI's answer, or null when the answer holds none.
export function parseModelCatalog(stdout: string): ModelCatalog | null {
  for (const line of stdout.split("\n")) {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(json) || json.type !== "control_response" || !isRecord(json.response) || json.response.subtype !== "success") continue;
    const answer = isRecord(json.response.response) ? json.response.response : json.response;
    const entries = Array.isArray(answer.models) ? answer.models.filter(isRecord).slice(0, MAX_MODELS) : [];
    const options = entries.flatMap((m) => optionOf(m) ?? []).filter((o, i, all) => all.findIndex((x) => x.id === o.id) === i);
    if (options.length === 0) return null;
    return { source: "account", models: options, recommended: recommendedOf(entries, options), detail: null };
  }
  return null;
}
