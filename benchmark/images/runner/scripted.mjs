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
// did not settle and goes on, never sending anything again. An ACTIVATION script (0.5.0) is a session as Claude Code has
// it, every hook delivered to Orbit's own entry points, its steps a control's data; a SEED script lays an activation
// case's seed into the runner's store with Orbit's own commands before the host's round.
//
// What it prints is stream-json, the shape the controller reads a host's session in: an init line naming its model
// `scripted:<control>`, one tool call per Orbit command it ran, and a result line -- its cost is 0, because no model ran.
//
//   node /bench/scripted.mjs <tsk-…|->   brief: /run/brief/brief.json (its `script`, `plugin`, `goal`, `round`)
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { uitestsOf } from "./inspect.mjs";

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
export const cliCall = (s, tool, args, input) => ((r) => ({ status: r.status, json: jsonOf(r.stdout), why: lastLine(r), line: commandLine(s, tool, [...args, "--json"]) }))(spawnSync(process.execPath, [join(s.plugin, "cli", tool), ...args, "--json"], { cwd: s.repo, env: s.env ?? process.env, input, ...CALL }));

// The command line a host would have typed for a call: what a judge's patterns read in an activation session's stream.
const quoted = (a) => (/[\s"'$`\\]/.test(a) ? JSON.stringify(a) : a);

export const commandLine = (s, tool, args) => ["node", join(s.plugin, "cli", tool), ...args].map((a) => quoted(String(a))).join(" ");

export const orbitCall = (s, args, input) => cliCall(s, "autonomous-engineering.mjs", args, input);

// How a session says a command it ran: in a line of its own -- or, in an activation session (`s.tell`, bashTold), as
// Claude Code says a Bash call, with its command line, its result and its hooks.
const plainTold = (s, what) => (s.say ?? said)({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { orbit: what } }] } });

