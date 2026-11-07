// THE WORKFLOW JUDGE (0.5.0, backlog B1, ADR 0053): what one request taken through `/orbit-help` must show beside the
// code the verifier holds, as record rows each naming its LEG -- the code (an engineering task delivered the change and
// completed on its own journal), the QA step (here: SKIPPED with its reason, on a target with nothing to start) and the
// path (the coordinated workflow's own journal: one workflow, routed as the case says, the change its own child's, every
// step settled on its owner's record and the workflow completed). A row reads an owner's word about its own state, as
// the inspection read it back through Orbit's own commands, and never judges code: the hidden checks do that.
//
//   workflowRecords(c, rb) -> [{ id, leg, ok, says }]      legsOf(c, round) -> { code, qa, path } | null
//   rb: { engineering, found, workflows: [{ id, lifecycle, route, child, steps: [{ id, kind, state, summary }] }] }
import { WORKFLOW_LEGS } from "../core/suites.mjs";

// The one coordinated workflow a round left -- two are never guessed between.
const theWorkflow = (rb) => ((ws) => (ws.length === 1 ? ws[0] : null))(rb.workflows ?? []);

const stepOf = (w, kind) => (w?.steps ?? []).find((s) => s.kind === kind) ?? null;

// Settled on its owner's record: a strict step SUCCEEDED (the coordinator reads its owner back before it says so);
// project context, which has no record to prove it by, may stand REPORTED; the QA step is held by its own leg.
const settledOn = (s) => s.kind === "qa" || s.state === "succeeded" || (s.kind === "context" && s.state === "reported");

const allSettled = (w) => Boolean(w) && (w.steps ?? []).length > 0 && w.steps.every(settledOn) && w.lifecycle === "COMPLETED";

// A QA step the engine skipped says why: nothing the checkout declares can be started (src/automation/dispatch.mjs).
const SKIP_SAID = /nothing this checkout declares can be started/;

const skippedSaying = (s) => s?.state === "skipped" && SKIP_SAID.test(String(s.summary ?? ""));

// What each QA expectation a case may name holds the QA step to.
const QA_ROWS = {
  skipped: [{ id: "qa-skipped-said", leg: "qa", says: "the change's QA step is in the plan and was SKIPPED, saying nothing could be started -- never left out, never passed", ok: (rb) => skippedSaying(stepOf(theWorkflow(rb), "qa")) }],
};

const PATH_ROWS = [
  { id: "one-workflow", leg: "path", says: "the request was taken through ONE coordinated workflow", ok: (rb) => Boolean(theWorkflow(rb)) },
  { id: "routed", leg: "path", says: "the coordinator routed the request as the case asks", ok: (rb, c) => theWorkflow(rb)?.route === c.workflow.route },
  { id: "its-change", leg: "path", says: "the change judged is the one the workflow's own engineering step started and names", ok: (rb) => rb.found === "coordinator" && Boolean(rb.engineering?.id) && theWorkflow(rb)?.child === rb.engineering.id },
  { id: "steps-settled", leg: "path", says: "every step of the workflow's plan settled on its owner's record, and the workflow completed", ok: (rb) => allSettled(theWorkflow(rb)) },
];

const rowOf = (c, rb) => (row) => ({ id: row.id, leg: row.leg, ok: row.ok(rb, c) === true, says: row.says });

export const workflowRecords = (c, rb) => [...(QA_ROWS[c.workflow.qa] ?? []), ...PATH_ROWS].map(rowOf(c, rb));

// Which legs held, from a judged round: the code leg is the verifier's (hidden checks, gates, own test, scope) with the
// code rows; every other leg is its rows'. Null for a round of another kind.
const codeHeld = (r) => r.v.complete && r.v.failures.length === 0 && r.cand.scope.length === 0 && r.extraTasks === 0;

const rowsHeld = (r, leg) => (r.records ?? []).filter((x) => x.leg === leg).every((x) => x.ok);

export const legsOf = (c, r) => (c.kind === "workflow" ? Object.fromEntries(WORKFLOW_LEGS.map((leg) => [leg, rowsHeld(r, leg) && (leg !== "code" || codeHeld(r))])) : null);

// The legs a judged round failed on, in their order.
export const failedLegs = (legs) => WORKFLOW_LEGS.filter((leg) => legs && legs[leg] === false);
