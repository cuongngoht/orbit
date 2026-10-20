// WHICH WORK a request is, and the ONE answer a replay of it gets (1.8.8).
//
// A work id is never typed in to be remembered and never guessed from a title:
//   --continue=<w-id>   the person or the host named it: that work, reopened when it was closed;
//   --ref=<item>        the item's own work -- the requirement's (src/work/store.mjs `workOf`) when a requirement is kept for
//                       it, else an id taken from the item's text, so two sessions that name PBI-482 name one work;
//   neither             the id of THIS session's request: (session mark, checkout, the objective's digest, generation).
//                       A replay of the request finds the open work; a repeat after the work was closed is the next
//                       generation. Two sessions never meet here: the session is in the hash. A title alone is not.
// Pure over the work store handed in.
import { Refused } from "../../errors.mjs";
import { short } from "../../hash.mjs";
import { ID_SPEC, workOf } from "../store.mjs";
import { trackOf } from "./fold.mjs";
import { LIMITS } from "./vocab.mjs";

export const MAX_GENERATIONS = 50;

const WORK_ID = new RegExp(ID_SPEC.pattern);

const squeezed = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

export const digestOf = (objective) => short(squeezed(objective).toLowerCase(), 12);

export const refOf = (ref) => squeezed(ref).slice(0, LIMITS.REF);

const idOf = (...parts) => `w-${short(parts.join("\u0000"), 12)}`;

export const refWorkId = (ref) => idOf("ref", refOf(ref).toLowerCase());

const sessionWorkId = (parts) => idOf("session", parts.session, parts.checkout, parts.digest, parts.generation);

const closedIn = (works, id) => trackOf(works.read(id) ?? []).closed !== null;

const candidates = (parts) => Array.from({ length: MAX_GENERATIONS }, (_, generation) => ({ generation, id: sessionWorkId({ ...parts, generation }) }));

const standing = (works) => (c) => !works.exists(c.id) || !closedIn(works, c.id);

const exhausted = () => {
  throw new Refused(`this session already asked for this ${MAX_GENERATIONS} times and closed it each time: continue one with --continue=<w-id>`);
};

// The work of this session's request: the first generation not closed.
export const requestWork = (works, parts) => ({ how: "request", ...(candidates(parts).find(standing(works)) ?? exhausted()) });

export function continuedWork(works, id) {
  if (!WORK_ID.test(String(id ?? ""))) throw new Refused("--continue names a work: w- followed by twelve hex characters");
  if (!works.exists(id)) throw new Refused(`no work ${id} is kept here — track the request first`);
  return { how: "continue", id };
}

// An item's work: the requirement's own when one is kept for it (`kept` is `{ root, identity }` or null).
export const itemWork = (ref, kept) => (kept ? { how: "ref", id: workOf(kept.root), requirement: kept } : { how: "ref", id: refWorkId(ref) });
