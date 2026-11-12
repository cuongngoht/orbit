// THE REPORT of a campaign, read from its frozen campaign.json and its journal alone: per arm, how many runs were
// gradable and how many resolved, the rate, regressions, FALSE_DONE, empty patches, timeouts and budget stops, every
// INFRA_ERROR listed (never counted in a rate), median cost and minutes, interventions (a last message that asked the
// person something), and how much of the plugin each arm used; then, task by task, every arm's outcome side by side.
// With n this small a one-task difference is noise, and the report says so.
//
//   reportOf(room) -> report      markdownOf(report) -> text      writtenReport(room) -> report (report.json, REPORT.md)
import { join } from "node:path";
import { foldJournal, ledgerOf, readJournal } from "../core/journal.mjs";
import { RATED, WORDS } from "../core/outcome.mjs";
import { median, readJson, writeJson, writeText } from "../core/util.mjs";

const finalOf = (s) => (s?.outcome ? s.outcome : null);

const endedOf = (s) => (s?.outcome ? s.attempts.find((a) => a.n === s.outcome.attempt)?.ended ?? null : null);

function rowsOf(campaign, fold) {
  return campaign.plan.map((r) => {
    const s = fold.runs.get(r.key);
    const o = finalOf(s);
    const e = endedOf(s);
    return { ...r, word: o?.word ?? (s?.skipped ? "NOT_RUN" : "PENDING"), why: o?.why ?? s?.skipped?.reason ?? null, attempts: s?.attempts.length ?? 0, interrupted: s?.attempts.filter((a) => a.interrupted).length ?? 0, costUsd: e?.summary?.costUsd ?? null, chargedUsd: e?.chargedUsd ?? null, minutes: typeof e?.wallMs === "number" ? e.wallMs / 60000 : null, turns: e?.summary?.turns ?? null, tokens: e?.summary?.tokens ?? null, denials: e?.summary?.denials ?? null, asked: e?.summary?.asked ?? null, saidDone: o?.saidDone ?? null, status: e?.summary?.status ?? null, tools: e?.summary?.tools ?? null, orbit: e?.summary?.orbit ?? null, plugins: e?.summary?.plugins ?? null, patchBytes: e?.patch?.bytes ?? null, touchedTests: (e?.patch?.paths ?? []).filter((p) => /(^|\/)tests?\//.test(p) || /test_|_test\.|\.test\./.test(p)), infra: e?.infra ?? null };
  });
}

const sum = (xs) => xs.reduce((a, b) => a + (b ?? 0), 0);

const count = (rows, word) => rows.filter((r) => r.word === word).length;

function armSummary(arm, rows) {
  const done = rows.filter((r) => WORDS.includes(r.word));
  const gradable = done.filter((r) => RATED.includes(r.word));
  const resolved = count(gradable, "RESOLVED");
  return {
    arm,
    runs: rows.length,
    ended: done.length,
    gradable: gradable.length,
    resolved,
    rate: gradable.length ? resolved / gradable.length : null,
    words: Object.fromEntries(WORDS.map((w) => [w, count(done, w)])),
    infraErrors: done.filter((r) => r.word === "INFRA_ERROR").map((r) => ({ key: r.key, why: r.why })),
    notRun: rows.filter((r) => r.word === "NOT_RUN" || r.word === "PENDING").map((r) => ({ key: r.key, word: r.word, why: r.why })),
    medianCostUsd: median(gradable.map((r) => r.costUsd)),
    medianMinutes: median(gradable.map((r) => r.minutes)),
    chargedUsd: sum(done.map((r) => r.chargedUsd)),
    interventions: gradable.filter((r) => r.asked === true).length,
    usage: { skillCalls: sum(gradable.map((r) => sum(Object.values(r.tools?.skills ?? {})))), agentCalls: sum(gradable.map((r) => sum(Object.values(r.tools?.agents ?? {})))), pluginCommands: sum(gradable.map((r) => r.orbit?.commands ?? 0)), runsWithPluginLoaded: gradable.filter((r) => (r.plugins ?? []).length > 0).length },
  };
}

function pairwise(campaign, rows) {
  const arms = Object.keys(campaign.arms);
  const tasks = [...new Set(rows.map((r) => r.task))];
  return tasks.map((task) => ({ task, arms: Object.fromEntries(arms.map((a) => [a, rows.filter((r) => r.task === task && r.arm === a && !r.track).map((r) => r.word)])) }));
}

export function reportOf(room) {
  const campaign = readJson(join(room, "campaign.json"));
  const fold = foldJournal(readJournal(join(room, "journal.jsonl")));
  const rows = rowsOf(campaign, fold);
  const arms = Object.keys(campaign.arms).map((a) => armSummary(a, rows.filter((r) => r.arm === a)));
  return { campaign: { id: campaign.id, model: campaign.model ?? null, effort: campaign.effort ?? null, limits: campaign.limits, budgetUsd: campaign.budgetUsd, claudeCode: campaign.claudeCode, evaluator: campaign.evaluator, arms: campaign.arms, tasks: campaign.tasks, frozenAt: campaign.frozenAt }, ledger: ledgerOf(fold, campaign.budgetUsd), finished: Boolean(fold.finished), arms, pairwise: pairwise(campaign, rows), runs: rows };
}

const pct = (x) => (x === null ? "—" : `${(100 * x).toFixed(0)}%`);

const val = (x, d = 2) => (x === null || x === undefined ? "—" : typeof x === "number" ? x.toFixed(d) : String(x));

const armLine = (a) => `| ${a.arm} | ${a.resolved} / ${a.gradable} | ${pct(a.rate)} | ${a.words.REGRESSED} | ${a.words.FALSE_DONE} | ${a.words.EMPTY_PATCH} | ${a.words.UNRESOLVED} | ${a.words.TIMEOUT} | ${a.words.BUDGET} | ${a.words.UNGRADABLE} | ${a.words.INFRA_ERROR} | ${val(a.medianCostUsd)} | ${val(a.medianMinutes, 1)} | ${a.interventions} | ${a.usage.skillCalls} / ${a.usage.agentCalls} / ${a.usage.pluginCommands} |`;

const armSpec = (id, a) => `- \`${id}\`: ${a.kind}${a.rev ? ` @ ${a.rev}` : ""}${a.frozen?.commit ? ` (commit ${a.frozen.commit.slice(0, 12)})` : ""}${a.behaviour ? ` — ${a.behaviour}${a.patch ? ` ${a.patch}` : ""}, says ${a.status ?? "DONE"}` : ""}`;

const orNone = (lines) => (lines.length ? lines : ["- none"]);

export function markdownOf(r) {
  const arms = Object.keys(r.campaign.arms);
  return [
    `# Campaign ${r.campaign.id}`,
    "",
    `Model ${r.campaign.model ?? "—"} at effort ${r.campaign.effort ?? "—"}; Claude Code ${r.campaign.claudeCode}; limits per run: $${r.campaign.limits.usd}, ${r.campaign.limits.turns} turns, ${r.campaign.limits.minutes} min, ${r.campaign.limits.cpus} CPU, ${r.campaign.limits.memoryMb} MB. Budget $${r.campaign.budgetUsd}: charged $${r.ledger.chargedUsd}, ${r.ledger.remainingUsd < 0 ? "over" : "left"} $${Math.abs(r.ledger.remainingUsd)}. Evaluator ${r.campaign.evaluator?.commit?.slice(0, 12) ?? "unknown"}${r.campaign.evaluator?.dirty ? " (with uncommitted changes)" : ""}. ${r.finished ? "Finished." : "NOT finished."}`,
    "",
    "## Arms",
    "",
    ...arms.map((id) => armSpec(id, r.campaign.arms[id])),
    "",
    "## Per arm",
    "",
    "Rate = RESOLVED / gradable; INFRA_ERROR is the environment's and is excluded from every rate. Usage = Skill calls / Agent calls / plugin CLI commands.",
    "",
    "| arm | resolved | rate | regressed | false done | empty | unresolved | timeout | budget | ungradable | infra | median $ | median min | interventions | usage |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...r.arms.map(armLine),
    "",
    "## Task by task",
    "",
    `| task | ${arms.join(" | ")} |`,
    `|---|${arms.map(() => "---").join("|")}|`,
    ...r.pairwise.map((p) => `| ${p.task} | ${arms.map((a) => p.arms[a].join(", ") || "—").join(" | ")} |`),
    "",
    "## Infrastructure errors and runs not run",
    "",
    ...orNone(r.arms.flatMap((a) => [...a.infraErrors.map((i) => `- ${i.key}: INFRA_ERROR — ${i.why}`), ...a.notRun.map((n) => `- ${n.key}: ${n.word}${n.why ? ` — ${n.why}` : ""}`)])),
    "",
    "## What this does not show",
    "",
    "- With a handful of tasks per arm, a difference of one task is noise: this is a measured baseline, not a proof that one arm is better.",
    "- Cost, tokens and turns are what the coding host reported in its own result line; an outcome is never decided by the host's word.",
    "- An arm with a plugin runs the plugin's hooks and commands as well as the task: the extra context and latency they add are part of what is measured.",
    "",
  ].join("\n");
}

export function writtenReport(room) {
  const r = reportOf(room);
  writeJson(join(room, "report.json"), r);
  writeText(join(room, "REPORT.md"), markdownOf(r));
  return r;
}
