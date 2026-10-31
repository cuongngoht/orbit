// THE QA RELAY: how a coding host in a runner container -- no Docker, no store of the run, no way to the application --
// drives an investigation whose engine runs beside the controller, where the isolated sandbox is. A mailbox of files
// and nothing else: the runner writes a request into requests/ (its own to write); the controller answers into
// responses/ (which the runner reads and cannot write). Every request is ONE autonomous-qa subcommand held to RELAY: a
// subcommand the table names, only the flags it allows with the values they may carry, the run's own investigation and
// no other, and a decision or a plan on stdin -- never a path. A person's approvals (settings, answer, release, cancel),
// a second investigation (plan) and the browser of an environment (explore, act, check-data, security) are refused by
// name and never run. What the engine then does with a decision is the engine's: its own gates judge it.
//
//   RELAY -> rows            admitted(request, investigation) -> { argv, stdin, budget } | { refused }
//   relayServer(dirs, serve, o) -> { stop() }      serve(admitted) -> Promise<{ exit, stdout, stderr }>
import { lstatSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha } from "../../../src/hash.mjs";

export const MAX_REQUEST = 512 * 1024;

export const MAX_OUTPUT = 2 * 1024 * 1024;

// A request's file name: the runner's choice, held to a shape that can never be a path.
export const REQUEST_NAME = /^[A-Za-z0-9._-]{1,80}\.json$/;

const TEXT = /^[^\u0000-\u001f\u007f]{1,240}$/;

// The values a flag may carry: `true` is a flag with no value; anything else is a pattern its value must match.
const FLAGS = { json: true, why: TEXT, finding: /^fnd-\d{1,6}$/ };

// What a host may ask, by subcommand: its flags, whether it reads a decision or a plan on stdin, which time budget
// bounds it, and whether it is about the run's investigation (every one but the two that list or print the protocol).
export const RELAY = {
  protocol: { flags: [], stdin: false, budget: "call", about: false },
  list: { flags: ["json"], stdin: false, budget: "call", about: false },
  context: { flags: [], stdin: false, budget: "call", about: true },
  derive: { flags: [], stdin: false, budget: "call", about: true },
  show: { flags: ["json"], stdin: false, budget: "call", about: true },
  report: { flags: ["json"], stdin: false, budget: "call", about: true },
  investigate: { flags: ["json"], stdin: false, budget: "call", about: true },
  step: { flags: [], stdin: true, budget: "step", about: true },
  checkpoint: { flags: [], stdin: false, budget: "step", about: true },
  reconcile: { flags: ["json"], stdin: false, budget: "step", about: true },
  reproduce: { flags: ["finding", "json"], stdin: false, budget: "step", about: true },
  draft: { flags: ["finding", "json"], stdin: false, budget: "call", about: true },
  "draft-plan": { flags: [], stdin: true, budget: "call", about: true },
  finish: { flags: ["why"], stdin: false, budget: "step", about: true },
  resume: { flags: ["why"], stdin: false, budget: "call", about: true },
};

// Why the subcommands the table leaves out are left out, said to the host that asked.
const NOT_RELAYED = {
  plan: "this run's investigation is already open: the controller opened it, on the run's own sandbox",
  settings: "a setting is a person's approval, never a host's",
  answer: "an answer is a person's word, never a host's",
  release: "releasing a step is a person's, once they looked at what it did",
  cancel: "cancelling is a person's",
  explore: "the sandbox is isolated: it has no origin to explore -- design a test and run its version",
  act: "the sandbox is isolated: it has no browser to act in -- design a test and run its version",
  "check-data": "the sandbox is isolated: read data in a test's design, through the engine",
  security: "this run's mode settles permissions with generated tests, not the tenant matrix",
  "link-run": "a run directory is a path on the controller's machine",
};

const refused = (why) => ({ refused: why });

const flagOf = (arg) => /^--([a-z][a-z-]*)(?:=([\s\S]*))?$/.exec(arg);

// One `--name[=value]` the row allows, with a value its pattern takes -- or why not.
function flagProblem(row, m, investigation) {
  if (!m) return "takes no words, only --flags";
  if (m[1] === "investigation") return m[2] === investigation ? null : `names another investigation: this run's is ${investigation}`;
  if (!row.flags.includes(m[1])) return `takes no --${m[1]} here`;
  return FLAGS[m[1]] === true ? (m[2] === undefined ? null : `--${m[1]} takes no value`) : FLAGS[m[1]].test(m[2] ?? "") ? null : `--${m[1]} does not hold a value it may carry`;
}

const stdinProblem = (row, stdin) => (typeof stdin !== "string" || stdin === "" ? null : !row.stdin ? "reads nothing on stdin" : Buffer.byteLength(stdin) > MAX_REQUEST ? "its stdin is larger than a decision is" : null);

