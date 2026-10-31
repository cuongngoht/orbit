#!/usr/bin/env node
// THE SCRIPTED HOST: what a control runs in the runner container in place of a coding host. No model, no network, no
// credential: a control proves the controller, the engine and the verifier, never a model, and every report says so
// (host basis SCRIPTED). It decides nothing: the inspection reads back what it left, and a verifier that shares nothing
// with it judges. It does not diagnose either: at the first step that does not succeed it stops and says where it stands.
//
// A REPAIR script drives the round's ONE engineering task through Orbit's own loop -- cli/autonomous-engineering.mjs,
// one decided step at a time, exactly as a host drives it -- and makes the edits its control defines in that task's own
// workspace. A GOAL script (an engineering case) starts where a person would: Orbit's goal entry (cli/orbit.mjs goal
// start, analyze, plan, step), then the coordinated workflow the step starts (cli/automation.mjs context, step,
// settle), whose engineering step's task it drives the same way -- or, for a goal that leaves out a rule the change
// needs, it records that rule as missing and stops, as nobody here can say it. An INTERRUPT script is a goal script
// whose first round kills its own check mid-run, the way a host that crashed leaves it; its next round reconciles what
// did not settle and goes on, never sending anything again.
//
// What it prints is stream-json, the shape the controller reads a host's session in: an init line naming its model
// `scripted:<control>`, one tool call per Orbit command it ran, and a result line -- its cost is 0, because no model ran.
//
//   node /bench/scripted.mjs <tsk-…|->   brief: /run/brief/brief.json (its `script`, `plugin`, `goal`, `round`)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const PATHS = { brief: "/run/brief/brief.json", repo: "/work/repo" };

const said = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

const jsonOf = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

const lastLine = (r) => String(r.stderr || r.stdout || r.error?.message || "").trim().split("\n").at(-1)?.slice(0, 300) ?? "";

const CALL = { encoding: "utf8", timeout: 3600000, maxBuffer: 64 * 1024 * 1024 };

// One command of an Orbit CLI, run as a host runs it: from the checkout, the plugin's own CLI. (`s.env` and `s.say`
// exist so a test can run this outside the container; in it, the process's own are used.)
export const cliCall = (s, tool, args, input) => ((r) => ({ status: r.status, json: jsonOf(r.stdout), why: lastLine(r) }))(spawnSync(process.execPath, [join(s.plugin, "cli", tool), ...args, "--json"], { cwd: s.repo, env: s.env ?? process.env, input, ...CALL }));

export const orbitCall = (s, args, input) => cliCall(s, "autonomous-engineering.mjs", args, input);

// A command the session ran, said as one tool call of the session and kept among the result's steps.
function told(s, what, r, kind = what) {
  (s.say ?? said)({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { orbit: what } }] } });
  s.steps.push({ kind, status: r.status, outcome: r.json?.outcome ?? r.json?.stepState ?? null, stage: r.json?.stage ?? null, lifecycle: r.json?.lifecycle ?? null, why: r.status ? r.why : null });
  return r;
}

// Where the task stands, and the revision the next decision is made on.
export function contextOf(s) {
  const r = orbitCall(s, ["context", s.task]);
  s.revision = r.json?.revision ?? s.revision;
  return r.json;
}

const decisionOf = (s, action) => JSON.stringify({ schemaVersion: 1, expectedRevision: s.revision, action, observed: "the context allows this step", hypothesis: "it moves the change toward verified" });

// ONE decided step, as a tool call of the session: judged, recorded, run and settled by the engine.
export function stepped(s, action) {
  const r = orbitCall(s, ["step", s.task], decisionOf(s, action));
  s.revision = r.json?.revision ?? s.revision;
  return told(s, `autonomous-engineering step ${action.kind}`, r, action.kind);
}

// ---- a step killed mid-run, the way a host that crashed leaves it ----------------------------------------------------

const SLEEP = new Int32Array(new SharedArrayBuffer(4));

const pause = (ms) => Atomics.wait(SLEEP, 0, 0, ms);

// Until `ok()` holds or `ms` pass, asked every `every` ms: what was seen, never asked again after the loop.
function waited(ok, ms, every) {
  const until = Date.now() + ms;
  let seen = ok();
  while (!seen && Date.now() < until) seen = (pause(every), ok());
  return seen;
}

const jsonLines = (file) => (file && existsSync(file) ? readFileSync(file, "utf8").split("\n").map(jsonOf).filter(Boolean) : []);

