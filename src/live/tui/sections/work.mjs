// WORKFLOW (a coordinated workflow's steps, src/automation/) and ENGINEER (an engineering task's stages, checks
// and the action running now). A bar is a COUNT with its denominator: the plan's own step count, read off the
// ACTIVE plan receipt the coordinator wrote; twelve stages. A check says what its owner recorded -- passed, an
// exit code, a timeout -- and whether a receipt backs it or it was only reported.
import { bar, counted } from "../bars.mjs";
import { progressWords } from "../../activity.mjs";
import { DISPATCH_WORDS, STAGE_STRIP, WORKFLOW_GLYPHS } from "../../words.mjs";
import { isCoordinator } from "../model.mjs";
import { ABSENT, between, dim, joined, num, packed, pulseOf, row, seg, str } from "./parts.mjs";

const BAR = 16;

// ---- WORKFLOW ---------------------------------------------------------------------------------------------

const PLAN = /(\d+) step\(s\): (.+)$/;

function planned(view) {
  const receipt = view.receipts.filter((r) => r.domain === "plan" && r.outcome === "ACTIVE").at(-1);
  const m = receipt ? PLAN.exec(receipt.summary ?? "") : null;
  return m ? { total: Number(m[1]), names: m[2].split(",").map((s) => s.trim().replace(/…$/, "")).filter(Boolean) } : null;
}

const stepReceipts = (view) => new Map(view.receipts.filter((r) => r.domain === "step").map((r) => [r.ref, r]));

const STEP_TONES = { SUCCEEDED: "success", FAILED: "danger", BLOCKED: "warning", RUNNING: "info", REPORTED: "warning", SKIPPED: "subtle", PENDING: "subtle" };
const DONE = new Set(["SUCCEEDED", "SKIPPED"]);

const actionOf = (view, id) => (id ? view.actions.find((a) => a.id === id) ?? null : null);

function stepCell(ctx, view, name, receipt) {
  const outcome = receipt?.outcome ?? "PENDING";
  const action = actionOf(view, receipt?.action);
  const running = outcome === "RUNNING" && !view.terminal;
  const owner = running && action ? ` ${DISPATCH_WORDS[action.type]?.word ?? action.type} ${action.tool ?? ""}`.trimEnd() : "";
  return seg(`${name} ${running ? pulseOf(ctx.nowMs) : WORKFLOW_GLYPHS[outcome] ?? "·"}${action ? ` ${between(action.startedAt, action.endedAt, ctx.nowMs) ?? ""}` : ""}${owner}${outcome === "REPORTED" ? " reported" : ""}`.trimEnd(), STEP_TONES[outcome]);
}

// A workflow's steps: the ACTIVE plan's names, then any step a receipt names that the plan did not (1.8.5: the
// workspace pane's checklist reads the same list). Since 1.8.6 the plan its source projected (`projection`, handed
// in from the snapshot) names them whole; its receipt's sentence -- cut at 240 characters -- is what is left when
// the artifact cannot be read.
const fromProjection = (projection) => (projection?.steps?.length ? { total: projection.steps.length, names: projection.steps.map((s) => s.id) } : null);

export function steps(view, projection = null) {
  const plan = fromProjection(projection) ?? planned(view);
  const receipts = stepReceipts(view);
  const names = [...new Set([...(plan?.names ?? []), ...receipts.keys()])];
  return { total: plan?.total ?? (names.length || null), names, receipts };
}

function childWords(ctx) {
  const v = ctx.d.child?.view;
  return ctx.d.childId ? seg(`engineering ${ctx.d.childId} ${v?.lifecycle ?? "reading its journal"}${v?.stage ? ` · ${v.stage}` : ""}`, "info") : dim("no engineering task yet");
}

function verifications(view) {
  const all = view.verification ?? [];
  return all.length ? dim(`${all.filter((x) => x.state === "satisfied").length}/${all.length} verified`) : null;
}

function workflowRows(ctx, view) {
  const s = steps(view, ctx.d.root?.plan);
  const done = s.names.filter((n) => DONE.has(s.receipts.get(n)?.outcome)).length;
  const head = joined([bar(done, s.total, BAR) && seg(bar(done, s.total, BAR), "success"), s.total ? seg(counted(done, s.total, "steps")) : dim("no plan recorded yet"), childWords(ctx), verifications(view)], "  ");
  return [row(head), ...packed(s.names.map((n) => stepCell(ctx, view, n, s.receipts.get(n))), ctx.inner).map((cells) => row(cells))];
}

export const workflowSection = (ctx) => (isCoordinator(ctx.d.root?.view) ? { name: "workflow", rows: workflowRows(ctx, ctx.d.root.view) } : null);