// A command the session ran, said as one tool call of the session and kept among the result's steps.
function told(s, what, r, kind = what) {
  (s.tell ?? plainTold)(s, what, r);
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

const jsonLines = (file) => (file && existsSync(file) ? readFileSync(file, "utf8").split("\n").map(jsonOf).filter(Boolean) : []);

const journalOf = (s) => ((base) => (base && existsSync(base) ? readdirSync(base).map((d) => join(base, d, "tasks", s.task, "journal.jsonl")).find((p) => existsSync(p)) ?? null : null))((s.env ?? process.env).ORBIT_STORE_DIR);

// An action the task's own journal shows started and not yet ended. The journal is read here as a CLOCK -- to time the
// kill while the check runs -- and as nothing else: what the round did is read back by the inspection, through Orbit.
const actionOpen = (file) => ((lines) => lines.some((l) => l.kind === "action-started" && lines.filter((x) => x.id === l.id).length === 1))(jsonLines(file));

// The decision as a file the step reads as its input, so nothing of this process has to stay alive to hand it over.
const decisionFile = (s, action) => ((file) => (writeFileSync(file, decisionOf(s, action)), file))(join(mkdtempSync(join(tmpdir(), "scripted-")), "decision.json"));

const SELF = fileURLToPath(import.meta.url);

// ONE decided step, killed the moment its action is open -- by a helper process of its own that also waits the killed
// step out, so nothing of it lingers to be taken for a step still running: left as a crash leaves it, recorded and never
// settled, for the next round to reconcile.
function killedMidStep(s, action) {
  const r = spawnSync(process.execPath, [SELF, "--kill-mid-step", s.plugin, s.repo, s.task, decisionFile(s, action)], { env: s.env ?? process.env, ...CALL, timeout: 180000 });
  const caught = jsonOf(String(r.stdout ?? "").trim())?.caught === true;
  return told(s, `autonomous-engineering step ${action.kind} (killed mid-run)`, { status: null, json: { outcome: caught ? "interrupted" : "not-started" } }, action.kind).json.outcome;
}

// Whether the step's action opened within `ms`, looked for every 20 ms: what was seen, never looked at again.
const opened = (s, ms) => new Promise((resolve) => ((until) => (function tick() {
  const open = actionOpen(journalOf(s));
  if (open || Date.now() > until) return resolve(open);
  setTimeout(tick, 20);
})())(Date.now() + ms));

// The step's whole process group, killed -- a group already gone has nothing left to kill.
const killedGroup = (pid) => {
  try { process.kill(-pid, "SIGKILL"); }
  catch { return false; }
  return true;
};

// The helper: the step started in a process group of its own, the whole group SIGKILLed once its action is open (the
// step and the check it runs), and the step waited out.
async function killMidStep([plugin, repo, task, file]) {
  const step = spawn(process.execPath, [join(plugin, "cli", "autonomous-engineering.mjs"), "step", task, "--json"], { cwd: repo, stdio: [openSync(file, "r"), "ignore", "ignore"], detached: true });
  const caught = await opened({ task }, 60000);
  const ended = new Promise((resolve) => (step.exitCode === null ? step.once("exit", resolve) : resolve()));
  killedGroup(step.pid);
  process.stdout.write(`${JSON.stringify({ caught: (await ended, caught) })}\n`);
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

// How long a round that interrupts itself waits, once its check is killed, for the controller to cut it where the case
// says (benchmark/lib/source/cut.mjs) -- the way a session stalls until a crash takes it. A wait that ends saw no cut.
export const CUT_WAIT_MS = 180000;

const cutAwaited = (s, outcome) => (outcome === "interrupted" ? (pause(s.cutWaitMs ?? CUT_WAIT_MS), "uncut") : outcome);

// A check is one decided step -- except the first of a round that interrupts itself, which is killed mid-run, and the
// round then left for the controller to cut.
const checkOutcome = (s, x) => (s.interrupt ? cutAwaited(s, killedMidStep(s, { kind: "check", command: x.id })) : stepped(s, { kind: "check", command: x.id }).json?.outcome);

const CHECK_ENDS = { uncut: "was killed mid-run, as this control intends, and no cut came where the case interrupts the round" };

// Each check the change is required to pass, in turn -- and none after the first that does not succeed.
function checked(s) {
  const required = (contextOf(s)?.verificationPlan?.required ?? []).filter((x) => x.settled !== true);
  for (const x of required) if (((o) => o !== "succeeded" && (s.ended = `the required check ${x.id} ${CHECK_ENDS[o] ?? "did not succeed"}: the task stays where it stands`))(checkOutcome(s, x))) return [s.ended];
  return [];
}

// A change that passed its checks: committed in the task's own delivery, then reviewed -- what completes the task. An
// agent whose playbook never commits (Satellite's engineer, `commits: false`) reviews it as it stands.
function delivered(s) {
  if (s.commits !== false && (contextOf(s)?.allowed ?? []).includes("commit")) stepped(s, { kind: "commit", message: String(s.script.intent).slice(0, 200) });
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

// The workflow, one move at a time, until nothing is left to move, a move does not succeed, or what `done` asks of its
// context holds (a control that stops part-way).
function workflowRan(s, left = MAX_MOVES, done = () => false) {
  const move = left > 0 ? nextMove(s, ((c) => (done(c) ? null : c))(autoContext(s))) : null;
  const problems = move ? move() : [];
  return problems.length || !move ? problems : workflowRan(s, left - 1, done);
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

// ---- a REQUEST through /orbit-help (a workflow case, 0.5.0, ADR 0053), and the controls that fall short of it -------
//
// Where a person starts: the navigator asked about the request (`help.mjs --for`), the coordinated workflow it names
// started (`automation.mjs start --for`) and driven step by step in its own plan's order -- the goal script's own loop, its
// engineering step's task carried with the control's edits. A later round finds the workflow an earlier one started and
// carries it on, never starting a second. CODE-ONLY takes the same entry and stops once the engineering step settled: the
// change made, its QA, regression and review never run. BYPASS never enters /orbit-help or a workflow: an engineering
// task started by hand, driven to a verified change through its own loop.

const helped = (s) => told(s, "orbit-help navigator", cliCall(s, "help.mjs", [`--for=${s.script.intent}`]));

const startedWorkflow = (s) => (helped(s), told(s, "automation start", cliCall(s, "automation.mjs", ["start", `--for=${s.script.intent}`])).json?.task ?? null);

const keptWorkflow = (s) => (s.round > 1 ? (cliCall(s, "task.mjs", ["list"]).json?.tasks ?? []).find((t) => t.provider === "automation")?.id ?? null : null);

function requested(s, done) {
  s.auto = keptWorkflow(s) ?? startedWorkflow(s);
  return s.auto ? workflowRan(s, MAX_MOVES, done) : ["the request started no coordinated workflow"];
}

const engineeringSettled = (c) => (c?.plan?.steps ?? []).some((x) => x.kind === "engineering" && x.state === "succeeded");

function bypassed(s) {
  const r = told(s, "autonomous-engineering start", orbitCall(s, ["start", s.script.intent]));
  return r.json?.task ? taskCarried({ ...s, task: r.json.task, revision: null }) : [`the engineering task could not be started by hand: ${r.why}`];
}

// ---- an ACTIVATION session (0.5.0, B22 M4): a session as Claude Code has it, every hook delivered to Orbit's own -------
//
// A control's host for an activation case prints the stream Claude Code prints -- one tool call per step, each with an
// id of its own and its result -- and delivers every hook a real host would, with the payload a real host sends (the
// shapes test/fixtures/hooks/claude/ keeps), to Orbit's own entry points: cli/learn-hook.mjs, cli/router-hook.mjs and
// cli/follow-hook.mjs. What the trail says is Orbit's own code's word, and the agreement rule holds the two sources
// apart as it holds a model's. Its steps are DATA (a control's file): call a skill or an agent, run one of Orbit's own
// commands, show a command it never runs, make the edits its definition names, drive an engineering task, a workflow or
// a goal -- or forge one source without the other. It runs nothing but Orbit's own CLIs, and needs no network.

const hookedEnv = (s) => ({ ...(s.env ?? process.env), CLAUDE_PLUGIN_ROOT: s.plugin, CLAUDE_PROJECT_DIR: s.repo });

const hookAnswer = (s, file, payload) => jsonOf(String(spawnSync(process.execPath, [join(s.plugin, "cli", file)], { cwd: s.repo, env: hookedEnv(s), input: JSON.stringify(payload), encoding: "utf8", timeout: 60000 }).stdout ?? "").trim());

// A subagent's own hooks carry its id and type, as Claude Code's do; the main session's carry neither.
const payloadOf = (s, event, more) => ({ session_id: s.session, transcript_path: "/tmp/scripted-transcript.jsonl", cwd: s.repo, permission_mode: "dontAsk", hook_event_name: event, ...(s.agent ? { agent_id: s.agent.id, agent_type: s.agent.type } : {}), ...more });

export const hooked = (s, event, more = {}, files = ["learn-hook.mjs"]) => (s.plugin && s.hooks !== false ? files.map((f) => hookAnswer(s, f, payloadOf(s, event, more))) : []);

const nextId = (s, prefix) => `${prefix}_scripted_${String((s.ids.n += 1)).padStart(4, "0")}`;

const shown = (s, event) => (s.say ?? said)(s.parent ? { ...event, parent_tool_use_id: s.parent } : event);

const callShown = (s, id, name, input) => shown(s, { type: "assistant", message: { id: nextId(s, "msg"), content: [{ type: "tool_use", id, name, input }] } });

const resultShown = (s, id, isError) => shown(s, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: isError ? "the call did not succeed" : "done" }] } });

