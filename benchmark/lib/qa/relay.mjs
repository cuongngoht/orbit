// THE QA RELAY: how a coding host in a runner container -- no Docker, no store of the run, no way to the application --
// drives an investigation whose engine runs beside the controller, where the isolated sandbox is. A mailbox of files
// and nothing else: the runner writes a request into requests/ (its own to write); the controller answers into
// responses/ (which the runner reads and cannot write). Every request is ONE autonomous-qa subcommand held to RELAY: a
// subcommand the table names, only the flags it allows with the values they may carry, the run's own investigation and
// no other, and a decision or a plan on stdin -- never a path. A person's approvals (settings, answer, release, cancel),
// a second investigation (plan) and the browser of an environment (explore, act, check-data, security) are refused by
// name and never run. What the engine then does with a decision is the engine's: its own gates judge it.
//
// A HELP PROBE (0.5.0, backlog B9) -- `--help` or `-h` anywhere, `help <subcommand>`, or no subcommand at all, the probe
// the engine's own refusals name (`node cli/autonomous-qa.mjs --help for the usage`) -- is answered by the relay itself
// and never reaches the engine, so it costs the engine nothing: the usage of the subcommand it names, as the engine's CLI
// documents it in its own usage header (read from the run's frozen source, never run), with what the relay takes of it;
// of the whole CLI, every subcommand the relay carries; of one it does not carry, why, and what it does carry.
//
//   RELAY -> rows            admitted(request, investigation) -> { argv, stdin, budget } | { help } | { refused }
//   usageAt(engineDir) -> [line] | null      helpAnswer(usage, help, investigation) -> { exit: 0, stdout, stderr }
//   relayServer(dirs, serve, o) -> { stop() }      serve(admitted) -> Promise<{ exit, stdout, stderr }>
import { lstatSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha } from "../../../src/hash.mjs";
import { printable } from "../../../src/printable.mjs";
import { scrub } from "../../../src/scrub.mjs";
import { headerOf } from "../../../src/trace/commands.mjs";

export const MAX_REQUEST = 512 * 1024;

export const MAX_OUTPUT = 2 * 1024 * 1024;

// A request's file name: the runner's choice, held to a shape that can never be a path.
export const REQUEST_NAME = /^[A-Za-z0-9._-]{1,80}\.json$/;

const TEXT = /^[^\u0000-\u001f\u007f]{1,240}$/;

// The values a flag may carry -- `value` null for a flag that takes none, else the pattern its value must match -- and
// how a help answer shows it.
const FLAGS = {
  json: { value: null, shown: "--json" },
  why: { value: TEXT, shown: '--why="…" (one line)' },
  finding: { value: /^fnd-\d{1,6}$/, shown: "--finding=fnd-<n>" },
};

// What a host may ask, by subcommand: its flags, what it reads on stdin (a decision, a plan, or nothing), which time
// budget bounds it, and whether it is about the run's investigation (every one but the two that list or print the
// protocol).
export const RELAY = {
  protocol: { flags: [], stdin: false, budget: "call", about: false },
  list: { flags: ["json"], stdin: false, budget: "call", about: false },
  context: { flags: [], stdin: false, budget: "call", about: true },
  derive: { flags: [], stdin: false, budget: "call", about: true },
  show: { flags: ["json"], stdin: false, budget: "call", about: true },
  report: { flags: ["json"], stdin: false, budget: "call", about: true },
  investigate: { flags: ["json"], stdin: false, budget: "call", about: true },
  step: { flags: [], stdin: "a decision", budget: "step", about: true },
  checkpoint: { flags: [], stdin: false, budget: "step", about: true },
  reconcile: { flags: ["json"], stdin: false, budget: "step", about: true },
  reproduce: { flags: ["finding", "json"], stdin: false, budget: "step", about: true },
  draft: { flags: ["finding", "json"], stdin: false, budget: "call", about: true },
  "draft-plan": { flags: [], stdin: "a plan", budget: "call", about: true },
  finish: { flags: ["why"], stdin: false, budget: "step", about: true },
  resume: { flags: ["why"], stdin: false, budget: "call", about: true },
};