// ---- ENGINEER ---------------------------------------------------------------------------------------------

const CHECK_TYPES = new Set(["build", "verify", "test"]);

const stagesSeen = (snap) => ((seen) => STAGE_STRIP.filter(([stage]) => seen.has(stage)).length)(new Set([...snap.events.filter((e) => e.source === "task" && e.kind === "stage").map((e) => e.stage), snap.view.stage]));

// What a budget has spent, of its limit when the task has one.
const spent = (b, unit) => (num(b?.spent) === null ? null : dim(num(b.limit) === null ? `${b.spent} ${unit}` : counted(b.spent, b.limit, unit)));

function engineerHead(snap) {
  const v = snap.view;
  const seen = stagesSeen(snap);
  const files = v.changes?.files ? dim(`${v.changes.files} file(s) +${v.changes.added ?? 0} −${v.changes.removed ?? 0}`) : dim("no file changed yet");
  return row(joined([seg(bar(seen, STAGE_STRIP.length, BAR), "info"), seg(counted(seen, STAGE_STRIP.length, "stages")), files, dim(`${v.actions.length} action(s)`), spent(v.budget?.attempts, "attempts"), spent(v.budget?.minutes, "min")], "  "));
}

const CHECK_MARK = { succeeded: ["✓", "success", "passed"], failed: ["✗", "danger", "failed"], error: ["✗", "danger", "error"], ended: ["·", "subtle", "ended"] };

const retest = (v, a) => ["fix", "retest"].includes(v.attempts?.find((t) => t.id === a.attempt)?.cause);

function markOf(ctx, v, a) {
  if (a.state === "running") return [v.terminal ? "·" : pulseOf(ctx.nowMs), "info", retest(v, a) ? "running again" : "running"];
  return CHECK_MARK[a.state] ?? ["?", "subtle", a.state ?? ABSENT.unknown];
}

const backing = (a) => (a.receipts?.length ? dim(`← ${a.receipts.at(-1)}`) : a.state === "running" ? null : seg("reported, no receipt", "warning"));

// What the check's runner reported, beside the receipt (1.8.5): an observation's counts, never its verdict.
const observedWords = (obs) => ((w) => (w?.cases ? dim(`${w.cases}  `) : null))(progressWords(obs));

function checkRow(ctx, v, a, obs) {
  const [glyph, tone, word] = markOf(ctx, v, a);
  const took = between(a.startedAt, a.endedAt, ctx.nowMs) ?? "";
  return row([seg(a.type.toUpperCase().padEnd(6), "label"), seg(`${glyph} `, tone), dim(took.padStart(6)), seg(`  ${str(a.tool) ?? str(a.label) ?? a.id}`), seg(`  ${str(a.summary) ?? str(a.reason) ?? word}`, tone)], [observedWords(obs), backing(a)]);
}

function runningRow(ctx, v) {
  const a = v.actions.filter((x) => x.state === "running" && !CHECK_TYPES.has(x.type)).at(-1);
  return a ? [row([seg(a.id.padEnd(6), "label"), seg(`${v.terminal ? "·" : pulseOf(ctx.nowMs)} `, "info"), dim((between(a.startedAt, null, ctx.nowMs) ?? "").padStart(6)), seg(`  ${DISPATCH_WORDS[a.type]?.word ?? a.type}`, "info"), seg(`  ${joined([seg(str(a.label) ?? ""), seg(str(a.tool) ?? "")]).map((x) => x.text).join("")}`)])] : [];
}

const SHOWN_CHECKS = 4;

// The latest checks, each with what its runner reported; the earlier ones are counted and kept for `i`.
function engineerRows(ctx, snap) {
  const all = snap.view.actions.filter((a) => CHECK_TYPES.has(a.type));
  const earlier = all.length > SHOWN_CHECKS ? [row([dim(`… ${all.length - SHOWN_CHECKS} earlier check(s): i shows every activity`)], [], { detail: true })] : [];
  const none = all.length ? [] : [row([dim("no build or test has run yet")])];
  return [engineerHead(snap), ...earlier, ...all.slice(-SHOWN_CHECKS).map((a) => checkRow(ctx, snap.view, a, snap.observations?.[a.id])), ...none, ...runningRow(ctx, snap.view)];
}

export function engineerSection(ctx) {
  if (!ctx.d.engineeringId) return null;
  return { name: "engineer", rows: ctx.d.engineering?.view ? engineerRows(ctx, ctx.d.engineering) : [row([dim(`${ctx.d.engineeringId}: reading its journal`)])] };
}
