// WHAT A CAPABILITY CALL IS, as an action -- built here and nowhere else, so the orchestrator that asks for an approval
// and the capability pipeline that holds the call to it describe one call one way.
//
// A capability says what it does through its declared `effects` (src/topology/vocab.mjs EFFECTS) and where it lands
// through its own `environment` (src/capability/contract-v1.mjs). One whose inputs `bind` to a task's sandbox lands in
// that sandbox (local), unless it declares production too -- the strictest declaration wins. A mutating capability that
// declares no effect this table can read is `data.mutate`: nobody said what it does, which on production is read as the
// strictest data boundary. Never a guess from its name, its tool or its input.
import { ACTION, DESTRUCTIVE_OPERATIONS, destructiveKind } from "./boundaries.mjs";
import { strictestTier } from "./environments.mjs";

// The effects that change nothing anybody else can see -- src/topology/vocab.mjs's non-mutating EFFECTS, asserted
// equal by a test, so a new effect is a write until the vocabulary says otherwise.
export const READING_EFFECTS = Object.freeze(["none", "read"]);

// The effects that name a protected action, each its kind.
export const PROTECTED_EFFECTS = Object.freeze([{ effect: "deploy", kind: ACTION.DEPLOY }, { effect: "migrate", kind: ACTION.MIGRATE }, ...DESTRUCTIVE_OPERATIONS.map((op) => ({ effect: op, kind: destructiveKind(op) }))]);

// The inputs a person reads before deciding, lifted when a capability names its inputs this way. Never a credential:
// a binding resolves those, and they never reach `input`.
export const LIFTED = Object.freeze(["service", "artifact", "revision", "database", "table", "migration", "scope", "digest"]);

const effectsOf = (cap) => (Array.isArray(cap?.effects) ? cap.effects : []);

const declaredKind = (cap) => PROTECTED_EFFECTS.find((p) => effectsOf(cap).includes(p.effect))?.kind ?? null;

const writes = (cap) => effectsOf(cap).some((e) => !READING_EFFECTS.includes(e));

const kindOf = (cap) => declaredKind(cap) ?? (cap?.mutates !== true ? ACTION.DATA_READ : writes(cap) ? ACTION.DATA_WRITE : ACTION.DATA_MUTATE);

const bound = (cap) => Object.values(cap?.inputSchema ?? {}).some((row) => Boolean(row?.bind));

const lifted = (input) => Object.fromEntries(LIFTED.filter((k) => ["string", "number"].includes(typeof input?.[k])).map((k) => [k, input[k]]));

// `cap`: the capability as registered ({ id, mutates, effects, environment, connection, inputSchema }).
export const capabilityAction = (cap, input = {}) => ({ ...lifted(input), kind: kindOf(cap), environment: strictestTier([bound(cap) ? "local" : null, cap?.environment]), target: cap?.connection ?? null, capability: cap?.id ?? null, input: input ?? {} });
