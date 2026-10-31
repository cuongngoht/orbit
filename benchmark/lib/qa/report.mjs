// THE REPORT of a QA benchmark run: what a person needs to read whether Orbit's autonomous QA found what was planted
// in the application -- read off the run's own records (its manifest, its task's journal, the evidence kept by phase,
// the judge's verdict) and never computed again. It keeps apart what is easily blurred: a defect FOUND (contradicted on
// the planted application, by a test the clean one passes), a false alarm, what was never tested, what the
// environment or the provider kept from being tested, and whether the benchmark itself held. A number the host
// reported says so, and one nobody reported is `unknown`.
//
//   qaReportOf(room, manifest, view, steps, ending, leaks) -> { json, md }
import { docRead } from "../core/room.mjs";

const UNKNOWN = "unknown";

const val = (v) => (v === null || v === undefined || v === "" ? UNKNOWN : v);

const stepOfType = (view, steps, type) => ((a) => (a ? { act: a, doc: steps[a.id] } : null))((view.actions ?? []).filter((x) => x.type === type && steps[x.id]).at(-1));

const roundOf = (qa) => (qa ? { driver: qa.doc.driver ?? null, interrupted: false, error: qa.doc.error?.says ?? null, host: qa.doc.host ?? null, relay: qa.doc.relay ? { served: qa.doc.relay.served } : null, egress: qa.doc.start?.egress ?? qa.doc.runner?.egress ?? null, timedOut: qa.doc.container?.timedOut ?? null, tested: qa.doc.tested ?? null } : { driver: null, interrupted: true });

const intervened = (view) => (view.approvals ?? []).length > 0 || ["PAUSED", "CANCELLED"].includes(view.lifecycle);

function axesOf(manifest, view, ending, judged, round) {
  return {
    found: judged ? `${judged.found}/${judged.planted}` : null,
    falseAlarms: judged?.falseAlarms ?? null,
    coverage: judged ? Math.round(judged.coverage * 100) / 100 : null,
    throughOrbit: { value: round.driver === "coding-host" ? (round.relay?.served ?? 0) > 0 : null, basis: "OBSERVED — every request a coding host made reached the engine through the controller's relay, which logged it" },
    autonomous: { value: round.driver === "coding-host" ? Boolean(judged) && !intervened(view) : null, basis: "a coding host worked the investigation with no person approving, pausing or cancelling" },
    blocker: ending?.outcome === "BLOCKED" ? ending.summary : null,
    benchmarkInvalid: ending?.outcome === "BENCHMARK_INVALID" ? ending.summary : null,
  };
}

const unverifiedOf = (round) => [
  "Host metrics (model, turns, cost, tool calls) are what the host reported in its own output, in a container the agent also wrote to.",
  ...(round.driver && round.driver !== "coding-host" ? [`This run was driven by the scripted ${round.driver} host -- a control of the verifier, not a measure of a coding host.`] : []),
  ...(round.interrupted ? ["The host's round was interrupted before the controller saw it end: what it left in the investigation was read back and judged."] : []),
  "Which defects an application can hide is its ground truth's to say: a defect beyond it shows only as a contradiction the clean application does not share.",
];

export function qaReportOf(room, manifest, view, steps, ending, leaks = null) {
  const qa = stepOfType(view, steps, "benchmark.qa");
  const judged = docRead(room, "judged.json");
  const round = roundOf(qa);
  const json = { schema: 1, kind: "qa", run: manifest.run, task: manifest.task, outcome: ending?.outcome ?? view.lifecycle, summary: ending?.summary ?? null, label: manifest.target?.variant === manifest.target?.clean ? "the clean application: every contradiction is a false alarm" : `a defect planted in the application (${manifest.target?.variant})`, lifecycle: view.lifecycle, stopReason: view.stopReason, source: manifest.source, subject: manifest.subject, plugin: manifest.plugin, benchmark: manifest.benchmark, target: manifest.target, images: manifest.images, host: manifest.host, config: manifest.config, investigation: stepOfType(view, steps, "benchmark.readback")?.doc ?? null, confirmation: stepOfType(view, steps, "benchmark.confirm")?.doc ?? null, round, judged, axes: axesOf(manifest, view, ending, judged, round), unverified: unverifiedOf(round), leaks: (leaks?.files ?? []).map((f) => `${f.rel} (${f.done})`), evidence: room.dir };
  return { json, md: markdownOf(json) };
}

