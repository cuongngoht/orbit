// QA: every investigation begun against a task this viewer follows, from its ALLOW-LISTED activity only
// (src/investigation/activity.mjs -- never a header, a body, a cookie or a query). A finding keeps the owner's
// word and confidence: SUSPECTED is not CONFIRMED, INCONCLUSIVE is not passed.
import { testCountsOf } from "../../current.mjs";
import { dim, joined, num, pulseOf, row, seg, str } from "./parts.mjs";

export const FINDING_TONES = Object.freeze({ CONFIRMED_DEFECT: "danger", SUSPECTED_DEFECT: "warning", REQUIRES_REQUIREMENT: "warning", INCONCLUSIVE: "subtle", BLOCKED: "warning", OBSERVED_EXPECTED_BEHAVIOR: "success" });

const SHOWN = 2;

const merged = (ctx) => ({ ...(ctx.d.child?.qa ?? {}), ...(ctx.d.root?.qa ?? {}) });

const eventsOf = (ctx) => [...(ctx.d.root?.events ?? []), ...(ctx.d.child?.events ?? [])];

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function headOf(q) {
  const state = q.ended ? seg(`ended ${q.ended.lifecycle ?? ""}`.trim(), "subtle") : seg("running", "info");
  return row(joined([seg(q.id, "brand"), str(q.mode) && dim(q.mode), seg(plural(q.steps, "step")), seg(`runs ${q.runs.passed} ✓ ${q.runs.failed} ✗`, q.runs.failed ? "danger" : undefined), q.consoleErrors ? seg(plural(q.consoleErrors, "console error"), "warning") : null, seg(plural(q.findings, "finding"), q.findings ? "warning" : undefined), state]));
}

function stepRow(ctx, q) {
  const step = q.step ? `→ ${q.step.verb} ${q.step.on ?? ""}`.trim() : "→ starting";
  const failure = q.lastFailure ? seg(`   last failed ${q.lastFailure.method ?? "?"} ${q.lastFailure.endpoint ?? "?"} ${num(q.lastFailure.status) ?? ""}`.trimEnd(), "danger") : null;
  return row([seg(step), q.ended ? null : seg(` ${pulseOf(ctx.nowMs)}`, "info"), failure]);
}

// A generated test's progress, counted per obligation (current.mjs testCountsOf): how many are
// satisfied, contradicted and running of how many -- or, while discovery is still open and the
// total is not known, only how many are done. Nothing at all before the first test event: an
// unknown is never drawn as 0.
function testsRow(q) {
  const c = testCountsOf(q);
  if (!c) return [];
  const words = c.discovering ? [seg(`tests ${c.done} done`), dim(" · discovering")] : [seg(`tests ${c.satisfied} satisfied`, c.satisfied ? "success" : undefined), dim(" · "), seg(`${c.contradicted} contradicted`, c.contradicted ? "danger" : undefined), dim(" · "), seg(`${c.running} running of ${c.total}`)];
  return [row(words)];
}

function findingRow(ctx, q) {
  const f = eventsOf(ctx).filter((e) => e.source === q.id && e.kind === "qa.finding").at(-1);
  return f ? [row([seg(`⚠ finding ${f.outcome ?? "?"} ${f.confidence ?? ""}`.trimEnd(), FINDING_TONES[f.outcome] ?? "warning"), f.reproduced === true ? dim(" · reproduced") : null, str(f.say) ? dim(` · ${f.say}`) : null])] : [];
}

const started = (a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0);

export function qaSection(ctx) {
  const all = Object.values(merged(ctx)).sort(started).slice(-SHOWN);
  if (!all.length || ctx.state.viewer.settings?.terminal?.showQa === false) return null;
  return { name: "qa", rows: all.flatMap((q) => [headOf(q), ...testsRow(q), stepRow(ctx, q), ...findingRow(ctx, q)]) };
}
