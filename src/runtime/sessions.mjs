// A SESSION: one started component, as a receipt kept in the machine store.
//
// The receipt is the whole of what Orbit knows about a process it started, and it
// is written BEFORE anything is launched. That order is the point. A start that
// dies between "decided to launch" and "recorded what launched" leaves a receipt
// that says STARTING and names no process: it is read back as AMBIGUOUS -- Orbit
// may have started something and cannot say what -- and it is never resent. The
// opposite order, launch and then record, would leave a running process nobody
// knows is Orbit's, which cannot be stopped and cannot be told from a stranger's.
//
// One document per session under the host's LIVE room (src/runtime/rooms.mjs):
// per host because a pid means nothing on another machine, per checkout because
// two checkouts of one repository run side by side. Its logs sit beside it. It
// keeps ids, a command's argument list, a pid and two times -- never a
// credential, an environment or any output a process wrote.
import { join } from "node:path";
import { sha, short } from "../hash.mjs";
import { readState, writeState } from "../store/control.mjs";
import { logsRoom, sessionsRoom } from "./rooms.mjs";

export const SESSION_SCHEMA = 1;

export const SESSION_STATES = ["STARTING", "RUNNING", "STOPPED", "LOST", "AMBIGUOUS"];

// What a session IS (0.1.0): a component a file declared -- the only kind a receipt written before kinds existed can
// be, so an absent kind reads as one -- or, in an isolated sandbox, a container the topology needs (a service the
// project is defined with, the pod that holds one shared namespace), a test worker, an observer, a helper, a probe,
// or the sandbox's supervisor. A container's receipt also carries `container`: the isolation provider, the name, the
// labels it was created with and, once it exists, its id -- which is what proves it Orbit's (src/runtime/ownership.mjs).
export const SESSION_KINDS = ["component", "service", "pod", "worker", "observer", "helper", "probe", "supervisor"];

export const kindOf = (session) => session.kind ?? "component";

// How many finished sessions a component keeps, with their logs. A process that
// writes logs for a week must not be allowed to keep every one it ever wrote.
export const KEEP_FINISHED = 3;

const ID = /^rs-[a-f0-9]{12}$/;

export const sessionId = ({ env, component, requestedAt }) => `rs-${short(sha(`${env}\u0000${component}\u0000${requestedAt}`), 12)}`;

export const commandFingerprint = (argv, cwd) => short(sha(`${argv.join("\u0000")}\u0001${cwd}`), 16);

// WHO a session belongs to: a person's runtime, or a task's sandbox. A receipt written before owners
// existed names none, and is a person's -- so the person's rule below is the COMPLEMENT of "a task's",
// not a list of environments, and an environment id that was stamped differently can never hide one.
export const HUMAN = Object.freeze({ kind: "human" });

export const ownerOf = (session) => session.owner ?? HUMAN;

// What a context may SEE of the sessions kept in one live room. Ordered, the last always matching.
// The live room is shared by a person's runtime and every sandbox of the checkout, because port
// ownership is read from it host-wide; this is the one place that says whose a session is.
export const ENV_SCOPE = [
  { name: "SANDBOX_CONTEXT", when: (scope) => scope.owner?.kind === "task", sees: (s, scope) => s.env === scope.env && ownerOf(s).id === scope.owner.id, say: "a sandbox sees only the sessions of its own environment and its own task" },
  { name: "HUMAN_CONTEXT", when: () => true, sees: (s) => ownerOf(s).kind === "human", say: "a person sees every session no task owns" },
];

// A predicate over sessions for one scope; no scope is every session (host-wide port ownership asks that).
export const inScope = (scope) => (s) => ENV_SCOPE.find((r) => r.when(scope)).sees(s, scope);

const visible = (scope) => (scope ? inScope(scope) : () => true);

export function createSessions(live, io) {
  const dir = sessionsRoom(live);
  const file = (id) => join(dir, `${id}.json`);
  return { list: (scope) => listed(dir, io, file).filter(visible(scope)), all: () => listed(dir, io, file), read: (id) => readOne(io, file, id), write: (doc) => writeState(io, file(doc.id), doc, SESSION_SCHEMA), logs: (id) => ({ out: join(logsRoom(live), `${id}.out`), err: join(logsRoom(live), `${id}.err`) }), prune: (component, scope) => pruned(live, io, dir, file, component, visible(scope)) };
}

// A receipt somebody edited, or a disk that lost half of one, must not take `stop`, `status` and every
// OTHER project's `start` down with it: a document that is not the shape of a session is not read as
// one, and what is optional in it is made safe to use.
const text = (v) => typeof v === "string" && v.length > 0;

// Only what reading a session ASSUMES is required: a component to name, a state this knows, the time it
// was asked for (it is how sessions are ordered) and a pid or the absence of one. A provider this engine
// does not have is not a damaged document: stop says so in a sentence.
const wellFormed = (doc) => text(doc.component) && SESSION_STATES.includes(doc.state) && text(doc.requestedAt) && (doc.pid === null || Number.isInteger(doc.pid));

function readOne(io, file, id) {
  if (!ID.test(id)) return null;
  const doc = readState(io, file(id), {}, SESSION_SCHEMA);
  return doc.id === id && wellFormed(doc) ? { ...doc, ports: Array.isArray(doc.ports) ? doc.ports.filter(Number.isInteger) : [] } : null;
}

const listed = (dir, io, file) => io.list(dir).filter((n) => n.endsWith(".json")).map((n) => readOne(io, file, n.replace(/\.json$/, ""))).filter(Boolean).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));

// Finished sessions beyond the newest few, and the logs that went with them.
function pruned(live, io, dir, file, component, mine) {
  const finished = listed(dir, io, file).filter((s) => mine(s) && s.component === component && ["STOPPED", "LOST"].includes(s.state));
  const drop = finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED));
  for (const s of drop) discard(io, file(s.id), logsRoom(live), s.id);
  return drop.map((s) => s.id);
}

function discard(io, doc, logs, id) {
  io.removeFile(doc);
  io.removeFile(join(logs, `${id}.out`));
  io.removeFile(join(logs, `${id}.err`));
}
