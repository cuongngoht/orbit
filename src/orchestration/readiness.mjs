// Whether a task may go on, read from what the OWNERS say -- as rows, first failing row stops.
//
//   REQUIREMENT   the snapshot the task rests on is still the requirement: it can be read, it hashes
//                 to what was frozen, no newer one was frozen, no blocking question is open, no source
//                 it cites has moved, and the work still rests on it. Asked by check-requirement and
//                 again before every step, so a requirement that MOVES under a running task blocks it
//                 (REQUIREMENT_BLOCKED, needs=requirement) and is never silently adopted.
//   ENVIRONMENT   the checkout has been understood, it declares a test (or a verify command) that can run without a shell,
//                 and nothing runtime already knows says the components holding its checks cannot
//                 run here (or must run where checks do not run yet).
//
// What a requirement SAYS, and what a runtime IS, stay with their owners: these rows read the
// answers the ports bring (requirements: `look`, runtime: `readiness`) and decide only whether the
// task may go on, and why not.

import { VERIFYING } from "./vocab.mjs";

// ---- the requirement -----------------------------------------------------------------------------

const ids = (rows) => rows.map((r) => r.id).join(", ");

// `t`: the task's head (view.task); `r`: { snapshot, latest, status, work } from the requirements port.
export const REQUIREMENT = [
  { id: "NO_SNAPSHOT", fails: (t) => !t.snapshot, because: () => "the task rests on no requirement snapshot" },
  { id: "UNREADABLE", fails: (t, r) => !r.snapshot, because: (t) => `snapshot ${t.snapshot} cannot be read here` },
  { id: "ALTERED", fails: (t, r) => Boolean(t.snapshotDigest) && r.snapshot.digest !== t.snapshotDigest, because: (t) => `snapshot ${t.snapshot} no longer hashes to what the task was started on` },
  { id: "NEWER", fails: (t, r) => Boolean(r.latest) && r.latest.id !== t.snapshot, because: (t, r) => `a newer snapshot ${r.latest.id} was frozen after this task began on ${t.snapshot} — a task rests on one snapshot: a person decides, and a new task starts on the new one` },
  { id: "BLOCKING", fails: (t, r) => (r.status?.open ?? []).some((q) => q.blocking), because: (t, r) => `blocking question(s) ${ids(r.status.open.filter((q) => q.blocking))} are open — a person answers them (orbit-requirements)` },
  { id: "SOURCE_MOVED", fails: (t, r) => (r.status?.sources ?? []).some((s) => s.stale), because: (t, r) => `source(s) ${ids(r.status.sources.filter((s) => s.stale))} changed since the requirement was recorded — settle what they say now before building on it` },
  { id: "WORK", fails: (t, r) => Boolean(r.work) && r.work.snapshot !== t.snapshot, because: (t, r) => `the work rests on ${r.work.snapshot ?? "no snapshot"}, the task on ${t.snapshot}` },
];

const requirementFailure = (t, r) => REQUIREMENT.find((row) => row.fails(t, r)) ?? null;

// -> { ok, id?, because } for a requirement-backed task; an ad-hoc one has nothing to check.
export function requirementOf(task, looked) {
  if (!task.root) return { ok: true, because: "an ad-hoc objective: no requirement to rest on" };
  const failed = requirementFailure(task, looked);
  return failed ? { ok: false, id: failed.id, because: failed.because(task, looked) } : { ok: true, because: `${task.snapshot} still stands` };
}

// ---- the environment -----------------------------------------------------------------------------

const holding = (e) => new Set(e.checks.map((c) => c.component));

const holders = (e, states) => e.components.filter((c) => holding(e).has(c.key) && states.includes(c.state));

const said = (rows) => rows.map((c) => `${c.key}: ${c.because}${c.blocking?.length ? ` — ${c.blocking.join("; ")}` : ""}`).join("; ");

// `e`: { understanding, components: [{ key, state, provider, because, blocking }], checks: [{ id, purpose, component }], unsafeTests }
export const ENVIRONMENT = [
  { id: "NOT_UNDERSTOOD", needs: "environment", fails: (e) => e.understanding === "NOT_DISCOVERED", because: () => "nothing has read what this checkout needs to run — runtime discover could not" },
  { id: "NO_TESTS", needs: "capability", fails: (e) => !e.checks.some((c) => VERIFYING.includes(c.purpose)), because: (e) => (e.unsafeTests ? "the test commands it declares need a shell, which Orbit never uses — declare one that does not" : "nothing this checkout declares can test a change — declare a test command, or build what verifies it (orbit-qc-builder)") },
  { id: "CANNOT_RUN", needs: "environment", fails: (e) => holders(e, ["unresolved", "unreachable"]).length > 0, because: (e) => said(holders(e, ["unresolved", "unreachable"])) },
  { id: "IN_CONTAINER", needs: "person", fails: (e) => e.components.some((c) => holding(e).has(c.key) && c.provider === "devcontainer"), because: () => "a component holding the checks is set to run in a dev container, and checks do not run in one yet — a person chooses how it runs here (runtime configure)" },
];

export function environmentOf(looked) {
  const failed = ENVIRONMENT.find((row) => row.fails(looked)) ?? null;
  return failed ? { ok: false, id: failed.id, needs: failed.needs, because: failed.because(looked) } : { ok: true, because: `${looked.checks.length} declared check(s) can run here` };
}
