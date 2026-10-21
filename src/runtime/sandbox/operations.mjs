// The OPERATIONS JOURNAL of one sandbox: what it was about to do, written BEFORE it did it.
//
// Preparing a sandbox runs things -- fetches dependencies, brings a container up -- and a process that dies in
// the middle must be able to say, afterwards, what it was in the middle of. So each step opens an operation
// (STARTED) before it acts and settles it (DONE or FAILED) after, one small document each, in a room of the
// sandbox's own. An operation that never settled is how a crash is recognised: `reconcile` reads it back and
// asks the world, and never runs it again by itself.
//
// An operation keeps its kind, its times and -- at most -- a fingerprint and a sentence. Never output, an
// argument list, an environment value or a path.
import { join } from "node:path";
import { sha, short } from "../../hash.mjs";
import { scrub } from "../../scrub.mjs";
import { readState, writeState } from "../../store/control.mjs";

export const OPERATIONS_SCHEMA = 1;

export const KINDS = ["prepare", "restore", "up", "start", "release", "network", "build", "service", "attest", "dispatch", "teardown"];

export const STATES = ["STARTED", "DONE", "FAILED"];

const ID = /^op-[a-f0-9]{12}$/;

const MAX_BECAUSE = 300;

const said = (text) => scrub(String(text ?? "")).slice(0, MAX_BECAUSE);

const wellFormed = (o) => ID.test(o?.id ?? "") && KINDS.includes(o.kind) && STATES.includes(o.state) && typeof o.at === "string";

export function createOperations(room, io, now) {
  const file = (id) => join(room, `${id}.json`);
  const read = (id) => (ID.test(id) ? readState(io, file(id), {}, OPERATIONS_SCHEMA) : {});
  const list = () => io.list(room).filter((n) => n.endsWith(".json")).map((n) => read(n.replace(/\.json$/, ""))).filter(wellFormed).sort((a, b) => a.at.localeCompare(b.at));
  return { list, open: () => list().filter((o) => o.state === "STARTED"), begin: (kind, data = {}) => begun(io, file, now, kind, data), settle: (op, state, because) => settled(io, file, now, op, state, because), logFile: (op) => join(room, `${op.id}.log`) };
}

// The id is a function of the kind and the moment, and a counter breaks the tie between two in one millisecond.
let counter = 0;

function begun(io, file, now, kind, data) {
  const at = now();
  const op = { id: `op-${short(sha(`${kind}\u0000${at}\u0000${counter++}`), 12)}`, kind, state: "STARTED", at, ...(data.fingerprint ? { fingerprint: String(data.fingerprint) } : {}) };
  writeState(io, file(op.id), op, OPERATIONS_SCHEMA);
  return op;
}

function settled(io, file, now, op, state, because) {
  const next = { ...op, state, settledAt: now(), ...(because ? { because: said(because) } : {}) };
  writeState(io, file(op.id), next, OPERATIONS_SCHEMA);
  return next;
}
