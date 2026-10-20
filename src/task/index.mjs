// The commands of a TASK: an execution of a work, recorded as it happens and governed by a
// person. A command table, every other subsystem's shape:
//
//   writes   `nothing`, or `store` (this project's machine store -- never a repository)
//   needs    what the composition root binds: `checkout` (one checkout's task room: the tasks,
//            the project and checkout ids, the session, the clock, the registry's entry for it)
//            or `machine` (the registry, a project's store root by key, the clock, where today
//            began)
//
// `run` answers with DATA and `say` puts it in words. The same table is what Orbit Control calls
// for a person's decision, with the same arguments a CLI would take. `door: "control"` marks the
// decisions that ALLOW something (approve, resume): only Orbit Control, which proves a person with
// its mutation token, offers them, and the write door refuses them from anywhere else.
// Nothing here runs, stops, installs or writes anything but a task's own journal.
import { Refused } from "../errors.mjs";
import { flag, has, words } from "../learn/args.mjs";
import { loadTask } from "./load.mjs";
import { machineView } from "./machine.mjs";
import { apply, createTask } from "./ops.mjs";
import { summaryOf } from "./summary.mjs";
import { CODES } from "./vocab.mjs";
import { eventsView, taskView } from "./views.mjs";

const int = (v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v);

const listOf = (v) => (v === undefined ? undefined : v.split(",").map((s) => s.trim()).filter(Boolean));

const mark = (args, name) => (has(args, name) ? true : undefined);

function named(args, i, what) {
  const word = words(args)[i];
  if (!word) throw new Refused(`name ${what}`);
  return word;
}

const task = (args, i = 0) => named(args, i, "the task: a tsk- id");

function paramsOf(v) {
  if (v === undefined) return undefined;
  try { return JSON.parse(v); }
  catch { throw new Refused(`params is a JSON object, such as --params='{"schema":82}' — it is hashed into the approval's fingerprint and never kept`); }
}

// A command with a second word: `attempt start`, `act complete`, `link receipt`.
const sub = (table, usage) => (ctx, args) => {
  const run = Object.hasOwn(table, words(args)[0] ?? "") ? table[words(args)[0]] : null;
  if (!run) throw new Refused(`${usage} — one of: ${Object.keys(table).join(", ")}`);
  return run(ctx, args);
};

// ---- recording what happened --------------------------------------------------------------

function create(ctx, args) {
  const objective = words(args).join(" ") || undefined;
  return createTask(ctx, { project: ctx.project, checkout: ctx.checkout, objective, work: flag(args, "work"), root: flag(args, "root"), snapshot: flag(args, "snapshot"), snapshotDigest: flag(args, "digest"), baseRevision: flag(args, "base"), workspace: flag(args, "workspace"), provider: flag(args, "provider"), actor: flag(args, "actor"), attempts: int(flag(args, "attempts")), actions: int(flag(args, "actions")), minutes: int(flag(args, "minutes")) });
}

const ATTEMPT = {
  start: (ctx, args) => apply(ctx, task(args, 1), "attempt-start", { cause: flag(args, "cause") }),
  complete: (ctx, args) => apply(ctx, task(args, 1), "attempt-complete", { outcome: flag(args, "outcome"), failureSignature: flag(args, "signature") }),
};

const actionId = (args) => named(args, 2, "the action: an act- id");

const ACT = {
  start: (ctx, args) => apply(ctx, task(args, 1), "act-start", { type: flag(args, "type"), tool: flag(args, "tool"), label: flag(args, "label"), mutates: mark(args, "mutates"), approval: flag(args, "approval"), environment: flag(args, "environment"), params: paramsOf(flag(args, "params")) }),
  complete: (ctx, args) => apply(ctx, task(args, 1), "act-complete", { action: actionId(args), outcome: flag(args, "outcome"), receipt: flag(args, "receipt"), summary: flag(args, "summary") }),
  fail: (ctx, args) => apply(ctx, task(args, 1), "act-fail", { action: actionId(args), reason: flag(args, "reason"), receipt: flag(args, "receipt"), summary: flag(args, "summary") }),
};

