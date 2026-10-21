// Asking a provider on behalf of a need -- through the doors that already exist, and no other.
//
// A managed server is reached only through the MCP broker (src/mcp/invoke.mjs): the same
// gates in the same order, so a disabled server, a policy that denies, an approval nobody
// gave and a runtime that is not there stop this exactly as they stop everything else. A
// project's own capability is reached only through the capability pipeline
// (src/capability/invoke.mjs), with no page and no case, so one that changes things is
// refused. There is no third route, and a need never holds a provider: it holds a capability,
// and the binding says who serves it today.
//
// What is kept of a call is a RECEIPT: the need, the provider, the tool, a digest of what
// was asked, a digest of what came back, the places it said it came from, and how it ended.
// Never the query and never the answer. The answer is printed for the host that asked, scrubbed
// and bounded, and is not kept anywhere. A refusal or a block is a receipt too -- it records
// that a call was attempted and how it ended -- and then the same typed stop is thrown, so the
// exit code says what it always says.
//
// The journal lock is never held across the call itself, only around writing the receipt.
import { invokeCapability } from "../capability/invoke.mjs";
import { Blocked, Refused } from "../errors.mjs";
import { sha } from "../hash.mjs";
import { parseKey } from "../mcp/identity.mjs";
import { invokeMcp, listManagedTools } from "../mcp/invoke.mjs";
import { canonical } from "../network/fingerprint.mjs";
import { quote } from "../quote.mjs";
import { scrub } from "../scrub.mjs";
import { WORKFLOW, resourceOf, revalidate } from "./bind.mjs";
import { numbered } from "./model.mjs";
import { refsIn } from "./refs.mjs";
import { load } from "./resume.mjs";

export const PRINT_LIMIT = 64 * 1024;

// What has to be true before anything is asked, in the order a person would check it.
const PRECONDITIONS = [
  { ask: (t) => (t.need ? null : `there is no need ${t.ref} in this work`) },
  { ask: (t) => (t.need.capability ? null : `${t.need.id} names no capability, so there is nothing to ask for on its behalf`) },
  { ask: (t) => (t.binding ? null : `${t.need.id} has not been resolved yet — run work resolve first`) },
  { ask: (t) => (t.binding.provider && t.binding.status === "provided" ? null : `nothing serves ${t.need.capability} yet: ${t.binding.why ?? t.binding.status}`) },
  { ask: (t, w) => (revalidate(t.binding, w.effective()) === "current" ? null : `${t.binding.provider.key} is no longer what ${t.need.id} was bound to — run work resolve again`) },
];

function firstProblem(t, w) {
  for (const row of PRECONDITIONS) {
    const problem = row.ask(t, w);
    if (problem) return problem;
  }
  return null;
}

function targetOf(w, model, ref) {
  const need = model.needs.get(ref) ?? null;
  const target = { ref, need, binding: need ? model.bindings.get(need.id) ?? null : null };
  const problem = firstProblem(target, w);
  if (problem) throw new Refused(problem);
  return target;
}

// A bound key names an owner, and only a server Orbit manages may be called. The broker looks
// a server up by its id among the managed ones, so a key naming another owner must never be
// let through to it: a host's `docs` and a managed `docs` are two resources.
function managedId(key) {
  const parsed = parseKey(key);
  if (parsed?.ownership !== "orbit-managed") throw new Refused(`${key} is not a server Orbit manages — Orbit observes a host's servers and never calls them`);
  return parsed.id;
}

const asked = async (call) => {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    return { ok: false, error };
  }
};

const failedAnswer = (value) => value?.result?.isError === true;

// How a call ended: the first row that holds, the last always does.
const OUTCOMES = [
  { name: "refused", when: (a) => !a.ok && a.error instanceof Refused },
  { name: "blocked", when: (a) => !a.ok && a.error instanceof Blocked },
  { name: "error", when: (a) => !a.ok || failedAnswer(a.value) },
  { name: "ok", when: () => true },
];

const outcomeOf = (answer) => OUTCOMES.find((o) => o.when(answer)).name;

const whyOf = (answer) => (answer.ok ? (failedAnswer(answer.value) ? "the tool reported an error" : null) : quote(scrub(answer.error?.message ?? answer.error), 200));

// Who asked, as far as an independent session is concerned: the machine and, when the host
// gave one, its session. A claim resting on the receipt counts as that session's, never the
// one that happens to project it later.
const seenBy = (w) => ({ host: w.works?.host ?? w.host ?? null, ...(w.session ? { session: w.session } : {}) });

