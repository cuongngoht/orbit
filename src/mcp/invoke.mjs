// Every call to a Orbit-managed MCP server goes through here, and there is no
// second route -- the promise src/capability/invoke.mjs makes for a project's
// capabilities, kept the same way. A skill never reaches the broker itself: it
// asks `cli/mcp.mjs call`, which asks this.
//
// The gates are an ordered TABLE, and a new concern is a row. Each earns its
// own typed stop, and the difference matters: a request that is wrong, or that
// policy forbids, is REFUSED -- the obvious fix is the caller's; a machine that
// cannot answer (a runtime that is not installed, a secret that is not set, a
// server that is down) is BLOCKED -- nobody asked for anything wrong.
//
//   resource    a server Orbit manages -- never an external one, whatever its name
//   enabled     somebody wants it used at all
//   input       a tool name and an arguments object, within size
//   capability  what the call is FOR is something it provides
//   policy      allow · approval · deny for that capability and workflow
//   approval    what needs approval has an unexpired one from Orbit Control
//   runtime     its runtime is here and every secret it names is set
//
// Only then is it connected to, with a deadline; the tool it names must be one
// the server lists, and what the server says that tool IS (read-only or not)
// is held against the policy's operation rules before tools/call. One activity
// line records what happened -- never the arguments, never the result.
import { Blocked, Refused } from "../errors.mjs";
import { capabilityVerdict, operationOf, operationVerdict, strictest, undeclaredVerdict } from "../policy.mjs";
import { resolvedDefinition } from "./connect.mjs";
import { parseKey } from "./identity.mjs";
import { specOf } from "./probe.mjs";
import { openSession } from "./runtime/session.mjs";

export const ARGS_LIMIT = 256 * 1024;
export const RESULT_LIMIT = 1024 * 1024;
const TOOL = /^[A-Za-z0-9_][A-Za-z0-9_.:/-]{0,127}$/;

const GATES = [
  { name: "resource", ask: (c) => (c.entry ? null : refused(`no Orbit-managed MCP server named ${c.ask.id}${c.external ? ` -- ${c.ask.id} is only configured in the host, which Orbit observes and never calls` : ""}`)) },
  { name: "enabled", ask: (c) => (c.entry.enabled ? null : refused(`${c.entry.id} is disabled in Orbit`)) },
  { name: "input", ask: (c) => inputProblem(c.ask) },
  { name: "capability", ask: (c) => (!c.ask.capability || c.entry.provides.includes(c.ask.capability) ? null : refused(`${c.entry.id} does not provide ${c.ask.capability} (it provides ${c.entry.provides.join(", ") || "nothing declared"})`)) },
  { name: "policy", ask: (c) => (verdictOf(c) === "deny" ? refused(`policy denies ${c.entry.id} ${c.ask.capability ? `for ${c.ask.capability}` : "here"}${c.ask.workflow ? ` in ${c.ask.workflow}` : ""}`) : null) },
  { name: "approval", ask: (c) => approvalProblem(c, verdictOf(c)) },
  { name: "runtime", ask: (c) => (c.entry.runtimeReady ? null : blocked(`${c.entry.id} cannot run here: ${c.entry.why ?? c.entry.state}`)) },
];

// ctx: { entries (src/mcp/effective.mjs), records (managed.json servers),
//        connect: { secrets, rooms, receipts, catalog, exists, platform, arch, node },
//        session: { fetch, start, env, timeoutMs }, activity, now }
// ask: { id, tool, args, capability?, workflow? }
export async function invokeMcp(ctx, ask) {
  const c = gated(ctx, ask);
  const started = ctx.now();
  try { return await called(ctx, c, started); }
  catch (e) { throw failed(ctx, c, e, started); }
}

// Listing a server's tools starts or reaches it too, so it passes the same
// gates a call does -- all but the two about one particular request.
const LISTING = GATES.filter((g) => !["input", "capability"].includes(g.name));

export async function listManagedTools(ctx, id) {
  const c = gated(ctx, { id }, LISTING);
  const session = await openSession(specOf(resolvedDefinition(ctx.records[c.entry.id], ctx.connect)), ctx.session);
  try { return (await session.tools()).map(toolView); }
  finally { session.close(); }
}

const toolView = (t) => ({ name: String(t.name).slice(0, 128), description: String(t.description ?? "").split("\n")[0].slice(0, 300), operation: operationOf(t), inputSchema: t.inputSchema ?? null });

