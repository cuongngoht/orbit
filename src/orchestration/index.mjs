// The commands of AUTONOMOUS ENGINEERING, as a table -- every other subsystem's shape:
//
//   run(ports, args)   answers with DATA, so `--json` and a host read the same thing
//   say(data)          puts it in words
//   writes             what it may touch: `nothing`, `store`, `workspace`, `machine`, or -- for `step`,
//                      which takes one action -- `by-action` (src/orchestration/governance.mjs says
//                      what each action touches)
//   needs              `checkout` (the ports of the checkout this runs in) or `nothing`
//
// Nothing here runs a command line, writes the primary checkout, grants an approval or resumes a
// paused task: there is no flag for any of them.
import { Refused } from "../errors.mjs";
import { flag, words } from "../learn/args.mjs";
import { cleanup, contextNow, finish, protocolOf, reconcile, removeWorkspace, resume, start, step } from "./loop.mjs";

const int = (v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v);

const TASK = /^tsk-[a-f0-9]{12}$/;

function task(args, i = 0) {
  const word = words(args)[i];
  if (!TASK.test(String(word ?? ""))) throw new Refused("name the task: a tsk- id (context, resume and `task list` show them)");
  return word;
}

function decisionOf(text) {
  try { return JSON.parse(text); }
  catch { throw new Refused("a decision is one JSON object, on stdin or in --decision=<file> (protocol shows its shape)"); }
}

function specOf(args) {
  const objective = flag(args, "objective") ?? (words(args).join(" ") || undefined);
  if (!flag(args, "ref") && !objective) throw new Refused('start --ref=<work item, req-…, rs-… or w-…>, or start "<objective>" for an ad-hoc change');
  return { ref: flag(args, "ref"), objective, attempts: int(flag(args, "attempts")), actions: int(flag(args, "actions")), minutes: int(flag(args, "minutes")) };
}

// A check's log is chk-n; the log of an application a sandbox started and that stopped by itself is sbx-n.
const LOG = /^(chk|sbx)-\d{1,6}$/;

function logOf(ports, args) {
  const id = task(args);
  const ref = words(args)[1];
  if (!LOG.test(String(ref ?? ""))) throw new Refused("name the log: a chk- id (a check) or an sbx- id (a sandbox's application) — a step's answer and the context name them");
  ports.task.view(id);
  return { task: id, check: ref, lines: (ports.roomOf(id).log(ref) ?? "").split("\n") };
}

// ---- words ---------------------------------------------------------------------------------------

const allowed = (c) => (c.allowed?.length ? c.allowed.join(", ") : "nothing");

const short12 = (tree) => String(tree ?? "").slice(0, 12) || "no tree";

const endpointText = (e) => (typeof e === "string" ? e : e?.url ?? e?.origin ?? null);

const appLine = (x) => `APP        ${x.component} · ${x.state ?? "unknown"}${x.readiness ? ` · ${typeof x.readiness === "string" ? x.readiness : x.readiness.state ?? ""}` : ""}${endpointText(x.endpoint) ? ` · ${endpointText(x.endpoint)}` : ""}`;

const networkLine = (live) => `NETWORK    data ${live.dataIsolation?.state ?? "unknown"}${live.dataIsolation?.because ? ` — ${live.dataIsolation.because}` : ""}${(live.connectivity ?? []).length ? ` · ${live.connectivity.map((x) => `${x.target} ${x.state}${x.stale ? " (stale)" : ""}`).join(", ")}` : ""}`;

const sandboxLine = (s) => `SANDBOX    ${s.environment} · ${s.state} · tree ${short12(s.tree)}${s.stale ? ` — the workspace moved on (${short12(s.currentTree)})` : ""} · ${s.running.length} running`;

// A sandbox's lines appear only when the task has one; the QA line always does, because what live
// evidence a task holds -- and why it holds none -- is part of where it stands.
const sandboxLines = (c) => (c.sandbox ? [sandboxLine(c.sandbox), ...(c.sandbox.live?.components ?? []).map(appLine), ...(c.sandbox.live ? [networkLine(c.sandbox.live)] : [])] : []);

// ---- the verification plan, in words -------------------------------------------------------------------

const keys = (rows, n = 4) => `${rows.slice(0, n).join(", ")}${rows.length > n ? `, … ${rows.length - n} more` : ""}`;

const checkWord = (x) => `${x.component} ${x.purpose} ${x.declaredAs} ${x.state}${x.baseline === "none" ? " (no baseline)" : x.baseline === "failed" ? " (failed at baseline)" : ""}`;

const PLAN_LINES = [
  (p) => `IMPACT     ${p.source} · ${p.word} · ${p.impact.components.length ? keys(p.impact.components.map((x) => `${x.key} ${x.reason.toLowerCase()}`)) : "nothing reached yet"}`,
  (p) => (p.required.length ? `REQUIRED   ${keys(p.required.map(checkWord), 6)}` : null),
  (p) => (p.excluded.length ? `EXCLUDED   ${p.excluded.length} not affected — not run: ${keys(p.excluded.map((x) => `${x.component} ${x.purpose} ${x.declaredAs}`))}` : null),
  (p) => (p.missing.length ? `MISSING    nothing declared verifies ${keys(p.missing.map((m) => m.what))}` : null),
  (p) => (p.baselineFailures.length ? `BASELINE   failed before the change: ${keys(p.baselineFailures)}` : null),
  (p) => (p.regressions.length ? `REGRESSED  ${keys(p.regressions)}` : null),
  (p) => (p.live.length ? `RUNTIME    ${keys(p.live.map((x) => `${x.key} ${x.how}`))} — ${p.linkedLive ? "the live evidence taken must be about the code the workspace holds now" : "worth seeing running; required once live evidence is taken"}` : null),
];

