// A RouteDecision -> the few lines a host adds beside the prompt, or null.
//
// Null is the common answer and the right one: a prompt that required nothing,
// or matched nothing worth saying, adds NOTHING to the session. Anything else is
// held to a hard BUDGET_BYTES: the registry is never dumped, a line is clipped,
// and whole lines are dropped from the end until the text fits.
//
// What the session already has is not repeated: an IMPLICIT provider (the
// checkout the session reads anyway) is part of the decision and of the
// Router Inspector, never a line here. A Orbit-managed MCP server is not in the
// host's own tool list, so when one is recommended the context says how it is
// reached -- `callVia`, which the composition root knows and this file does not.
//
// It recommends; it never instructs. There is no "you must call" -- the host
// knows the conversation, this only knows a table.
import { labelOf } from "../resources/model.mjs";

export const BUDGET_BYTES = 2048;
const LINE_LIMIT = 240;

const HEAD = "Orbit routing context";
const FOOT = "Use these only if they help with the request. The router ran nothing and installed nothing.";

const SECTIONS = [
  ["selected", "Relevant and available here:"],
  ["approval", "Relevant, but a person must approve it in Orbit Control first:"],
  ["blocked", "Relevant, but Orbit policy blocks it:"],
  ["missing", "Relevant, but not usable here:"],
];

export function formatDecision(decision, opts = {}) {
  const shown = Object.fromEntries(SECTIONS.map(([name]) => [name, (decision?.[name] ?? []).filter((e) => !e.implicit)]));
  if (!SECTIONS.some(([name]) => shown[name].length)) return null;
  const body = SECTIONS.flatMap(([name, title]) => section(title, shown[name]));
  return fitted([HEAD, `Intent: ${decision.intent.id} (${decision.intent.confidence} confidence)`, "", ...body, ...howToCall(shown, opts.callVia)], FOOT);
}

const section = (title, entries) => (entries.length ? [title, ...entries.map(line), ""] : []);

const line = (e) => clip(`- ${e.id} (${labelOf(e.kind)}${e.key?.startsWith("managed:") ? ", Orbit-managed" : ""})${e.summary ? `: ${e.summary}` : ""} -- ${e.reason}`);

// Said once, and only when a managed server is among what may be used.
function howToCall(shown, callVia) {
  const managed = [...shown.selected, ...shown.approval].some((e) => e.key?.startsWith("managed:"));
  return managed && callVia ? [`A Orbit-managed MCP server is not in the host's tool list; reach it through: ${callVia} <server> <tool> --input='<json>'`, ""] : [];
}

const clip = (text) => (text.length > LINE_LIMIT ? `${text.slice(0, LINE_LIMIT - 1)}…` : text);

function fitted(lines, foot) {
  const kept = [...lines];
  while (kept.length > 3 && bytes([...kept, foot]) > BUDGET_BYTES) kept.pop();
  return [...kept, foot].join("\n");
}

const bytes = (lines) => Buffer.byteLength(lines.join("\n"));
