// THE MODEL CATALOG of an OpenAI Codex connection, as its own CLI says it (run against that connection's CODEX_HOME) --
// pure: what its app server is asked, and its answer read into Orbit Web's catalog. The app server (`codex app-server`,
// JSON-RPC over stdio) is asked `model/list` after its `initialize`: the models its own picker offers THIS account (a
// ChatGPT plan's or an API key's), each with the reasoning efforts it takes and whether it is the default. No model is
// called -- the CLI reads its catalog (one GET when its cache is stale) and answers. When the app server cannot answer,
// the catalog bundled in the binary (`codex debug models --bundled`, offline) is the labelled fallback: chats may use
// it, an employee never does (probe.ts).
import { isEffortChoice, isModelChoice, ORBIT_WEB_VERSION, type ModelCatalog, type ModelOption } from "@orbit-web/contracts";
import { redactSecrets } from "../../infra/security/redact.js";

// The answer read is the one to this id.
const MODELS_ID = 2;

export const CODEX_MODELS_REQUEST = `${[
  { method: "initialize", id: 0, params: { clientInfo: { name: "orbit_web", title: "Orbit Web", version: ORBIT_WEB_VERSION } } },
  { method: "initialized" },
  { method: "model/list", id: MODELS_ID, params: { includeHidden: false } },
]
  .map((m) => JSON.stringify(m))
  .join("\n")}\n`;

// What `codex debug models --bundled` is run with.
export const CODEX_BUNDLED_MODELS_ARGS = ["debug", "models", "--bundled"];

const MAX_MODELS = 60;
const LABEL_LIMIT = 80;
const DESCRIPTION_LIMIT = 200;

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

// eslint-disable-next-line no-control-regex -- control characters are removed from what is shown
const printable = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? redactSecrets(v.replace(/[\u0000-\u001f\u007f]/g, " ").trim()).slice(0, max) : null);

// One model of either list, held to the shapes a choice must have. `autoMode`: Autonomous runs in Codex's own sandbox
// whatever the model, so every Codex model takes it.
function optionOf(id: unknown, label: unknown, description: unknown, efforts: unknown[]): ModelOption | null {
  if (!isModelChoice(id) || id === "default") return null;
  const levels = [...new Set(efforts.filter(isEffortChoice))];
  return { id, label: printable(label, LABEL_LIMIT) ?? id, description: printable(description, DESCRIPTION_LIMIT), efforts: levels, autoMode: true };
}

const once = (options: ModelOption[]): ModelOption[] => options.filter((o, i, all) => all.findIndex((x) => x.id === o.id) === i).slice(0, MAX_MODELS);

// One line the app server printed: the answer to model/list (`undefined`: not that answer) -- the catalog it names, or
// null when it names no model (an error, an empty list).
export function codexModelsOf(line: string): ModelCatalog | null | undefined {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(msg) || msg.id !== MODELS_ID) return undefined;
  const data = isRecord(msg.result) && Array.isArray(msg.result.data) ? msg.result.data.filter(isRecord) : [];
  const shown = data.filter((m) => m.hidden !== true);
  const options = once(shown.flatMap((m) => optionOf(m.model ?? m.id, m.displayName, m.description, Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts.map((e) => (isRecord(e) ? e.reasoningEffort : null)) : []) ?? []));
  if (options.length === 0) return null;
  const marked = shown.find((m) => m.isDefault === true && options.some((o) => o.id === (m.model ?? m.id)));
  return { source: "account", models: options, recommended: typeof (marked?.model ?? marked?.id) === "string" ? ((marked?.model ?? marked?.id) as string) : (options[0] as ModelOption).id, detail: null };
}

// `codex debug models --bundled`: the binary's own catalog, the models its picker lists (`visibility: "list"`) in its
// order (`priority`), the first recommended -- or null when that is not what it printed.
export function parseBundledCodexModels(stdout: string): ModelCatalog | null {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return null;
  }
  const models = isRecord(json) && Array.isArray(json.models) ? json.models.filter(isRecord) : [];
  const listed = models.filter((m) => m.visibility === "list").sort((a, b) => (typeof a.priority === "number" ? a.priority : 1e9) - (typeof b.priority === "number" ? b.priority : 1e9));
  const options = once(listed.flatMap((m) => optionOf(m.slug, m.display_name, m.description, Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels.map((e) => (isRecord(e) ? e.effort : null)) : []) ?? []));
  if (options.length === 0) return null;
  return { source: "fallback", models: options, recommended: (options[0] as ModelOption).id, detail: null };
}
