// The TEST-HOOK conformance kit (doc §5.3, §5.5, §5.10): the scenarios an adapter over a project's
// orbit.scheduler/v1, orbit.clock/v1 and orbit.workload/v1 hooks is held to, on a REAL system,
// through its REAL helper. It knows no product: which schedule, workload and clock a scenario
// asks about is the SYSTEM's -- bound values the caller hands in (`system.bound`) -- and what the
// system did is asked of a WITNESS the caller binds (`system.witness.executed(ref)`), never of the
// adapter under test. A scenario whose semantics are unknown or unmet is not applicable.
import { meets } from "../../src/adapters/semantics.mjs";

export const SCENARIOS = [
  { id: "trigger-dispatches", family: "scheduler", ops: ["trigger"], needs: {}, run: triggerDispatches },
  { id: "decisions-by-cursor", family: "scheduler", ops: ["observe"], needs: { decisionReceipts: "cursor" }, run: decisionsByCursor },
  { id: "clock-barrier", family: "clock", ops: ["advance"], needs: { clockInjection: ["live"] }, run: clockBarrier },
  { id: "control-stop-start", family: "workload", ops: ["control"], needs: {}, run: stopStart },
  { id: "attempts-by-cursor", family: "worker", ops: ["observe"], needs: {}, run: attemptsByCursor },
];

// A dispatch the scheduler took names an execution, and the system's own record of it exists.
function triggerDispatches(kit) {
  const out = kit.ask("trigger", {}, { scheduleRef: kit.system.bound.schedule });
  const ref = out.value?.executionRef;
  return { ok: out.ok && typeof ref === "string" && kit.system.witness.executed(ref) === true, saw: out.value ?? out };
}

// What the loop decided is read from a cursor; reading on from `through` sees nothing new, and is
// complete -- the cursor caught up.
function decisionsByCursor(kit) {
  const first = kit.ask("decisions", {}, { scheduleRef: kit.system.bound.schedule });
  const again = first.ok ? kit.ask("decisions", { since: first.value.through }, { scheduleRef: kit.system.bound.schedule }) : first;
  return { ok: first.ok && again.ok && first.value.completeness === "complete" && again.value.decisions.length === 0 && again.value.completeness === "complete", saw: { through: first.value?.through, again: again.value ?? again } };
}

// The clock moves only forward, behind a barrier that answers how far the loop has evaluated. A
// business clock keeps whole seconds, so the instant asked for is one.
function clockBarrier(kit) {
  const to = new Date(Math.floor((kit.system.now() + 86_400_000) / 1000) * 1000).toISOString();
  const out = kit.ask("advance", { to }, { clockRef: kit.system.bound.clock });
  return { ok: out.ok && Date.parse(out.value.evaluatedThrough) >= Date.parse(to), saw: out.value ?? out };
}

function stopStart(kit) {
  const stopped = kit.ask("control", { action: "stop" }, { workloadRef: kit.system.bound.workload });
  const started = kit.ask("control", { action: "start" }, { workloadRef: kit.system.bound.workload });
  return { ok: stopped.ok && stopped.value.status === "stopped" && started.ok && started.value.status === "running", saw: { stopped: stopped.value ?? stopped, started: started.value ?? started } };
}

function attemptsByCursor(kit) {
  const out = kit.ask("attempts", {}, { workloadRef: kit.system.bound.workload });
  return { ok: out.ok && out.value.completeness === "complete" && Number.isInteger(out.value.through), saw: { count: out.value?.attempts?.length, through: out.value?.through } };
}

// One scenario's word for one adapter: not applicable on semantics it does not meet.
export function scenarioResult(kit, s) {
  const fit = meets(kit.adapter.semantics, s.needs);
  if (fit.unknown.length || fit.unmet.length) return { id: s.id, ops: s.ops, outcome: "not-applicable", why: { unknown: fit.unknown, unmet: fit.unmet.map((u) => u.field) } };
  const r = s.run(kit);
  return { id: s.id, ops: s.ops, outcome: r.ok ? "passed" : "failed", saw: r.saw };
}
