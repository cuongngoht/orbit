// THE REPORT of a benchmark run: everything a person needs to read what happened and run it again -- read off the run's
// own records (its manifest, its task's journal, the evidence kept by action) and never computed again. It keeps apart
// what is easily blurred: whether the code is right, whether Orbit did the work, whether nobody had to step in, what
// blocked the run, and whether the benchmark itself held. A number the host reported says so, and a number nobody
// reported is `unknown` -- never estimated, and never traded for correctness. Who carried the rounds is said first
// (HOST BASIS: none, scripted, coding-host): a scripted host's success is conformance of the controller and the engine,
// never a measure of autonomy, and a metric never mixes the two. Whether a person stepped in is read off the run task's
// own events (a pause and a resume leave a COMPLETED task that a person still held).
//
//   reportOf(room, manifest, view, steps, ending, leaks, events) -> { json, md }
import { hostBasisOf } from "./flow.mjs";
import { docRead } from "../core/room.mjs";

const UNKNOWN = "unknown";

const val = (v) => (v === null || v === undefined || v === "" ? UNKNOWN : v);

const sum = (xs) => (xs.some((x) => typeof x !== "number") ? null : xs.reduce((a, b) => a + b, 0));

// ---- what the evidence documents say ---------------------------------------------------------------------------------------

const stepsOfType = (view, steps, type) => (view.actions ?? []).filter((a) => a.type === type && steps[a.id]).map((a) => ({ act: a, doc: steps[a.id] }));

const verificationsOf = (view, steps) => stepsOfType(view, steps, "benchmark.verify").map(({ act, doc }) => ({ act: act.id, label: doc.label, state: act.state, digest: doc.digest, complete: doc.complete, failures: doc.failures.length, signature: doc.signature, hidden: { passed: doc.hidden.checks.filter((c) => c.ok).length, total: doc.hidden.checks.length, error: doc.hidden.error?.code ?? null, failingGroups: [...new Set(doc.hidden.checks.filter((c) => !c.ok).map((c) => c.group))] }, gates: doc.gates.map((g) => ({ id: g.id, ok: g.ok, end: g.end, tests: g.tap?.tests ?? null, failed: g.tap?.fail ?? null, why: g.why })), agent: doc.agent ? { tests: doc.agent.rels, failsBefore: doc.agent.before.failed, passesAfter: doc.agent.after.ok } : null, attested: (doc.hidden.attested ?? []).every((r) => r.ok) }));

const lastOfType = (acts, type) => acts.filter((a) => a.type === type).at(-1) ?? null;

const engineeringIn = (j) => ({ id: j.task?.id ?? null, lifecycle: j.lifecycle, stage: j.stage, stopReason: j.stopReason, attempts: (j.attempts ?? []).length, commit: (j.receipts ?? []).find((r) => r.domain === "commit")?.ref ?? null, decisions: (j.decisions ?? []).length });

// How the session worked, as the trail Orbit's hooks kept: the subagents it started, the skills, the Orbit commands.
const agentsOf = (read) => ((t) => ({ sessions: t?.sessions ?? null, subagents: t?.agents ?? null, skills: t?.skills ?? null, orbitCommands: t?.orbit ?? null }))(read?.trace?.totals);

// Whether the engineering task came through a goal: a goal whose workflow is the task's parent, as the owners' records
// say -- read back from the runner's store, so OBSERVED there and never the verdict's ground.
const throughGoalOf = (doc) => ((parent) => Boolean(parent) && (doc?.goals?.json?.goals ?? []).some((g) => g.task === parent))(doc?.task?.json?.task?.parent ?? null);

const inspectionOf = (doc) => (doc ? { engineering: doc.task?.json ? engineeringIn(doc.task.json) : null, found: doc.inspect?.found ?? null, tasks: (doc.tasks?.json?.tasks ?? []).length, changes: (doc.inspect?.changes ?? []).length, trace: doc.trace?.json ?? null, goals: (doc.goals?.json?.goals ?? []).length, throughGoal: throughGoalOf(doc) } : null);

