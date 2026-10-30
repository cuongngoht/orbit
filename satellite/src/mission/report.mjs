// AN AGENT RUN'S REPORT, through the one door it has: held to the report contract whole (src/hosts/report.mjs), every
// evidence reference read back from its owner (src/evidence/readback.mjs), the primary checkout witnessed against how
// it was when the run began, the run's handoff published immutably, and what the run came to decided by the engine
// (conclude.mjs) -- never by what the report says about itself. A report while an owner's record is still moving is
// refused (EVIDENCE_PENDING): report again when it has ended. The same report twice is a replay.
import { Refused } from "../../../src/errors.mjs";
import { canonicalJson, sha, short } from "../../../src/hash.mjs";
import { scrubbed } from "../../../src/scrub.mjs";
import { readBack } from "../evidence/readback.mjs";
import { refOf } from "../evidence/vocab.mjs";
import { handoffOf, publishHandoff } from "../handoff/handoff.mjs";
import { reportDigest, reportProblems } from "../hosts/report.mjs";
import { PROFILES } from "../permissions/profiles.mjs";
import { nextId } from "../store/ids.mjs";
import { missionFile } from "../store/rooms.mjs";
import { clip, list, quietly, refused } from "../store/text.mjs";
import { concludeRun } from "./conclude.mjs";
import { locked } from "./world.mjs";

const fieldOf = { findings: (r) => r.findings, evidenceRefs: (r) => r.evidenceRefs, artifacts: (r) => r.artifacts };

const contractMet = (r, unit) => list(unit.outputContract?.fields).every((f) => list((fieldOf[f] ?? (() => [r[f]].filter(Boolean)))(r)).length > 0);

const reportRow = (r, unit, run) => ({ owner: "report", ref: `report:${run.id}`, level: contractMet(r, unit) ? "CONTRACT_MET" : "TOOL_COMPLETED", independent: false, digest: reportDigest(r), open: false, say: contractMet(r, unit) ? "the report holds to the unit's output contract" : "the report does not hold every field the unit's output contract names" });

// The primary checkout, witnessed when the run began and now. A checkout that could not be witnessed on either side is
// treated as one that changed: nothing a run says can be told apart from what may have.
const WITNESS_ROWS = [
  { when: (now, run) => !now || !run.tree || now.witnessed === false || run.tree.witnessed === false, say: (now) => `the primary checkout could not be witnessed (${now?.why ?? "no snapshot could be taken"}): what the run says cannot be told apart from what may have changed` },
  { when: (now, run) => Boolean(run.tree?.digest && now?.digest && now.digest !== run.tree.digest), say: () => "the primary checkout changed while this run was open: what the run says cannot be told apart from what changed" },
];

const witnessRow = (now, say) => ({ owner: "checkout", ref: `checkout:${String(now?.head ?? "none").slice(0, 12)}:${String(now?.digest ?? "unwitnessed").slice(0, 8)}`, level: "BLOCKED", independent: false, digest: now?.digest ?? null, open: false, say });

const witnessRows = (now, run) => ((row) => (row ? [witnessRow(now, row.say(now))] : []))(WITNESS_ROWS.find((r) => r.when(now, run)));

export const evidenceRowsOf = (ports, lw, run, r, unit) => ((now) => [...(r ? [reportRow(r, unit, run)] : []), ...list(r?.evidenceRefs ?? (run.task ? [`task:${run.task}`] : [])).map(refOf).filter(Boolean).map((ref) => readBack(ports, ref, lw)), ...witnessRows(now, run)])(quietly(() => ports.checkout.snapshot()));

function openRunOf(lw, runId, raw) {
  const run = lw.m.runs.get(runId);
  if (!run) throw refused(Refused, "RUN_UNKNOWN", `no agent run ${runId} in ${lw.id}`);
  if (run.ended && run.reported?.digest === reportDigest(raw)) return { replay: true, run };
  if (run.ended) throw refused(Refused, "RUN_ENDED", `${runId} already ended ${run.ended.outcome}; a new attempt is a new run`);
  return { run };
}

const artifactsRefused = (run, raw) => list(raw.artifacts).length > 0 && !PROFILES[run.profile]?.kinds.includes("artifact.publish");

function judged(lw, run, raw) {
  const problems = reportProblems(raw, { run });
  if (problems.length) throw refused(Refused, "REPORT_INVALID", problems.map((p) => `${p.id}: ${p.say}`).join("; "));
  if (artifactsRefused(run, raw)) throw refused(Refused, "ARTIFACT_NOT_GRANTED", `a ${run.profile} run publishes no artifact; put what it found in findings`);
  return scrubbed(raw);
}

function artifactPins(ports, lw, run, r) {
  return list(r.artifacts).map((a) => ((name, rel) => (ports.io.writePrivate(missionFile(ports.rooms, lw.id, "artifacts", name), a.text), { ref: `artifact:${rel}`, digest: sha(a.text) }))(`${run.id}-${a.name}`, `artifacts/${run.id}-${a.name}`));
}