const deniedBy = (answers) => answers.some((a) => a?.hookSpecificOutput?.permissionDecision === "deny");

const ended = (s, input, failed, response) => hooked(s, failed ? "PostToolUseFailure" : "PostToolUse", failed ? { ...input, error: "the call did not succeed" } : { ...input, tool_response: response });

// One of Orbit's commands, said as Claude Code says a Bash call: its command line, its result, its hooks.
function bashTold(s, what, r) {
  const id = nextId(s, "toolu");
  const input = { tool_name: "Bash", tool_input: { command: r.line, description: what }, tool_use_id: id };
  hooked(s, "PreToolUse", input);
  callShown(s, id, "Bash", input.tool_input);
  return (resultShown(s, id, r.status !== 0), ended(s, input, r.status !== 0, { stdout: "", stderr: "" }));
}

// A placeholder a step names: `{kept}` a value an earlier step kept, `@prompt` the prompt's first line.
const filled = (s, a) => String(a).replace(/\{([a-z][a-zA-Z]*)\}/g, (m, k) => String(s.kept[k] ?? m)).replace("@prompt", String(s.prompt ?? "").split("\n")[0].trim().slice(0, 240));

const valueAt = (json, path) => String(path).split(".").reduce((v, k) => v?.[k], json);

const keptFrom = (s, keep, json) => Object.entries(keep ?? {}).forEach(([name, path]) => (s.kept[name] = valueAt(json, path) ?? s.kept[name] ?? null));

function skillCalled(s, st) {
  const id = nextId(s, "toolu");
  const input = { tool_name: "Skill", tool_input: { skill: st.name }, tool_use_id: id };
  const refused = st.hooked !== false && deniedBy(hooked(s, "PreToolUse", input)) && st.ignoreDeny !== true;
  callShown(s, id, "Skill", { skill: st.name });
  return (resultShown(s, id, refused), st.hooked === false ? null : ended(s, input, refused, { success: true, commandName: st.name }), []);
}

function agentRan(s, st, id, input) {
  const agent = { id: `agent-${id}`, type: st.name };
  hooked({ ...s, agent }, "SubagentStart");
  const problems = stepsRan({ ...s, parent: id, agent }, st.steps ?? []);
  hooked({ ...s, agent }, "SubagentStop", { stop_hook_active: false });
  return (resultShown(s, id, false), ended(s, input, false, { status: "completed", agentId: agent.id }), hooked(s, "PostToolUse", { ...input, tool_response: { status: "completed", agentId: agent.id } }, ["follow-hook.mjs"]), problems);
}

