// THE REPORT of a workflow run (0.5.0, backlog B1, ADR 0053): an engineering run's report -- the code the verifier held,
// the rounds, what was kept apart -- and, beside it, the request's three legs as the last round judged them, every record
// row that held or not, and the coordinated workflow as the inspection read it back: its route and each step of its plan
// with the word it settled on and why (a skipped QA step says why it was skipped).
//
//   workflowReportOf(room, manifest, view, steps, ending, leaks, events) -> { json, md }
import { reportOf } from "../source/report.mjs";

const lastDecided = (json) => json.rounds.map((r) => r.decided).filter(Boolean).at(-1) ?? null;

const lastWorkflows = (json) => json.rounds.map((r) => r.inspection?.workflows).filter(Boolean).at(-1) ?? [];

const workflowOf = (json) => ((d) => ({ legs: d?.legs ?? null, failedLegs: d?.failedLegs ?? [], records: d?.records ?? [], workflows: lastWorkflows(json) }))(lastDecided(json));

const stepLine = (s) => `  - ${s.id}: ${s.state ?? "unknown"}${s.summary ? ` — ${s.summary}` : ""}`;

const workflowLines = (w) => [`- workflow ${w.id}: ${w.lifecycle ?? "unknown"}, routed ${w.route ?? "unknown"}, engineering task ${w.child ?? "none"}`, ...(w.steps ?? []).map(stepLine)];

const recordLine = (x) => `- ${x.ok ? "held" : "FAILED"} [${x.leg ?? "code"}] ${x.id}: ${x.says}`;

const legsSaid = (wf) => (wf.legs ? Object.entries(wf.legs).map(([leg, held]) => `${leg} ${held ? "held" : "FAILED"}`).join(" · ") : "not judged: no round reached a verdict");

const markdownOf = (wf) => ["## The request's three legs", "", `Legs: ${legsSaid(wf)}.`, "", ...(wf.records.length ? wf.records.map(recordLine) : ["- no record was read back"]), "", "## The workflow, as its own journal says", "", ...(wf.workflows.length ? wf.workflows.flatMap(workflowLines) : ["- no coordinated workflow was found in the runner's store"]), ""];

export function workflowReportOf(room, manifest, view, steps, ending, leaks = null, events = null) {
  const rep = reportOf(room, manifest, view, steps, ending, leaks, events);
  const wf = workflowOf(rep.json);
  return { json: { ...rep.json, workflow: wf }, md: [rep.md, ...markdownOf(wf)].join("\n") };
}