function receiptOf(w, t, how, answer) {
  const kept = answer.ok ? { resultDigest: sha(canonical(answer.value)), sourceRefs: refsIn(answer.value) } : { resultDigest: null, sourceRefs: [] };
  return { ...(t.need ? { need: t.need.id } : {}), capability: t.capability ?? t.need.capability, provider: t.binding.provider.key, tool: how.tool, queryDigest: sha(canonical(how.input ?? {})), ...kept, outcome: outcomeOf(answer), why: whyOf(answer), seen: seenBy(w) };
}

function record(w, id, t, how, answer) {
  return w.works.transact(id, () => {
    const [row] = numbered(load(w, id), "receipt", [receiptOf(w, t, how, answer)]);
    return w.works.append(id, "receipt", row);
  });
}

// What the host that asked is shown: scrubbed, and cut where it is too long, saying so.
export function printable(value) {
  const text = scrub(JSON.stringify(value ?? null));
  return text.length > PRINT_LIMIT ? { text: text.slice(0, PRINT_LIMIT), truncated: true } : { text, truncated: false };
}

async function attempted(w, id, t, door) {
  const answer = await asked(door.call);
  const receipt = record(w, id, t, door.how, answer);
  if (!answer.ok) throw answer.error;
  return { receipt, result: printable(answer.value) };
}

// ---- each door: what is asked, and the call that asks it -------------------------------------------------

// A managed server is asked only through the broker. `readOnly` NARROWS what the broker lets through (0.0.4: a
// declared workflow reads, and a tool its server calls a write is refused before it is sent) -- it never widens it.
function mcpDoor(w, t, ask) {
  const server = managedId(t.binding.provider.key);
  const how = { tool: ask.tool, input: ask.input ?? {} };
  return { how, call: () => invokeMcp(w.mcp, { id: server, tool: ask.tool, args: how.input, capability: t.capability ?? t.need.capability, workflow: ask.workflow ?? WORKFLOW, ...(ask.readOnly ? { readOnly: true } : {}) }) };
}

const NO_CASE = { c: { id: "work" }, page: false, values: {} };

const detailOf = (w, provider) => resourceOf(w.effective(), provider)?.detail ?? {};

// A capability that names a connection is asked in a context that holds that one credential for
// the moment of the call; the composition root builds it, and a function is how it is asked for.
const contextFor = (context, connection) => (typeof context === "function" ? context(connection) : context);

// A project's capability is asked only through the capability pipeline, with no page and no case: one that changes
// things is refused there, so whatever it answers was a read.
function capabilityDoor(w, t, ask) {
  const how = { tool: t.binding.provider.id, input: ask.input ?? {} };
  const connection = detailOf(w, t.binding.provider).connection ?? null;
  return { how, call: async () => invokeCapability(await contextFor(w.capabilityContext, connection), NO_CASE, { capability: how.tool, input: how.input }) };
}

async function viaMcp(w, id, t, ask) {
  if (!ask.tool) return { listed: await listManagedTools(w.mcp, managedId(t.binding.provider.key)) };
  return attempted(w, id, t, mcpDoor(w, t, ask));
}

const viaCapability = (w, id, t, ask) => attempted(w, id, t, capabilityDoor(w, t, ask));

function engineOwned(w, id, t) {
  const run = detailOf(w, t.binding.provider).run;
  throw new Refused(`${t.binding.provider.id} is part of Orbit itself${run ? ` — run it as: ${run}` : ""}; work invoke calls a managed server or a project's own capability`);
}

const followed = (w, id, t) => {
  throw new Refused(`${t.binding.provider.kind} ${t.binding.provider.id} is followed, not invoked — hand the need to it`);
};

// Which door a provider is behind, by what it is. First row that holds; the last always does. `run` is a work's
// need asked through it; `door` is the same door for a bound provider the caller keeps its own receipt of.
export const INVOKERS = [
  { name: "mcp", when: (p) => p.kind === "mcp", run: viaMcp, door: mcpDoor },
  { name: "project", when: (p) => p.kind === "capability" && p.ownership === "project", run: viaCapability, door: capabilityDoor },
  { name: "engine", when: (p) => p.kind === "capability", run: engineOwned, door: (w, t) => engineOwned(w, null, t) },
  { name: "followed", when: () => true, run: followed, door: (w, t) => followed(w, null, t) },
];

