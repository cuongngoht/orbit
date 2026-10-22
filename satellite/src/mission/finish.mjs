// FINISH: a mission ends on what its journal shows. With every unit done (or skipped, or cancelled) and nothing open,
// its verdict is derived: VERIFIED -- every acceptance criterion proved by an independent owner -- COMPLETES it;
// anything less REPORTS it, saying what is still owed. A stop (`--stop=<REASON>`) needs the journal to show that
// reason (STOP_EVIDENCE); CANCELLED is the session's word and says so. An engineering task that is still running is
// Orbit's, never stopped from here: the mission waits for it.
import { Refused } from "../../../src/errors.mjs";
import { canonicalJson, short } from "../../../src/hash.mjs";
import { acceptanceOf, verdictOf } from "../evidence/verdict.mjs";
import { clip, isSentence, refused } from "../store/text.mjs";
import { allDone, lifecycleOf, noProgressOf, openActions, unitStates } from "./state.mjs";
import { STOP_IDS, TERMINAL } from "./vocab.mjs";
import { locked } from "./world.mjs";

const GAP_LABELS = ["CAPABILITY_GAP", "POLICY_GAP", "ENVIRONMENT_GAP", "APPROVAL_REQUIRED"];

const budgetSpent = (lw) => ((s, l) => s.actions >= l.maxActions || s.agentRuns >= l.maxAgentRuns || s.replans >= l.maxReplans || (l.maxMinutes !== null && l.maxMinutes !== undefined && s.minutes >= l.maxMinutes))(lw.spent(), lw.limits);

export const STOP_EVIDENCE = Object.freeze({
  NO_PROGRESS: (lw) => Boolean(noProgressOf(lw.m)),
  BUDGET_EXHAUSTED: budgetSpent,
  VERIFICATION_FAILED: (lw) => [...unitStates(lw.m).values()].includes("failed"),
  EXECUTION_FAILED: (lw) => [...lw.m.actions.values()].some((a) => a.recorded?.outcome === "failed"),
  CAPABILITY_BLOCKED: (lw) => lw.m.factory.some((f) => f.kind === "skill.discovered" && GAP_LABELS.includes(f.label)),
  PERMISSION_DENIED: (lw) => lw.m.permissions.some((p) => p.kind === "permission.denied"),
  CANCELLED: () => true,
});

const openWrites = (lw) => openActions(lw.m).filter((a) => a.effect === "write");

const FINISH = [
  { code: "MISSION_ENDED", fails: (lw) => TERMINAL.includes(lifecycleOf(lw.m)), say: (lw) => `${lw.id} has already ended (${lifecycleOf(lw.m)})` },
  { code: "STOP_UNKNOWN", fails: (lw, o) => Boolean(o.stop) && !STOP_IDS.includes(o.stop), say: () => `--stop is one of ${STOP_IDS.join(", ")}` },
  { code: "STOP_UNSUPPORTED", fails: (lw, o) => Boolean(o.stop) && !STOP_EVIDENCE[o.stop](lw), say: (lw, o) => `the journal does not show ${o.stop}; a stop is recorded only for a reason the mission's own record supports` },
  { code: "STOP_BECAUSE", fails: (lw, o) => Boolean(o.stop) && !isSentence(o.because), say: () => '--because="one sentence" says why' },
  { code: "STILL_RUNNING", fails: (lw) => openWrites(lw).length > 0, say: (lw) => `${openWrites(lw).map((a) => `${a.id} (${a.accepted?.providerRef ?? a.type})`).join(", ")} still works through its owner; it ends there (a person stops an engineering task), then reconcile reads it back` },
  { code: "STILL_OPEN", fails: (lw, o) => !o.stop && openActions(lw.m).length > 0, say: (lw) => `${openActions(lw.m).map((a) => a.id).join(", ")} is still open: report it, or reconcile it` },
  { code: "NOT_SETTLED", fails: (lw, o) => !o.stop && !allDone(lw.m), say: (lw) => `units still owed: ${[...unitStates(lw.m)].filter(([, s]) => !["done", "skipped", "cancelled"].includes(s)).map(([id, s]) => `${id} ${s}`).join(", ")}` },
];

function refusedUnless(lw, o) {
  const failed = FINISH.find((r) => r.fails(lw, o));
  if (failed) throw refused(Refused, failed.code, failed.say(lw, o));
}

function concluded(lw) {
  const v = verdictOf(lw.m, true);
  lw.append("verification.derived", { verdict: v.verdict, owed: v.owed.map((o) => o.acceptance), digest: short(canonicalJson(v.acceptance), 16) });
  const done = v.verdict === "VERIFIED";
  lw.append(done ? "mission.completed" : "mission.reported", done ? { verdict: v.verdict, summary: `every acceptance criterion was verified by an independent owner (${v.acceptance.length})` } : { verdict: v.verdict, owed: v.owed.map((o) => o.acceptance), summary: clip(`${v.owed.length} of ${v.acceptance.length} acceptance criteria are not verified by an independent owner`) });
  return { mission: lw.id, lifecycle: lifecycleOf(lw.m), verdict: v.verdict, acceptance: v.acceptance, owed: v.owed };
}

// A stop closes what is open and only READS: a read-only run cancelled with its mission is interrupted, never left open.
function closedReads(lw) {
  for (const a of openActions(lw.m)) lw.append("action.recorded", { id: a.id, outcome: "interrupted", level: "UNKNOWN", summary: "the mission was stopped while it was open" });
  for (const r of [...lw.m.runs.values()].filter((x) => !x.ended)) lw.append("agentrun.ended", { id: r.id, outcome: "interrupted", because: "the mission was stopped" });
}

function stopped(ports, lw, o) {
  closedReads(lw);
  lw.append(o.stop === "CANCELLED" ? "mission.cancelled" : "mission.failed", o.stop === "CANCELLED" ? { by: "session", session: ports.session ?? undefined, because: o.because } : { stop: o.stop, because: o.because });
  return { mission: lw.id, lifecycle: lifecycleOf(lw.m), stop: o.stop, verdict: verdictOf(lw.m, true).verdict, acceptance: acceptanceOf(lw.m) };
}

function finished(ports, lw, o) {
  refusedUnless(lw, o);
  return o.stop ? stopped(ports, lw, o) : concluded(lw);
}

export const finish = (ports, id, opts = {}) => locked(ports, id, (lw) => finished(ports, lw, opts));