function agentCalled(s, st) {
  const id = nextId(s, "toolu");
  const input = { tool_name: "Agent", tool_input: { description: "one bounded job", prompt: "the job, in the host's own words", subagent_type: st.name }, tool_use_id: id };
  const refused = deniedBy(hooked(s, "PreToolUse", input)) && st.ignoreDeny !== true;
  callShown(s, id, "Agent", { description: input.tool_input.description, subagent_type: st.name });
  return refused ? (resultShown(s, id, true), ended(s, input, true), []) : agentRan(s, st, id, input);
}

const stdinOf = (s, st) => (st.stdin === undefined ? undefined : st.stdin === "@prompt" ? s.prompt : filled(s, st.stdin));

function orbitRan(s, st) {
  const r = cliCall(s, st.argv[0], st.argv.slice(1).map((a) => filled(s, a)), stdinOf(s, st));
  told(s, `${st.argv[0]} ${st.argv[1] ?? ""}`.trim(), r);
  keptFrom(s, st.keep, r.json);
  return r.status === 0 || st.mayFail === true ? [] : [`${st.argv.slice(0, 2).join(" ")}: ${r.why}`];
}

// A command this host SHOWS and never runs (a push, a write under a read-only agent): a scripted host runs nothing but
// Orbit's own commands, and a judge reads what the host tried.
function bashShown(s, st) {
  const id = nextId(s, "toolu");
  const input = { tool_name: "Bash", tool_input: { command: st.command, description: "a command this host shows and never runs" }, tool_use_id: id };
  hooked(s, "PreToolUse", input);
  callShown(s, id, "Bash", input.tool_input);
  return (resultShown(s, id, true), ended(s, input, true), []);
}

const editShown = (s, path) => ((id) => (callShown(s, id, "Edit", { file_path: path, old_string: "-", new_string: "-" }), resultShown(s, id, false), ended(s, { tool_name: "Edit", tool_input: { file_path: path }, tool_use_id: id }, false, { filePath: path })))(nextId(s, "toolu"));

const dataRootOf = (s) => cliCall(s, "query.mjs", ["storage"]).json?.dataRoot ?? null;

// The edits a control's definition names, made where the step says: the checkout the host was handed, or the project's
// test data in the store.
function editsMade(s, st) {
  const dir = st.root === "data" ? dataRootOf(s) : s.repo;
  if (!dir) return ["no data root to edit in"];
  const problems = edited(dir, s.edits ?? {});
  return (scopeOf(s.edits ?? {}).forEach((rel) => editShown(s, join(dir, rel))), problems);
}

// An engineering task that commits, then asks to push that commit: the push waits for a person (GIT_PUSH).
function pushedFrom(t) {
  const problems = implemented(t, prepared(t));
  const failed = problems.length ? problems : checked(t);
  if (failed.length) return failed;
  if ((contextOf(t)?.allowed ?? []).includes("commit")) stepped(t, { kind: "commit", message: String(t.script.intent).slice(0, 200) });
  return (stepped(t, { kind: "push" }), []);
}

function engineerRan(s, st) {
  const task = told(s, "autonomous-engineering start", cliCall(s, "autonomous-engineering.mjs", ["start", filled(s, st.objective)])).json?.task ?? null;
  if (!task) return ["the engineering task could not be started"];
  const t = { ...s, task, revision: null, script: { ...s.script, intent: filled(s, st.objective), definition: s.edits ?? {} } };
  return st.push ? pushedFrom(t) : applied(t);
}

const routedTask = (s) => /automation\.mjs"?\s+resume\s+(tsk-[a-f0-9]{12})/.exec(s.routed ?? "")?.[1] ?? "-";

const resumedWorkflow = (s, ref) => told(s, "automation resume", cliCall(s, "automation.mjs", ["resume", ref === "@router" ? routedTask(s) : filled(s, ref)])).json?.task ?? null;

const workflowFound = (s, st) => (st.resume ? resumedWorkflow(s, st.resume) : told(s, "automation start", cliCall(s, "automation.mjs", ["start", ...st.start.map((a) => filled(s, a))])).json?.task ?? null);

// A coordinated workflow started (or resumed) and driven step by step, its engineering step's task carried with the
// control's edits -- the goal script's own loop.
function coordinated(s, st) {
  s.auto = workflowFound(s, st);
  s.script = { ...s.script, intent: filled(s, st.intent ?? "@prompt"), definition: s.edits ?? {} };
  return s.auto ? workflowRan(s, st.moves ?? MAX_MOVES) : ["no coordinated workflow to drive"];
}

const cited = (digest, rows) => rows.map(({ line, ...r }) => ({ ...r, sourceRef: `spec@${digest}#L${line}` }));

const readingOf = (s, st, digest) => JSON.stringify({ objective: filled(s, "@prompt"), intent: { category: "change", workKinds: ["change"], verification: ["the project's own declared tests pass"], missing: [] }, requirements: cited(digest, st.requirements ?? []), acceptance: cited(digest, st.acceptance ?? []) });

