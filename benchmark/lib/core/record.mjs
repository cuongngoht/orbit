// THE RECORD of a benchmark run: ONE Orbit task, written only through the task's own door (`node cli/task.mjs`, run
// from the developer's checkout as a terminal runs it) -- the same journal, stages, attempts, actions, receipts,
// verification rows and stop reasons every Orbit execution has, so Orbit Live and Mission Control show a benchmark run
// as they show any task, a person pauses or cancels it there, and its budget is held by the door that holds every
// task's. Nothing here keeps a second state: where a run stands is read back from that journal every time.
//
//   recorder({ cli, cwd, env }) -> { create, stage, attempt, act, link, decide, end, show }
//   text(s) -> one line of at most 240 characters, the task's own limit
import { spawnSync } from "node:child_process";
import { Blocked, Refused } from "../../../src/errors.mjs";
import { printable } from "../../../src/printable.mjs";

export const PROVIDER = "benchmark";

const LIMIT = 240;

export const text = (s) => printable(String(s ?? "")).replace(/\s+/g, " ").trim().slice(0, LIMIT) || "-";

const flags = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => (v === true ? `--${k}` : `--${k}=${v}`));

const lastLine = (r) => String(r.stderr || r.stdout || r.error?.message || "").trim().split("\n").at(-1) ?? "";

const parsed = (out) => {
  try { return JSON.parse(out); }
  catch { return null; }
};

// One call through the door: its JSON answer, or what the door said -- a refusal is REFUSED (exit 2), a machine that
// could not answer is BLOCKED (exit 3), exactly as the CLI says them.
function called(p, args) {
  const r = spawnSync(process.execPath, [p.cli, ...args, "--json"], { cwd: p.cwd, env: p.env, encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  if (r.status === 0) return parsed(r.stdout) ?? {};
  if (r.status === 2) throw Object.assign(new Refused(`task door: ${lastLine(r)}`), { door: lastLine(r) });
  throw new Blocked(`the task door could not answer (${r.status ?? r.signal ?? r.error?.code}): ${lastLine(r)}`);
}

export function recorder(p) {
  const call = (args) => called(p, args);
  return {
    create: (objective, budget) => call(["create", text(objective), ...flags({ provider: PROVIDER, actor: "orbit-benchmark", attempts: budget.attempts, actions: budget.actions, minutes: budget.minutes })]).task,
    stage: (t, stage, because) => call(["stage", t, stage, ...flags({ because: because && text(because) })]),
    attemptStart: (t, cause) => call(["attempt", "start", t, ...flags({ cause })]),
    attemptComplete: (t, outcome, signature) => call(["attempt", "complete", t, ...flags({ outcome, signature })]),
    actStart: (t, type, label) => call(["act", "start", t, ...flags({ type, label: text(label) })]).lines?.find((l) => l.kind === "action-started")?.id ?? null,
    actComplete: (t, act, outcome, receipt, summary) => call(["act", "complete", t, act, ...flags({ outcome, receipt, summary: summary && text(summary) })]),
    actFail: (t, act, reason, receipt) => call(["act", "fail", t, act, ...flags({ reason: text(reason), receipt })]),
    receipt: (t, r) => call(["link", "receipt", t, ...flags({ domain: r.domain, ref: r.ref, outcome: r.outcome, summary: r.summary && text(r.summary), action: r.action })]),
    file: (t, f) => call(["link", "file", t, ...flags({ path: f.path, change: f.change, added: f.added, removed: f.removed })]),
    verification: (t, v) => call(["link", "verification", t, ...flags({ obligation: text(v.obligation), state: v.state, evidence: v.evidence, subject: v.subject })]),
    decide: (t, d) => call(["decide", t, ...flags({ observed: text(d.observed), hypothesis: text(d.hypothesis), next: d.next, evidence: (d.evidence ?? []).join(",") || undefined, reason: d.reason && text(d.reason) })]),
    complete: (t, summary) => call(["complete", t, ...flags({ summary: text(summary) })]),
    fail: (t, stop, because) => call(["fail", t, ...flags({ stop, because: text(because) })]),
    block: (t, stop, needs, because) => call(["block", t, ...flags({ stop, needs, because: text(because) })]),
    unblock: (t, because) => call(["unblock", t, ...flags({ because: text(because) })]),
    show: (t) => call(["show", t]),
  };
}