const LINK = {
  workspace: (ctx, args) => apply(ctx, task(args, 1), "link-workspace", { workspace: flag(args, "workspace"), baseRevision: flag(args, "base") }),
  file: (ctx, args) => apply(ctx, task(args, 1), "link-file", { path: flag(args, "path"), change: flag(args, "change"), added: int(flag(args, "added")), removed: int(flag(args, "removed")) }),
  receipt: (ctx, args) => apply(ctx, task(args, 1), "link-receipt", { domain: flag(args, "domain"), ref: flag(args, "ref"), outcome: flag(args, "outcome"), summary: flag(args, "summary"), action: flag(args, "action") }),
  verification: (ctx, args) => apply(ctx, task(args, 1), "link-verification", { obligation: flag(args, "obligation"), state: flag(args, "state"), evidence: flag(args, "evidence"), subject: flag(args, "subject") }),
};

const APPROVAL = {
  expire: (ctx, args) => apply(ctx, task(args, 1), "approval-expire", { approval: named(args, 2, "the approval: an apr- id") }),
};

const decide = (ctx, args) => apply(ctx, task(args), "decide", { observed: flag(args, "observed"), hypothesis: flag(args, "hypothesis"), nextAction: flag(args, "next"), evidence: listOf(flag(args, "evidence")), reason: flag(args, "reason") });

const requestApproval = (ctx, args) => apply(ctx, task(args), "request-approval", { type: flag(args, "type"), tool: flag(args, "tool"), environment: flag(args, "environment"), reason: flag(args, "reason"), risk: flag(args, "risk"), params: paramsOf(flag(args, "params")), expires: flag(args, "expires") });

// ---- a person's decisions ---------------------------------------------------------------------

const decision = (op) => (ctx, args) => apply(ctx, task(args), op, { human: mark(args, "human"), expected: int(flag(args, "expect")), because: flag(args, "because") });

const verdict = (op, extra) => (ctx, args) => apply(ctx, task(args), op, { approval: named(args, 1, "the approval: an apr- id"), human: mark(args, "human"), expected: int(flag(args, "expect")), ...extra(args) });

// ---- reading -----------------------------------------------------------------------------------

function show(ctx, args) {
  const loaded = loadTask(ctx, task(args));
  return taskView(loaded.model, loaded.now, ctx.checkoutSummary ?? null);
}

const events = (ctx, args) => eventsView(loadTask(ctx, task(args)).model, int(flag(args, "since")) ?? 0);

function listRow(ctx, id) {
  try { return summaryOf(show(ctx, [id])); }
  catch (e) { return e?.code === CODES.TASK_UNKNOWN ? null : { id, unreadable: true, why: "its journal could not be read" }; }
}

const list = (ctx) => ({ version: 1, project: ctx.project, checkout: ctx.checkout, tasks: ctx.tasks.list().map((id) => listRow(ctx, id)).filter(Boolean) });

const where = (ctx) => ({ store: ctx.tasks.paths.root, project: ctx.project, checkout: ctx.checkout });

// ---- words -------------------------------------------------------------------------------------

const sayWritten = (r) => `TASK       ${r.task} · ${r.kinds.join(" + ")} · revision ${r.revision}`;

const attemptWords = (a) => (a.count ? `attempt ${a.number} / ${a.limit ?? "?"}${a.open ? "" : " (none open)"}` : "no attempt yet");

const approvalLine = (a) => `  ${a.id}  ${a.action} · ${a.environment ?? "?"} · ${a.state}${a.open ? " — waits for a person" : ""}`;

const decisionLine = (d) => (d ? `DECISION   ${d.observed} → ${d.nextAction}` : "DECISION   none recorded");