// A round's repair as its evidence says -- or, for a round the controller never saw end, only that it was interrupted:
// what its host would have reported was never read, and stays unknown.
const repairFields = (act, doc) => ({ act: act?.id ?? null, state: act?.state ?? null, interrupted: Boolean(act) && !doc, engineeringTask: doc?.start?.task ?? doc?.runner?.task ?? null, egress: doc?.start?.egress ?? doc?.runner?.egress ?? null, host: doc?.host ?? null, timedOut: doc?.container?.timedOut ?? null, error: doc?.error?.says ?? null, runnerAttested: (doc?.container?.attested ?? []).every((r) => r.ok), egressAttested: (doc?.egress?.attested ?? []).every((r) => r.ok) });

// What a round's verdict did, as its own outcome document says: what it broke that held, what it fixed, how NEXT read it.
const decidedOf = (room, round) => ((o) => (o ? { next: o.next, class: o.class ?? null, cutShort: o.cutShort === true, regressed: o.regressed ?? [], improved: o.improved ?? [] } : null))(docRead(room, `rounds/${round}/outcome.json`));

const costOf = (r) => (typeof r.host?.costUsd === "number" ? { usd: r.host.costUsd, basis: "REPORTED" } : { usd: null, basis: UNKNOWN });

// One round per repair attempt, its repair and its read-back taken from that attempt's own actions -- never paired by
// position, which an interrupted round would shift.
function roundOf(room, view, steps, att, round) {
  const acts = (view.actions ?? []).filter((a) => a.attempt === att.id);
  const repair = lastOfType(acts, "benchmark.repair");
  const read = lastOfType(acts.filter((a) => steps[a.id]), "benchmark.inspect");
  return ((r) => ({ ...r, cost: costOf(r), decided: decidedOf(room, round) }))({ round, attempt: att.id, outcome: att.outcome ?? null, ...repairFields(repair, repair ? (steps[repair.id] ?? null) : null), inspection: inspectionOf(read ? steps[read.id] : null) });
}

const roundsOf = (room, view, steps) => (view.attempts ?? []).slice(1).map((att, i) => roundOf(room, view, steps, att, i + 1));

// What a person did to the run, read off its task's own events: null when they were not read (an older caller).
const COUNTED = { paused: "paused", resumed: "resumed", cancelled: "cancelled", approvalsAsked: "approval-requested", approvalsGranted: "approval-granted" };

const interventionsOf = (events) => (Array.isArray(events) ? Object.fromEntries(Object.entries(COUNTED).map(([k, kind]) => [k, events.filter((e) => e.kind === kind).length])) : null);

// ---- the five things kept apart -------------------------------------------------------------------------------------------

const finalOf = (vs) => vs.at(-1) ?? null;

const intervened = (view, iv) => (view.approvals ?? []).length > 0 || ["PAUSED", "CANCELLED"].includes(view.lifecycle) || Boolean(iv && Object.values(iv).some((n) => n > 0));

// Autonomy is a coding host's to show: no repair means there is nothing to show, and a scripted host shows the
// controller and the engine hold, never autonomy.
const AUTONOMY = {
  none: () => ({ value: null, basis: "no repair was asked for" }),
  scripted: () => ({ value: null, basis: "a scripted host carried the rounds: conformance of the controller and the engine, never a measure of autonomy" }),
  "coding-host": (x) => ({ value: x.ending?.outcome === "REPAIRED_VERIFIED" && x.eng?.lifecycle === "COMPLETED" && !intervened(x.view, x.iv), basis: "the engine completed its own task, the verifier passed the candidate, and no person approved, paused, resumed or cancelled" }),
};

