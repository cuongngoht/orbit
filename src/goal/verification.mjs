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