// A specification read into a goal, its rows citing the lines they come from: what the grounding cases hold.
function goalRead(s, st) {
  const start = told(s, "orbit goal start", cliCall(s, "orbit.mjs", ["goal", "start", "--stdin"], s.prompt));
  if (!start.json?.id) return [`goal start: ${start.why}`];
  const r = told(s, "orbit goal analyze", cliCall(s, "orbit.mjs", ["goal", "analyze", start.json.id, "--stdin"], readingOf(s, st, start.json.specDigest)));
  return r.status === 0 ? [] : [`goal analyze: ${r.why}`];
}

// A file the host reads with its own Read tool: a path inside the checkout, answered as an error when it is not there.
const readShown = (s, st) => ((id, path) => (callShown(s, id, "Read", { file_path: path }), resultShown(s, id, !existsSync(path)), ended(s, { tool_name: "Read", tool_input: { file_path: path }, tool_use_id: id }, !existsSync(path), { type: "text" }), []))(nextId(s, "toolu"), join(s.repo, st.path));

// Forging: a trail line with no call in the stream -- the hook told of a skill nobody called.
const trailForged = (s, st) => (hooked(s, "PreToolUse", { tool_name: "Skill", tool_input: { skill: st.name }, tool_use_id: nextId(s, "toolu") }), []);

// The seed's own: a directory of the case's seed laid into the project's test data or its store, as Orbit locates them.
function copied(s, st) {
  const paths = cliCall(s, "query.mjs", ["storage"]).json;
  const to = { data: paths?.dataRoot, store: paths?.storeRoot }[st.to];
  if (!to || !existsSync(join(s.seed ?? "/run/seed", st.from))) return st.optional === true && to ? [] : [`nothing to copy ${st.from} into ${st.to}`];
  return (cpSync(join(s.seed ?? "/run/seed", st.from), to, { recursive: true }), []);
}

const unknownAct = (s, st) => [`a step this host does not know: ${st.do}`];

export const ACTS = { skill: skillCalled, agent: agentCalled, orbit: orbitRan, bash: bashShown, read: readShown, edit: editsMade, engineer: engineerRan, workflow: coordinated, goal: goalRead, trail: trailForged, copy: copied };

const stepsRan = (s, steps) => steps.reduce((problems, st) => (problems.length ? problems : (ACTS[st.do] ?? unknownAct)(s, st)), []);

// What each kind of control does when its file names no steps.
export const DEFAULT_STEPS = { idle: [], "over-eager": [{ do: "skill", name: "orbit:orbit-help" }, { do: "orbit", argv: ["automation.mjs", "start", "--for=@prompt"], mayFail: true }], forging: [{ do: "skill", name: "orbit:orbit-help", hooked: false }] };

const routedText = (answers) => String(answers[0]?.hookSpecificOutput?.additionalContext ?? "");

function stopped(s) {
  const held = hooked(s, "Stop", { stop_hook_active: false }, ["learn-hook.mjs", "follow-hook.mjs"]).some((a) => a?.decision === "block");
  if (held) hooked(s, "Stop", { stop_hook_active: true }, ["learn-hook.mjs", "follow-hook.mjs"]);
  return hooked(s, "SessionEnd", { reason: "other" });
}

// The session: its start, the person's prompt (the router's hook answers it), the control's steps, its stop and end.
function activationRan(s) {
  hooked(s, "SessionStart", { source: "startup" });
  s.routed = routedText(hooked(s, "UserPromptSubmit", { prompt: s.prompt }, ["router-hook.mjs"]));
  const problems = stepsRan(s, s.script.steps ?? DEFAULT_STEPS[s.script.kind] ?? []);
  return (stopped(s), problems);
}

// A SEEDING round: the case's seed steps (Orbit's own commands, and its files laid into place), then what the store holds
// once seeded -- the values the steps kept, and the test data's digests and what each case's steps say.
function seeded(s) {
  const problems = stepsRan({ ...s, hooks: false }, s.script.steps ?? []);
  const paths = cliCall(s, "query.mjs", ["storage"]).json;
  writeFileSync(join(s.out ?? "/work/out", "seed.json"), `${JSON.stringify({ kept: s.kept, problems, ...uitestsOf(paths?.dataRoot ?? null) }, null, 2)}\n`);
  return problems;
}

