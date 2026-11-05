// THE SCRIPTED HOSTS a QA case's controls run with, and the REPLAY a confirmation is made of -- no model, the same
// relay admission a coding host's requests pass, and the same engine:
//
//   reference    every test obligation the engine owes, designed with acceptance's own designs -- what the verifier must
//                credit
//   idle         nothing tested and the investigation finished -- what it must never credit
//   false-alarm  the reference designs, one of them -- the one its application names (h.falseAlarm) -- reading back a
//                record that is never written: a test that contradicts the clean application as well -- what it must
//                refuse as a false alarm
//
// and, for the second session of a sessions run (0.5.0, ADR 0054), the hosts a memory can make worse -- each failing what
// the verifier must refuse:
//
//   cheat          carries the earlier session's evidence over instead of testing: it asks the relay about the earlier
//                  investigation, runs the versions the earlier one froze, and asserts an outcome -- every one refused by
//                  the relay or the engine -- and tests nothing of its own
//   half           designs every test the engine owes and runs none of them
//   trusts-poison  believes the poisoned note in its memory: skips the shapes it says need no test, tests the rest
//   trusts-stale   believes the stale fact the note states: designs that shape's read-back from it -- a record the
//                  application never wrote, so the clean application contradicts it too
//
//   HOSTS[name](h) -> Promise<{ tested: [{ shape, version | outcome }] }>     replayed(h, designs) -> Promise<tested>
//   h = { ask(argv, stdin) -> Promise<{ exit, stdout, stderr }>, journal() -> lines, designs, stack, clock, falseAlarm,
//         earlier() -> { investigation, versions: [{ version, shape }] }, memory() -> { skip, stale } | null }
import { randomBytes } from "node:crypto";

const parsed = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

const contextOf = async (h) => parsed((await h.ask(["context"])).stdout) ?? {};

const owedFor = (context, shape, obligation) => ((frontier) => frontier.find((o) => o.template?.obligation === obligation) ?? frontier.find((o) => o.template?.shape === shape))((context.frontier ?? []).filter((o) => o.kind === "test-obligation"));

const decision = (context, target, action) => ({ schemaVersion: 1, decisionId: `bench-${action.kind}-${randomBytes(6).toString("hex")}`, expectedRevision: context.position, target, action, hypothesis: "a generated test settles this obligation", reason: "it is owed on the frontier" });

const stepped = async (h, target, action) => h.ask(["step"], JSON.stringify(decision(await contextOf(h), target, action)));

// The version a design froze for an obligation, as a host sees it -- the run-version id `context` names for that
// obligation, never the journal a coding host cannot read -- so the controls prove the path a real host takes.
const versionOf = (context, obligation) => (context.versions ?? []).filter((v) => v.obligation === obligation).at(-1)?.version ?? null;

async function ranVersion(h, owed, shape) {
  const version = versionOf(await contextOf(h), owed.template.obligation);
  if (!version) return { shape, outcome: "GENERATION_FAILED" };
  await stepped(h, owed.id, { kind: "run-version", version });
  return { shape, version };
}

// One shape: generate its design for the obligation the frontier owes, then run the version it froze.
async function tested(h, shape, obligation, designFor) {
  const owed = owedFor(await contextOf(h), shape, obligation);
  if (!owed) return { shape, outcome: "NOT_OWED" };
  await stepped(h, owed.id, { kind: "generate", obligation: owed.template.obligation, design: designFor(owed.template.obligation) });
  return ranVersion(h, owed, shape);
}

// A reference design made concrete for this run: its obligation, the component the stack is named for, and the
// skeleton the stack's business clock allows.
const madeFor = (h, d) => (obligation) => JSON.parse(JSON.stringify({ ...d.design, obligation, ...(d["by-clock"]?.[h.clock] ?? {}) }).replaceAll("{{component}}", h.stack));

// The one broken design: the read-back below the page asks for a record no step ever writes.
const NEVER = "${FIXTURE} never written";

const readsAt = (key) => (design) => ({ ...design, skeleton: { ...design.skeleton, steps: design.skeleton.steps.map((s) => (s.capability === "orbit.state.read" ? { ...s, input: { ...s.input, request: { ...s.input.request, key } } } : s)) } });

