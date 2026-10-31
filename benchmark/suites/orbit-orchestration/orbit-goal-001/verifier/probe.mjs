// THE PROBE of ORBIT-GOAL-001: the one piece of the verifier that runs the SUBJECT's code. It is handed the subject's
// root as its argument and the inputs on stdin, imports the subject's own goal commands, goal store, goal model and
// file-system port, and prints ONE line: the raw answer to every input (the ids of what the goal's journal says), or
// why it could not answer. It judges nothing -- what an answer should have been is computed elsewhere, by a judge that
// never imports the subject -- so whatever the subject's code does in this process, it can only change its own answers.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: "goal", workKinds, ops: [step | end | resume] }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
//
// Each input is played on a goal store of its own, in a new directory under the temporary directory, removed after:
// the goal is started, analyzed with the work kinds it names, planned; then `step` steps it (the automation port
// starts task tsk-…1, tsk-…2, … in turn, each EXECUTING), `end` gives a task the lifecycle its view would show, and
// `resume` resumes the goal with the task views as they stand. The answer is what the goal's journal then says.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { commands: ["src/goal/commands.mjs", ["startGoal", "analyzeGoal", "planGoal", "stepGoal", "resumeGoal"]], store: ["src/goal/store.mjs", ["createGoals"]], model: ["src/goal/model.mjs", ["modelOf", "frontierOf", "lifecycleOf"]], io: ["src/store/io.mjs", ["realIo"]] };

const CTX = { project: "acme-web", checkout: "co-111111111111", session: "s-1", host: "probe" };

const SPEC = "Ship the refund rule\nAC1: refunds over thirty days need a manager\n";

const TERMINAL = ["COMPLETED", "FAILED", "CANCELLED"];

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

const taskId = (n) => `tsk-${String(n).padStart(12, "0")}`;

const summary = (n, lifecycle) => ({ id: taskId(n), lifecycle, terminal: TERMINAL.includes(lifecycle), stopReason: lifecycle === "FAILED" ? "VERIFICATION_FAILED" : null });

function startedTask(w) {
  w.started += 1;
  w.summaries.set(taskId(w.started), summary(w.started, "EXECUTING"));
  return { task: taskId(w.started), created: true };
}

function worldOf(m, store) {
  const io = m.io.realIo();
  const w = { summaries: new Map(), started: 0 };
  w.ports = { ctx: CTX, io, goals: m.store.createGoals(store, io), automation: { start: () => startedTask(w) }, taskSummaries: () => [...w.summaries.values()] };
  return w;
}

const analysisOf = (kinds, digest) => ({ objective: "Ship the refund rule", intent: { category: "change", workKinds: kinds }, requirements: [], acceptance: [{ statement: "refunds over thirty days need a manager", sourceRef: `spec@${digest}#L2` }], unknowns: [], conflicts: [] });

function goalOf(m, w, kinds) {
  const g = m.commands.startGoal(w.ports, SPEC);
  m.commands.analyzeGoal(w.ports, g.id, analysisOf(kinds, g.specDigest));
  m.commands.planGoal(w.ports, g.id);
  return g.id;
}

const OPS = {
  step: (m, w, id) => m.commands.stepGoal(w.ports, id),
  end: (m, w, id, op) => w.summaries.set(taskId(op.task), summary(op.task, op.lifecycle)),
  resume: (m, w, id) => m.commands.resumeGoal(w.ports, id),
};

// A unit is named by the kind the plan gave it, looked up by the unit's own key in the goal's model.
const kindsOf = (records) => new Map(records.filter((r) => r.kind === "planned").at(-1).units.map((u) => [u.id, u.kind]));

const keyOf = (model, unit) => [...model.units.entries()].find(([, u]) => u === unit)?.[0] ?? unit.id;

function answerOf(m, w, id) {
  const records = w.ports.goals.read(id);
  const kind = kindsOf(records);
  const model = m.model.modelOf(records);
  return [...[...model.units.entries()].map(([key, u]) => `unit:${kind.get(key)}:${u.state}`), ...m.model.frontierOf(model).map((u) => `frontier:${kind.get(keyOf(model, u))}`), `life:${m.model.lifecycleOf(model)}`];
}

function played(m, store, input) {
  const w = worldOf(m, store);
  const id = goalOf(m, w, input.workKinds);
  for (const op of input.ops) OPS[op.op](m, w, id, op);
  return answerOf(m, w, id);
}

function goalIds(m, input) {
  const store = mkdtempSync(join(tmpdir(), "orbit-goal-probe-"));
  try { return played(m, store, input); }
  finally { rmSync(store, { recursive: true, force: true }); }
}

const CALLS = {
  goal: goalIds,
};

const answered = (m, i) => {
  try { return { id: i.id, got: CALLS[i.call](m, i) }; }
  catch (e) { return { id: i.id, threw: String(e?.message ?? e).slice(0, 200) }; }
};

function inputsOf(text) {
  try { return JSON.parse(text).inputs.filter((i) => Object.hasOwn(CALLS, i?.call)); }
  catch { return null; }
}

async function main() {
  const inputs = inputsOf(await stdin());
  const m = inputs ? await loaded(process.argv[2]) : { error: { code: "INPUT", message: "the inputs could not be read" } };
  process.stdout.write(`${JSON.stringify(m.error ? { error: m.error } : { answers: inputs.map((i) => answered(m, i)) })}\n`);
}

main();
