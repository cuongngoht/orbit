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
//
// A skill that may be used names the agents its playbook dispatches (0.5.0,
// `opts.dispatches`: src/routing/explain.mjs `dispatchedBy`), because such an agent
// is never a line of its own: it is reached through its parent's step.
//
// A RouteDecision v3 (0.5.0, B22) says how much Orbit the request needs. NONE --
// and a DIRECT the strategy did not say (`strategy.shown`) -- adds NOTHING at all;
// anything else opens with ONE line: the word, why, and the one way in (the skill
// or agent to invoke, or for COORDINATED, RESUME and SATELLITE the one command,
// `<engine>` read as `opts.engine`). The lines a v2 decision had follow, unchanged.
import { labelOf } from "../resources/model.mjs";

export const BUDGET_BYTES = 2048;
const LINE_LIMIT = 240;

const HEAD = "Orbit routing context";
const FOOT = "Use these only if they help with the request. The router ran nothing and installed nothing.";

// [list, title, whether a parent there names the agents it dispatches]
const SECTIONS = [
  ["selected", "Relevant and available here:", true],
  ["approval", "Relevant, but a person must approve it in Orbit Control first:", true],
  ["blocked", "Relevant, but Orbit policy blocks it:", false],
  ["missing", "Relevant, but not usable here:", false],
];

export function formatDecision(decision, opts = {}) {
  if (decision?.strategy && !decision.strategy.shown) return null;
  const shown = Object.fromEntries(SECTIONS.map(([name]) => [name, (decision?.[name] ?? []).filter((e) => !e.implicit)]));
  const lines = [...strategyLine(decision, opts.engine), ...listed(decision, shown, opts)];
  return lines.length ? fitted(lines, FOOT) : null;
}

function listed(decision, shown, opts) {
  if (!SECTIONS.some(([name]) => shown[name].length)) return [];
  const body = SECTIONS.flatMap(([name, title, parents]) => section(title, shown[name], parents ? opts.dispatches : null));
  return [HEAD, `Intent: ${decision.intent.id} (${decision.intent.confidence} confidence)`, "", ...body, ...howToCall(shown, opts.callVia)];
}

const strategyLine = (d, engine) => (d?.strategy ? [`Orbit strategy: ${d.strategy.word} -- ${d.strategy.because}${d.activation?.invoke ? `: ${engined(d.activation.invoke, engine)}` : ""}.`] : []);

const engined = (text, engine) => (engine ? text.replaceAll("<engine>", engine) : text);

const section = (title, entries, dispatches) => (entries.length ? [title, ...entries.map((e) => line(e, dispatches)), ""] : []);

const line = (e, dispatches) => clip(`- ${e.id} (${labelOf(e.kind)}${e.key?.startsWith("managed:") ? ", Orbit-managed" : ""}${agentsOf(e, dispatches)})${e.summary ? `: ${e.summary}` : ""} -- ${e.reason}`);

const agentsOf = (e, dispatches) => (e.kind === "skill" && dispatches?.[e.id]?.length ? `, dispatches ${dispatches[e.id].join(", ")}` : "");

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
