// The commands of a COORDINATED WORKFLOW, as a table -- every other subsystem's shape:
//
//   run(ports, args)   answers with DATA, so `--json` and a host read the same thing
//   say(data)          puts it in words
//   writes             what it may touch: `nothing`, `store`, or -- for `step`, which runs one step --
//                      `by-step` (src/automation/governance.mjs says what each step kind touches)
//   needs              `checkout` (the ports of the checkout this runs in) or `nothing`
//
// There is no command that writes the automation settings (only Orbit Control's door does), none that
// grants an approval or resumes a paused workflow, and none that takes a command line.
import { Refused } from "../errors.mjs";
import { flag, words } from "../learn/args.mjs";
import { contextOf, finish, planFor, planOfTask, protocolOf, reconcile, resume, settle, start, step } from "./loop.mjs";
import { matrixOf } from "./policy.mjs";
import { CAPABILITY, MAX_CAPABILITIES } from "./vocab.mjs";

const int = (v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v);

const TASK = /^tsk-[a-f0-9]{12}$/;

function task(args) {
  const word = words(args)[0];
  if (!TASK.test(String(word ?? ""))) throw new Refused("name the workflow: its tsk- id (start, resume and `task list` show it)");
  return word;
}

const jsonOf = (text, noun) => {
  try { return JSON.parse(text); }
  catch { throw new Refused(`${noun} is one JSON object, on stdin or in a file (protocol shows its shape)`); }
};

// The capabilities a person or a host names for the objective (`--capability=a.b,c.d`): capability words only,
// as many as an objective is read for -- a server, a tool or a URL is refused, never resolved.
function capabilitiesOf(text) {
  const list = String(text ?? "").split(",").map((w) => w.trim()).filter(Boolean);
  if (list.some((w) => !CAPABILITY.test(w)) || list.length > MAX_CAPABILITIES) throw new Refused(`--capability names at most ${MAX_CAPABILITIES} capability words, dotted and lower case (qa.tenant-isolation.verification) — never a server, a tool or a URL`);
  return list;
}

function specOf(args) {
  const objective = flag(args, "for") ?? (words(args).join(" ") || undefined);
  if (!objective) throw new Refused('start --for="<the objective, in one sentence>" [--ref=<work item, req-…, rs-… or w-…>] [--capability=<a.b,c.d>]');
  return { objective, ref: flag(args, "ref"), capabilities: capabilitiesOf(flag(args, "capability")), attempts: int(flag(args, "attempts")), actions: int(flag(args, "actions")), minutes: int(flag(args, "minutes")) };
}

const planned = (ports, args) => (flag(args, "for") ? planFor(ports, specOf(args)) : planOfTask(ports, task(args)));

const statusOf = (ports) => ((s) => ({ ...s, matrix: matrixOf(s.effective.values) }))(ports.settingsView());

// ---- words ---------------------------------------------------------------------------------------

const waitsFor = (s) => (s.after?.length ? ` ← ${s.after.join(", ")}` : "");

const stepLine = (s) => `  ${s.state.padEnd(9)} ${s.id}${waitsFor(s)}${s.summary ? ` — ${s.summary}` : ""}`;

const replanLine = (r) => `REPLAN     plan-${r.n}: ${r.trigger} → ${r.response}${r.step ? ` at ${r.step}` : ""}${r.summary ? ` — ${r.summary}` : ""}`;

const capabilityLine = (c) => `  ${(c.word ?? c.outcome).padEnd(17)} ${c.capability}${c.named ? " (named)" : ""}${c.provider ? ` · ${c.provider.id}` : ""}${c.generates ? " · the skill factory may draft it" : ""}`;

const missingLine = (m) => `  ${m.what.padEnd(17)} ${m.by === "person" ? "a person says" : "a step finds out"} — ${m.say}`;

const sayContext = (c) => [`WORKFLOW   ${c.task.id} — ${c.task.objective}`, `STATE      ${c.lifecycle} · ${c.stage ?? "no stage"} · mode ${c.mode} · attempt ${c.attempt.number ?? 0}/${c.attempt.limit ?? "?"} · revision ${c.revision}`, ...(c.plan ? [`PLAN       plan-${c.plan.n} (${c.plan.workflow})${c.plan.revisedOnEvidence ? ` · revised ${c.plan.revisedOnEvidence} time(s) on new evidence` : ""}`, ...c.plan.steps.map(stepLine), ...(c.plan.replans ?? []).map(replanLine)] : ["PLAN       unreadable"]), ...(c.child ? [`CHILD      ${c.child.task} · ${c.child.lifecycle}${c.child.stage ? ` · ${c.child.stage}` : ""}${c.child.attempt ? ` · attempt ${c.child.attempt}` : ""}`] : []), ...(c.open.length ? [`OPEN       ${c.open.map((o) => `${o.id} ${o.label ?? o.type}`).join("; ")}`] : []), ...(c.next?.blocked ? [`BLOCKED    ${c.next.step}: ${c.next.blocked.because}`] : []), ...(c.watch ? [`WATCH      ${c.watch}`] : []), `NEXT       ${c.say}`].join("\n");

