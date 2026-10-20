// ACTIVITY (1.8.5, ADR 0020): what the task is doing NOW, in the first rows a person reads -- what runs, why, where
// and how, how far a check's runner has reported, the latest failure it printed, how long since it last printed, and
// what comes next. With nothing running it is what ended last and what it came to. Every word is a field of the task's
// journal or of a check's observation (src/live/activity.mjs); a total is shown only when the runner said one, a case
// is shown as what it was REPORTED to come to, never as "running now", and an action that reports nothing shows its
// time alone -- never a bar over time.
import { focusOf, progressWords } from "../../activity.mjs";
import { ABSENT, between, dim, joined, num, pulseOf, row, seg, since, str } from "./parts.mjs";

const SHOWN_CASES = 6;

const CASE_MARK = { passed: ["✓", "success"], failed: ["✗", "danger"], skipped: ["-", "subtle"], todo: ["○", "subtle"], cancelled: ["■", "warning"] };

const END_MARK = { succeeded: ["✓", "success", "ENDED"], failed: ["✗", "danger", "FAILED"], error: ["✗", "danger", "COULD NOT RUN"], ended: ["·", "subtle", "ENDED"] };

// The task whose activity is shown: a workflow's engineering task while it runs something, else the task in focus.
export function chosen(ctx) {
  const snaps = [ctx.d.engineering, ctx.d.focus].filter((s, i, all) => s?.view && all.indexOf(s) === i);
  const running = snaps.find((s) => s.activities.some((a) => a.state === "running"));
  return running ?? snaps[0] ?? null;
}

function headRow(ctx, a, snap) {
  const end = END_MARK[a.state] ?? ["?", "subtle", String(a.state ?? ABSENT.unknown).toUpperCase()];
  const mark = a.state === "running" ? [snap.view.terminal ? "·" : pulseOf(ctx.nowMs), "info", "RUNNING"] : end;
  const took = between(a.startedAt, a.endedAt, ctx.nowMs);
  return row([seg(`${mark[0]} `, mark[1]), seg(mark[2], mark[1]), seg(` · ${String(a.kind).toUpperCase()}`, "label"), seg(` · ${a.what}`)], [dim(joined([took && seg(took), a.attempt && seg(attemptWords(snap, a)), seg(a.id)]).map((s) => s.text).join(""))]);
}

const attemptWords = (snap, a) => ((n) => (n ? `attempt ${n}/${snap.view.attempt?.limit ?? "?"}` : a.attempt))(snap.view.attempts?.findIndex((t) => t.id === a.attempt) + 1);

const labelled = (label, segs, extra = {}) => row([dim(`${label.padEnd(9)}`), ...segs], [], extra);

const whyRow = (a) => (a.why ? [labelled("why", [seg(a.why)])] : []);

const whereRow = (a) => (a.where || a.how ? [labelled("where", [seg(joined([str(a.where) && seg(a.where), str(a.how) && dim(a.how)]).map((s) => s.text).join(""))], { detail: true })] : []);

// What a check's runner reported so far -- or, for an action that reports nothing, that it reports nothing.
function progressRows(a) {
  const words = progressWords(a.observation);
  if (!a.observation) return a.state === "running" ? [labelled("progress", [dim("this action reports no progress: only how long it has run")])] : [];
  if (words.aborted) return [labelled("cases", [seg(words.aborted, "warning")])];
  if (words.unavailable) return [labelled("cases", [seg(words.unavailable, "warning")])];
  return [labelled("cases", [seg(words.cases ?? "no case reported yet", words.cases ? undefined : "subtle"), dim(`   ${[words.total, adapterWords(a.observation), words.onlyFailures].filter(Boolean).join(" · ")}`)])];
}

const adapterWords = (obs) => (obs.adapter ? `${obs.adapter.runner ?? obs.adapter.id} · ${obs.adapter.capabilities?.order === "reported" ? "in reported order" : ""}`.replace(/ · $/, "") : null);

function casesRow(a) {
  const recent = (a.observation?.recent ?? []).slice(-SHOWN_CASES).reverse();
  return recent.length ? [labelled("latest", joined(recent.map((r) => ((m) => seg(`${m[0]} ${r.name ?? r.key}${r.before ? ` (was ${r.before})` : ""}`, m[1]))(CASE_MARK[r.state] ?? ["?", "subtle"])), "  "))] : [];
}

function failureRow(a) {
  const f = a.observation?.failures?.[0];
  return f ? [labelled("failed", [seg(`✗ ${f.name ?? f.key}`, "danger"), dim(` — ${f.category}`), seg(f.message ? `: ${String(f.message).replace(/\s+/g, " ")}` : ""), dim(f.location ? `  (${f.location})` : "")])] : [];
}

// When the command last printed: a fact about the output, never a claim that it hangs.
function outputRow(ctx, a) {
  const out = a.observation?.output;
  if (!out || a.state !== "running") return [];
  return [labelled("output", [dim(`${num(out.lines) ?? 0} line(s) · ${out.lastAt ? `last printed ${since(out.lastAt, ctx.nowMs)} ago` : "nothing printed yet"}`)], { detail: true })];
}

const gapRow = (a) => ((g) => (g ? [labelled("note", [seg(g, "warning")])] : []))(a.observation?.gaps?.find((x) => !/printed nothing Orbit reads/.test(x)));

function resultRow(a) {
  if (!a.result) return [];
  return [labelled("result", [seg(a.result.summary ?? a.result.state, END_MARK[a.result.state]?.[1]), a.result.evidence === "reported" ? seg("  reported, no receipt", "warning") : dim(a.result.receipts.length ? `  ← ${a.result.receipts.at(-1)}` : "")])];
}

const nextRow = (a) => (a.next ? [labelled("next", [a.next.decided ? seg(`decided: ${a.next.decided}`, "info") : dim(`awaiting ${a.next.waiting}`)])] : []);

function activityRows(ctx, snap) {
  const a = focusOf(snap.activities);
  if (!a) return [row([dim(snap.view.terminal ? "the task ended without starting an action" : "no action has started yet: the orchestrator decides the first")])];
  return [headRow(ctx, a, snap), ...whyRow(a), ...progressRows(a), ...failureRow(a), ...casesRow(a), ...gapRow(a), ...outputRow(ctx, a), ...whereRow(a), ...resultRow(a), ...nextRow(a)];
}

export function activitySection(ctx) {
  const snap = chosen(ctx);
  return snap ? { name: "activity", rows: activityRows(ctx, snap) } : null;
}