// Why the subcommands the table leaves out are left out, said to the host that asked.
export const NOT_RELAYED = {
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

// Why the relay runs no `sub` -- the table's own word, read as an own property only, so no word reads Object's prototype.
const whyNot = (sub, otherwise = "it is not one of the subcommands an investigation's host runs") => (Object.hasOwn(NOT_RELAYED, sub) ? NOT_RELAYED[sub] : otherwise);

const refused = (why) => ({ refused: why });

const flagOf = (arg) => /^--([a-z][a-z-]*)(?:=([\s\S]*))?$/.exec(arg);

// One `--name[=value]` the row allows, with a value its pattern takes -- or why not.
function flagProblem(row, m, investigation) {
  if (!m) return "takes no words, only --flags";
  if (m[1] === "investigation") return m[2] === investigation ? null : `names another investigation: this run's is ${investigation}`;
  if (!row.flags.includes(m[1])) return `takes no --${m[1]} here`;
  return FLAGS[m[1]].value === null ? (m[2] === undefined ? null : `--${m[1]} takes no value`) : FLAGS[m[1]].value.test(m[2] ?? "") ? null : `--${m[1]} does not hold a value it may carry`;
}

const stdinProblem = (row, stdin) => (typeof stdin !== "string" || stdin === "" ? null : !row.stdin ? "reads nothing on stdin" : Buffer.byteLength(stdin) > MAX_REQUEST ? "its stdin is larger than a decision is" : null);

const shapeProblem = (req) => (!req || !Array.isArray(req.argv) || req.argv.length > 16 || !req.argv.every((a) => typeof a === "string" && a.length <= 4096 && !a.includes("\u0000")) ? "is not a request: { argv: [subcommand, --flags], stdin }" : null);

const kept = (flags) => flags.filter((m) => m[1] !== "investigation").map((m) => m[0]);

// A request, admitted as the argument list the engine is run with -- the run's investigation always its own -- or as a
// help probe the relay answers itself, or refused with why.
export function admitted(req, investigation) {
  const shape = shapeProblem(req);
  if (shape) return refused(shape);
  return probed(req.argv) ? { help: helpOf(req.argv) } : subAdmitted(req, investigation);
}

function subAdmitted(req, investigation) {
  const [sub, ...rest] = req.argv;
  if (!Object.hasOwn(RELAY, sub)) return refused(`the relay runs no \`${sub}\`: ${whyNot(sub)}`);
  return rowAdmitted(RELAY[sub], sub, rest.map((a) => [a, flagOf(a)]), req, investigation);
}

function rowAdmitted(row, sub, parsed, req, investigation) {
  const bad = [...parsed.map(([a, m]) => flagProblem(row, m, investigation) && `${a.slice(0, 60)} ${flagProblem(row, m, investigation)}`), stdinProblem(row, req.stdin)].filter(Boolean);
  if (bad.length) return refused(`\`${sub}\` ${bad.join("; ")}`);
  const flags = kept(parsed.map(([, m]) => m));
  return { argv: [sub, ...(row.about ? [`--investigation=${investigation}`] : []), ...flags], stdin: row.stdin ? (req.stdin ?? "") : "", budget: row.budget };
}

// ---- a help probe: answered from the engine CLI's own usage, never run -----------------------------------------------

// What asks for a usage rather than a run, as the engine's own CLI prints one for it: `--help` (or `-h`) anywhere -- an
// argument, never a flag's value -- the word `help` as the subcommand, or no subcommand at all.
const HELP_FLAGS = ["--help", "-h"];

const probed = (argv) => argv.length === 0 || argv[0] === "help" || argv.some((a) => HELP_FLAGS.includes(a));

// A word a subcommand could be.
const SUB = /^[a-z][a-z-]{0,39}$/;

// What a probe asks about: its first word that is neither `help` nor a flag, or none -- the whole CLI. The log files it
// under that subcommand, or under `--help` when it named none a subcommand could be.
function helpOf(argv) {
  const about = argv.find((a) => a !== "help" && !a.startsWith("-")) ?? null;
  return { about, sub: SUB.test(about ?? "") ? about : "--help" };
}

// The engine CLI the usage is read from, in the run's frozen source -- the file the host's plugin replaced with the
// relay's client -- and the most of it read.
export const ENGINE_CLI = "cli/autonomous-qa.mjs";

const MAX_CLI = 1024 * 1024;

function cliText(file) {
  try { return ((st) => (st?.isFile() === true && st.size <= MAX_CLI ? readFileSync(file, "utf8") : null))(lstatSync(file, { throwIfNoEntry: false })); }
  catch { return null; }
}

// The engine CLI's usage, as the frozen source documents it: its leading comment block -- the very text its own help()
// prints (src/trace/commands.mjs headerOf) -- line by line as help() prints them; null when no such file can be read.
export const usageAt = (engineDir) => ((text) => (text === null ? null : headerOf(text).split("\n").map((l) => l.replace(/^\/\/ ?/, ""))))(cliText(join(engineDir, ENGINE_CLI)));

// A line of the usage that documents a subcommand: `node autonomous-qa.mjs <sub> …`, the subcommand it names.
const USAGE_LINE = /^\s*node\s+\S*autonomous-qa\.mjs\s+([a-z][a-z-]*)(?=\s|$)/;

const documents = (line) => USAGE_LINE.exec(line)?.[1] ?? null;

const linesOf = (usage, sub) => (usage ?? []).filter((l) => documents(l) === sub);

// Where the usage first documents a subcommand: what orders a whole answer the way the CLI orders its own help.
const firstAt = (usage, sub) => ((i) => (i < 0 ? Number.MAX_SAFE_INTEGER : i))((usage ?? []).findIndex((l) => documents(l) === sub));

const inOrder = (usage) => Object.keys(RELAY).sort((a, b) => firstAt(usage, a) - firstAt(usage, b));

// What the relay takes of a subcommand it carries, said from its row -- so the answer and the admission are one table.
const flagsSaid = (row) => (row.flags.length ? `${row.flags.map((f) => FLAGS[f].shown).join(", ")}, and no other flag or word` : `no ${row.about ? "other " : ""}flag or word`);

const stdinSaid = (row) => (row.stdin ? `${row.stdin} on stdin -- or in a file named by --decision=<file> or --file=<file>, read on your side and sent as stdin` : "nothing on stdin");

const takes = (row, investigation) => `through this relay: ${[row.about ? `--investigation is ${investigation}, named or not` : null, flagsSaid(row), stdinSaid(row)].filter(Boolean).join("; ")}`;

const UNREAD = "the engine's usage could not be read here: what the relay takes of each subcommand is all this says";

// A carried subcommand's usage, line for line as documented, then what the relay takes of it.
const subUsage = (usage, sub, investigation) => [...(linesOf(usage, sub).length ? linesOf(usage, sub) : [`  node autonomous-qa.mjs ${sub} (the engine's usage documents no line for it here)`]), `      ${takes(RELAY[sub], investigation)}`];

const ONE = "`<subcommand> --help`, or `help <subcommand>`, says one subcommand's usage.";

const carriesLine = () => `It carries: ${Object.keys(RELAY).join(", ")} -- \`--help\` alone says the usage of each.`;

const shownWord = (about) => printable(String(about)).slice(0, 40);

const notCarried = (usage, h) => [`the relay runs no \`${shownWord(h.about)}\`: ${whyNot(h.about, linesOf(usage, h.about).length ? undefined : "the engine's usage documents no such subcommand")}.`, carriesLine()];

const wholeUsage = (usage, investigation) => [`autonomous-qa.mjs through this relay, for investigation ${investigation}: each subcommand it carries, as the engine's own usage documents it, and what the relay takes of it.`, ...(usage ? [] : [UNREAD]), "", ...inOrder(usage).flatMap((sub) => subUsage(usage, sub, investigation)), "", `Not carried here: ${Object.keys(NOT_RELAYED).join(", ")} -- \`help <subcommand>\` says why.`, ONE];

// What a probe is answered, by what it asks about: the first row that holds, the last always does.
const HELP_ANSWERS = [
  { when: (h) => h.about === null, says: (usage, h, inv) => wholeUsage(usage, inv) },
  { when: (h) => Object.hasOwn(RELAY, h.about), says: (usage, h, inv) => [...(usage ? [] : [UNREAD]), ...subUsage(usage, h.about, inv), "", ONE] },
  { when: () => true, says: (usage, h) => notCarried(usage, h) },
];

// The answer to a help probe: exit 0, its usage on stdout -- answered, never refused, and nothing run.
export const helpAnswer = (usage, help, investigation) => ({ exit: 0, stdout: `${HELP_ANSWERS.find((r) => r.when(help)).says(usage, help, investigation).join("\n")}\n`, stderr: "" });

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
// the decision itself, which the engine's own journal keeps -- how it ended (and, of an answer of 0, where a run it
// dispatched stopped short: `stopped`, below) and how long it took. A help probe is kept as one (`help: true`), under
// the subcommand it asked about (`helpOf`), with no argv: nothing was run.
const logged = (dirs, line) => writeFileSync(dirs.log, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`, { flag: "a" });

// How a request the engine stopped ended, in the engine's own words: the first line it said when it refused or blocked
// one (`inv-… is already paused`), which its answer carried to the host -- kept beside the exit code, since the relay's
// own `refused` is null for it, printable, scrubbed and bounded. Nothing an answer of 0 said, and nothing of stdout.
const STOP_LINE = 240;

const whyOf = (a, answer) => (!a.refused && answer.exit !== 0 ? { why: firstLine(answer.stderr) } : {});

const firstLine = (text) => scrub(printable(String(text ?? "").split("\n").find((l) => l.trim()) ?? "").trim()).slice(0, STOP_LINE) || null;

// Of an answer of 0, the log keeps ONE thing (0.5.0, backlog B6): where a run the request dispatched stopped short, as
// the engine said it in its answer -- `result.stopped`, its own allow-listed, scrubbed and bounded view
// (src/investigation/loop.mjs) -- with the outcome and rule it came to: what a person diagnosing a round reads first.
// Printable and scrubbed again here, bounded as the engine bounds it; nothing else an answer said is kept.
const STOPPED_TEXT = 600;

const resultOf = (text) => {
  try { return JSON.parse(String(text ?? "")).result ?? null; }
  catch { return null; }
};

const word = (v) => (typeof v === "string" && v.length <= 80 ? printable(v) : null);

const stoppedLine = (r) => ({ outcome: word(r.outcome), rule: word(r.rule), step: Number.isInteger(r.stopped.step) ? r.stopped.step : null, do: word(r.stopped.do), capability: word(r.stopped.capability), as: word(r.stopped.as), says: scrub(printable(String(r.stopped.says ?? ""))).slice(0, STOPPED_TEXT) || null });

const stoppedOf = (a, answer) => ((r) => (r?.stopped && typeof r.stopped === "object" ? { stopped: stoppedLine(r) } : {}))(!a.refused && answer.exit === 0 ? resultOf(answer.stdout) : null);

async function servedOne(dirs, serve, name) {
  const req = requestAt(dirs.requests, name);
  const a = req ? serve.admit(req) : { refused: "is not a regular file a request is" };
  const started = Date.now();
  const answer = a.refused ? { exit: 2, stdout: "", stderr: `REFUSED ${a.refused}\n` } : await serve.run(a);
  return finishedOne(dirs, name, req, a, { ...answer, ms: Date.now() - started });
}

function finishedOne(dirs, name, req, a, answer) {
  answered(dirs, name, answer);
  logged(dirs, { request: name, sub: a.help?.sub ?? req?.argv?.[0] ?? null, ...(a.help ? { help: true } : {}), argv: a.argv ?? null, stdin: req?.stdin ? { bytes: Buffer.byteLength(req.stdin), digest: sha(req.stdin).slice(0, 16) } : null, refused: a.refused ?? null, exit: answer.exit, ...whyOf(a, answer), ...stoppedOf(a, answer), ms: answer.ms });
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
