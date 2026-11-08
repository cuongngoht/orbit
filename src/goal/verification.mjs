import { Refused } from "../errors.mjs";

export const COMPLETION = [
  { id: "UNITS", when: (c) => c.units.every((u) => ["completed", "skipped"].includes(u.state)), say: () => "every work unit reached an acceptable final state" },
  { id: "AC", when: (c) => c.mandatoryAcs.every((a) => c.acStates.get(a.id)?.state === "verified"), say: () => "every mandatory acceptance criterion is verified on evidence" },
  { id: "CONFLICT", when: (c) => !(c.conflicts ?? []).some((x) => x.blocking), say: () => "no blocking requirement conflict remains" },
  { id: "OPEN", when: (c) => !c.openActions, say: () => "no required execution action is still open" },
  { id: "STALE", when: (c) => !(c.staleAcs ?? []).length, say: () => "no relevant verification evidence is stale" },
  { id: "DONE", when: () => true, say: () => "goal completion gate passed" },
];

export function completionGate(model, opts = {}) {
  const ctx = gateContext(model, opts);
  const failed = COMPLETION.find((r) => !r.when(ctx));
  if (failed && failed.id !== "DONE") return { outcome: "partial", because: failed.say(), gate: failed.id };
  return { outcome: "completed", because: "every completion row holds" };
}

// EVERY criterion the analysis keeps is mandatory. The analysis is stamped from the declared row table
// (src/goal/fields.mjs AC_ROW), and `mandatory` is not in it, so a host's `mandatory: false` never reaches the journal
// (closed, 0.5.0 review of B21). A requirement is what its own source says, and a host's reading is not that source:
// the engine cannot tell that the specification calls a criterion optional, and no door lets a person say so. A
// criterion stops being held only when the specification stops asking for it -- a new revision, analyzed again --
// never on a host's word. `mandatory !== false` below reads a field nothing writes, and errs toward holding more.
function gateContext(model, opts) {
  const units = [...model.units.values()];
  const mandatoryAcs = (model.analyzed?.acceptance ?? []).filter((a) => a.mandatory !== false);
  return { units, mandatoryAcs, acStates: model.ac, conflicts: model.analyzed?.conflicts ?? [], openActions: opts.openActions ?? false, staleAcs: opts.staleAcs ?? [] };
}

export function recordAcVerification(model, ac, state, evidence, because) {
  if (state === "verified" && !evidence) throw new Refused("verified acceptance needs evidence — a model assertion is not enough");
  return { ac, state, evidence: evidence ?? null, because: because ?? null, revision: model.revision };
}

export function staleAcceptance(model, treeRevision, recordedRevision) {
  if (!recordedRevision || !treeRevision) return [];
  if (recordedRevision === treeRevision) return [];
  return (model.analyzed?.acceptance ?? []).map((a) => a.id);
}