const sayShown = (v) => [`TASK       ${v.task.id} — ${v.task.objective}`, `STATE      ${v.lifecycle} · ${v.stage ?? "no stage"} · ${attemptWords(v.attempt)}${v.stopReason ? ` · ${v.stopReason}` : ""}`, decisionLine(v.decision), `CHANGES    ${v.changes.files} file(s) +${v.changes.added} -${v.changes.removed} · ${v.receipts.length} receipt(s) · ${v.verification.length} verification row(s)`, ...(v.approvals.length ? ["APPROVALS", ...v.approvals.map(approvalLine)] : []), `REVISION   ${v.revision}`].join("\n");

const sayEvents = (r) => [`TASK       ${r.task} · revision ${r.revision}`, ...r.events.map((e) => `  ${String(e.n).padStart(4)}  ${e.at}  ${e.kind}`)].join("\n");

const rowLine = (t) => (t.unreadable ? `  ${t.id}  UNREADABLE  ${t.why}` : `  ${t.id}  ${t.lifecycle.padEnd(16)} ${(t.stage ?? "-").padEnd(12)} ${attemptWords(t.attempt)}  ${t.objective}`);

const sayListed = (r) => [`TASKS      ${r.tasks.length} in this checkout`, ...r.tasks.map(rowLine)].join("\n");

const sayMachine = (r) => [`MACHINE    ${r.counts.projects} project(s) · ${r.counts.checkouts} checkout(s) · ${r.counts.tasks} task(s)`, `NOW        ${r.counts.running} running · ${r.counts.waitingApproval} waiting approval · ${r.counts.blocked} blocked · ${r.counts.paused} paused · ${r.counts.completedToday} completed today`, ...r.tasks.map((t) => `${rowLine(t)}  [${t.projectName ?? t.project}]`), ...(r.approvals.length ? ["APPROVALS", ...r.approvals.map((a) => `  ${a.task} ${a.id}  ${a.action} · ${a.environment} — ${a.projectName ?? a.project}`)] : [])].join("\n");

const sayWhere = (r) => `TASKS      ${r.store}`;

const record = (run) => ({ run, say: sayWritten, writes: "store", needs: "checkout" });

const read = (run, say) => ({ run, say, writes: "nothing", needs: "checkout" });

export const COMMANDS = {
  create: record(create),
  stage: record((ctx, args) => apply(ctx, task(args), "stage", { stage: words(args)[1], because: flag(args, "because") })),
  attempt: record(sub(ATTEMPT, "attempt start|complete <task>")),
  decide: record(decide),
  act: record(sub(ACT, "act start|complete|fail <task> [<act-id>]")),
  link: record(sub(LINK, "link workspace|file|receipt|verification <task>")),
  "request-approval": record(requestApproval),
  approval: record(sub(APPROVAL, "approval expire <task> <apr-id>")),
  block: record((ctx, args) => apply(ctx, task(args), "block", { stop: flag(args, "stop"), needs: flag(args, "needs"), because: flag(args, "because") })),
  unblock: record((ctx, args) => apply(ctx, task(args), "unblock", { because: flag(args, "because") })),
  complete: record((ctx, args) => apply(ctx, task(args), "complete", { summary: flag(args, "summary") })),
  fail: record((ctx, args) => apply(ctx, task(args), "fail", { stop: flag(args, "stop"), because: flag(args, "because") })),
  pause: record(decision("pause")),
  resume: { ...record(decision("resume")), door: "control" },
  cancel: record(decision("cancel")),
  approve: { ...record(verdict("approve", () => ({}))), door: "control" },
  reject: record(verdict("reject", (args) => ({ reason: flag(args, "reason") }))),
  show: read(show, sayShown),
  events: read(events, sayEvents),
  list: read(list, sayListed),
  machine: { run: (ctx) => machineView(ctx), say: sayMachine, writes: "nothing", needs: "machine" },
  where: read(where, sayWhere),
};

export const COMMAND_NAMES = Object.keys(COMMANDS);

/** What a terminal may run: every command but the ones only Orbit Control's door may. */
export const CLI_COMMANDS = COMMAND_NAMES.filter((name) => COMMANDS[name].door !== "control");
