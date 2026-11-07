// HOLDS: members waiting for a title, first come, first served. When a copy of the title comes back it is set aside for
// whoever has waited longest: their hold is ready, they are sent a notice, and they have a week to collect it -- the copy
// is theirs alone to borrow until then. With nobody waiting, the copy goes back on the shelf.
import { addDays } from "./dates.mjs";
import { created, put } from "./store.mjs";
import { allMine } from "./tenancy.mjs";
import { shelved } from "./catalog.mjs";

export const PICKUP_DAYS = 7;

const OPEN = ["waiting", "ready"];

// A title's holds, in the order they were placed.
const holdsOn = (store, tenant, titleId) => allMine(store, tenant, "holds").filter((h) => h.title === titleId);

export const openHoldOf = (store, tenant, title, member) => holdsOn(store, tenant, title.id).find((h) => h.member === member.id && OPEN.includes(h.state)) ?? null;

export const newHold = (store, tenant, title, member, day) => created(store, "holds", "hold", { tenant, title: title.id, member: member.id, placed: day, state: "waiting", copy: null, pickupBy: null });

// Whether anybody is waiting for a copy's title: a hold placed and not yet served.
export const holdWaiting = (store, copy) => holdsOn(store, copy.tenant, copy.title).some((h) => h.state === "waiting");

const readyHoldOf = (store, copy) => holdsOn(store, copy.tenant, copy.title).find((h) => h.state === "ready" && h.copy === copy.id) ?? null;

// A copy set aside is its hold's member's alone to borrow; when they borrow it, their hold is collected.
export const heldForAnother = (store, copy, member) => copy.status === "held" && readyHoldOf(store, copy)?.member !== member.id;

const collected = (store, hold, member) => (hold && hold.member === member.id ? put(store, "holds", { ...hold, state: "collected" }) : null);

export const collectedBy = (store, copy, member) => (copy.status === "held" ? collected(store, readyHoldOf(store, copy), member) : null);

function setAside(store, copy, hold, day) {
  const ready = put(store, "holds", { ...hold, state: "ready", copy: copy.id, pickupBy: addDays(day, PICKUP_DAYS) });
  put(store, "copies", { ...copy, status: "held" });
  created(store, "notices", "notice", { tenant: copy.tenant, member: hold.member, kind: "hold-ready", hold: hold.id, copy: copy.id, pickupBy: ready.pickupBy });
  return ready;
}

const firstWaiting = (store, copy) => holdsOn(store, copy.tenant, copy.title).find((h) => h.state === "waiting") ?? null;

// A copy back from a loan: set aside for the member who has waited longest for its title, or shelved.
export const servedOrShelved = (store, copy, day) => ((hold) => (hold ? setAside(store, copy, hold, day) : shelved(store, copy)))(firstWaiting(store, copy));

export const holdView = (h) => ({ id: h.id, title: h.title, member: h.member, placed: h.placed, state: h.state, copy: h.copy, pickupBy: h.pickupBy });

export const noticeView = (n) => ({ id: n.id, kind: n.kind, hold: n.hold, copy: n.copy, pickupBy: n.pickupBy });
