// The definitions PORT a mission is handed: the four rooms, read through the eligibility rules (registry.mjs) and
// written through the one immutable door (definitions.mjs). A revocation is a person's and is only ever read here.
import { readDefinition, versionsOf, writeDefinition } from "./definitions.mjs";
import { isRevoked } from "./policy.mjs";
import { indexOf, offeredOf } from "./registry.mjs";

export const definitionsPort = (io, rooms, policy) => ({ write: (proposed) => writeDefinition(io, rooms, proposed), read: (pin) => readDefinition(io, rooms, pin), index: (kind) => indexOf(io, rooms, kind, policy), offered: (kind) => offeredOf(io, rooms, kind, policy), versions: (kind, id) => versionsOf(io, rooms, kind, id), revoked: (pin) => isRevoked(policy, pin) });
