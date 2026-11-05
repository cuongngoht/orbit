// THE REPORT of an activation run (0.5.0, B22 M4): what a person needs to read whether the host used Orbit by itself, and
// only where it helps -- read off the run's own records (its manifest, its task's journal, the evidence kept by phase,
// the judge's verdict) and never computed again. It keeps apart what is easily blurred: what the host DID (from the
// stream the controller captured), what the trail Orbit's hooks wrote says of it (and whether the two agree), what the
// router suggested (its own accuracy, never the host's), what the owners' records say, and -- for an outcome case --
// whether what the host delivered holds the hidden checks. A selection is behaviour, never a PASS on its own; a scripted
// host's run is a control of the judge, never a measure of a model.
//
//   activationReportOf(room, manifest, view, steps, ending, leaks) -> { json, md }      activationBasisOf(config)
import { diagnosisLines, diagnosisOf } from "../core/diagnosis.mjs";
import { effortSaid, hostSummary } from "../core/host.mjs";
import { docRead } from "../core/room.mjs";
import { runToolsOf, toolsMarkdown } from "../core/tools.mjs";

const UNKNOWN = "unknown";

const val = (v) => (v === null || v === undefined || v === "" ? UNKNOWN : v);

const stepOfType = (view, steps, type, label) => ((a) => (a ? { act: a, doc: steps[a.id] } : null))((view.actions ?? []).filter((x) => x.type === type && (!label || x.label === label) && steps[x.id]).at(-1));

const triedOf = (view) => (view.actions ?? []).some((a) => a.type === "benchmark.activation");

// Who carried the run: a coding host (a model, in the runner), the operator's own session, or a control's scripted host.
export const activationBasisOf = (config) => (String(config?.host ?? "").startsWith("scripted:") ? "scripted" : String(config?.host ?? "").startsWith("session:") ? "session" : "coding-host");

// The host's round as its evidence says -- or, for one that began and left none, only that it was interrupted.
const roundOf = (h, tried) => (h ? { round: 1, driver: h.doc.driver ?? null, interrupted: false, error: h.doc.error?.says ?? null, host: hostSummary(h.doc.host ?? null), egress: h.doc.start?.egress ?? h.doc.runner?.egress ?? null, timedOut: h.doc.container?.timedOut ?? null } : tried ? { round: 1, driver: null, interrupted: true, host: null } : null);

const sum = (xs) => (xs.length && xs.every((x) => typeof x === "number") ? xs.reduce((a, b) => a + b, 0) : null);

const totalsOf = (rounds) => (rounds.length ? { rounds: rounds.length, costUsd: sum(rounds.map((r) => r.host?.costUsd)), turns: sum(rounds.map((r) => r.host?.turns)), toolCalls: sum(rounds.map((r) => r.host?.toolCalls)), basis: "REPORTED" } : { rounds: 0, costUsd: null, turns: null, toolCalls: null, basis: "no host ran" });

// What the metrics fold reads of this run: the judge's own facts, beside what the case measures.
const factsOf = (manifest, judged) => (judged ? { ...judged.metric, arm: manifest.config?.arm ?? "release", tier: manifest.activation?.tier ?? null, language: manifest.activation?.language ?? null, capability: manifest.activation?.capability ?? null, row: judged.row, verdict: judged.verdict } : null);

const unverifiedOf = (round) => [
  "Host metrics (model, turns, cost, tool calls) are what the host reported in its own output; a selection is read off the stream the controller captured, held to the trail Orbit's hooks wrote.",
  "A router's suggestion is never a selection: its accuracy is measured apart, from the trail's own prompt.submitted.",
  ...(round?.driver && round.driver !== "coding-host" ? [`This run was driven by the scripted ${round.driver} host -- a control of the judge, never a measure of a model.`] : []),
  ...(round?.interrupted ? ["The host's round was interrupted before the controller saw it end: what it left was read back and judged."] : []),
];

export function activationReportOf(room, manifest, view, steps, ending, leaks = null) {
  const host = stepOfType(view, steps, "benchmark.activation");
  const judged = docRead(room, "judged.json");
  const rounds = ((round) => (round ? [round] : []))(roundOf(host, triedOf(view)));
  const json = { schema: 1, kind: "activation", run: manifest.run, task: manifest.task, outcome: ending?.outcome ?? view.lifecycle, summary: ending?.summary ?? null, cause: ending?.cause ?? null, class: ending?.class ?? null, hostBasis: activationBasisOf(manifest.config), label: `${manifest.activation?.tier ?? "an"} case on the ${manifest.config?.arm ?? "release"} arm (${manifest.activation?.language ?? "?"})`, lifecycle: view.lifecycle, stopReason: view.stopReason, source: manifest.source, subject: manifest.subject, fixture: manifest.fixture ?? null, plugin: manifest.plugin ?? null, benchmark: manifest.benchmark, measures: manifest.activation ?? null, images: manifest.images, host: manifest.host, config: manifest.config, seed: stepOfType(view, steps, "benchmark.target")?.doc ?? null, rounds, totals: totalsOf(rounds), judged, activation: factsOf(manifest, judged), tools: runToolsOf(room, manifest, ending), unverified: unverifiedOf(rounds[0] ?? null), diagnosis: diagnosisOf({ manifest, ending, rounds, relay: null }), leaks: (leaks?.files ?? []).map((f) => `${f.rel} (${f.done})`), evidence: room.dir };
  return { json, md: markdownOf(json) };
}

