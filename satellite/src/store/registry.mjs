// What a definition's ELIGIBILITY is, derived on every read and never stored: the latest intact version of an id is
// offered; an older one is SUPERSEDED (a mission that pinned it still reads it -- a pin is never silently moved to
// the latest); a corrupt one is offered to nobody; and a REVOKED one -- a person's revocation in the policy room, by id
// or by pin -- is refused even to a mission that pinned it. The index is rebuilt from the definition files each time.
//
// Since 0.3.0 (Orbit ADR 0045) two more things decide what is offered, both owned HERE:
//   a CANDIDATE   a version an improvement campaign published (provenance.candidate) is offered to nobody until it is
//                 selected: a mission that holds its pin reads it, and nothing reuses it by accident
//   a SELECTION   which kept version is offered -- chosen on evaluated evidence by the improvement engine, or by a person
//                 in Orbit Control (selectDefinition, under the registry's lock, against the version the caller read).
//                 It holds while that version is intact and unrevoked and no newer non-candidate version was published
//                 after it: a factory's later version is the definition's newer word. A revocation always wins.
import { join } from "node:path";
import { Refused } from "../../../src/errors.mjs";
import { writeAtomic } from "../../../src/store/atomic.mjs";
import { withLock } from "../../../src/store/lock.mjs";
import { allOf, compareVersions, parsePin } from "./definitions.mjs";
import { quietly, refused } from "./text.mjs";

export const revokedBy = (policy, row) => (policy?.revoked ?? []).find((r) => r.ref === row.pin || r.ref === row.id) ?? null;

export const isCandidate = (row) => row?.record?.provenance?.candidate === true;

const latestIntact = (rows, id) => rows.filter((r) => r.id === id && !r.corrupt && !isCandidate(r)).sort((a, b) => compareVersions(a.version, b.version)).at(-1) ?? null;

const selectedRow = (rows, selection) => (selection ? rows.find((r) => r.pin === selection.pin && !r.corrupt) ?? null : null);

// The version an id offers: the selection while it holds, else the latest intact version that is no candidate.
export const chosenOf = (rows, id, policy, selection) => ((latest, sel) => (sel && !revokedBy(policy, sel) && (!latest || compareVersions(latest.version, sel.version) <= 0) ? sel : latest))(latestIntact(rows, id), selectedRow(rows, selection));

export const eligibilityOf = (row, rows, policy, selection = null) => ((chosen, revoked) => ({ offered: !row.corrupt && !revoked && chosen?.pin === row.pin, superseded: Boolean(chosen) && chosen.pin !== row.pin, revoked: Boolean(revoked), corrupt: row.corrupt, candidate: isCandidate(row), selected: Boolean(selection) && selection.pin === row.pin, because: revoked?.because ?? null }))(chosenOf(rows, row.id, policy, selection), revokedBy(policy, row));

// ---- selections: one small document per id, rebuilt into a map on every read ---------------------------------------

const SELECTION_SCHEMA = 1;

const SELECTION_FILE = /^((?:rol|atp|skl|wft)-[a-z0-9][a-z0-9-]{0,47})\.json$/;

// A selection this release cannot read selects nothing: the latest version is offered, as if none was ever made.
const readSelection = (io, file) => ((doc) => (doc?.schema === SELECTION_SCHEMA && typeof doc.pin === "string" ? doc : null))(quietly(() => JSON.parse(io.read(file) ?? "null")));

export const selectionsOf = (io, rooms) => new Map(io.list(rooms.selected).map((n) => [SELECTION_FILE.exec(n)?.[1], readSelection(io, join(rooms.selected, n))]).filter(([id, doc]) => id && doc));

// Every version of one kind, each with its eligibility.
export const indexOf = (io, rooms, kind, policy) => ((rows, selections) => rows.map((r) => ({ ...r, eligibility: eligibilityOf(r, rows, policy, selections.get(r.id) ?? null) })))(allOf(io, rooms, kind), selectionsOf(io, rooms));

// What may be reused now: the offered version of each id.
export const offeredOf = (io, rooms, kind, policy) => indexOf(io, rooms, kind, policy).filter((r) => r.eligibility.offered);

// ---- choosing which kept version is offered ---------------------------------------------------------------------------

export const SELECT_DOORS = Object.freeze(["improvement", "control"]);

const BUSY = "another session is choosing a Satellite definition for this project — try again in a moment";

export const SELECT_RULES = Object.freeze([
  { id: "SELECT_DOOR", fails: (c) => !SELECT_DOORS.includes(c.sel.door), say: () => "which version of a definition is offered is chosen by the improvement engine on evaluated evidence, or by a person in Orbit Control — never from a terminal" },
  { id: "PIN_INVALID", fails: (c) => !c.parsed?.kind, say: (c) => `${c.sel.pin} is not a definition pin` },
  { id: "PIN_UNKNOWN", fails: (c) => !c.target || c.target.corrupt, say: (c) => `${c.sel.pin} is no intact definition kept in this project's store` },
  { id: "PIN_REVOKED", fails: (c) => Boolean(revokedBy(c.policy, c.target)), say: (c) => `${c.sel.pin} was revoked by a person — it is never offered again by anybody else` },
  { id: "SELECT_STALE", code: "STALE_REVISION", fails: (c) => (c.chosen?.pin ?? null) !== (c.sel.expect ?? null), say: (c) => `${c.parsed.id} offers ${c.chosen?.pin ?? "nothing"} now, not ${c.sel.expect ?? "nothing"} — read it again and decide on what is there` },
]);

const factsOf = (io, rooms, sel, policy) => ((parsed) => ((rows) => ((selections) => ({ sel, policy, parsed, target: rows.find((r) => r.pin === sel.pin) ?? null, chosen: parsed ? chosenOf(rows, parsed.id, policy, selections.get(parsed.id) ?? null) : null }))(selectionsOf(io, rooms)))(parsed?.kind ? allOf(io, rooms, parsed.kind) : []))(parsePin(sel.pin));

function judged(c) {
  const failed = SELECT_RULES.find((r) => r.fails(c));
  if (failed) throw refused(Refused, failed.code ?? failed.id, failed.say(c));
}

// sel: { pin, expect, door, at, campaign? } -> { ok, unchanged, id, from, pin, door }
export function selectDefinition(io, rooms, sel, policy) {
  io.ensureDir(rooms.selected);
  return withLock(rooms.registry, () => selecting(io, rooms, sel, policy), io, BUSY);
}

function selecting(io, rooms, sel, policy) {
  const c = factsOf(io, rooms, sel, policy);
  judged(c);
  if (c.chosen?.pin === c.target.pin) return { ok: true, unchanged: true, id: c.parsed.id, from: c.chosen.pin, pin: c.target.pin, door: sel.door };
  writeAtomic(join(rooms.selected, `${c.parsed.id}.json`), `${JSON.stringify({ schema: SELECTION_SCHEMA, id: c.parsed.id, pin: c.target.pin, version: c.target.version, previous: c.chosen?.pin ?? null, by: sel.door, at: sel.at, campaign: sel.campaign ?? null }, null, 2)}\n`, io, false);
  return { ok: true, unchanged: false, id: c.parsed.id, from: c.chosen?.pin ?? null, pin: c.target.pin, door: sel.door };
}
