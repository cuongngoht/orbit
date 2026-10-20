// A task's SANDBOX in Control: what it is, what its processes said, and a person's two decisions about
// it -- Stop and Release. The sandbox is the TASK's: Control finds it from the task's own journal (the
// latest `sandbox` receipt names its environment) and never from a path or a body, and starts nothing:
// a sandbox is prepared and started by the agent's loop, so there is no start, restart or build route
// here and no field of any request can name an environment, a session's pid, a path or a command.
//
// Every read and decision goes through the SAME runtime command table cli/runtime.mjs runs, bound to
// the sandbox the task owns (skills/orbit-runtime/bind.mjs), so what a page shows and what a
// terminal prints are one answer. The environment a receipt names is only a CLAIM until the checkout's
// own sandboxes agree: another task's environment in this task's journal is a conflict, an unknown one
// a 404, and a malformed one is refused before a runtime is bound at all.
import { claimedEnvironment, isRefusal, NO_SANDBOX, RUNTIME_COMMANDS, Refused, sessionRefusal, TASK_COMMANDS, witnessedBy } from "../core.mjs";
import { conflict, guarded, invalid, missing } from "../errors.mjs";
import { fieldsOf } from "../project-runtime/body.mjs";
import { runtimeOf, sandboxOf } from "../project-runtime/project.mjs";
import { taskIdOf, tasksOf } from "./project.mjs";

const CODE = "SANDBOX_UNAVAILABLE";
const BODY = "SANDBOX_BODY_INVALID";
const TAIL = { fallback: 200, most: 1000 };

const NONE = NO_SANDBOX;

// The live core's answers (src/live/logs.mjs) are data; here each refusal becomes the page's HTTP error.
const STOPS = { invalid, missing, conflict };

function answered(x) {
  if (isRefusal(x)) throw STOPS[x.refusal](x.code, x.why);
  return x;
}

// What the task's journal CLAIMS: the environment its latest sandbox receipt names, or null.
function claimed(ctx, ids) {
  const task = taskIdOf(ids[2]);
  return { task, env: answered(claimedEnvironment(TASK_COMMANDS.show.run(tasksOf(ctx, ids), [task]))) };
}

// The checkout's own sandboxes are the witness of a receipt's claim: unknown here, or another task's.
async function witnessed(ctx, ids, { task, env }) {
  const { sandboxes } = await RUNTIME_COMMANDS.sandboxes.run(runtimeOf(ctx, ids), []);
  return answered(witnessedBy(sandboxes, env, task));
}

// The sandbox context of what the task's journal names, once the checkout agrees -- or null when it names none.
async function sandboxIn(ctx, ids) {
  const named = claimed(ctx, ids);
  if (named.env === null) return null;
  await witnessed(ctx, ids, named);
  return { ...named, bound: () => sandboxOf(ctx, ids, named.task) };
}

const viewOf = async (sandbox) => ({ sandbox: await RUNTIME_COMMANDS.sandbox.run(sandbox.bound(), [`--task=${sandbox.task}`]) });

// A receipt with no workspace behind it any more is a sandbox that is gone, not a fault of the page.
const gone = (e) => (e instanceof Refused ? { sandbox: null, because: e.message } : Promise.reject(e));

async function read(ctx, ids) {
  const sandbox = await sandboxIn(ctx, ids);
  if (sandbox === null) return { sandbox: null, because: NONE };
  return viewOf(sandbox).catch(gone);
}

export const readSandbox = (ctx, ids) => guarded(CODE, () => read(ctx, ids));

// The one door to a process's output: bounded and scrubbed by the runtime, never a path built here.
function logArgs(task, session, query) {
  const stream = query?.stream ?? "out";
  answered(sessionRefusal(session, stream) ?? true);
  return [`--task=${task}`, `--session=${session}`, `--stream=${stream}`, windowOf(query)];
}

