// THE REPORT of a benchmark run: everything a person needs to read what happened and run it again -- read off the run's
// own records (its manifest, its task's journal, the evidence kept by action) and never computed again. It keeps apart
// what is easily blurred: whether the code is right, whether Orbit did the work, whether nobody had to step in, what
// blocked the run, and whether the benchmark itself held. A number the host reported says so, and a number nobody
// reported is `unknown` -- never estimated, and never traded for correctness.
//
//   reportOf(room, manifest, view, steps) -> { json, md }
const UNKNOWN = "unknown";

const val = (v) => (v === null || v === undefined || v === "" ? UNKNOWN : v);

const sum = (xs) => (xs.some((x) => typeof x !== "number") ? null : xs.reduce((a, b) => a + b, 0));

// ---- what the evidence documents say ---------------------------------------------------------------------------------------

const stepsOfType = (view, steps, type) => (view.actions ?? []).filter((a) => a.type === type && steps[a.id]).map((a) => ({ act: a, doc: steps[a.id] }));

const verificationsOf = (view, steps) => stepsOfType(view, steps, "benchmark.verify").map(({ act, doc }) => ({ act: act.id, label: doc.label, state: act.state, digest: doc.digest, complete: doc.complete, failures: doc.failures.length, signature: doc.signature, hidden: { passed: doc.hidden.checks.filter((c) => c.ok).length, total: doc.hidden.checks.length, error: doc.hidden.error?.code ?? null, failingGroups: [...new Set(doc.hidden.checks.filter((c) => !c.ok).map((c) => c.group))] }, gates: doc.gates.map((g) => ({ id: g.id, ok: g.ok, end: g.end, tests: g.tap?.tests ?? null, failed: g.tap?.fail ?? null, why: g.why })), agent: doc.agent ? { tests: doc.agent.rels, failsBefore: doc.agent.before.failed, passesAfter: doc.agent.after.ok } : null, attested: (doc.hidden.attested ?? []).every((r) => r.ok) }));

const lastOfType = (acts, type) => acts.filter((a) => a.type === type).at(-1) ?? null;

const engineeringIn = (j) => ({ id: j.task?.id ?? null, lifecycle: j.lifecycle, stage: j.stage, stopReason: j.stopReason, attempts: (j.attempts ?? []).length, commit: (j.receipts ?? []).find((r) => r.domain === "commit")?.ref ?? null, decisions: (j.decisions ?? []).length });

const inspectionOf = (doc) => (doc ? { engineering: doc.task?.json ? engineeringIn(doc.task.json) : null, found: doc.inspect?.found ?? null, tasks: (doc.tasks?.json?.tasks ?? []).length, changes: (doc.inspect?.changes ?? []).length, trace: doc.trace?.json ?? null } : null);

// A round's repair as its evidence says -- or, for a round the controller never saw end, only that it was interrupted:
// what its host would have reported was never read, and stays unknown.
const repairFields = (act, doc) => ({ act: act?.id ?? null, state: act?.state ?? null, interrupted: Boolean(act) && !doc, engineeringTask: doc?.start?.task ?? doc?.runner?.task ?? null, egress: doc?.start?.egress ?? doc?.runner?.egress ?? null, host: doc?.host ?? null, timedOut: doc?.container?.timedOut ?? null, error: doc?.error?.says ?? null, runnerAttested: (doc?.container?.attested ?? []).every((r) => r.ok), egressAttested: (doc?.egress?.attested ?? []).every((r) => r.ok) });

// One round per repair attempt, its repair and its read-back taken from that attempt's own actions -- never paired by
// position, which an interrupted round would shift.
function roundOf(view, steps, att, round) {
  const acts = (view.actions ?? []).filter((a) => a.attempt === att.id);
  const repair = lastOfType(acts, "benchmark.repair");
  const read = lastOfType(acts.filter((a) => steps[a.id]), "benchmark.inspect");
  return { round, attempt: att.id, outcome: att.outcome ?? null, ...repairFields(repair, repair ? (steps[repair.id] ?? null) : null), inspection: inspectionOf(read ? steps[read.id] : null) };
}

const roundsOf = (view, steps) => (view.attempts ?? []).slice(1).map((att, i) => roundOf(view, steps, att, i + 1));

// ---- the five things kept apart -------------------------------------------------------------------------------------------

const finalOf = (vs) => vs.at(-1) ?? null;