const journalOf = (s) => ((base) => (base && existsSync(base) ? readdirSync(base).map((d) => join(base, d, "tasks", s.task, "journal.jsonl")).find((p) => existsSync(p)) ?? null : null))((s.env ?? process.env).ORBIT_STORE_DIR);

// An action the task's own journal shows started and not yet ended. The journal is read here as a CLOCK -- to time the
// kill while the check runs -- and as nothing else: what the round did is read back by the inspection, through Orbit.
const actionOpen = (file) => ((lines) => lines.some((l) => l.kind === "action-started" && lines.filter((x) => x.id === l.id).length === 1))(jsonLines(file));

// The decision as a file the step reads as its input, so nothing of this process has to stay alive to hand it over.
const decisionInput = (s, action) => ((file) => (writeFileSync(file, decisionOf(s, action)), openSync(file, "r")))(join(mkdtempSync(join(tmpdir(), "scripted-")), "decision.json"));

// ONE decided step started on its own and SIGKILLed the moment its action is open: left as a crash leaves it, recorded
// and never settled, for the next round to reconcile.
function killedMidStep(s, action) {
  const step = spawn(process.execPath, [join(s.plugin, "cli", "autonomous-engineering.mjs"), "step", s.task, "--json"], { cwd: s.repo, env: s.env ?? process.env, stdio: [decisionInput(s, action), "ignore", "ignore"] });
  const caught = waited(() => actionOpen(journalOf(s)), 60000, 20);
  step.kill("SIGKILL");
  return told(s, `autonomous-engineering step ${action.kind} (killed mid-run)`, { status: null, json: { outcome: caught ? "interrupted" : "not-started" } }, action.kind).json.outcome;
}

const BUSY = /another session is taking a step/;

// A lock a killed step left behind is Orbit's to break once it is stale; until then the command is tried again, the way
// a host told "try again in a moment" does.
function patiently(call, ms = 120000) {
  const until = Date.now() + ms;
  let r = call();
  while (r.status !== 0 && BUSY.test(r.why) && Date.now() < until) r = (pause(5000), call());
  return r;
}

// ---- the edits a definition names, made in the task's own workspace ----------------------------------------------------

const occurrences = (text, find) => text.split(find).length - 1;

function mutated(dir, m) {
  const file = join(dir, m.file);
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (occurrences(text, m.find) !== m.count) return `${m.id}: expected ${m.count} occurrence(s) in ${m.file}, found ${occurrences(text, m.find)}`;
  writeFileSync(file, text.split(m.find).join(m.replace));
  return null;
}

const written = (dir, f) => (mkdirSync(dirname(join(dir, f.rel)), { recursive: true }), writeFileSync(join(dir, f.rel), f.lines.map((l) => `${l}\n`).join("")), null);

const deleted = (dir, rel) => (rmSync(join(dir, rel), { force: true }), null);

// Every edit of the definition, in order: what it could not do, or nothing.
export const edited = (dir, d) => [...(d.mutations ?? []).map((m) => mutated(dir, m)), ...(d.files ?? []).map((f) => written(dir, f)), ...(d.deletes ?? []).map((rel) => deleted(dir, rel))].filter(Boolean);

export const scopeOf = (d) => [...new Set([...(d.mutations ?? []).map((m) => m.file), ...(d.files ?? []).map((f) => f.rel), ...(d.deletes ?? [])])];

// ---- the loop, from a fresh task to a reviewed change ----------------------------------------------------------------

const PREPARING = [{ kind: "gather-context" }, { kind: "check-environment" }, { kind: "prepare-workspace" }];

function prepared(s) {
  contextOf(s);
  for (const a of PREPARING) stepped(s, a);
  return contextOf(s);
}

function implemented(s, c) {
  stepped(s, { kind: "plan", intent: s.script.intent, scope: scopeOf(s.script.definition) });
  stepped(s, { kind: "implement" });
  const problems = c?.workspace?.path ? edited(c.workspace.path, s.script.definition) : ["the engineering task has no workspace"];
  stepped(s, { kind: "record-changes" });
  return problems;
}

// A check is one decided step -- except the first of a round that interrupts itself, which is killed mid-run.
const checkOutcome = (s, x) => (s.interrupt ? killedMidStep(s, { kind: "check", command: x.id }) : stepped(s, { kind: "check", command: x.id }).json?.outcome);

const CHECK_ENDS = { interrupted: "was killed mid-run, as this control intends" };

