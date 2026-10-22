// The GENERATE action (doc §4.1 steps 3-4; PBI 11): one design proposal for one obligation the
// journal holds, judged whole by the generator (src/qa/generation/design.mjs) with the ports the
// composition root bound (`w.generation`: the accepted expectations, the step outputs and
// semantics, the real validator), and kept as the lifecycle the journal folds:
//
//   designed   failed -- with the word and the stage that stopped it -- or designed
//   version    the draft saved into the machine store and FROZEN (src/qa/generation/version.mjs)
//   validated  by the validator that held it
//
// Each record is written once, by an eventId made from what it was made of (store.mjs eventIdOf),
// so the same proposal sent twice is the same design. It runs nothing, and a generated test stays
// a draft until a person promotes it.
import { caseDigest } from "../dsl/digest.mjs";
import { Refused } from "../errors.mjs";
import { canonicalJson, sha } from "../hash.mjs";
import { generatedCase } from "../qa/generation/design.mjs";
import { freezeVersion } from "../qa/generation/version.mjs";
import { current, withJournal } from "./act.mjs";
import { nextId } from "./model.mjs";
import { eventIdOf } from "./store.mjs";

export function generated(w, a) {
  const g = generationOf(w);
  const obligation = obligationWithin(w, a.obligation);
  const out = generatedCase(a.design, g.contextFor(obligation, a));
  return withJournal(w, () => (out.ok ? keptVersion(w, g, obligation, out) : keptFailure(w, obligation, a, out)));
}

// The obligation as the journal holds it now, while its budget lasts.
function obligationWithin(w, id) {
  const obligation = current(w).obligations.findLast((o) => o.obligation === id);
  if (!obligation) throw new Refused(`${id} is not an obligation of ${w.id} — discovery derives one before anything is designed for it`);
  budgetHeld(w, obligation);
  return obligation;
}

// What one obligation may cost (doc §6.4): designs that held, and proposals that failed and were
// repaired again -- a design is never retried until it goes green.
const BUDGET = [
  { limit: "designs", fallback: 4, over: (ds, n) => ds.filter((d) => d.state === "designed").length >= n, say: "designs" },
  { limit: "repairs", fallback: 2, over: (ds, n) => ds.filter((d) => d.state === "failed").length > n, say: "repairs of a design that failed" },
];

function budgetHeld(w, obligation) {
  const designs = current(w).designs.filter((d) => d.obligation === obligation.obligation);
  const spent = BUDGET.find((b) => b.over(designs, w.settings?.limits?.[b.limit] ?? b.fallback));
  if (spent) throw new Refused(`${obligation.obligation}'s budget of ${spent.say} is spent (settings limits.${spent.limit} ${w.settings?.limits?.[spent.limit] ?? spent.fallback}) — what it came to is reported, or a person raises the limit`);
}

function generationOf(w) {
  if (typeof w.generation?.contextFor !== "function") throw new Refused("this engine was not given a way to generate a test here — cli/autonomous-qa.mjs binds one");
  return w.generation;
}

function keptFailure(w, obligation, a, out) {
  const digest = sha(canonicalJson(a.design ?? null));
  const why = `${out.outcome} at ${out.stage}: ${out.findings.slice(0, 3).join("; ")}`.slice(0, 600);
  w.store.appendOnce(w.id, "designed", { id: nextId(current(w), "designed"), eventId: eventIdOf("designed", obligation.obligation, 0, digest), obligation: obligation.obligation, digest, state: "failed", why });
  return { outcome: out.outcome, stage: out.stage, findings: out.findings };
}

// A version this design already froze for these very bytes is the same version: kept, not made again.
function keptVersion(w, g, obligation, out) {
  designKept(w, obligation, out.design);
  const there = current(w).versions.find((v) => v.design === out.design.id && v.digest === caseDigest(out.case));
  const version = there?.version ?? frozenVersion(w, g, out);
  return { outcome: "DRAFT_CREATED", version, design: out.design.id, case: out.case.id, channel: out.channel, digests: out.digests };
}

function frozenVersion(w, g, out) {
  g.saveDraft(out.case);
  const frozen = freezeVersion({ case: out.case, design: out.design.id, versionNumber: current(w).versions.filter((v) => v.design === out.design.id).length + 1, ...g.versions });
  versionKept(w, out, frozen, g.versions?.validatorVersion ?? "core");
  return frozen.id;
}

// `digest` is the ARTIFACT's -- what the design is read back by (store.mjs readArtifact).
function designKept(w, obligation, design) {
  const kept = w.store.putArtifact(w.id, "designs", design);
  w.store.appendOnce(w.id, "designed", { id: nextId(current(w), "designed"), eventId: eventIdOf("designed", obligation.obligation, 0, design.digest), obligation: obligation.obligation, design: design.id, digest: kept.digest, state: "designed" });
}

function versionKept(w, out, frozen, validator) {
  w.store.putVersion(w.id, frozen);
  w.store.appendOnce(w.id, "version", { id: nextId(current(w), "version"), eventId: eventIdOf("version", out.design.id, 0, frozen.version.caseDigest), design: out.design.id, case: out.case.id, version: frozen.id, digest: frozen.version.caseDigest });
  w.store.appendOnce(w.id, "validated", { id: nextId(current(w), "validated"), eventId: eventIdOf("validated", frozen.id, 0, validator), version: frozen.id, state: "valid", validator });
}
