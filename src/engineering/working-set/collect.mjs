// One lifecycle event → one working-set line, or nothing.
//
// The working set is what a session TOUCHED, never what it said or saw. So a
// line carries metadata only, and each field is the smallest thing that
// answers "what did this session read, change, search and run":
//
//   paths   repo-relative, POSIX, and only inside the repository -- a path
//           outside it is none of this engine's business and is dropped
//   tokens  a search pattern, SCRUBBED (src/scrub.mjs masks a secret by its
//           shape) and then reduced to src/tokens.mjs tokens -- `[a-z0-9]{3,}`,
//           which cannot carry a secret's punctuation either
//   cmd     a CLASS (commit · diff · test · lint · build · other), the bare
//           executable name, and whether it succeeded -- never the arguments,
//           which is where a token or a connection string would be
//
// Never kept: the prompt, the response, file contents, the tool's output, the
// command line, the transcript. There is no field for any of them.
//
// The classes are generic English, never a stack's command names: "test",
// "lint", "build" are words every toolchain uses, while a row naming one
// runner would be this engine learning a stack.
import { isAbsolute, relative } from "node:path";
import { tokens } from "../../tokens.mjs";
import { scrub } from "../../scrub.mjs";
import { okOf } from "../../outcome.mjs";

export const MAX_PATHS = 20;
export const MAX_TOKENS = 8;

// Ordered, first match wins, the last always matches.
export const CLASSES = [
  { name: "commit", when: (w) => w.includes("git") && w.includes("commit") },
  { name: "diff", when: (w) => w.includes("git") && w.includes("diff") },
  { name: "test", when: (w) => w.some((x) => /^tests?$/.test(x)) },
  { name: "lint", when: (w) => w.some((x) => /^(lint|check|typecheck)$/.test(x)) },
  { name: "build", when: (w) => w.some((x) => /^(build|compile)$/.test(x)) },
  { name: "other", when: () => true },
];

// Which classes are a CHECK: a successful one after an edit is a milestone.
export const CHECKS = ["test", "lint", "build"];

// `roots` is every spelling of the checkout root: the real path and the one the
// host was given can differ by a symlink (a temp directory on macOS, a mapped
// workspace), and a path matched against only one of them would be dropped as
// "outside the repository" when it is not.
//
// Two moments are kept for Orbit Live (1.8.7) and are NOT something the session
// touched, so the fold reads past them: a `pre-tool` line, only for a COMMAND
// (its class and bare executable, `ok: null` -- nothing is known yet), which is
// how a viewer can say a check is RUNNING; and `turn-end`, the host finishing a
// reply, after which no foreground command is still running. A protocol-2 host's
// delivery id (added by the subscriber) pairs a pre-tool with its post-tool.
//
// Since 0.2.2 (ADR 0044) a line also says WHICH AGENT it is about -- the subagent's hashed id and its type, when the
// host's payload named one -- and three more things are kept: a subagent STARTING and STOPPING (`agent-start`,
// `agent-end`), and a finished call that STARTED a skill or an agent (`invokes`: which; for an Agent call, the hashed id
// of the agent it launched and the mission run its envelope named). Names and ids only, never a prompt.
const BOUNDARIES = { "session-end": true, "turn-end": true };

const AGENT_LIFE = { "agent-start": true, "agent-end": true };

// Which line a lifecycle moment becomes: ordered, the first row that holds, the last always.
const SHAPES = [
  { when: (e) => BOUNDARIES[e.event] === true, line: (e, roots, at) => ({ t: at, ev: e.event }) },
  { when: (e) => AGENT_LIFE[e.event] === true, line: (e, roots, at) => (e.agent?.id ? { t: at, ev: e.event } : null) },
  { when: (e) => e.event === "pre-tool", line: (e, roots, at) => startOf(e, at) },
  { when: () => true, line: (e, roots, at) => toolLine(e, roots, at) },
];

export function collect(event, roots, at) {
  const line = SHAPES.find((s) => s.when(event)).line(event, roots, at);
  return line ? withAgent(line, event) : null;
}

function toolLine(event, roots, at) {
  const line = { t: at, ev: event.event, tool: event.tool?.kind ?? "other", paths: within(event.paths, [roots].flat()), tokens: tokens(scrub(event.pattern ?? "")).slice(0, MAX_TOKENS), cmd: commandOf(event), ...invocationOf(event) };
  if (line.tool === "other" && !line.paths.length && !line.invokes) return null;
  return event.background ? { ...line, bg: true } : line;
}

const some = (key, value) => (value ? { [key]: value } : {});

const invocationOf = (event) => (event.invokes?.name ? { invokes: { kind: event.invokes.kind, name: String(event.invokes.name).slice(0, 96) }, ...some("launched", event.launched), ...some("run", event.dispatched) } : {});

const withAgent = (line, event) => (event.agent?.id ? { ...line, agent: event.agent.id, agentType: event.agent.type ?? null } : line);

function startOf(event, at) {
  const cmd = event.tool?.kind === "command" ? commandOf(event) : null;
  return cmd ? { t: at, ev: "pre-tool", tool: "command", paths: [], tokens: [], cmd: { ...cmd, ok: null }, ...(event.background ? { bg: true } : {}) } : null;
}

const within = (paths, roots) => (paths ?? []).map((p) => roots.map((r) => relativeTo(p, r)).find(Boolean)).filter(Boolean).slice(0, MAX_PATHS);

function relativeTo(path, root) {
  const rel = (isAbsolute(path) ? relative(root, path) : path).replace(/\\/g, "/");
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : null;
}

// A command as a CLASS, the bare executable and whether it succeeded -- never
// its arguments. The session trail (src/lifecycle/subscribers/trace.mjs) asks
// the same function, so "what kind of command was that" has one answer.
export function commandOf(event) {
  if (!event.command) return null;
  const words = event.command.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return { class: CLASSES.find((c) => c.when(words)).name, exe: exeOf(event.command), ok: okOf(event) };
}

// The bare name of what ran, and nothing that could be an argument -- nor a value: a leading `NAME=value` sets the
// command's environment, and is where a token or a password rides (1.8.7: it used to be read as the executable).
// A value may be quoted and hold spaces (`PASSWORD='a b' deploy.sh`), so the assignments are cut off as a whole first.
const ASSIGNMENTS = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s'"]*)+\s+)+/;

const unassigned = (command) => String(command).trim().replace(ASSIGNMENTS, "");

const exeOf = (command) => ((w) => (/['"=]/.test(w) ? "" : w))(unassigned(command).split(/\s+/)[0] ?? "").split(/[\\/]/).at(-1).toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32);