const intervened = (view) => (view.approvals ?? []).length > 0 || ["PAUSED", "CANCELLED"].includes(view.lifecycle);

function axesOf(manifest, view, ending, vs, rounds) {
  const fin = finalOf(vs);
  const read = rounds.map((r) => r.inspection).filter(Boolean).at(-1) ?? null;
  const eng = read?.engineering ?? null;
  return {
    correct: fin ? fin.complete && fin.failures === 0 : null,
    throughOrbit: manifest.config.repair ? { value: Boolean(eng && eng.attempts > 0 && read.changes > 0), basis: "REPORTED — read from the runner's store, which the coding host could also write" } : { value: null, basis: "no repair was asked for" },
    autonomous: manifest.config.repair ? { value: ending?.outcome === "REPAIRED_VERIFIED" && eng?.lifecycle === "COMPLETED" && !intervened(view), basis: "the engine completed its own task, the verifier passed the candidate, and no person approved, paused or cancelled" } : { value: null, basis: "no repair was asked for" },
    blocker: ending?.outcome === "BLOCKED" ? ending.summary : null,
    benchmarkInvalid: ending?.outcome === "BENCHMARK_INVALID" ? ending.summary : null,
  };
}

const unverifiedOf = (manifest, rounds) => [
  "Host metrics (model, turns, cost, tokens, tool calls) are what the host reported in its own output, in a container the agent also wrote to.",
  ...(manifest.config.repair ? ["Whether the work went through Orbit is read from the runner's store, which the agent could write: the verifier's verdict on the candidate does not rest on it."] : []),
  ...(rounds.some((r) => !r.inspection?.trace || Object.keys(r.inspection.trace).length === 0) ? ["Attribution (which skill or agent carried the work): unknown where the session trail is empty or was not read."] : []),
  ...rounds.filter((r) => r.interrupted).map((r) => `Round ${r.round} was interrupted before the controller saw it end: what its host would have reported (model, turns, cost, tool calls) was never read and stays unknown; what it left was read back and judged.`),
  ...(rounds.some((r) => r.egress && r.egress.holds !== true) ? ["A round's network did not hold to what a round needs, and its host did not run."] : []),
];

// ---- the report ------------------------------------------------------------------------------------------------------------

export function reportOf(room, manifest, view, steps, ending, leaks = null) {
  const vs = verificationsOf(view, steps);
  const rounds = roundsOf(view, steps);
  const json = { schema: 1, run: manifest.run, task: manifest.task, outcome: ending?.outcome ?? view.lifecycle, summary: ending?.summary ?? null, label: manifest.benchmark.variant === "real" ? "real source" : `controlled fault (${manifest.benchmark.variant}): planted, not a defect found in the source`, lifecycle: view.lifecycle, stopReason: view.stopReason, source: manifest.source, subject: manifest.subject, benchmark: manifest.benchmark, images: manifest.images, host: manifest.host, config: manifest.config, budget: view.budget, attempts: (view.attempts ?? []).map((a) => ({ id: a.id, cause: a.cause, outcome: a.outcome, signature: a.failureSignature })), verifications: vs, rounds, changes: view.changes, axes: axesOf(manifest, view, ending, vs, rounds), totals: totalsOf(rounds), unverified: unverifiedOf(manifest, rounds), leaks: (leaks?.files ?? []).map((f) => `${f.rel} (${f.done})`), evidence: room.dir };
  return { json, md: markdownOf(json) };
}

const totalsOf = (rounds) => (rounds.length ? { rounds: rounds.length, costUsd: sum(rounds.map((r) => r.host?.costUsd)), turns: sum(rounds.map((r) => r.host?.turns)), toolCalls: sum(rounds.map((r) => r.host?.toolCalls)), durationMs: sum(rounds.map((r) => r.host?.durationMs)), basis: "REPORTED" } : { rounds: 0, costUsd: null, turns: null, toolCalls: null, durationMs: null, basis: "no host ran" });

// ---- in words -----------------------------------------------------------------------------------------------------------

const yes = (v) => (v === null || v === undefined ? "n/a" : v ? "yes" : "no");