const sayStarted = (r) => [`WORKFLOW   ${r.task} ${r.created ? "started" : "is already running for this objective — picked up"}`, sayContext(r.context)].join("\n");

const sayStep = (r) => (r.how ? [`STEP       ${r.step} → ${r.mode} ${r.how.provider.id} (${r.action})`, `DO         ${r.how.invoke}`, `EXPECTS    ${r.how.expects.join(", ") || "nothing the engine can read back"}`, `THEN       ${r.how.settle} (decisionId of this step, expectedRevision ${r.revision})`, ...(r.watch ? [`WATCH      ${r.watch}`] : [])].join("\n") : saySettled(r));

const saySettled = (r) => (r.stepState ? [`STEP       ${r.step} → ${r.stepState}${r.summary ? ` · ${r.summary}` : ""}`, `STATE      ${r.lifecycle} · ${r.stage ?? "no stage"} · revision ${r.revision}`, `NEXT       ${r.say}`].join("\n") : `WORKFLOW   ${r.task} · ${r.state}${r.say ? ` — ${r.say}` : ""}`);

const sayFinished = (r) => [`WORKFLOW   ${r.task} · ${r.state}${r.stop ? ` (${r.stop})` : ""}${r.say ? ` — ${r.say}` : ""}`, ...(r.note ? [`NOTE       ${r.note}`] : [])].join("\n");

const sayReconciled = (r) => [`WORKFLOW   ${r.task}`, ...r.settled.map((s) => `SETTLED    ${s.action} ${s.step ?? ""} → ${s.settled}`), `NEXT       ${r.answer.say}`].join("\n");

const factLines = (f) => [`READ AS    ${f.intent} (${f.confidence}) · matched ${f.matched.join(", ") || "nothing"}`, ...((f.capabilities ?? []).length ? ["NEEDS", ...f.capabilities.map(capabilityLine)] : []), ...((f.missing ?? []).length ? ["MISSING", ...f.missing.map(missingLine)] : [])];

const sayPlan = (r) => (r.plan ? [`PLAN       plan-${r.plan.n} (${r.plan.workflow}) · ${r.plan.digest}`, ...(r.states ?? r.plan.steps.map((s) => ({ ...s, state: "planned" }))).map(stepLine), ...(r.revisions ?? []).map(replanLine), ...(r.facts ? [...factLines(r.facts), `WRITES     nothing — mode ${r.mode}`] : [])].join("\n") : [`PLAN       none — the objective reads as ${r.facts.intent}, which no workflow here coordinates`, ...factLines(r.facts)].join("\n"));



const sayStatus = (s) => ["AUTOMATION on by default", "LIMITS", ...Object.entries(s.effective.fields).map(([k, f]) => `  ${k.padEnd(36)} ${JSON.stringify(f.value)}  (${f.by})`), "POLICY", ...s.matrix.map((m) => `  ${m.id.padEnd(28)} ${m.verdict}`)].join("\n");

const sayDoctor = (d) => d.rows.map((r) => `${r.ok ? "ok  " : "--  "} ${r.name.padEnd(28)} ${r.say}`).join("\n");

const sayWhere = (w) => Object.entries(w).map(([k, v]) => `${k.toUpperCase().padEnd(11)}${v}`).join("\n");

const read = (run, say) => ({ run, say, writes: "nothing", needs: "checkout" });

export const COMMANDS = {
  start: { run: (ports, args) => start(ports, specOf(args)), say: sayStarted, writes: "store", needs: "checkout" },
  context: read((ports, args) => contextOf(ports, task(args)), sayContext),
  resume: read((ports, args) => resume(ports, flag(args, "ref") ?? words(args).join(" ")), (r) => sayContext(r.context)),
  step: { run: (ports, args) => step(ports, task(args), jsonOf(ports.readInput(flag(args, "decision")), "a decision")), say: sayStep, writes: "by-step", needs: "checkout" },
  settle: { run: (ports, args) => settle(ports, task(args), jsonOf(ports.readInput(flag(args, "outcome")), "an outcome")), say: saySettled, writes: "store", needs: "checkout" },
  reconcile: { run: (ports, args) => reconcile(ports, task(args)), say: sayReconciled, writes: "store", needs: "checkout" },
  finish: { run: (ports, args) => finish(ports, task(args), { stop: flag(args, "stop"), because: flag(args, "because") }), say: sayFinished, writes: "store", needs: "checkout" },
  plan: read(planned, sayPlan),
  status: read(statusOf, sayStatus),
  doctor: read((ports) => ports.doctor(), sayDoctor),
  protocol: { run: () => protocolOf(), say: (p) => JSON.stringify(p, null, 2), writes: "nothing", needs: "nothing" },
  where: read((ports) => ports.where(), sayWhere),
};

export const COMMAND_NAMES = Object.keys(COMMANDS);
