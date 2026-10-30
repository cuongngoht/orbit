// IMPROVE (0.3.0, ADR 0045): a self-improvement campaign the task works for, read only off the campaign's ONE
// projection (src/improvement/views.mjs, handed in as an `improvement-view`): where it stands and who carries it now,
// the mode its stage runs in, the version it would replace beside the candidate, how far the evaluation got against what
// it planned, the promotion gates, a rollback, and what stops it or how it ended. Every count is what the campaign
// recorded; nothing is a percentage, and a verdict is the campaign's word, never a viewer's.
import { dim, joined, row, seg, str } from "./parts.mjs";

const SHOWN = 2;

export const PHASE_TONES = Object.freeze({ COMPLETED: "success", PROMOTED: "success", MONITORING: "info", QUALIFIED: "success", EVALUATING: "info", REJECTED: "warning", ROLLED_BACK: "danger", ROLLING_BACK: "danger", BLOCKED: "warning", AWAITING_AUTHORITY: "warning", INCONCLUSIVE: "subtle" });

const VERDICT_TONES = Object.freeze({ BETTER: "success", WORSE: "danger", EQUIVALENT: "subtle", INCONCLUSIVE: "subtle", BLOCKED: "warning", INTERRUPTED: "warning" });

const campaignsOf = (ctx) => Object.values({ ...(ctx.d.child?.improvement ?? {}), ...(ctx.d.root?.improvement ?? {}) }).sort((a, b) => String(a.startedAt ?? "").localeCompare(String(b.startedAt ?? ""))).slice(-SHOWN);

const headOf = (v) => row(joined([seg(v.id, "brand"), seg(v.phase, PHASE_TONES[v.phase]), seg(`${v.subject.id ?? "?"}`), str(v.pin) && dim(v.pin), v.candidate ? seg(`→ ${v.candidate.pin}`, "info") : null]));

const carrierOf = (v) => row(joined([dim(`mode ${v.mode}`), dim(`carried by ${v.carrier}`), str(v.signal) && dim(`${v.signal} on ${v.signature.join(", ") || "—"}`)]));

const metricsOf = (e) => (e.metrics ? [seg(`baseline met ${e.metrics.baseline.met}/${e.metrics.baseline.runs}`), seg(`candidate met ${e.metrics.candidate.met}/${e.metrics.candidate.runs}`, e.metrics.candidate.met > e.metrics.baseline.met ? "success" : undefined)] : []);

const evaluationRow = (e) => row(joined([seg(e.evaluation), seg(e.verdict ?? (e.open ? "running" : "?"), VERDICT_TONES[e.verdict] ?? "info"), seg(`${e.recorded}${e.planned ? `/${e.planned}` : ""} run(s)`), ...metricsOf(e), str(e.attribution?.join(",")) && dim(e.attribution.join(","))]));

const gatesRow = (v) => (v.gates ? [row(joined([seg(`gates ${v.gates.rows.filter((g) => g.holds).length}/${v.gates.rows.length}`, v.gates.failed ? "warning" : "success"), v.gates.failed ? seg(`✗ ${v.gates.failed}`, "warning") : null]))] : []);

const RESULT = [
  { when: (v) => v.ended, row: (v) => row(joined([seg(`ended ${v.ended.outcome}`, PHASE_TONES[v.phase]), str(v.ended.because) && dim(v.ended.because)])) },
  { when: (v) => v.blocked, row: (v) => row(joined([seg(`⚠ ${v.blocked.stop}`, "warning"), dim(`needs ${v.blocked.needs ?? "a person"}`), str(v.blocked.because) && dim(v.blocked.because)])) },
  { when: (v) => v.rollback, row: (v) => row(joined([seg(`${v.rollback.state} ${v.rollback.from} → ${v.rollback.to}`, "danger")])) },
  { when: (v) => v.promotion, row: (v) => row(joined([seg(`promoted ${v.promotion.from} → ${v.promotion.to}`, "success"), dim(`by ${v.promotion.by}`)])) },
  { when: (v) => v.awaiting, row: (v) => row(joined([seg("awaiting a person in Orbit Control", "warning"), dim(v.awaiting)])) },
];

const resultRows = (v) => ((r) => (r ? [r.row(v)] : []))(RESULT.find((x) => x.when(v)));

const rowsOf = (v) => [headOf(v), carrierOf(v), ...v.evaluations.slice(-2).map(evaluationRow), ...gatesRow(v), ...resultRows(v)];

export function improvementSection(ctx) {
  const all = campaignsOf(ctx);
  if (!all.length) return null;
  return { name: "improvement", rows: all.flatMap(rowsOf) };
}
