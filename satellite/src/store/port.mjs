// The definitions PORT a mission is handed: the four rooms, read through the eligibility rules (registry.mjs) and
// written through the one immutable door (definitions.mjs). A revocation is a person's and is only ever read here.
// Since 0.3.0 (Orbit ADR 0045) an improvement campaign is handed the same port: a CANDIDATE published through the same
// immutable door (offered to nobody), and which kept version is offered chosen through registry.mjs's own rules.
import { readDefinition, versionsOf, writeDefinition } from "./definitions.mjs";
import { isRevoked } from "./policy.mjs";
import { indexOf, offeredOf, selectDefinition, selectionsOf } from "./registry.mjs";

const candidateOf = (proposed) => ({ ...proposed, provenance: { ...(proposed.provenance ?? {}), candidate: true } });

export const definitionsPort = (io, rooms, policy) => ({ write: (proposed) => writeDefinition(io, rooms, proposed), read: (pin) => readDefinition(io, rooms, pin), index: (kind) => indexOf(io, rooms, kind, policy), offered: (kind) => offeredOf(io, rooms, kind, policy), versions: (kind, id) => versionsOf(io, rooms, kind, id), revoked: (pin) => isRevoked(policy, pin), publishCandidate: (proposed) => writeDefinition(io, rooms, candidateOf(proposed)), select: (sel) => selectDefinition(io, rooms, sel, policy), selection: (id) => selectionsOf(io, rooms).get(id) ?? null });
