// RECONCILE: every action still open, read back from where it would have left a trace -- and NEVER sent again.
//
//   a worker's lease that is alive           STILL_RUNNING: nothing is touched
//   a dead worker's read                     INTERRUPTED: closed, and the decision can be made again
//   a dead worker's engineering start        the tasks Orbit started since the intent, by objective: none -> INTERRUPTED,
//                                            one -> adopted (PROVIDER_ACCEPTED), more -> AMBIGUOUS
//   a dead worker's other write              AMBIGUOUS: it may have happened; a person decides, nothing is resent
//   an engineering run                       its task read back: still moving -> STILL_RUNNING, ended -> the run is
//                                            concluded on the task's own record, unreadable -> AMBIGUOUS
//   a host-agent run                         STILL_RUNNING, unless the host says it is gone (--abandon=<arn>) or it is
//                                            older than STALE_AFTER_MS -> INTERRUPTED
import { Refused } from "../../../src/errors.mjs";
import { readLease, releaseLease } from "../recovery/lease.mjs";
import { refOf } from "../evidence/vocab.mjs";
import { clip, list, quietly, refused } from "../store/text.mjs";
import { accepted } from "./actions/dispatch.mjs";
import { concludeRun } from "./conclude.mjs";
import { evidenceRowsOf } from "./report.mjs";
import { lifecycleOf, openActions } from "./state.mjs";
import { STALE_AFTER_MS } from "./vocab.mjs";
import { locked } from "./world.mjs";

const runOfAction = (lw, a) => (a.agentRun ? lw.m.runs.get(a.agentRun) ?? null : null);

const ageMs = (ports, a) => ports.nowMs() - (Date.parse(a.intended?.at ?? a.at ?? "") || ports.nowMs());

const liveLease = (ports, lease) => lease && ports.liveness(lease) !== false;

const note = (lw, a, to, because) => (lw.append("recovery.reconciled", { action: a.id, from: a.status, to, because: clip(because) }), { action: a.id, from: a.status, to, because });

function interrupted(ports, lw, a, because) {
  const r = note(lw, a, "INTERRUPTED", because);
  lw.append("action.recorded", { id: a.id, outcome: "interrupted", level: "UNKNOWN", summary: clip(because) });
  if (runOfAction(lw, a) && !runOfAction(lw, a).ended) lw.append("agentrun.ended", { id: a.agentRun, outcome: "interrupted", because: clip(because) });
  releaseLease(ports, lw.id, a.id);
  return r;
}

// AMBIGUOUS takes the lease too: a worker that wakes after this must find it gone and write nothing (FENCED), or the
// journal would say both that a person decides and what the worker says happened.
function ambiguous(ports, lw, a, because) {
  const r = note(lw, a, "AMBIGUOUS", because);
  lw.append("action.ambiguous", { id: a.id, because: clip(because) });
  releaseLease(ports, lw.id, a.id);
  return r;
}

const tasksFor = (ports, lw, a) => list(quietly(() => ports.owners.tasksSince(a.intended?.at ?? a.at))).filter((t) => t.objective === lw.m.units.get(a.unit)?.objective);

function adopted(ports, lw, a) {
  const tasks = tasksFor(ports, lw, a);
  if (tasks.length !== 1) return tasks.length === 0 ? interrupted(ports, lw, a, "the worker that would start the engineering task is gone, and no task was started for this unit") : ambiguous(ports, lw, a, `${tasks.length} engineering tasks were started for this unit since its intent; a person decides which is this run's`);
  accepted(lw, runOfAction(lw, a), `task:${tasks[0].id}`, "reconcile");
  releaseLease(ports, lw.id, a.id);
  return note(lw, a, "PROVIDER_ACCEPTED", `adopted ${tasks[0].id}, the one task started for this unit since its intent`);
}

function readTask(ports, lw, a) {
  const run = runOfAction(lw, a);
  const rows = evidenceRowsOf(ports, lw, run, { evidenceRefs: [a.accepted.providerRef] }, lw.m.units.get(run.unit)).filter((r) => r.owner !== "report");
  if (rows.some((r) => r.open)) return { action: a.id, from: a.status, to: "STILL_RUNNING", because: rows.find((r) => r.open).say };
  if (rows.every((r) => r.level === "UNKNOWN" && !r.digest)) return ambiguous(ports, lw, a, `${a.accepted.providerRef} cannot be read back`);
  return { ...note(lw, a, "RESULT_RECORDED", `concluded on ${a.accepted.providerRef}'s own record; its reporter is gone`), ...concludeRun(ports, lw, run, { unit: lw.m.units.get(run.unit), rows, state: "reported", summary: `concluded on ${a.accepted.providerRef}` }) };
}

const leased = (ports, lw, a) => readLease(ports, lw.id, a.id);

const stillRunning = (a, because) => ({ action: a.id, from: a.status, to: "STILL_RUNNING", because });

const RECONCILE = [
  { when: (ports, lw, a) => liveLease(ports, leased(ports, lw, a)) && ageMs(ports, a) < STALE_AFTER_MS, then: (ports, lw, a) => stillRunning(a, "its worker still holds the lease") },
  { when: (ports, lw, a) => Boolean(leased(ports, lw, a)) && a.type === "dispatch" && !a.accepted, then: adopted },
  { when: (ports, lw, a) => Boolean(leased(ports, lw, a)) && a.effect === "read", then: (ports, lw, a) => interrupted(ports, lw, a, "its worker is gone and it only read: it can be decided again") },
  { when: (ports, lw, a) => Boolean(leased(ports, lw, a)), then: (ports, lw, a) => ambiguous(ports, lw, a, `its worker is gone after a ${a.effect} began; it is never resent`) },
  { when: (ports, lw, a) => refOf(a.accepted?.providerRef)?.domain === "task", then: readTask },
  { when: (ports, lw, a, o) => o.abandon === a.agentRun || ageMs(ports, a) > STALE_AFTER_MS, then: (ports, lw, a, o) => interrupted(ports, lw, a, o.abandon === a.agentRun ? "the host says this run is gone" : "no report came back within the time a run may stay open") },
  { when: () => true, then: (ports, lw, a) => stillRunning(a, "the host has not reported it yet") },
];

function reconciled(ports, lw, o) {
  if (o.abandon && !lw.m.runs.has(o.abandon)) throw refused(Refused, "RUN_UNKNOWN", `${o.abandon} is no agent run of ${lw.id}`);
  const results = openActions(lw.m).map((a) => RECONCILE.find((r) => r.when(ports, lw, a, o)).then(ports, lw, a, o));
  return { mission: lw.id, reconciled: results, lifecycle: lifecycleOf(lw.m), revision: lw.m.position };
}

export const reconcile = (ports, id, opts = {}) => locked(ports, id, (lw) => reconciled(ports, lw, opts));