function handedOff(ports, lw, run, unit, r, tree) {
  const record = handoffOf({ m: lw.m, id: nextId(lw.m, "handoff.published"), run, unit, report: r, tree, artifactPins: artifactPins(ports, lw, run, r) });
  const file = publishHandoff(ports.io, ports.rooms, record);
  lw.append("handoff.published", { id: record.id, unit: unit.id, targets: record.targetWorkUnitIds, agentRun: run.id, digest: record.digest, file: `handoffs/${record.id}.json`, proposes: Boolean(record.proposes), action: run.action });
  return { id: record.id, file };
}

function observed(lw, run, r, rows) {
  if (!run.started) lw.append("agentrun.started", { id: run.id, action: run.action, providerRef: run.providerRef ?? undefined, by: "report" });
  lw.append("action.observed", { id: run.action, refs: rows.map((x) => x.ref), digests: rows.map((x) => x.digest).filter(Boolean), outcome: r.executionState, by: "host" });
  lw.append("agentrun.reported", { id: run.id, executionState: r.executionState, findings: list(r.findings).length, artifacts: list(r.artifacts).length, evidenceRefs: list(r.evidenceRefs), unknowns: list(r.remainingUnknowns).length, proposes: Boolean(r.proposes), digest: reportDigest(r), summary: clip(r.summary) });
}

function settled(ports, lw, run, r) {
  const unit = lw.m.units.get(run.unit);
  const rows = evidenceRowsOf(ports, lw, run, r, unit);
  if (rows.some((x) => x.open)) throw refused(Refused, "EVIDENCE_PENDING", `${rows.filter((x) => x.open).map((x) => `${x.ref}: ${x.say}`).join("; ")} — report again once it has ended`);
  observed(lw, run, r, rows);
  return { handoff: handedOff(ports, lw, run, unit, r, quietly(() => ports.checkout.snapshot())), ...concludeRun(ports, lw, run, { unit, rows, state: r.executionState, supports: r.supports, refutes: r.refutes, proposes: r.proposes, summary: r.summary }) };
}

function reported(ports, lw, runId, raw) {
  const open = openRunOf(lw, runId, raw);
  if (open.replay) return { replay: true, run: runId, outcome: open.run.ended.outcome };
  const r = judged(lw, open.run, raw);
  lw.action = open.run.action;
  return { mission: lw.id, ...settled(ports, lw, open.run, r), revision: lw.m.position };
}

export const agentReport = (ports, id, runId, raw) => locked(ports, id, (lw) => reported(ports, lw, runId, raw));

// The HOST's word that it launched the run: PROVIDER_ACCEPTED, said to be the host's -- a report, never an
// observation of the run itself. With a host agent (0.2.2, ADR 0044) the host also says WHICH of its agents carries
// the run: kept hashed beside the run (`agentrun.bound`), REPORTED, and outranked by what the hooks observed of the
// launch -- a disagreement is shown CONFLICTING, never settled here. A link may come late: binding an ended run
// changes nothing about how it ended.
function knownRun(lw, runId, hostAgent) {
  const run = lw.m.runs.get(runId);
  if (!run || (run.ended && !hostAgent)) throw refused(Refused, run ? "RUN_ENDED" : "RUN_UNKNOWN", `${runId} is no open agent run of ${lw.id}`);
  return run;
}

function startedByHost(lw, run, ports) {
  if (run.started || run.ended) return { replay: true, by: run.started?.by ?? null };
  lw.append("action.accepted", { id: run.action, providerRef: `host:${ports.hostId}`, by: "host" });
  return { accepted: lw.append("agentrun.started", { id: run.id, action: run.action, providerRef: `host:${ports.hostId}`, by: "host" }).by };
}

const boundOnce = (lw, run, hashed) => (run.bound.some((b) => b.hostAgent === hashed) ? { bound: hashed, boundBefore: true } : { bound: lw.append("agentrun.bound", { id: run.id, hostAgent: hashed, by: "host" }).hostAgent });

const HOST_AGENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

// The agent id the host's own Agent tool answered with, hashed the way the hooks hash it (src/lifecycle/event.mjs), so
// the two words about one agent are one id -- on a host this command can name; elsewhere there is nothing to compare.
function hostAgentOf(ports, raw) {
  if (!raw) return null;
  if (ports.hostId === "unknown" || !HOST_AGENT.test(String(raw))) throw refused(Refused, "HOST_AGENT", ports.hostId === "unknown" ? "the host this command runs under is not known here, so an agent id it named cannot be compared with what the hooks saw" : "a host agent id is letters, digits and . _ : - only");
  return ports.hashAgent(String(raw));
}

function acknowledged(lw, runId, ports, raw) {
  const run = knownRun(lw, runId, raw);
  const hashed = hostAgentOf(ports, raw);
  const started = startedByHost(lw, run, ports);
  return { run: runId, ...started, ...(hashed ? boundOnce(lw, run, hashed) : {}), revision: lw.m.position };
}

export const agentAck = (ports, id, runId, hostAgent = null) => locked(ports, id, (lw) => acknowledged(lw, runId, ports, hostAgent));

export const runDigest = (run) => short(canonicalJson(run), 16);