// ---- a MISSION through Orbit Satellite (a mission case, 0.5.0, ADR 0055): a session as Claude Code has it -------------
//
// Where a host handed Satellite starts: `satellite mission start` with the goal, then one decided step at a time -- the
// goal analyzed into one acceptance criterion, an explore unit and an implement unit resting on it planned, each staffed
// with the least-privilege role it needs and dispatched -- and each run launched with the Agent tool as the agent its
// envelope names, the envelope pasted verbatim as the call's prompt, with every hook Claude Code delivers around it (an
// activation session's), so the trail is Orbit's own code's word. The reader reads the file the change touches; the
// engineer drives the engineering task Satellite started, with the control's edits, in that task's own workspace and
// through its own loop, and reports it; each run is acknowledged with the agent the call answered. The mission is
// finished. Every command is Satellite's or Orbit's own, run as a host runs it, CLAUDECODE set as Claude Code sets it in
// its shell. CLAIMS makes the change in an engineering task started by hand and has the mission's one review run claim
// it, citing a file; OVER-REACH lets the reader's agent edit a file and run a command (shown, never made). A later round
// carries no mission on: the scripted host says so and stops, never starting a second.
const SATELLITE = "../satellite/cli/satellite.mjs";

const satCall = (s, args, input) => cliCall(s, SATELLITE, args, input);

function satContext(s) {
  const c = satCall(s, ["mission", "context", s.msn]).json;
  s.satRevision = c?.revision ?? s.satRevision;
  return c;
}

const decisionFor = (s, action) => JSON.stringify({ schemaVersion: 1, decisionId: `d-${s.round}-${(s.ids.d = (s.ids.d ?? 0) + 1)}`, expectedRevision: s.satRevision, action, observed: "the mission's context allows this step" });

// ONE decided step of the mission, as a Bash call of the session: judged, recorded, run and settled by Satellite.
const satStepped = (s, action) => (satContext(s), told(s, `satellite mission step ${action.kind}`, satCall(s, ["mission", "step", s.msn], decisionFor(s, action)), `mission ${action.kind}`));

const satOk = (s, action) => ((r) => (r.status === 0 ? [] : [`mission ${action.kind}: ${r.why}`]))(satStepped(s, action));

const missionAnalysisOf = (digest) => ({ kind: "analyze", intent: { facts: [{ statement: "the goal names a behaviour the project does not hold yet", sourceRef: `goal@${digest}` }], acceptanceCriteria: [{ statement: "the behaviour the goal describes holds, shown by the project's own declared tests", verification: "the engineering task's declared checks pass on the change" }] } });

function missionStarted(s) {
  s.msn = told(s, "satellite mission start", satCall(s, ["mission", "start", "--stdin"], s.goal ?? s.prompt)).json?.mission ?? null;
  return s.msn ? satOk(s, missionAnalysisOf(String(satContext(s)?.mission?.goalDigest ?? "").slice(0, 8))) : ["the mission could not be started"];
}

// The work graph each script plans: an explore unit and the implement unit resting on it -- or, for CLAIMS, one review.
const CHANGE_UNITS = (s) => [{ key: "explore", kind: "explore", objective: "find where the behaviour the goal names lives in the project" }, { key: "change", kind: "implement", objective: String(s.script.intent).slice(0, 200), dependsOn: ["explore"], acceptanceCriteriaRefs: ["acc-1"] }];

const UNITS_OF = { mission: CHANGE_UNITS, "over-reach": CHANGE_UNITS, claims: () => [{ key: "review", kind: "review", objective: "review the change the goal asks for", acceptanceCriteriaRefs: ["acc-1"] }] };

const planned = (s) => satOk(s, { kind: "plan", units: UNITS_OF[s.script.mode](s) });

// The role each kind of unit is staffed with: the least privilege its kind needs, and nothing a role may not say.
const READER = { profile: "READ_ONLY", purpose: "Find what the goal needs read, and cite where it is.", restrictions: ["It never changes a file or runs a command."], completionCriteria: ["Every finding cites the file that shows it."] };

const ROLES = { explore: { ...READER, responsibilities: [{ activity: "explore", subject: "project code" }] }, review: { ...READER, responsibilities: [{ activity: "review", subject: "the change" }] }, implement: { responsibilities: [{ activity: "implement", subject: "the change" }], profile: "IMPLEMENT", purpose: "Make the change the goal asks for in the engineering task's own workspace.", restrictions: ["It edits only inside the engineering task workspace."], completionCriteria: ["The engineering task completes on its own verification."] } };

const staffed = (s, unit, kind) => ((role) => (role.length ? role : satOk(s, { kind: "resolve-template", unit })))(satOk(s, { kind: "resolve-role", unit, ...ROLES[kind] }));

const envelopeOf = (s, unit) => satStepped(s, { kind: "dispatch", unit }).json?.result?.envelope ?? null;

