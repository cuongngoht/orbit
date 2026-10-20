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
const seenBy = (w) => ({ host: w.works.host, ...(w.session ? { session: w.session } : {}) });

function receiptOf(w, t, how, answer) {
  const kept = answer.ok ? { resultDigest: sha(canonical(answer.value)), sourceRefs: refsIn(answer.value) } : { resultDigest: null, sourceRefs: [] };
  return { need: t.need.id, capability: t.need.capability, provider: t.binding.provider.key, tool: how.tool, queryDigest: sha(canonical(how.input ?? {})), ...kept, outcome: outcomeOf(answer), why: whyOf(answer), seen: seenBy(w) };
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

async function attempted(w, id, t, how, call) {
  const answer = await asked(call);
  const receipt = record(w, id, t, how, answer);
  if (!answer.ok) throw answer.error;
  return { receipt, result: printable(answer.value) };
}

async function viaMcp(w, id, t, ask) {
  const server = managedId(t.binding.provider.key);
  if (!ask.tool) return { listed: await listManagedTools(w.mcp, server) };
  const how = { tool: ask.tool, input: ask.input ?? {} };
  return attempted(w, id, t, how, () => invokeMcp(w.mcp, { id: server, tool: ask.tool, args: how.input, capability: t.need.capability, workflow: ask.workflow ?? WORKFLOW }));
}

const NO_CASE = { c: { id: "work" }, page: false, values: {} };

const detailOf = (w, provider) => resourceOf(w.effective(), provider)?.detail ?? {};

// A capability that names a connection is asked in a context that holds that one credential for
// the moment of the call; the composition root builds it, and a function is how it is asked for.
const contextFor = (context, connection) => (typeof context === "function" ? context(connection) : context);

function viaCapability(w, id, t, ask) {
  const how = { tool: t.binding.provider.id, input: ask.input ?? {} };
  const connection = detailOf(w, t.binding.provider).connection ?? null;
  return attempted(w, id, t, how, async () => invokeCapability(await contextFor(w.capabilityContext, connection), NO_CASE, { capability: how.tool, input: how.input }));
}

function engineOwned(w, id, t) {
  const run = detailOf(w, t.binding.provider).run;
  throw new Refused(`${t.binding.provider.id} is part of Orbit itself${run ? ` — run it as: ${run}` : ""}; work invoke calls a managed server or a project's own capability`);
}

const followed = (w, id, t) => {
  throw new Refused(`${t.binding.provider.kind} ${t.binding.provider.id} is followed, not invoked — hand the need to it`);
};

// Which door a provider is behind, by what it is. First row that holds; the last always does.
export const INVOKERS = [
  { name: "mcp", when: (p) => p.kind === "mcp", run: viaMcp },
  { name: "project", when: (p) => p.kind === "capability" && p.ownership === "project", run: viaCapability },
  { name: "engine", when: (p) => p.kind === "capability", run: engineOwned },
  { name: "followed", when: () => true, run: followed },
];

// w: { works, effective(), mcp (the broker's context), capabilityContext, now() }
// ask: { tool?, input?, workflow? } -- a managed server needs a tool; without one its tools are listed.
export async function invokeNeed(w, id, ref, ask = {}) {
  const target = targetOf(w, load(w, id), ref);
  const row = INVOKERS.find((r) => r.when(target.binding.provider));
  return row.run(w, id, target, ask);
}
