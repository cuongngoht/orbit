// An ENVIRONMENT INSTANCE: a prepared place a checkout's components can run, and
// how far along it is.
//
// An instance belongs to ONE checkout and names a provider, and a checkout may
// have several -- the one a person develops in today, and one per sandbox an agent
// works in -- which is why an instance has an id and a `kind` (`human` or `sandbox`)
// rather than being a property of the checkout. Native needs none: it is the
// machine, and there is nothing to prepare, so only environments that are BUILT
// have a document.
//
// A kind has its OWN road (LIFECYCLES below). A sandbox is owned by a task and is
// prepared from the task's workspace, so its states say what a person's never need
// to: PREPARING, STALE (the workspace moved past what it was built from), and
// RELEASED. The sandbox road is in `./sandbox/`'s vocabulary of states; the table
// of roads is here because `moved` is the one door every state change goes through.
//
// Its state is a short ordered road, and the road is the point:
//
//   PROPOSED -> ADOPTED -> VALIDATING -> VALIDATED
//                                    \-> VALIDATION_FAILED
//
// ADOPTED means a person accepted a proposal and its files were written and read
// back. It does NOT mean the environment works: files that were written are not an
// environment that was built, and an instance that is ADOPTED and then fails to
// build is ADOPTED with a FAILED validation -- never a success. Only VALIDATED can
// start anything (src/runtime/providers/devcontainer.mjs).
import { join } from "node:path";
import { sha, short } from "../hash.mjs";
import { Refused } from "../errors.mjs";
import { readState, writeState } from "../store/control.mjs";

export const INSTANCE_SCHEMA = 1;

export const INSTANCE_STATES = ["PROPOSED", "ADOPTED", "VALIDATING", "VALIDATED", "VALIDATION_FAILED"];

// The only moves. A row is `from -> [to…]`; anything else is refused, because a
// state that can jump is a state nobody can reason about. VALIDATING may be
// entered again: a validation that died with the machine must not leave an
// environment that can never be tried once more.
export const TRANSITIONS = {
  PROPOSED: ["ADOPTED"],
  ADOPTED: ["VALIDATING", "ADOPTED"],
  VALIDATING: ["VALIDATING", "VALIDATED", "VALIDATION_FAILED"],
  VALIDATED: ["VALIDATING", "ADOPTED"],
  VALIDATION_FAILED: ["VALIDATING", "ADOPTED"],
};

// A sandbox is a task's: it is prepared (PREPARING), usable (READY), left behind by the workspace it was
// built from (STALE), unknown after a crash (AMBIGUOUS) until runtime reads the world back, and finally
// RELEASED. Nothing moves out of RELEASED, and STALE is DERIVED on every read
// (src/runtime/sandbox/model.mjs) -- this road only says which words may be written.
export const SANDBOX_STATES = ["ALLOCATED", "PREPARING", "READY", "STALE", "AMBIGUOUS", "RELEASED"];

export const SANDBOX_TRANSITIONS = {
  ALLOCATED: ["PREPARING", "RELEASED"],
  PREPARING: ["PREPARING", "READY", "AMBIGUOUS", "RELEASED"],
  READY: ["PREPARING", "STALE", "RELEASED"],
  STALE: ["PREPARING", "READY", "RELEASED"],
  AMBIGUOUS: ["PREPARING", "READY", "STALE", "RELEASED"],
  RELEASED: [],
};

// The road of each kind. A table, so `moved` asks the document's kind and never branches on it.
export const LIFECYCLES = { human: { states: INSTANCE_STATES, transitions: TRANSITIONS }, sandbox: { states: SANDBOX_STATES, transitions: SANDBOX_TRANSITIONS } };

export const KINDS = Object.keys(LIFECYCLES);

export const instanceId = ({ checkout, kind, name }) => `env-${short(sha(`${checkout}\u0000${kind}\u0000${name}`), 12)}`;

const ID = /^env-[a-f0-9]{12}$/;

export function createInstances(room, io) {
  const file = (id) => join(room, `${id}.json`);
  return { list: () => io.list(room).filter((n) => n.endsWith(".json")).map((n) => read(io, file, n.replace(/\.json$/, ""))).filter(Boolean), read: (id) => read(io, file, id), write: (doc) => writeState(io, file(doc.id), doc, INSTANCE_SCHEMA) };
}

function read(io, file, id) {
  if (!ID.test(id)) return null;
  const doc = readState(io, file(id), {}, INSTANCE_SCHEMA);
  return doc.id === id ? doc : null;
}

// A new document, or one moved along the road. -> the document, not yet written.
export function moved(doc, to, now, extra = {}) {
  const road = LIFECYCLES[doc.kind ?? "human"]?.transitions ?? {};
  if (!(road[doc.state] ?? []).includes(to)) throw new Refused(`${doc.kind === "sandbox" ? "a sandbox" : "an environment"} that is ${doc.state} cannot become ${to}`);
  return { ...doc, ...extra, state: to, updatedAt: now };
}

// ONE sandbox per task per checkout: the id is a function of both, so asking for it twice is asking for
// the same one -- which is what makes preparing it idempotent.
export const sandboxId = ({ checkout, task }) => instanceId({ checkout, kind: "sandbox", name: task });

// A new sandbox, not yet written. It keeps the owner (a task), the workspace's ID (never its path: the
// workspace owner resolves that live), the revision it began from, and -- once prepared -- the tree it was
// built at, where each component runs, the endpoints it exposes and a fingerprint of everything it was
// built from. Never a secret, an environment value, an absolute path or a file's contents.
export const createdSandbox = ({ checkout, task, workspace, baseRevision }, now) => ({ id: sandboxId({ checkout, task }), kind: "sandbox", name: task, provider: "sandbox", checkout, owner: { kind: "task", id: task }, workspace, state: "ALLOCATED", source: { baseRevision, tree: null }, placements: {}, endpoints: [], backing: { devcontainer: null }, restore: null, fingerprint: null, policy: null, lastActiveAt: null, createdAt: now, updatedAt: now });

export const created = ({ checkout, name, provider, files = {}, proposal = null }, now) => ({ id: instanceId({ checkout, kind: "human", name }), kind: "human", name, provider, checkout, state: "PROPOSED", files, proposal, validation: null, createdAt: now, updatedAt: now });