// A run carried as Claude Code carries one: an Agent call whose prompt is the envelope, verbatim, as the agent its
// envelope names -- the agent's own hooks around what `body` does as that agent, and the agent the call answered with.
function envelopeCarried(s, envelope, body) {
  const id = nextId(s, "toolu");
  const input = { tool_name: "Agent", tool_input: { description: `carry ${envelope.agentRunId}`, prompt: JSON.stringify(envelope), subagent_type: envelope.agent.subagentType }, tool_use_id: id };
  hooked(s, "PreToolUse", input);
  callShown(s, id, "Agent", { description: input.tool_input.description, subagent_type: input.tool_input.subagent_type });
  return agentCarried(s, body, { id, input, agent: { id: `agent-${id}`, type: envelope.agent.subagentType } });
}

function agentCarried(s, body, call) {
  hooked({ ...s, agent: call.agent }, "SubagentStart");
  const problems = body({ ...s, parent: call.id, agent: call.agent });
  hooked({ ...s, agent: call.agent }, "SubagentStop", { stop_hook_active: false });
  return (resultShown(s, call.id, false), ended(s, call.input, false, { status: "completed", agentId: call.agent.id }), hooked(s, "PostToolUse", { ...call.input, tool_response: { status: "completed", agentId: call.agent.id } }, ["follow-hook.mjs"]), { agent: call.agent.id, problems });
}

const acked = (s, envelope, agent) => told(s, "satellite agent ack", satCall(s, ["agent", "ack", s.msn, envelope.agentRunId, `--host-agent=${agent}`]));

const reportSaid = (s, envelope, report) => ((r) => (r.status === 0 ? [] : [`agent report ${envelope.agentRunId}: ${r.why}`]))(told(s, "satellite agent report", satCall(s, ["agent", "report", s.msn, envelope.agentRunId], JSON.stringify(report))));

// What a reader does in its run: reads the file the change touches -- and, OVER-REACHING, edits it and runs a command its
// agent has no tool for, both shown and neither made.
const overReached = (t, rel) => (editShown(t, join(t.repo, rel)), bashShown(t, { command: `touch ${rel}` }));

const readerDid = (t, rel) => (readShown(t, { path: rel }), t.script.mode === "over-reach" ? overReached(t, rel) : [], []);

const readerReport = (envelope, rel, claim) => ({ schemaVersion: 1, agentRunId: envelope.agentRunId, executionState: "reported", findings: [{ say: claim ? "the change the goal asks for is made, and its tests pass" : `the behaviour the goal names lives in ${rel}`, refs: [`file:${rel}`] }], evidenceRefs: [`file:${rel}`], remainingUnknowns: [], summary: claim ? "the change is in, and nothing else is owed" : `the change belongs in ${rel}` });

// A read-only run: dispatched, carried by its reader, acknowledged and reported by the session (a reader runs nothing).
function readCarried(s, unit, rel, claim = false) {
  const envelope = envelopeOf(s, unit);
  if (!envelope) return [`dispatch ${unit}: no envelope came back`];
  const run = envelopeCarried(s, envelope, (t) => readerDid(t, rel));
  return run.problems.length ? run.problems : (acked(s, envelope, run.agent), reportSaid(s, envelope, readerReport(envelope, rel, claim)));
}

// The engineer's report: the task its envelope drives, and every check that task's runner ran -- read back by Satellite.
const checksOf = (e) => (cliCall(e, "task.mjs", ["show", e.task]).json?.receipts ?? []).filter((r) => r.domain === "check").map((r) => `check:${e.task}:${r.ref}`);

const engineerReport = (e, envelope) => ({ schemaVersion: 1, agentRunId: envelope.agentRunId, executionState: "reported", findings: [{ say: "the change is made in the engineering task's own workspace, and its declared checks ran", refs: [`task:${e.task}`] }], evidenceRefs: [`task:${e.task}`, ...checksOf(e)].slice(0, 16), remainingUnknowns: [], summary: "the engineering task completed on its own verification" });

const editsShownIn = (e) => ((ws) => (ws ? scopeOf(e.script.definition).forEach((rel) => editShown(e, join(ws, rel))) : null))(contextOf(e)?.workspace?.path);

// What the engineer does in its run: drives the task its envelope names through the task's own loop with the control's
// edits, never committing, then reports the task.
function engineerDid(t, envelope) {
  const e = { ...t, task: envelope.drive.task, revision: null, commits: false };
  const problems = applied(e);
  editsShownIn(e);
  return problems.length ? problems : reportSaid(e, envelope, engineerReport(e, envelope));
}

function implementCarried(s, unit) {
  const envelope = envelopeOf(s, unit);
  if (!envelope?.drive?.task) return [`dispatch ${unit}: Satellite started no engineering task for it`];
  const run = envelopeCarried(s, envelope, (t) => engineerDid(t, envelope));
  return (acked(s, envelope, run.agent), run.problems);
}

const finishedMission = (s) => ((r) => (r.status === 0 ? [] : [`mission finish: ${r.why}`]))(told(s, "satellite mission finish", satCall(s, ["mission", "finish", s.msn])));