function gated(ctx, ask, gates = GATES) {
  const c = { ask, entry: ctx.entries.find((e) => e.key === `managed:${ask.id}`), external: ctx.entries.some((e) => parseKey(e.key)?.ownership === "external" && e.id === ask.id) };
  const stop = gates.map((g) => ({ gate: g.name, problem: c.entry || g.name === "resource" ? g.ask(c) : null })).find((x) => x.problem);
  if (stop) throw record(ctx, c, "mcp-blocked", stop.problem, { outcome: stop.gate });
  return c;
}

async function called(ctx, c, started) {
  const session = await openSession(specOf(resolvedDefinition(ctx.records[c.entry.id], ctx.connect)), ctx.session);
  ctx.activity.record({ kind: "mcp-started", resource: c.entry.key, ms: ctx.now() - started });
  try { return await answered(ctx, c, session, started); }
  finally { session.close(); }
}

async function answered(ctx, c, session, started) {
  const tool = (await session.tools()).find((t) => t.name === c.ask.tool);
  if (!tool) throw refused(`${c.entry.id} offers no tool named ${c.ask.tool}`);
  operationGate(c, tool);
  const result = bounded(await session.call(c.ask.tool, c.ask.args ?? {}));
  return (ctx.activity.record({ kind: "mcp-invoked", resource: c.entry.key, tool: c.ask.tool, capability: c.ask.capability, workflow: c.ask.workflow, operation: operationOf(tool), outcome: result.isError ? "tool-error" : "ok", ms: ctx.now() - started }), { resource: c.entry.key, tool: c.ask.tool, operation: operationOf(tool), result });
}

function operationGate(c, tool) {
  const verdict = strictest([verdictOf(c), operationVerdict(c.entry.policy, operationOf(tool))]);
  if (verdict === "deny") throw refused(`policy denies a ${operationOf(tool)} tool (${tool.name}) on ${c.entry.id}`);
  const problem = approvalProblem(c, verdict);
  if (problem) throw problem;
}

const verdictOf = (c) => strictest([c.ask.capability ? capabilityVerdict(c.entry.policy, c.ask.capability, c.ask.workflow ?? null) : undeclaredVerdict(c.entry.policy, c.entry.provides, c.ask.workflow ?? null), c.entry.selection === "approval" ? "approval" : "allow"]);

// An approval is a person's, given in Orbit Control behind its token, for a
// while -- never something a caller can claim for itself.
const approvalProblem = (c, verdict) => (verdict !== "approval" || c.entry.approval ? null : refused(`${c.entry.id} needs a person's approval first: approve it in Orbit Control (MCP -> ${c.entry.name} -> Approve), then ask again`));

function inputProblem(ask) {
  if (!TOOL.test(String(ask.tool ?? ""))) return refused("name the tool to call: letters, digits and _ . : / -");
  if (ask.args !== undefined && (ask.args === null || typeof ask.args !== "object" || Array.isArray(ask.args))) return refused("the tool's arguments are one JSON object");
  return JSON.stringify(ask.args ?? {}).length > ARGS_LIMIT ? refused(`the tool's arguments are larger than ${ARGS_LIMIT} bytes`) : null;
}

// A result a caller can hold: past RESULT_LIMIT it is cut, and says so.
function bounded(result) {
  const text = JSON.stringify(result ?? {});
  return text.length <= RESULT_LIMIT ? result : { content: [{ type: "text", text: text.slice(0, RESULT_LIMIT) }], truncated: true, isError: result?.isError === true };
}

// A refusal met after connecting (no such tool, an operation policy forbids,
// the server refusing the call) is still the request's; anything else is the
// machine's, and says so.
function failed(ctx, c, e, started) {
  const typed = e instanceof Refused || e instanceof Blocked ? e : e?.kind === "rpc-error" && e.method === "tools/call" ? new Refused(e.message) : new Blocked(`${c.entry.id} could not be asked -- ${e?.message ?? e}`);
  const refusal = typed instanceof Refused;
  ctx.activity.record({ kind: refusal ? "mcp-blocked" : "mcp-failed", resource: c.entry.key, tool: c.ask.tool, capability: c.ask.capability, outcome: refusal ? "refused" : "blocked", reason: typed.message.slice(0, 200), ms: ctx.now() - started });
  return typed;
}

function record(ctx, c, kind, error, extra) {
  ctx.activity.record({ kind, resource: c.entry?.key ?? `managed:${c.ask.id}`, tool: c.ask.tool, capability: c.ask.capability, workflow: c.ask.workflow, reason: error.message.slice(0, 200), ...extra });
  return error;
}

const refused = (message) => new Refused(message);
const blocked = (message) => new Blocked(message);