// Each check the change is required to pass, in turn -- and none after the first that does not succeed.
function checked(s) {
  const required = (contextOf(s)?.verificationPlan?.required ?? []).filter((x) => x.settled !== true);
  for (const x of required) if (((o) => o !== "succeeded" && (s.ended = `the required check ${x.id} ${CHECK_ENDS[o] ?? "did not succeed"}: the task stays where it stands`))(checkOutcome(s, x))) return [s.ended];
  return [];
}

// A change that passed its checks: committed in the task's own delivery, then reviewed -- what completes the task.
function delivered(s) {
  if ((contextOf(s)?.allowed ?? []).includes("commit")) stepped(s, { kind: "commit", message: String(s.script.intent).slice(0, 200) });
  const r = stepped(s, { kind: "review" });
  return r.status === 0 ? [] : [`review: ${r.why}`];
}

function applied(s) {
  const problems = implemented(s, prepared(s));
  if (problems.length) return problems;
  const failed = checked(s);
  return failed.length ? failed : delivered(s);
}

// A task an earlier round left mid-step: what did not settle is reconciled -- read back, never sent again -- and the loop
// goes on from where the task stands.
function resumed(s) {
  told(s, "autonomous-engineering reconcile", patiently(() => orbitCall(s, ["reconcile", s.task])), "reconcile");
  const failed = checked(s);
  return failed.length ? failed : delivered(s);
}

// A task still where its start left it is taken through the whole loop; one an earlier round moved is resumed.
const taskCarried = (t) => (contextOf(t)?.stage === "CONTEXT" ? applied(t) : resumed(t));

// ---- a GOAL through Orbit's own goal entry (an engineering case), and the workflow its step starts ------------------

const goalCall = (s, args, input) => told(s, `orbit goal ${args[0]}`, cliCall(s, "orbit.mjs", ["goal", ...args], input));

const autoCall = (s, args, input) => cliCall(s, "automation.mjs", args, input);

function autoContext(s) {
  const c = autoCall(s, ["context", s.auto]).json;
  s.autoRevision = c?.revision ?? s.autoRevision;
  return c;
}

// A workflow step is decided by id, and its decision id names it: the engineering step is settled with the decision
// that dispatched it, in this round or the one before.
const runDecision = (s, step) => JSON.stringify({ schemaVersion: 1, decisionId: `d-${step}`, expectedRevision: s.autoRevision, action: { kind: "run", step }, observed: "the workflow's plan says this step is ready", hypothesis: "running it moves the workflow toward its goal" });

const autoStep = (s, step) => told(s, `automation step ${step}`, autoCall(s, ["step", s.auto], runDecision(s, step)));

const ranStep = (s, step) => ((r) => (r.status === 0 ? [] : [`the workflow's ${step.id} step: ${r.why}`]))(autoStep(s, step.id));

const settleDecision = (s, stepId, child) => JSON.stringify({ schemaVersion: 1, decisionId: `d-${stepId}`, expectedRevision: s.autoRevision, stepId, executionState: "succeeded", evidenceRefs: [`task:${child}`] });

// The engineering step settled with its task as its evidence: the workflow checks that task's own journal, not this.
function settledStep(s, stepId, child) {
  autoContext(s);
  const r = told(s, `automation settle ${stepId}`, autoCall(s, ["settle", s.auto], settleDecision(s, stepId, child)));
  return r.status === 0 ? [] : [`settling the workflow's ${stepId} step: ${r.why}`];
}

function carried(s, stepId, child) {
  const problems = taskCarried({ ...s, task: child, revision: null });
  return problems.length ? problems : settledStep(s, stepId, child);
}

const childOf = (r) => /(tsk-[a-f0-9]{12})/.exec(r.json?.how?.invoke ?? "")?.[1] ?? null;

const engineered = (s, step) => ((child) => (child ? carried(s, step.id, child) : [`the workflow's ${step.id} step started no engineering task`]))(childOf(autoStep(s, step.id)));

const STEP_KINDS = { engineering: engineered };

const stepNamed = (c, id) => (c.plan?.steps ?? []).find((x) => x.id === id) ?? { id, kind: null };

const dispatched = (c) => (c.plan?.steps ?? []).find((x) => x.kind === "engineering" && x.state === "running" && c.child?.task) ?? null;