// The last lines (a person opening the log), or everything from a byte offset on (a live console asking only for what is new).
const windowOf = (query) => (query?.from === undefined ? `--tail=${tailOf(query?.tail)}` : `--from=${offsetOf(query.from)}`);

function offsetOf(raw) {
  if (!/^\d{1,12}$/.test(String(raw))) throw invalid("SANDBOX_QUERY_INVALID", "from is a byte offset into the log: a whole number");
  return Number(raw);
}

function tailOf(raw) {
  if (raw === undefined) return TAIL.fallback;
  if (!/^\d{1,4}$/.test(raw) || Number(raw) < 1 || Number(raw) > TAIL.most) throw invalid("SANDBOX_QUERY_INVALID", `tail is a whole number of lines from 1 to ${TAIL.most}`);
  return Number(raw);
}

async function logsOf(ctx, ids, query) {
  const args = logArgs(taskIdOf(ids[2]), ids[3], query);
  const sandbox = await sandboxIn(ctx, ids);
  if (sandbox === null) throw missing("SANDBOX_UNKNOWN", NONE);
  return RUNTIME_COMMANDS["sandbox-logs"].run(sandbox.bound(), args);
}

export const sandboxLogs = (ctx, ids, query) => guarded(CODE, () => logsOf(ctx, ids, query));

// A LIVE log reader: the same checks a read makes -- the session's id, the stream's name, the task's own sandbox
// witnessed by the checkout -- made ONCE, then a reader the live console asks at its own offset, through the same
// runtime command. Control never builds a log's path, and every line is placed and scrubbed by the runtime.
async function readerOf(ctx, ids, query) {
  const args = logArgs(taskIdOf(ids[2]), ids[3], { stream: query?.stream, from: "0" }).slice(0, 3);
  const sandbox = await sandboxIn(ctx, ids);
  if (sandbox === null) throw missing("SANDBOX_UNKNOWN", NONE);
  const bound = sandbox.bound();
  return { key: `${sandbox.env}/${args.slice(1).join("/")}`, read: (from) => guarded(CODE, () => RUNTIME_COMMANDS["sandbox-logs"].run(bound, [...args, `--from=${from}`])) };
}

export const logReader = (ctx, ids, query) => guarded(CODE, () => readerOf(ctx, ids, query));

// Stop and Release are a person's: the body is `{ human: true }` and nothing else, and what it asks
// of the runtime is the command of the same name over this task's sandbox.
function personal(name, body) {
  const given = fieldsOf(body, { human: "boolean" }, BODY);
  if (given.human !== true) throw invalid("HUMAN_REQUIRED", `${name} ends what a task's sandbox is running or holds: it is a person's — send { human: true } from the button a person pressed`);
}

// What the runtime answers as DATA (so a task's own cleanup can read it) and a page must be told is a conflict: releasing
// what was released already.
const CONFLICTS = { "sandbox-release": (r) => (r.released === false && r.reason === "RELEASED" ? "SANDBOX_RELEASED" : null) };

// The runtime's answer, or the conflict it says a page must be told.
function asked(command, result) {
  const code = CONFLICTS[command]?.(result) ?? null;
  if (code) throw conflict(code, result.why);
  return result;
}

async function decide(command, ctx, ids) {
  const sandbox = await sandboxIn(ctx, ids);
  if (sandbox === null) throw missing("SANDBOX_UNKNOWN", NONE);
  const result = asked(command, await RUNTIME_COMMANDS[command].run(sandbox.bound(), [`--task=${sandbox.task}`]));
  return { result, ...(await viewOf(sandbox)) };
}

const decided = (name, command) => (ctx, ids, body) => {
  personal(name, body);
  return guarded("SANDBOX_OPERATION_FAILED", () => decide(command, ctx, ids));
};

export const stopSandbox = decided("stop", "sandbox-stop");
export const releaseSandbox = decided("release", "sandbox-release");
