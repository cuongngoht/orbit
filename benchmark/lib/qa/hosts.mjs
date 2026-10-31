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
//   HOSTS[name](h) -> Promise<{ tested: [{ shape, version | outcome }] }>     replayed(h, designs) -> Promise<tested>
//   h = { ask(argv, stdin) -> Promise<{ exit, stdout, stderr }>, journal() -> lines, designs, stack, clock, falseAlarm }
import { randomBytes } from "node:crypto";

const parsed = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

const contextOf = async (h) => parsed((await h.ask(["context"])).stdout) ?? {};

const owedFor = (context, shape, obligation) => ((frontier) => frontier.find((o) => o.template?.obligation === obligation) ?? frontier.find((o) => o.template?.shape === shape))((context.frontier ?? []).filter((o) => o.kind === "test-obligation"));

const decision = (context, target, action) => ({ schemaVersion: 1, decisionId: `bench-${action.kind}-${randomBytes(6).toString("hex")}`, expectedRevision: context.position, target, action, hypothesis: "a generated test settles this obligation", reason: "it is owed on the frontier" });

const stepped = async (h, target, action) => h.ask(["step"], JSON.stringify(decision(await contextOf(h), target, action)));

// The version a design froze for an obligation, as the journal says: the latest design that held, and its version.
function versionOf(lines, obligation) {
  const designed = lines.filter((l) => l.kind === "designed" && l.obligation === obligation && l.state === "designed").at(-1);
  return designed ? (lines.filter((l) => l.kind === "version" && l.design === designed.design).at(-1)?.version ?? null) : null;
}

async function ranVersion(h, owed, shape) {
  const version = versionOf(h.journal(), owed.template.obligation);
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

const readsNothing = (design) => ({ ...design, skeleton: { ...design.skeleton, steps: design.skeleton.steps.map((s) => (s.capability === "orbit.state.read" ? { ...s, input: { ...s.input, request: { ...s.input.request, key: NEVER } } } : s)) } });

const brokenFor = (h, d) => (d.shape === h.falseAlarm ? (ob) => readsNothing(madeFor(h, d)(ob)) : madeFor(h, d));

async function testedAll(h, designerOf) {
  const out = [];
  for (const d of h.designs) out.push(await tested(h, d.shape, null, designerOf(h, d)));
  return out;
}

const finished = async (h, why, tested) => (await h.ask(["finish", `--why=${why}`]), { tested });

export const HOSTS = {
  reference: async (h) => finished(h, "the reference host tested every shape it has a design for", await testedAll(h, madeFor)),
  idle: async (h) => finished(h, "the idle host tests nothing", []),
  "false-alarm": async (h) => finished(h, "the false-alarm host tested every shape, one of them wrongly", await testedAll(h, brokenFor)),
};

// The designs that contradicted the planted application, run again on the clean one -- each for the obligation of the
// same shape the clean investigation owes.
export async function replayed(h, designs) {
  const out = [];
  for (const d of designs) out.push(await tested(h, d.shape, d.obligation, (ob) => (d.design && Object.hasOwn(d.design, "obligation") ? { ...d.design, obligation: ob } : d.design)));
  return finished(h, "the confirmation replayed every contradiction on the clean application", out);
}