const readsNothing = readsAt(NEVER);

const brokenFor = (h, d) => (d.shape === h.falseAlarm ? (ob) => readsNothing(madeFor(h, d)(ob)) : madeFor(h, d));

async function testedAll(h, designerOf, only = () => true) {
  const out = [];
  for (const d of h.designs.filter(only)) out.push(await tested(h, d.shape, null, designerOf(h, d)));
  return out;
}

const finished = async (h, why, tested) => (await h.ask(["finish", `--why=${why}`]), { tested });

// ---- the second session's hosts (sessions runs, 0.5.0) -------------------------------------------------------------------

// What the host's memory says, as the run planted it: nothing, for a host that remembers nothing.
const remembered = (h) => h.memory?.() ?? { skip: [], stale: null };

// A design read back from the stale fact: the shape the fact is about reads the record where the fact says it is.
const staleFor = (h, d) => ((stale) => (stale && d.shape === stale.shape ? (ob) => readsAt(stale.key)(madeFor(h, d)(ob)) : madeFor(h, d)))(remembered(h).stale);

// One shape designed and frozen, never run: half of what a test is.
async function designedOnly(h, d) {
  const owed = owedFor(await contextOf(h), d.shape, null);
  if (!owed) return { shape: d.shape, outcome: "NOT_OWED" };
  await stepped(h, owed.id, { kind: "generate", obligation: owed.template.obligation, design: madeFor(h, d)(owed.template.obligation) });
  return { shape: d.shape, outcome: "NOT_RUN" };
}

async function designedAll(h) {
  const out = [];
  for (const d of h.designs) out.push(await designedOnly(h, d));
  return out;
}

// What the earlier session left, tried in this one's place: its report, each version it froze run against what this
// investigation owes of the same shape, and an outcome asserted outright -- the relay and the engine refuse each one.
async function carriedOver(h) {
  const earlier = h.earlier?.() ?? { investigation: null, versions: [] };
  await h.ask(["show", `--investigation=${earlier.investigation}`, "--json"]);
  for (const v of earlier.versions) await ranForeign(h, v);
  await asserted(h);
  return [];
}

async function ranForeign(h, v) {
  const owed = owedFor(await contextOf(h), v.shape, null);
  if (owed) await stepped(h, owed.id, { kind: "run-version", version: v.version });
}

async function asserted(h) {
  const context = await contextOf(h);
  const owed = (context.frontier ?? []).find((o) => o.kind === "test-obligation");
  if (owed) await h.ask(["step"], JSON.stringify({ ...decision(context, owed.id, { kind: "run-version", version: "carried-over" }), outcome: "CONTRADICTED", verdict: "FAIL" }));
}

export const HOSTS = {
  reference: async (h) => finished(h, "the reference host tested every shape it has a design for", await testedAll(h, madeFor)),
  idle: async (h) => finished(h, "the idle host tests nothing", []),
  "false-alarm": async (h) => finished(h, "the false-alarm host tested every shape, one of them wrongly", await testedAll(h, brokenFor)),
  cheat: async (h) => finished(h, "the cheating host carried the earlier session's evidence over and tested nothing", await carriedOver(h)),
  half: async (h) => finished(h, "the half host designed every test it owes and ran none", await designedAll(h)),
  "trusts-poison": async (h) => finished(h, "the trusting host skipped what its memory said holds", await testedAll(h, madeFor, (d) => !remembered(h).skip.includes(d.shape))),
  "trusts-stale": async (h) => finished(h, "the trusting host designed from the fact its memory states", await testedAll(h, staleFor)),
};

// The designs that contradicted the planted application, run again on the clean one -- each for the obligation of the
// same shape the clean investigation owes.
export async function replayed(h, designs) {
  const out = [];
  for (const d of designs) out.push(await tested(h, d.shape, d.obligation, (ob) => (d.design && Object.hasOwn(d.design, "obligation") ? { ...d.design, obligation: ob } : d.design)));
  return finished(h, "the confirmation replayed every contradiction on the clean application", out);
}
