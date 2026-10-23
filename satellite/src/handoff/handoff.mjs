// A HANDOFF: what one agent run hands to the units that depend on its unit -- published IMMUTABLY when the run's
// report is accepted (handoffs/hof-<n>.json, writePrivate), referenced by id and digest, and validated by every
// consumer before it relies on it: scope, compatibility, freshness and contract (CONSUME_RULES). A run that finds the
// accepted design insufficient PROPOSES a change inside its handoff; it never changes the objective or the acceptance
// criteria, and only the orchestrator's next revision can act on the proposal.
import { canonicalJson, short } from "../../../src/hash.mjs";
import { missionFile } from "../store/rooms.mjs";
import { isObject, list, quietly } from "../store/text.mjs";

export const HANDOFF_API = "orbit.satellite.handoff/v1";

export const HANDOFF_FIELDS = Object.freeze(["api", "id", "missionId", "sourceAgentRunId", "sourceUnitId", "targetWorkUnitIds", "sourceRevision", "sourceTree", "artifactPins", "scope", "findings", "remainingUnknowns", "evidenceRefs", "outputContract", "proposes"]);

export const handoffDigest = (record) => short(canonicalJson(Object.fromEntries(HANDOFF_FIELDS.map((k) => [k, record?.[k] ?? null]))), 16);

const targetsOf = (m, unitId) => [...m.units.values()].filter((u) => (u.dependencyIds ?? []).includes(unitId)).map((u) => u.id);

// x: { m, id, run, unit, report, tree, artifactPins }
export const handoffOf = (x) => ((record) => ({ ...record, digest: handoffDigest(record) }))({ api: HANDOFF_API, id: x.id, missionId: x.m.meta.id, sourceAgentRunId: x.run.id, sourceUnitId: x.unit.id, targetWorkUnitIds: targetsOf(x.m, x.unit.id), sourceRevision: x.m.position, sourceTree: x.tree ?? null, artifactPins: x.artifactPins ?? [], scope: x.unit.scope, findings: list(x.report.findings), remainingUnknowns: list(x.report.remainingUnknowns), evidenceRefs: list(x.report.evidenceRefs), outputContract: x.unit.outputContract, proposes: x.report.proposes ?? null });

export const handoffFile = (rooms, missionId, id) => missionFile(rooms, missionId, "handoffs", `${id}.json`);

export function publishHandoff(io, rooms, record) {
  const file = handoffFile(rooms, record.missionId, record.id);
  io.writePrivate(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

export const readHandoff = (io, rooms, missionId, id) => quietly(() => JSON.parse(io.read(handoffFile(rooms, missionId, id)) ?? "null"));

const within = (path, roots) => roots.some((r) => path === r || path.startsWith(`${r.replace(/\/+$/, "")}/`));

const fieldOf = { findings: (h) => h.findings, evidenceRefs: (h) => h.evidenceRefs, artifacts: (h) => h.artifactPins };

const contractMet = (h) => list(h.outputContract?.fields).every((f) => list((fieldOf[f] ?? (() => [h[f]].filter(Boolean)))(h)).length > 0);

// c: { m, unit (the consumer), record (read back), tree (the checkout now), published (its journal line) }
export const CONSUME_RULES = Object.freeze([
  { rule: "HOF_MISSING", fails: (c) => !isObject(c.record), say: (c) => `${c.published.id} could not be read back` },
  { rule: "HOF_DIGEST", fails: (c) => c.record.digest !== handoffDigest(c.record) || c.record.digest !== c.published.digest, say: (c) => `${c.published.id} is not what was published (its digest moved)` },
  { rule: "HOF_TARGET", fails: (c) => !list(c.record.targetWorkUnitIds).includes(c.unit.id) && !list(c.unit.inputArtifactRefs).includes(c.record.id) && !(c.unit.dependencyIds ?? []).includes(c.record.sourceUnitId), say: (c) => `${c.record.id} was not handed to ${c.unit.id}` },
  { rule: "HOF_SCOPE", fails: (c) => list(c.record.scope?.paths).length > 0 && list(c.unit.scope?.paths).some((p) => !within(p, c.record.scope.paths)), say: (c) => `${c.unit.id} works on paths ${c.record.id} says nothing about` },
  { rule: "HOF_COMPATIBILITY", fails: (c) => list(c.unit.inputContract?.accepts).length > 0 && !c.unit.inputContract.accepts.includes(c.record.outputContract?.shape), say: (c) => `${c.unit.id} accepts ${c.unit.inputContract.accepts.join(", ")}, and ${c.record.id} is a ${c.record.outputContract?.shape}` },
  { rule: "HOF_FRESHNESS", fails: (c) => (c.m.units.get(c.record.sourceUnitId)?.resetAt ?? -1) > c.published.n || (Boolean(c.record.sourceTree?.head) && Boolean(c.tree?.head) && c.record.sourceTree.head !== c.tree.head), say: (c) => `${c.record.id} is stale: its unit was reset, or the checkout moved since it was published` },
  { rule: "HOF_CONTRACT", fails: (c) => !contractMet(c.record), say: (c) => `${c.record.id} does not hold to its own output contract (${list(c.record.outputContract?.fields).join(", ")})` },
]);

export const consumeFinding = (c) => ((r) => (r ? { rule: r.rule, say: r.say(c) } : null))(CONSUME_RULES.find((x) => x.fails(c)));

// The handoffs a unit rests on: each dependency's latest, from a succeeded run after that unit's last reset, and any
// it names itself.
export const inputHandoffsOf = (m, unit) => [...m.handoffs.values()].filter((h) => (unit.dependencyIds ?? []).includes(h.unit) || list(unit.inputArtifactRefs).includes(h.id)).filter((h) => ((run) => run?.ended?.outcome === "succeeded" && run.n > (m.units.get(h.unit)?.resetAt ?? -1))(m.runs.get(h.agentRun))).reduce((latest, h) => ({ ...latest, [h.unit]: h }), {});