const sourceOf = (s) => scopeOf(s.script.definition ?? {}).find((rel) => rel.startsWith("src/")) ?? "README.md";

const CHANGE_STEPS = [missionStarted, planned, (s) => staffed(s, "wu-1", "explore"), (s) => readCarried(s, "wu-1", sourceOf(s)), (s) => staffed(s, "wu-2", "implement"), (s) => implementCarried(s, "wu-2"), finishedMission];

const MISSION_STEPS = { mission: CHANGE_STEPS, "over-reach": CHANGE_STEPS, claims: [missionStarted, planned, bypassed, (s) => staffed(s, "wu-1", "review"), (s) => readCarried(s, "wu-1", sourceOf(s), true), finishedMission] };

const missionSteps = (s) => (s.round > 1 ? [`round ${s.round}: a scripted mission host carries no mission on across rounds`] : MISSION_STEPS[s.script.mode].reduce((problems, step) => (problems.length ? problems : step(s)), []));

// The session: its start, the round's prompt (the router's hook answers it), the mission's steps, its stop and end.
function missionRan(s) {
  s.env = { ...(s.env ?? process.env), CLAUDECODE: "1" };
  hooked(s, "SessionStart", { source: "startup" });
  hooked(s, "UserPromptSubmit", { prompt: s.prompt }, ["router-hook.mjs"]);
  const problems = missionSteps(s);
  return (stopped(s), problems);
}

// What a script does: APPLY its definition through a repair's loop, take a GOAL through Orbit's goal entry, stop on a
// goal that is BLOCKED by a missing rule, INTERRUPT its own first round, or sit IDLE -- change nothing at all; an
// ACTIVATION session, or the SEED of one; a REQUEST through /orbit-help (`workflow`), the same stopped once the change is
// made (`code-only`), or the change made with no workflow at all (`bypass`); a goal through Orbit Satellite (`mission`),
// the change claimed by a mission no owner's record backs (`claims`), or a reader's agent outside its profile
// (`over-reach`).
export const SCRIPTS = { apply: applied, goal: (s) => goalRan(s, []), blocked: (s) => goalRan(s, MISSING), interrupt: (s) => goalRan(s, []), idle: () => [], activation: activationRan, seed: seeded, workflow: (s) => requested(s), "code-only": (s) => requested(s, engineeringSettled), bypass: bypassed, mission: missionRan, claims: missionRan, "over-reach": missionRan };

// Where Orbit would be in an activation round's container. On the arm with no Orbit nothing is there: no hook is
// delivered, and every command of Orbit's a host types fails as it would.
const PLUGIN_AT = "/work/orbit";

// The scripts that play a whole Claude Code session -- every hook delivered, every command said as a Bash call.
const SESSIONS = ["activation", "mission", "claims", "over-reach"];

const activationOf = (b) => (SESSIONS.includes(b.script?.mode) ? { session: b.script.session ?? `scripted-${b.script.id ?? "session"}`, prompt: b.prompt ?? "", tell: bashTold, plugin: b.plugin ?? PLUGIN_AT, hooks: b.plugin ? undefined : false } : { prompt: b.prompt ?? "" });

export const stateOf = (b, task) => ((round) => ({ task: /^tsk-[a-f0-9]{12}$/.test(task ?? "") ? task : null, repo: PATHS.repo, plugin: b.plugin ?? PATHS.repo, script: b.script ?? {}, goal: b.goal ?? null, round, interrupt: b.script?.mode === "interrupt" && round === 1, revision: null, steps: [], ids: { n: 0 }, kept: {}, parent: null, agent: null, edits: b.script?.edits ?? null, ...activationOf(b) }))(b.round ?? 1);

// A repair script needs its task readable first; a goal script starts from the goal itself.
export const ranScript = (s) => (s.task && !contextOf(s) ? ["the engineering task could not be read"] : (SCRIPTS[s.script.mode] ?? SCRIPTS.apply)(s));

function main(task) {
  const s = { ...stateOf(JSON.parse(readFileSync(PATHS.brief, "utf8")), task), startedAt: Date.now() };
  said({ type: "system", subtype: "init", model: `scripted:${s.script.id ?? "unnamed"}`, session_id: s.session ?? `scripted-${s.task ?? "goal"}`, claude_code_version: null });
  const problems = ranScript(s);
  said({ type: "result", subtype: problems.length ? "error_during_execution" : "success", is_error: problems.length > 0, num_turns: s.steps.length, total_cost_usd: 0, duration_ms: Date.now() - s.startedAt, result: problems.join("; ").slice(0, 300) || "the script ran to its end", steps: s.steps });
}

const ENTRY = { "--kill-mid-step": (argv) => killMidStep(argv) };

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) (ENTRY[process.argv[2]] ?? (() => main(process.argv[2])))(process.argv.slice(3));