function axesOf(manifest, view, ending, vs, rounds, iv) {
  const fin = finalOf(vs);
  const read = rounds.map((r) => r.inspection).filter(Boolean).at(-1) ?? null;
  const eng = read?.engineering ?? null;
  return {
    correct: fin ? fin.complete && fin.failures === 0 : null,
    throughOrbit: manifest.config.repair ? { value: Boolean(eng && eng.attempts > 0 && read.changes > 0), basis: "REPORTED — read from the runner's store, which the host could also write" } : { value: null, basis: "no repair was asked for" },
    autonomous: AUTONOMY[hostBasisOf(manifest.config)]({ ending, eng, view, iv }),
    blocker: ending?.outcome === "BLOCKED" ? ending.summary : null,
    benchmarkInvalid: ending?.outcome === "BENCHMARK_INVALID" ? ending.summary : null,
    throughGoal: manifest.benchmark.kind === "engineering" ? { value: read?.throughGoal ?? null, goals: read?.goals ?? null, basis: "OBSERVED — a goal whose workflow started the engineering task, read from the runner's store" } : null,
    agents: manifest.config.repair ? { ...agentsOf(read), basis: "OBSERVED — the session trail Orbit's hooks wrote in the runner store (a scripted host writes none); never a criterion: one agent that reaches the goal is as good as many" } : null,
  };
}

// What the case said the source as it is comes to, and whether this run is news against it: a known finding that
// still fails is evidence kept, a PASS that turned into a FAIL on the real source is a regression found.
const knownOf = (c, manifest, ending) => ({ baseline: c?.baseline ?? null, expects: c?.measures?.expects ?? null, regression: c?.baseline === "PASS" && manifest.benchmark.variant === "real" && ending?.outcome === "FAIL", stillFails: c?.baseline === "FAIL" && manifest.benchmark.variant === "real" && ending?.outcome === "FAIL" });

const unverifiedOf = (manifest, rounds) => [
  "Host metrics (model, turns, cost, tokens, tool calls) are what the host reported in its own output, in a container the agent also wrote to.",
  ...(manifest.config.repair ? ["Whether the work went through Orbit is read from the runner's store, which the agent could write: the verifier's verdict on the candidate does not rest on it."] : []),
  ...(rounds.some((r) => !r.inspection?.trace || Object.keys(r.inspection.trace).length === 0) ? ["Attribution (which skill or agent carried the work): unknown where the session trail is empty or was not read."] : []),
  ...rounds.filter((r) => r.interrupted).map((r) => `Round ${r.round} was interrupted before the controller saw it end: what its host would have reported (model, turns, cost, tool calls) was never read and stays unknown; what it left was read back and judged.`),
  ...(rounds.some((r) => r.egress && r.egress.holds !== true) ? ["A round's network did not hold to what a round needs, and its host did not run."] : []),
];

// ---- the report ------------------------------------------------------------------------------------------------------------

export function reportOf(room, manifest, view, steps, ending, leaks = null, events = null) {
  const vs = verificationsOf(view, steps);
  const rounds = roundsOf(room, view, steps);
  const iv = interventionsOf(events);
  const json = { schema: 1, run: manifest.run, task: manifest.task, outcome: ending?.outcome ?? view.lifecycle, summary: ending?.summary ?? null, cause: ending?.cause ?? null, class: ending?.class ?? null, next: ending?.next ?? null, hostBasis: hostBasisOf(manifest.config), known: knownOf(docRead(room, "frozen/case/case.json"), manifest, ending), label: labelOf(manifest), lifecycle: view.lifecycle, stopReason: view.stopReason, source: manifest.source, subject: manifest.subject, benchmark: manifest.benchmark, images: manifest.images, host: manifest.host, config: manifest.config, budget: view.budget, attempts: (view.attempts ?? []).map((a) => ({ id: a.id, cause: a.cause, outcome: a.outcome, signature: a.failureSignature })), verifications: vs, rounds, changes: view.changes, interventions: iv, verified: docRead(room, "verified.json") ? room.at("verified.json") : null, axes: axesOf(manifest, view, ending, vs, rounds, iv), totals: totalsOf(rounds), unverified: unverifiedOf(manifest, rounds), leaks: (leaks?.files ?? []).map((f) => `${f.rel} (${f.done})`), evidence: room.dir };
  return { json, md: markdownOf(json) };
}

