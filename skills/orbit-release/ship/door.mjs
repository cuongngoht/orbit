// THE SHIP'S JOURNAL: one Orbit task (provider `release`), written only through the task's own door -- `node
// cli/task.mjs`, run from the person's checkout as a terminal runs it -- so Orbit Live and Mission Control show a ship as
// they show any task, a person pauses or cancels it there, and where a ship stands is read back from that journal
// every time. Nothing here keeps a second state. (skills/ never imports src/task/: the door is a command.)
//
//   doorOf({ cli, cwd, env }) -> { create, stage, attemptStart, attemptComplete, actStart, actComplete, actFail,
//                                   receipt, file, verification, decide, complete, fail, block, unblock, show }
//   text(s) -> one line of at most 240 characters, the task's own limit          PROVIDER · ACTOR
import { spawnSync } from "node:child_process";
import { Blocked, Refused } from "../../../src/errors.mjs";
import { printable } from "../../../src/printable.mjs";

export const PROVIDER = "release";

export const ACTOR = "orbit-release";

const LIMIT = 240;

export const text = (s) => printable(String(s ?? "")).replace(/\s+/g, " ").trim().slice(0, LIMIT) || "-";

// Who carries each kind of the ship's actions, and whether it writes: a ship writes only its own workspace and room.
export const ACTION_ROLES = {
  "release.preflight": { tool: "release", mutates: false },
  "release.workspace": { tool: "release", mutates: true },
  "release.build": { tool: "docker", mutates: false },
  "release.host": { tool: "coding-host", mutates: false },
  "release.gates": { tool: "release", mutates: false },
  "release.row": { tool: "benchmark", mutates: false },
  "release.repair": { tool: "coding-host", mutates: false },
  "release.integrate": { tool: "release", mutates: true },
  "release.limits": { tool: "person", mutates: false },
  "release.resume": { tool: "person", mutates: false },
  "release.evidence": { tool: "release", mutates: true },
};

const roleOf = (type, role) => ({ ...(ACTION_ROLES[type] ?? { tool: "release", mutates: false }), ...(role ?? {}) });

const flags = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => (v === true ? `--${k}` : `--${k}=${v}`));

const lastLine = (r) => String(r.stderr || r.stdout || r.error?.message || "").trim().split("\n").at(-1) ?? "";

const parsed = (out) => {
  try { return JSON.parse(out); }
  catch { return null; }
};

// One call through the door: its JSON answer, or what the door said -- a refusal is REFUSED, a door that could not
// answer is BLOCKED, exactly as the CLI says them.
function called(p, args) {
  const r = spawnSync(process.execPath, [p.cli, ...args, "--json"], { cwd: p.cwd, env: p.env, encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  if (r.status === 0) return parsed(r.stdout) ?? {};
  if (r.status === 2) throw Object.assign(new Refused(`task door: ${lastLine(r)}`), { door: lastLine(r) });
  throw new Blocked(`the task door could not answer (${r.status ?? r.signal ?? r.error?.code}): ${lastLine(r)}`);
}

export function doorOf(p) {
  const call = (args) => called(p, args);
  return {
    create: (objective, budget) => call(["create", text(objective), ...flags({ provider: PROVIDER, actor: ACTOR, attempts: budget.attempts, actions: budget.actions, minutes: budget.minutes })]).task,
    stage: (t, stage, because) => call(["stage", t, stage, ...flags({ because: because && text(because) })]),
    attemptStart: (t, cause) => call(["attempt", "start", t, ...flags({ cause })]),
    attemptComplete: (t, outcome, signature) => call(["attempt", "complete", t, ...flags({ outcome, signature })]),
    actStart: (t, type, label, role) => ((r) => call(["act", "start", t, ...flags({ type, label: text(label), tool: r.tool, mutates: r.mutates || undefined })]).lines?.find((l) => l.kind === "action-started")?.id ?? null)(roleOf(type, role)),
    actComplete: (t, act, outcome, receipt, summary) => call(["act", "complete", t, act, ...flags({ outcome, receipt, summary: summary && text(summary) })]),
    actFail: (t, act, reason) => call(["act", "fail", t, act, ...flags({ reason: text(reason) })]),
    receipt: (t, r) => call(["link", "receipt", t, ...flags({ domain: r.domain, ref: r.ref, outcome: r.outcome, summary: r.summary && text(r.summary), action: r.action })]),
    file: (t, f) => call(["link", "file", t, ...flags({ path: f.path, change: f.change })]),
    verification: (t, v) => call(["link", "verification", t, ...flags({ obligation: text(v.obligation), state: v.state, evidence: v.evidence, subject: v.subject })]),
    decide: (t, d) => call(["decide", t, ...flags({ observed: text(d.observed), hypothesis: text(d.hypothesis), next: d.next, evidence: (d.evidence ?? []).join(",") || undefined })]),
    complete: (t, summary) => call(["complete", t, ...flags({ summary: text(summary) })]),
    fail: (t, stop, because) => call(["fail", t, ...flags({ stop, because: text(because) })]),
    block: (t, stop, needs, because) => call(["block", t, ...flags({ stop, needs, because: text(because) })]),
    unblock: (t, because) => call(["unblock", t, ...flags({ because: text(because) })]),
    show: (t) => call(["show", t]),
  };
}
