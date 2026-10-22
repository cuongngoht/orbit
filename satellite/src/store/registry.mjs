// What a definition's ELIGIBILITY is, derived on every read and never stored: the latest intact version of an id is
// offered; an older one is SUPERSEDED (a mission that pinned it still reads it -- a pin is never silently moved to
// the latest); a corrupt one is offered to nobody; and a REVOKED one -- a person's revocation in the policy room, by id
// or by pin -- is refused even to a mission that pinned it. The index is rebuilt from the definition files each time.
import { allOf, compareVersions } from "./definitions.mjs";

export const revokedBy = (policy, row) => (policy?.revoked ?? []).find((r) => r.ref === row.pin || r.ref === row.id) ?? null;

const latestIntact = (rows, id) => rows.filter((r) => r.id === id && !r.corrupt).sort((a, b) => compareVersions(a.version, b.version)).at(-1) ?? null;

export const eligibilityOf = (row, rows, policy) => ((latest, revoked) => ({ offered: !row.corrupt && !revoked && latest?.pin === row.pin, superseded: Boolean(latest) && latest.pin !== row.pin, revoked: Boolean(revoked), corrupt: row.corrupt, because: revoked?.because ?? null }))(latestIntact(rows, row.id), revokedBy(policy, row));

// Every version of one kind, each with its eligibility.
export const indexOf = (io, rooms, kind, policy) => ((rows) => rows.map((r) => ({ ...r, eligibility: eligibilityOf(r, rows, policy) })))(allOf(io, rooms, kind));

// What may be reused now: the offered version of each id.
export const offeredOf = (io, rooms, kind, policy) => indexOf(io, rooms, kind, policy).filter((r) => r.eligibility.offered);