const totalsOf = (rounds) => (rounds.length ? { rounds: rounds.length, costUsd: sum(rounds.map((r) => r.host?.costUsd)), turns: sum(rounds.map((r) => r.host?.turns)), toolCalls: sum(rounds.map((r) => r.host?.toolCalls)), durationMs: sum(rounds.map((r) => r.host?.durationMs)), basis: "REPORTED" } : { rounds: 0, costUsd: null, turns: null, toolCalls: null, durationMs: null, basis: "no host ran" });

// ---- in words -----------------------------------------------------------------------------------------------------------

const yes = (v) => (v === null || v === undefined ? "n/a" : v ? "yes" : "no");

const vLine = (v) => `- ${v.label}: ${v.complete ? (v.failures ? "FAIL" : "PASS") : "INCOMPLETE"} — hidden ${v.hidden.passed}/${v.hidden.total}${v.hidden.error ? ` (${v.hidden.error})` : ""}; gates ${v.gates.map((g) => `${g.id} ${g.ok ? "pass" : "fail"} (${g.end}${g.tests === null ? "" : `, ${g.tests} tests`})`).join(", ")}${v.agent ? `; own test fails before ${yes(v.agent.failsBefore)}, passes after ${yes(v.agent.passesAfter)}` : ""}; tree ${v.digest.slice(0, 12)}; signature ${val(v.signature)}${v.hidden.failingGroups.length ? `; failing: ${v.hidden.failingGroups.join(", ")}` : ""}`;

const decidedLine = (d) => (d ? `; next ${d.next}${d.class ? ` (${d.class})` : ""}${d.regressed.length ? `; REGRESSED ${d.regressed.join(", ")}` : ""}${d.improved.length ? `; improved ${d.improved.join(", ")}` : ""}` : "");

const rLine = (r, ins = r.inspection) => `- round ${r.round}${r.interrupted ? " (interrupted, read back)" : ""}: engineering task ${val(r.engineeringTask ?? ins?.engineering?.id)} → ${val(ins?.engineering?.lifecycle)}${ins?.engineering?.stopReason ? ` (${ins.engineering.stopReason})` : ""}, ${val(ins?.engineering?.attempts)} attempt(s), commit ${val(ins?.engineering?.commit)}; host model ${val(r.host?.model)}, ${val(r.host?.turns)} turns, ${val(r.host?.toolCalls)} tool calls, cost ${val(r.cost?.usd)} USD (${r.cost?.basis ?? "reported"})${r.timedOut ? "; stopped at the round's deadline" : ""}${r.error ? `; ${r.error}` : ""}; egress held ${yes(r.egress?.holds)}${decidedLine(r.decided)}`;

const ivLine = (iv) => (iv ? `paused ${iv.paused}, resumed ${iv.resumed}, cancelled ${iv.cancelled}, approvals asked ${iv.approvalsAsked}, granted ${iv.approvalsGranted}` : UNKNOWN);

const knownLine = (k) => (k.regression ? "REGRESSION — the case expects the source as it is to PASS" : k.stillFails ? "a known finding, still failing: kept as evidence until it is repaired" : `baseline ${val(k.baseline)}`);

// What a goal asks, in place of a cause: the target fails the hidden checks until the change is made, or the goal leaves
// out its rule and the right outcome is to change nothing. Neither is a defect of anything.
const GOAL_SAYS = { change: "asks for a change: the target, as the case declares it, fails the hidden checks until the change is made", blocked: "leaves out the rule it needs: the right outcome is to say so and change nothing" };

const causeLine = (j) => (j.benchmark.kind === "engineering" ? `The goal ${GOAL_SAYS[j.known.expects] ?? "is the case's"} (baseline ${val(j.known.baseline)})` : `Cause ${val(j.cause)}${j.class ? ` (${j.class})` : ""}; ${knownLine(j.known)}`);