// w: { works, effective(), mcp (the broker's context), capabilityContext, now() }
// ask: { tool?, input?, workflow? } -- a managed server needs a tool; without one its tools are listed.
export async function invokeNeed(w, id, ref, ask = {}) {
  const target = targetOf(w, load(w, id), ref);
  const row = INVOKERS.find((r) => r.when(target.binding.provider));
  return row.run(w, id, target, ask);
}

// ---- a provider the caller already bound (0.0.4) -----------------------------------------------------------
//
// The coordinator's skill runner (src/automation/skill-run.mjs) asks the provider the resolver picked for a workflow
// step a moment ago, through the SAME door a work's need is asked through -- the same gates in the same order, the
// same scrubbing -- and keeps the receipt in its own task's journal, so nothing here writes. A binding that moved
// since it was picked is refused, never asked. What the answer said is handed back scrubbed value by value and
// bounded, for the step's declared outputs to be read off; it is never kept here.
//
//   w        { effective(), mcp, capabilityContext, host?, session? }
//   binding  { provider: { kind, id, key, ownership }, fingerprint }
//   ask      { capability, tool?, input?, workflow?, readOnly? }
//   ->       { receipt, answer, operation, error }   a typed stop is the receipt's outcome, never thrown

function boundDoor(w, t, ask) {
  if (revalidate(t.binding, w.effective()) !== "current") throw new Refused(`${t.binding.provider.key} is no longer what was picked for ${t.capability} — it is resolved again before anything is asked`);
  if (t.binding.provider.kind === "mcp" && !ask.tool) throw new Refused(`${t.binding.provider.id} is a managed server — name the tool to call`);
  return INVOKERS.find((r) => r.when(t.binding.provider)).door(w, t, ask);
}

function opened(w, t, ask) {
  try { return { ok: true, ...boundDoor(w, t, ask) }; }
  catch (error) { return { ok: false, error }; }
}

export async function invokeBound(w, binding, ask) {
  const t = { capability: ask.capability, binding };
  const door = opened(w, t, ask);
  const answer = door.ok ? await asked(door.call) : { ok: false, error: door.error };
  return { receipt: receiptOf(w, t, door.how ?? { tool: ask.tool ?? binding.provider?.id, input: ask.input ?? {} }, answer), answer: answer.ok ? cleaned(answerOf(binding.provider, answer.value), { n: MAX_ANSWER_NODES }, 0) : null, operation: answer.ok ? operationOf(binding.provider, answer.value) : null, error: answer.ok ? null : answer.error };
}

// What a call DID, as the door that made it says: a managed server's tool is what its server calls it, and a
// project's capability asked with no case is a read (the pipeline refuses one that changes things).
const operationOf = (provider, value) => (provider.kind === "mcp" ? (value?.operation === "read" ? "read" : "write") : "read");

// What an answer SAYS, for a declared output to be read off: a server's structured content, or the JSON its first text
// item holds, or the result itself; a capability's own return value.
const textJson = (content) => ((t) => (typeof t === "string" && t.length <= PRINT_LIMIT && /^\s*[[{]/.test(t) ? jsonOf(t) : undefined))(Array.isArray(content) ? content.find((c) => c?.type === "text")?.text : undefined);

const jsonOf = (text) => {
  try { return JSON.parse(text); }
  catch { return undefined; }
};

const answerOf = (provider, value) => (provider.kind === "mcp" ? value?.result?.structuredContent ?? textJson(value?.result?.content) ?? value?.result ?? null : value);

export const MAX_ANSWER_NODES = 2000;
const MAX_ANSWER_DEPTH = 8;

// The answer value by value: every string and every key scrubbed by shape, each list and object cut at 256 entries,
// and nothing past MAX_ANSWER_NODES nodes or MAX_ANSWER_DEPTH deep -- an answer built to be enormous costs a bounded walk.
const CLEAN = [
  { when: (v) => typeof v === "string", as: (v) => scrub(v).slice(0, 4096) },
  { when: (v) => typeof v === "number" || typeof v === "boolean" || v === null, as: (v) => v },
  { when: (v) => Array.isArray(v), as: (v, b, d) => v.slice(0, 256).map((x) => cleaned(x, b, d + 1)) },
  { when: (v) => typeof v === "object", as: (v, b, d) => Object.fromEntries(Object.entries(v).slice(0, 256).map(([k, x]) => [scrub(k), cleaned(x, b, d + 1)])) },
  { when: () => true, as: () => undefined },
];

function cleaned(value, budget, depth) {
  budget.n -= 1;
  if (budget.n < 0 || depth > MAX_ANSWER_DEPTH) return undefined;
  return CLEAN.find((r) => r.when(value)).as(value, budget, depth);
}