// ---- in words ----------------------------------------------------------------------------------------------------------------

const yes = (v) => (v === null || v === undefined ? "n/a" : v ? "yes" : "no");

const listSaid = (xs) => (xs?.length ? xs.join(", ") : "none");

const agentsSaid = (agents) => listSaid(Object.entries(agents ?? {}).map(([a, n]) => `${a}×${n}`));

const roundLines = (r) => (r ? [`- driven by: ${val(r.driver)}${r.interrupted ? " (interrupted, read back)" : ""}`, `- host model ${val(r.host?.model)}, ${val(r.host?.turns)} turns, ${val(r.host?.toolCalls)} tool calls, cost ${val(r.host?.costUsd)} USD (reported)${r.timedOut ? "; stopped at the round's deadline" : ""}${r.error ? `; ${r.error}` : ""}`] : ["- no round ran"]);

const observedLines = (j) => (j ? [`- activated: ${yes(j.observed.activated)}; strategy ${j.observed.strategy}${j.observed.how ? ` (${j.observed.how})` : ""}`, `- skills: ${listSaid(j.observed.skills)}; agents: ${agentsSaid(j.observed.agents)}`, `- switched off and refused (counted, never failed): ${listSaid(j.observed.disabled.filter((d) => !d.dispatched).map((d) => d.name))}; dispatched anyway: ${listSaid(j.observed.disabled.filter((d) => d.dispatched).map((d) => d.name))}`, `- read-only breaches: ${j.observed.breaches.length}; forbidden commands: ${j.observed.forbidden.length}`, `- the stream and the trail: ${j.agreement.verdict} (by ${j.agreement.by})`, `- the router: ${j.router.strategy ?? j.router.top ?? "said nothing"}${j.router.top ? ` → ${j.router.top}` : ""}; right by the truth: ${yes(j.router.right)}`] : ["- not judged: the run ended before a verdict"]);

const recordLines = (j) => (j?.records?.length ? j.records.map((r) => `- ${r.ok ? "holds" : "DOES NOT HOLD"} \`${r.id}\` (${r.read}): ${r.says}`) : ["- no record row applies on this arm"]);

const outcomeLines = (j) => (j?.outcome ? [`- delivered by: ${j.outcome.delivered}; ${j.outcome.changes} change(s); hidden checks ${j.outcome.held ? "hold" : "do not hold"} — ${j.outcome.says}`] : ["- a selection case: no hidden checks"]);

function markdownOf(j) {
  return [`# Activation benchmark run ${j.run} — ${j.outcome}`, "", `${j.summary ?? ""}`, "", `**${j.label}.** Case ${j.benchmark.case} ${j.benchmark.version} (suite ${j.benchmark.suite} ${j.benchmark.suiteVersion}), measuring ${val(j.measures?.capability)}. Host basis ${j.hostBasis}. Task ${j.task}: ${j.lifecycle}${j.stopReason ? ` (${j.stopReason})` : ""}.`, "", `Verdict row ${val(j.judged?.row)}${j.class ? ` (${j.class})` : ""}: ${val(j.judged?.why)}.`, "", "## Inputs, frozen", "", `- source: ${val(j.source.branch)}@${j.source.commit} (${j.source.mode}), digest ${j.source.digest}`, `- target: ${val(j.fixture?.id)}, variant ${j.benchmark.variant}, digest ${j.subject.digest}; seeded ${yes(Boolean(j.seed))}`, `- plugin: arm ${val(j.config?.arm)}${j.plugin?.revision?.named ? `, revision ${j.plugin.revision.named} (${String(j.plugin.revision.commit).slice(0, 12)})` : ""}; switches ${listSaid(Object.entries(j.measures?.switches ?? {}).map(([k, v]) => `${k}=${v}`))}`, `- images: runner ${val(j.images?.runner)} (Claude Code ${val(j.images?.claudeCode)}); docker ${val(j.host?.docker)}`, `- config: model ${val(j.config.model)}, effort ${effortSaid(j.config.effort)}, minutes ${j.config.minutes}, usd ${j.config.usd}`, "", "## The host's round", "", ...roundLines(j.rounds[0]), "", "## What the host did", "", ...observedLines(j.judged), "", "## The owners' records", "", ...recordLines(j.judged), "", "## The outcome", "", ...outcomeLines(j.judged), "", ...toolsMarkdown(j.tools), "## Diagnosis", "", ...diagnosisLines(j.diagnosis), "", "## Not verified", "", ...j.unverified.map((u) => `- ${u}`), "", `Evidence: ${j.evidence}`, ""].join("\n");
}
