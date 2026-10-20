// ACTIVITY (`i`, 1.8.5): every action the task in focus started, newest first -- not only the last four checks the
// ENGINEER section has room for. `f` keeps the ones worth finding (running, failed, run again, ended); Enter opens one:
// what, why, where, how, when, how it ended and on what evidence, what came next -- and for a check, what its runner
// reported: the adapter and what it can show, the counts and the runner's own total, the failures with their message,
// location and first lines of stack, the latest cases, and anything the observation could not see. A field nothing
// recorded says NOT RECORDED; an observation is never shown as the verdict -- the receipt is.
import { focusId } from "../model.mjs";
import { progressWords } from "../../activity.mjs";
import { ABSENT, between, clock, dim, joined, row, seg, str } from "../sections/parts.mjs";

export const ACTIVITY_FILTERS = Object.freeze(["all", "running", "failed", "again", "ended"]);

const FILTER_WORDS = { all: "every action", running: "running now", failed: "failed or could not run", again: "run again after a fix or a retest", ended: "ended" };

const MARK = { running: ["▶", "info", "RUNNING"], succeeded: ["✓", "success", "ENDED"], failed: ["✗", "danger", "FAILED"], error: ["✗", "danger", "COULD NOT RUN"], ended: ["·", "subtle", "ENDED"] };

const causeOf = (view, a) => view?.attempts?.find((t) => t.id === a.attempt)?.cause ?? null;

const KEEP = {
  all: () => true,
  running: (a) => a.state === "running",
  failed: (a) => a.state === "failed" || a.state === "error",
  again: (a, view) => ["fix", "retest", "retry"].includes(causeOf(view, a)) || (a.observation?.recent ?? []).some((r) => r.before),
  ended: (a) => a.state !== "running",
};

const markOf = (a) => MARK[a.state] ?? ["?", "subtle", String(a.state ?? ABSENT.unknown).toUpperCase()];

function itemRow(a, nowMs) {
  const m = markOf(a);
  const cases = progressWords(a.observation)?.cases;
  return row([seg(`${m[0]} `, m[1]), seg(m[2].padEnd(14), m[1]), dim(`${a.id.padEnd(8)}`), seg(`${String(a.kind).toUpperCase()} · ${a.what}`)], [dim(joined([seg(between(a.startedAt, a.endedAt, nowMs) ?? ""), cases ? seg(cases) : null]).map((s) => s.text).join(""))]);
}

// ---- one activity, field by field --------------------------------------------------------------------------

const valueOf = (v) => (v === null || v === undefined || v === "" ? ABSENT.unrecorded : String(v));

const field = (name, value, tone) => row([dim(`  ${name.padEnd(12)}`), seg(valueOf(value), valueOf(value) === ABSENT.unrecorded ? "subtle" : tone)]);

const RUNNING_SAYS = { result: "still running: its receipt is written when it ends", next: "decided once it ends" };

const nextWords = (a) => (a.state === "running" ? RUNNING_SAYS.next : a.next ? (a.next.decided ? `decided: ${a.next.decided}` : `awaiting ${a.next.waiting}`) : null);

const resultWords = (a) => (a.state === "running" ? RUNNING_SAYS.result : a.result ? a.result.summary ?? a.result.state : null);

const evidenceWords = (a) => (a.result ? (a.result.receipts.length ? a.result.receipts.join(", ") : "reported, no receipt") : null);

const baseRows = (a, nowMs) => [field("what", a.what), field("why", a.why), field("where", a.where), field("how", a.how), field("state", markOf(a)[2], markOf(a)[1]), field("started", a.startedAt ? clock(a.startedAt) : null), field("took", between(a.startedAt, a.endedAt, nowMs)), field("attempt", a.attempt), field("result", resultWords(a)), field("evidence", evidenceWords(a), a.result?.evidence === "reported" ? "warning" : undefined), field("next", nextWords(a))];

function observedRows(obs) {
  const words = progressWords(obs);
  const adapter = obs.adapter ? `${obs.adapter.framework}${obs.adapter.runner ? ` · ${obs.adapter.runner}` : ""} · cases ${obs.adapter.capabilities?.cases} · total ${obs.adapter.capabilities?.total}` : null;
  return [row([seg("  OBSERVED  ", "label"), dim("what the runner printed while it ran -- the receipt above is the check's word")]), field("read with", adapter), field("cases", words.unavailable ?? words.cases ?? "none reported"), field("total", Number.isInteger(obs.total) ? `${obs.total}, as the runner said` : "not said by the runner"), field("output", obs.output ? `${obs.output.lines} line(s), last printed ${obs.output.lastAt ? clock(obs.output.lastAt) : "-"}` : null), ...obs.gaps.map((g) => field("gap", g, "warning"))];
}

const failureRows = (obs) => (obs.failures ?? []).slice(0, 5).flatMap((f) => [row([seg(`  ✗ ${f.name ?? f.key}`, "danger"), dim(`  ${f.category}${f.location ? ` · ${f.location}` : ""}`)]), ...(f.message ? [row([dim("      "), seg(String(f.message).replace(/\s+/g, " "))])] : []), ...(f.stack ?? []).slice(0, 2).map((l) => row([dim(`      ${l}`)]))]);

const caseRows = (obs) => (obs.recent ?? []).slice(-10).reverse().map((r) => row([seg(`  ${{ passed: "✓", failed: "✗", skipped: "-", todo: "○", cancelled: "■" }[r.state] ?? "?"} `, r.state === "failed" ? "danger" : r.state === "passed" ? "success" : "subtle"), seg(r.name ?? r.key), dim(`${r.suite ? `  ${r.suite}` : ""}${r.before ? `  (was ${r.before})` : ""}`)]));

const detailRows = (a, nowMs) => (a ? [row([dim("─".repeat(8))]), ...baseRows(a, nowMs), ...(a.observation ? [...observedRows(a.observation), ...failureRows(a.observation), ...caseRows(a.observation)] : [])] : []);

// ---- the overlay -------------------------------------------------------------------------------------------

export const activityItems = (state, d) => {
  const snap = [d?.focus, d?.root].find((s) => s?.view?.task?.id === focusId(state)) ?? d?.focus ?? null;
  const filter = state.viewer.inspect?.filter ?? "all";
  return (snap?.activities ?? []).filter((a) => KEEP[filter](a, snap?.view)).reverse();
};

export function activityOverlay(state, d) {
  const items = activityItems(state, d);
  const filter = state.viewer.inspect?.filter ?? "all";
  const lead = [row(joined([seg(focusId(state) ?? "no task", "brand"), dim(`${items.length} shown · ${FILTER_WORDS[filter]}`), dim("f filters · enter opens one · an observation is never the verdict")]))];
  return { title: "ACTIVITY", lead, rows: items.length ? items.map((a) => itemRow(a, state.viewer.nowMs)) : [row([dim(str(filter === "all" ? "no action has started yet" : `none ${FILTER_WORDS[filter]}`))])], selectable: items.length > 0, after: detailRows(items[state.viewer.detail ?? -1] ?? null, state.viewer.nowMs) };
}