const labelOf = (manifest) => (manifest.benchmark.kind === "engineering" ? `the ${manifest.fixture?.id ?? "fixture"} target, ${manifest.benchmark.variant} variant` : manifest.benchmark.variant === "real" ? "real source" : `controlled fault (${manifest.benchmark.variant}): planted, not a defect found in the source`);

function markdownOf(j) {
  return [`# Benchmark run ${j.run} — ${j.outcome}`, "", `${j.summary ?? ""}`, "", `**${j.label}.** Case ${j.benchmark.case} ${j.benchmark.version} (suite ${j.benchmark.suite} ${j.benchmark.suiteVersion}), variant ${j.benchmark.variant}, repair ${yes(j.config.repair)}, host basis ${j.hostBasis}. Task ${j.task}: ${j.lifecycle}${j.stopReason ? ` (${j.stopReason})` : ""}.`, "", `${causeLine(j)}${j.verified ? `; verified candidate: ${j.verified}` : ""}.`, "", "## Inputs, frozen", "", `- source: ${val(j.source.branch)}@${j.source.commit} (${j.source.mode}${j.source.dirty.length ? `, ${j.source.dirty.length} uncommitted path(s) at freeze` : ""}), digest ${j.source.digest}`, `- subject: digest ${j.subject.digest}, ${j.subject.files} files, faults ${j.subject.faults.join(", ") || "none"}, excluded ${j.subject.excluded.length} harness file(s), commit ${j.subject.commit}`, `- benchmark: case digest ${j.benchmark.digest}, harness digest ${j.benchmark.harness}`, `- images: verifier ${val(j.images?.verifier)}, runner ${val(j.images?.runner)} (Claude Code ${val(j.images?.claudeCode)}); docker ${val(j.host.docker)}`, `- config: seed ${j.config.seed}, model ${val(j.config.model)}, rounds ${j.config.rounds}, minutes ${j.config.minutes}, usd ${j.config.usd}`, "", "## Before and after", "", ...j.verifications.map(vLine), "", "## Repair rounds", "", ...(j.rounds.length ? j.rounds.map((r) => rLine(r)) : ["- none"]), "", `Changes: ${j.changes?.files ?? 0} file(s) +${j.changes?.added ?? 0} -${j.changes?.removed ?? 0}${(j.changes?.paths ?? []).length ? ` (${j.changes.paths.map((p) => p.path).join(", ")})` : ""}. Patch: ${j.evidence}/rounds/<k>/candidate.patch.`, "", "## Kept apart", "", `- correct code: ${yes(j.axes.correct)}`, `- went through Orbit: ${yes(j.axes.throughOrbit.value)} — ${j.axes.throughOrbit.basis}`, ...(j.axes.throughGoal ? [`- came through a goal: ${yes(j.axes.throughGoal.value)} (${val(j.axes.throughGoal.goals)} goal(s)) — ${j.axes.throughGoal.basis}`] : []), ...(j.axes.agents ? [`- agents: ${val(j.axes.agents.subagents)} subagent(s), ${val(j.axes.agents.skills)} skill(s), ${val(j.axes.agents.orbitCommands)} Orbit command(s) in ${val(j.axes.agents.sessions)} session(s) — ${j.axes.agents.basis}`] : []), `- autonomous end to end: ${yes(j.axes.autonomous.value)} — ${j.axes.autonomous.basis}`, `- a person stepped in: ${ivLine(j.interventions)}`, `- blocker: ${j.axes.blocker ?? "none"}`, `- benchmark invalid: ${j.axes.benchmarkInvalid ?? "no"}`, `- credential in the run's room: ${j.leaks.length ? `found in ${j.leaks.length} file(s), masked: ${j.leaks.join(", ")}` : "none found"}`, "", `Totals (reported): ${j.totals.rounds} round(s), cost ${val(j.totals.costUsd)} USD, ${val(j.totals.turns)} turns, ${val(j.totals.toolCalls)} tool calls, ${val(j.totals.durationMs)} ms.`, "", "## Not verified", "", ...j.unverified.map((u) => `- ${u}`), "", `Evidence: ${j.evidence}`, ""].join("\n");
}