// ---- in words -----------------------------------------------------------------------------------------------------------

const yes = (v) => (v === null || v === undefined ? "n/a" : v ? "yes" : "no");

const rowLine = (r) => `| ${r.shape} | ${r.expected} | ${r.got} | ${r.clean ?? "—"} | ${r.credit} |`;

const roundLines = (r) => [`- driven by: ${val(r.driver)}${r.interrupted ? " (interrupted, read back)" : ""}`, ...(r.driver === "coding-host" ? [`- host model ${val(r.host?.model)}, ${val(r.host?.turns)} turns, ${val(r.host?.toolCalls)} tool calls, cost ${val(r.host?.costUsd)} USD (reported); relay requests served ${val(r.relay?.served)}; egress held ${yes(r.egress?.holds)}${r.timedOut ? "; stopped at the round's deadline" : ""}`] : []), ...(r.error ? [`- ${r.error}`] : [])];

const judgedLines = (j) => (j ? [`Verdict: **${j.verdict}** — ${j.why}.`, "", `Found ${j.found} of ${j.planted} planted defect(s) · false alarms ${j.falseAlarms} · unconfirmed ${j.unconfirmed} · coverage ${Math.round(j.coverage * 100)}% (at least ${Math.round(j.minCoverage * 100)}%)${j.beyondTruth.length ? ` · found beyond the ground truth: ${j.beyondTruth.join(", ")}` : ""}.`, "", "| shape | ground truth | planted app | clean app | credit |", "| --- | --- | --- | --- | --- |", ...j.rows.map(rowLine)] : ["No verdict: the run ended before the investigation could be judged."]);

function markdownOf(j) {
  return [`# QA benchmark run ${j.run} — ${j.outcome}`, "", `${j.summary ?? ""}`, "", `**${j.label}.** Case ${j.benchmark.case} ${j.benchmark.version} (suite ${j.benchmark.suite} ${j.benchmark.suiteVersion}). Task ${j.task}: ${j.lifecycle}${j.stopReason ? ` (${j.stopReason})` : ""}.`, "", "## Inputs, frozen", "", `- source: ${val(j.source.branch)}@${j.source.commit} (${j.source.mode}), digest ${j.source.digest}`, `- engine: the subject's own checkout, digest ${j.subject.digest}; the host's plugin: digest ${val(j.plugin?.digest)}, withholding ${(j.plugin?.withheld ?? []).join(", ")}, its ${val(j.plugin?.relayed)} the relay's client`, `- application: ${val(j.target?.app)} on ${val(j.target?.stack)}, variant planted ${val(j.target?.variant)}, clean variant ${val(j.target?.clean)}, plan ${val(j.target?.plan)}, mode ${val(j.target?.mode)}`, `- images: QA worker ${val(j.images?.qaWorker)}, runner ${val(j.images?.runner)} (Claude Code ${val(j.images?.claudeCode)}); docker ${val(j.host?.docker)}`, `- config: model ${val(j.config.model)}, minutes ${j.config.minutes}, usd ${j.config.usd}`, "", "## The host's round", "", ...roundLines(j.round), "", "## What the investigation came to", "", `Investigation ${val(j.investigation?.investigation)} (${val(j.investigation?.lines)} journal lines); confirmed on the clean application in ${val(j.confirmation?.investigation)}.`, "", ...judgedLines(j.judged), "", "## Kept apart", "", `- defects found: ${val(j.axes.found)}`, `- false alarms: ${val(j.axes.falseAlarms)}`, `- went through Orbit: ${yes(j.axes.throughOrbit.value)} — ${j.axes.throughOrbit.basis}`, `- autonomous end to end: ${yes(j.axes.autonomous.value)} — ${j.axes.autonomous.basis}`, `- blocker: ${j.axes.blocker ?? "none"}`, `- benchmark invalid: ${j.axes.benchmarkInvalid ?? "no"}`, `- a secret in the run's room: ${j.leaks.length ? `found in ${j.leaks.length} file(s), masked: ${j.leaks.join(", ")}` : "none found"}`, "", "## Not verified", "", ...j.unverified.map((u) => `- ${u}`), "", `Evidence: ${j.evidence}`, ""].join("\n");
}