const vLine = (v) => `- ${v.label}: ${v.complete ? (v.failures ? "FAIL" : "PASS") : "INCOMPLETE"} — hidden ${v.hidden.passed}/${v.hidden.total}${v.hidden.error ? ` (${v.hidden.error})` : ""}; gates ${v.gates.map((g) => `${g.id} ${g.ok ? "pass" : "fail"} (${g.end}${g.tests === null ? "" : `, ${g.tests} tests`})`).join(", ")}${v.agent ? `; own test fails before ${yes(v.agent.failsBefore)}, passes after ${yes(v.agent.passesAfter)}` : ""}; tree ${v.digest.slice(0, 12)}; signature ${val(v.signature)}${v.hidden.failingGroups.length ? `; failing: ${v.hidden.failingGroups.join(", ")}` : ""}`;

const rLine = (r, ins = r.inspection) => `- round ${r.round}${r.interrupted ? " (interrupted, read back)" : ""}: engineering task ${val(r.engineeringTask ?? ins?.engineering?.id)} → ${val(ins?.engineering?.lifecycle)}${ins?.engineering?.stopReason ? ` (${ins.engineering.stopReason})` : ""}, ${val(ins?.engineering?.attempts)} attempt(s), commit ${val(ins?.engineering?.commit)}; host model ${val(r.host?.model)}, ${val(r.host?.turns)} turns, ${val(r.host?.toolCalls)} tool calls, cost ${val(r.host?.costUsd)} USD (reported)${r.timedOut ? "; stopped at the round's deadline" : ""}${r.error ? `; ${r.error}` : ""}; egress held ${yes(r.egress?.holds)}`;

function markdownOf(j) {
  return [`# Benchmark run ${j.run} — ${j.outcome}`, "", `${j.summary ?? ""}`, "", `**${j.label}.** Case ${j.benchmark.case} ${j.benchmark.version} (suite ${j.benchmark.suite} ${j.benchmark.suiteVersion}), variant ${j.benchmark.variant}, repair ${yes(j.config.repair)}. Task ${j.task}: ${j.lifecycle}${j.stopReason ? ` (${j.stopReason})` : ""}.`, "", "## Inputs, frozen", "", `- source: ${val(j.source.branch)}@${j.source.commit} (${j.source.mode}${j.source.dirty.length ? `, ${j.source.dirty.length} uncommitted path(s) at freeze` : ""}), digest ${j.source.digest}`, `- subject: digest ${j.subject.digest}, ${j.subject.files} files, faults ${j.subject.faults.join(", ") || "none"}, excluded ${j.subject.excluded.length} harness file(s), commit ${j.subject.commit}`, `- benchmark: case digest ${j.benchmark.digest}, harness digest ${j.benchmark.harness}`, `- images: verifier ${val(j.images?.verifier)}, runner ${val(j.images?.runner)} (Claude Code ${val(j.images?.claudeCode)}); docker ${val(j.host.docker)}`, `- config: seed ${j.config.seed}, model ${val(j.config.model)}, rounds ${j.config.rounds}, minutes ${j.config.minutes}, usd ${j.config.usd}`, "", "## Before and after", "", ...j.verifications.map(vLine), "", "## Repair rounds", "", ...(j.rounds.length ? j.rounds.map((r) => rLine(r)) : ["- none"]), "", `Changes: ${j.changes?.files ?? 0} file(s) +${j.changes?.added ?? 0} -${j.changes?.removed ?? 0}${(j.changes?.paths ?? []).length ? ` (${j.changes.paths.map((p) => p.path).join(", ")})` : ""}. Patch: ${j.evidence}/rounds/<k>/candidate.patch.`, "", "## Kept apart", "", `- correct code: ${yes(j.axes.correct)}`, `- went through Orbit: ${yes(j.axes.throughOrbit.value)} — ${j.axes.throughOrbit.basis}`, `- autonomous end to end: ${yes(j.axes.autonomous.value)} — ${j.axes.autonomous.basis}`, `- blocker: ${j.axes.blocker ?? "none"}`, `- benchmark invalid: ${j.axes.benchmarkInvalid ?? "no"}`, `- credential in the run's room: ${j.leaks.length ? `found in ${j.leaks.length} file(s), masked: ${j.leaks.join(", ")}` : "none found"}`, "", `Totals (reported): ${j.totals.rounds} round(s), cost ${val(j.totals.costUsd)} USD, ${val(j.totals.turns)} turns, ${val(j.totals.toolCalls)} tool calls, ${val(j.totals.durationMs)} ms.`, "", "## Not verified", "", ...j.unverified.map((u) => `- ${u}`), "", `Evidence: ${j.evidence}`, ""].join("\n");
}