// The move to make next: an engineering step already dispatched is carried on with the task it started -- never sent
// again -- else the first step the workflow's own plan says is ready; none once the workflow stopped.
function nextMove(s, c) {
  if (!c) return null;
  const running = dispatched(c);
  if (running) return () => carried(s, running.id, c.child.task);
  return !c.stop && c.ready?.[0] ? ((step) => () => (STEP_KINDS[step.kind] ?? ranStep)(s, step))(stepNamed(c, c.ready[0])) : null;
}

const MAX_MOVES = 16;

// The workflow, one move at a time, until nothing is left to move or a move does not succeed.
function workflowRan(s, left = MAX_MOVES) {
  const move = left > 0 ? nextMove(s, autoContext(s)) : null;
  const problems = move ? move() : [];
  return problems.length || !move ? problems : workflowRan(s, left - 1);
}

const MISSING = [{ statement: "the goal leaves out a rule the change needs, and nobody here can say it", blocks: ["change"] }];

const analysisOf = (s, missing) => JSON.stringify({ objective: String(s.script.intent).slice(0, 240), intent: { category: "change", workKinds: ["change"], verification: ["the project's own declared tests pass"], missing }, requirements: [{ statement: String(s.script.intent).slice(0, 240) }], acceptance: [{ statement: "what the goal describes holds, shown by the project's own tests" }] });

// The goal read the way a host's model reads it, into the structured intent Orbit plans from: one change -- or one
// change a missing rule blocks, which the plan leaves UNRESOLVED and nobody starts.
function goalPlanned(s, missing) {
  s.goalId = goalCall(s, ["start", "--stdin"], s.goal).json?.id ?? null;
  if (!s.goalId) return false;
  goalCall(s, ["analyze", s.goalId, "--stdin"], analysisOf(s, missing));
  return goalCall(s, ["plan", s.goalId]).status === 0;
}

// A later round: the goal an earlier round started, and the workflow its step started -- found, never started again.
function goalFound(s) {
  if (s.round <= 1) return false;
  s.goalId = goalCall(s, ["list"]).json?.goals?.[0] ?? null;
  s.auto = s.goalId ? goalCall(s, ["status", s.goalId]).json?.projection?.currentTask ?? null : null;
  return Boolean(s.goalId);
}

// The goal brought up to date with what its workflow did, and asked whether it is met: its word is reported, never
// evidence -- the verifier judges.
function goalAsked(s, problems) {
  if (problems.length) return problems;
  goalCall(s, ["resume", s.goalId]);
  goalCall(s, ["verify", s.goalId]);
  return problems;
}

function goalRan(s, missing) {
  if (!goalFound(s) && !goalPlanned(s, missing)) return ["the goal could not be started and planned"];
  s.auto = s.auto ?? goalCall(s, ["step", s.goalId]).json?.automation?.task ?? null;
  if (!s.auto) return missing.length ? [] : ["the goal's step started no workflow"];
  return goalAsked(s, workflowRan(s));
}

// What a script does: APPLY its definition through a repair's loop, take a GOAL through Orbit's goal entry, stop on a
// goal that is BLOCKED by a missing rule, INTERRUPT its own first round, or sit IDLE -- change nothing at all.
export const SCRIPTS = { apply: applied, goal: (s) => goalRan(s, []), blocked: (s) => goalRan(s, MISSING), interrupt: (s) => goalRan(s, []), idle: () => [] };

export const stateOf = (b, task) => ((round) => ({ task: /^tsk-[a-f0-9]{12}$/.test(task ?? "") ? task : null, repo: PATHS.repo, plugin: b.plugin ?? PATHS.repo, script: b.script ?? {}, goal: b.goal ?? null, round, interrupt: b.script?.mode === "interrupt" && round === 1, revision: null, steps: [] }))(b.round ?? 1);

// A repair script needs its task readable first; a goal script starts from the goal itself.
export const ranScript = (s) => (s.task && !contextOf(s) ? ["the engineering task could not be read"] : (SCRIPTS[s.script.mode] ?? SCRIPTS.apply)(s));

function main(task) {
  const s = stateOf(JSON.parse(readFileSync(PATHS.brief, "utf8")), task);
  said({ type: "system", subtype: "init", model: `scripted:${s.script.id ?? "unnamed"}`, session_id: `scripted-${s.task ?? "goal"}`, claude_code_version: null });
  const problems = ranScript(s);
  said({ type: "result", subtype: problems.length ? "error_during_execution" : "success", is_error: problems.length > 0, num_turns: s.steps.length, total_cost_usd: 0, result: problems.join("; ").slice(0, 300) || "the script ran to its end", steps: s.steps });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv[2]);