const shapeProblem = (req) => (!req || !Array.isArray(req.argv) || req.argv.length < 1 || req.argv.length > 16 || !req.argv.every((a) => typeof a === "string" && a.length <= 4096 && !a.includes("\u0000")) ? "is not a request: { argv: [subcommand, --flags], stdin }" : null);

const kept = (flags) => flags.filter((m) => m[1] !== "investigation").map((m) => m[0]);

// A request, admitted as the argument list the engine is run with -- the run's investigation always its own -- or
// refused with why.
export function admitted(req, investigation) {
  const shape = shapeProblem(req);
  if (shape) return refused(shape);
  const [sub, ...rest] = req.argv;
  if (!Object.hasOwn(RELAY, sub)) return refused(`the relay runs no \`${sub}\`: ${NOT_RELAYED[sub] ?? "it is not one of the subcommands an investigation's host runs"}`);
  return rowAdmitted(RELAY[sub], sub, rest.map((a) => [a, flagOf(a)]), req, investigation);
}

function rowAdmitted(row, sub, parsed, req, investigation) {
  const bad = [...parsed.map(([a, m]) => flagProblem(row, m, investigation) && `${a.slice(0, 60)} ${flagProblem(row, m, investigation)}`), stdinProblem(row, req.stdin)].filter(Boolean);
  if (bad.length) return refused(`\`${sub}\` ${bad.join("; ")}`);
  const flags = kept(parsed.map(([, m]) => m));
  return { argv: [sub, ...(row.about ? [`--investigation=${investigation}`] : []), ...flags], stdin: row.stdin ? (req.stdin ?? "") : "", budget: row.budget };
}

// ---- the mailbox -----------------------------------------------------------------------------------------------------

const cut = (text) => (Buffer.byteLength(String(text ?? "")) > MAX_OUTPUT ? `${String(text).slice(0, MAX_OUTPUT)}\n[cut at ${MAX_OUTPUT} bytes]` : String(text ?? ""));

// A request the runner left: a regular file of a request's size under a name of a request's shape, or nothing --
// a link, a pipe or a directory is removed unread (a link itself, never what it points at).
function requestAt(dir, name) {
  const st = lstatSync(join(dir, name), { throwIfNoEntry: false });
  const ok = st?.isFile() === true && st.size <= MAX_REQUEST;
  const text = ok ? readFileSync(join(dir, name), "utf8") : null;
  rmSync(join(dir, name), { recursive: true, force: true });
  return text === null ? null : parsedRequest(text);
}

function parsedRequest(text) {
  try { return JSON.parse(text); }
  catch { return { argv: null }; }
}

const pending = (dir) => readdirSync(dir).filter((n) => REQUEST_NAME.test(n)).sort();

const answered = (dirs, name, answer) => (writeFileSync(join(dirs.responses, `.${name}.part`), `${JSON.stringify({ v: 1, ...answer, stdout: cut(answer.stdout), stderr: cut(answer.stderr) })}\n`), renameSync(join(dirs.responses, `.${name}.part`), join(dirs.responses, name)));

// What the controller keeps of every request: which subcommand, its flags, the decision's size and digest -- never
// the decision itself, which the engine's own journal keeps -- how it ended and how long it took.
const logged = (dirs, line) => writeFileSync(dirs.log, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`, { flag: "a" });

async function servedOne(dirs, serve, name) {
  const req = requestAt(dirs.requests, name);
  const a = req ? serve.admit(req) : { refused: "is not a regular file a request is" };
  const started = Date.now();
  const answer = a.refused ? { exit: 2, stdout: "", stderr: `REFUSED ${a.refused}\n` } : await serve.run(a);
  return finishedOne(dirs, name, req, a, { ...answer, ms: Date.now() - started });
}

function finishedOne(dirs, name, req, a, answer) {
  answered(dirs, name, answer);
  logged(dirs, { request: name, sub: req?.argv?.[0] ?? null, argv: a.argv ?? null, stdin: req?.stdin ? { bytes: Buffer.byteLength(req.stdin), digest: sha(req.stdin).slice(0, 16) } : null, refused: a.refused ?? null, exit: answer.exit, ms: answer.ms });
  return answer;
}

// One request served at a time; one the controller cannot even remove is set aside, so it never holds up the next.
async function tick(dirs, serve, state) {
  if (state.busy || state.stopped) return;
  const next = pending(dirs.requests).find((n) => !state.setAside.has(n));
  if (!next) return;
  state.busy = servedOne(dirs, serve, next).catch((e) => (state.setAside.add(next), logged(dirs, { request: next, error: String(e?.message ?? e).slice(0, 300) }))).finally(() => ((state.busy = null), (state.served += 1)));
}

// The controller's side of the mailbox: one request at a time, oldest first, while a round runs.
export function relayServer(dirs, serve, o = {}) {
  const state = { busy: null, stopped: false, served: 0, setAside: new Set() };
  const timer = setInterval(() => tick(dirs, serve, state), o.everyMs ?? 200);
  return { state, stop: async () => (clearInterval(timer), (state.stopped = true), await state.busy, state.served) };
}