const planLines = (c) => (c.verificationPlan ? PLAN_LINES.map((line) => line(c.verificationPlan)).filter(Boolean) : []);

const qaLine = (c) => `QA         live evidence ${c.evidence.state} (${c.evidence.id}) — ${c.evidence.say}`;

const sayContext = (c) => [`TASK       ${c.task.id} — ${c.task.objective}`, `STATE      ${c.lifecycle} · ${c.stage ?? "no stage"} · attempt ${c.attempt.number ?? 0}/${c.attempt.limit ?? "?"} · revision ${c.revision}`, ...(c.workspace?.path ? [`WORKSPACE  ${c.workspace.id} → ${c.workspace.path}  (edit here; run Orbit from your checkout)`] : []), `CHANGES    ${c.changes.files} file(s) +${c.changes.added} -${c.changes.removed}`, ...planLines(c), ...sandboxLines(c), qaLine(c), ...(c.latestFailure ? [`FAILURE    ${c.latestFailure.check} · ${c.latestFailure.class} (${c.latestFailure.confidence}) · signature ${c.latestFailure.signature} · repeats ${c.repeats}`] : []), ...(c.open.length ? [`OPEN       ${c.open.map((o) => `${o.id} ${o.kind} — ${o.settle}`).join("; ")}`] : []), ...(c.completion?.length ? [`UNMET      ${c.completion.map((u) => u.id).join(", ")}`] : []), `ALLOWED    ${allowed(c)}`, `NEXT       ${c.next}`].join("\n");

const sayStarted = (r) => [`TASK       ${r.task} ${r.created ? "started" : "is already running for this work — picked up"}`, ...(r.dirty ? ["NOTE       your checkout has uncommitted changes; the workspace starts from HEAD and does not have them"] : []), sayContext(r.context)].join("\n");

const sayStep = (r) => (r.action ? [`STEP       ${r.action} ${r.kind} → ${r.outcome}${r.summary ? ` · ${r.summary}` : ""}`, ...(r.failure ? [`FAILURE    ${r.failure.class} (${r.failure.confidence}) · ${r.failure.because} · signature ${r.failure.signature}`] : []), `STATE      ${r.lifecycle} · ${r.stage} · revision ${r.revision}`, `NEXT       ${r.next}`].join("\n") : `TASK       ${r.task} · ${r.state}${r.say ? ` — ${r.say}` : ""}`);

const sayFinished = (r) => `TASK       ${r.task} · ${r.state}${r.stop ? ` (${r.stop})` : ""}${r.say ? ` — ${r.say}` : ""}`;

const sayReconciled = (r) => [`TASK       ${r.task}`, ...r.settled.map((s) => `SETTLED    ${s.action} ${s.kind} → ${s.outcome}${s.summary ? ` · ${s.summary}` : ""}`), `NEXT       ${r.context.next}`].join("\n");

const sandboxEnd = (b) => `SANDBOX    ${b.environment} → ${b.released ? "released" : "kept"}${b.why ? ` · ${b.why}` : ""}`;

const sayCleanup = (r) => [`TASK       ${r.task}`, ...(r.sessions.length ? r.sessions.map((s) => `SESSION    ${s.ref} → ${s.outcome}${s.why ? ` · ${s.why}` : ""}`) : ["SESSION    none of its own was still open"]), ...(r.sandbox ? [sandboxEnd(r.sandbox)] : [])].join("\n");

const sayLog = (r) => r.lines.join("\n");

const sayWhere = (r) => `ROOMS      ${r.orchestration}\nWORKSPACES ${r.workspaces}`;

const sayProtocol = (p) => JSON.stringify(p, null, 2);

const sayRemoved = (r) => `WORKSPACE  ${r.id} removed`;

const read = (run, say) => ({ run, say, writes: "nothing", needs: "checkout" });

export const COMMANDS = {
  start: { run: (ports, args) => start(ports, specOf(args)), say: sayStarted, writes: "store", needs: "checkout" },
  context: read((ports, args) => contextNow(ports, task(args)), sayContext),
  resume: read((ports, args) => resume(ports, words(args)[0] ?? flag(args, "ref")), (r) => sayContext(r.context)),
  step: { run: (ports, args) => step(ports, task(args), decisionOf(ports.readDecision(flag(args, "decision")))), say: sayStep, writes: "by-action", needs: "checkout" },
  reconcile: { run: (ports, args) => reconcile(ports, task(args)), say: sayReconciled, writes: "store", needs: "checkout" },
  finish: { run: (ports, args) => finish(ports, task(args), { stop: flag(args, "stop"), because: flag(args, "because") }), say: sayFinished, writes: "store", needs: "checkout" },
  cleanup: { run: (ports, args) => cleanup(ports, task(args)), say: sayCleanup, writes: "machine", needs: "checkout" },
  "remove-workspace": { run: (ports, args) => removeWorkspace(ports, task(args)), say: sayRemoved, writes: "workspace", needs: "checkout" },
  log: read(logOf, sayLog),
  protocol: { run: () => protocolOf(), say: sayProtocol, writes: "nothing", needs: "nothing" },
  where: read((ports) => ports.where(), sayWhere),
};

export const COMMAND_NAMES = Object.keys(COMMANDS);
