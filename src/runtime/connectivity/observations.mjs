// What a connectivity check OBSERVED, per target and per location -- the last time, and nothing more.
//
// One document per checkout per host (src/runtime/rooms.mjs `probesFile`), keyed `<target>|<location>`:
// a network is this machine's, so a second laptop sharing the store keeps its own answers. It is
// written under the connectivity room's OWN lock, never the live room's: a start takes that one
// (src/runtime/exclusive.mjs), and a retry that waits between attempts must hold nobody up.
//
// Bounded and plain: the state, the two facts under it (did the name resolve, did the port accept),
// a sentence -- scrubbed and clipped -- when it was checked, and the attempts of that one run. No
// history, no raw answer, no address list, no credential: a target has none to give.
//
// An observation is ABOUT a target as it pointed when it was made (`targetPrint`): moved to another
// host or port, it is no longer an answer to anything and reads as NOT_CHECKED. And it ages: past
// CONNECTIVITY_FRESH_MS it is STALE -- shown with when it was made, never called current, and handed to
// the resolver as nothing at all. A VPN connects and drops in less time than that.
import { scrub } from "../../scrub.mjs";
import { readState, writeState } from "../../store/control.mjs";
import { withLock } from "../../store/lock.mjs";
import { connectivityRoom, probesFile } from "../rooms.mjs";
import { STATES } from "./states.mjs";

export const OBSERVATIONS_SCHEMA = 1;

export const CONNECTIVITY_FRESH_MS = 5 * 60 * 1000;

export const MAX_BECAUSE = 300;

export const keyOf = (target, provider) => `${target}|${provider}`;

// Free text that reaches the disk goes through the masking every store uses, and is clipped.
export const said = (text) => scrub(String(text ?? "")).slice(0, MAX_BECAUSE);

const wellFormed = (o) => o && typeof o.target === "string" && typeof o.provider === "string" && STATES.includes(o.state) && typeof o.checkedAt === "string";

export function createObservations(live, io) {
  const room = connectivityRoom(live);
  const file = probesFile(live);
  const read = () => readState(io, file, { observations: {} }, OBSERVATIONS_SCHEMA);
  return { list: () => Object.values(read().observations ?? {}).filter(wellFormed), note: (o) => noted(io, room, file, read, o) };
}

function noted(io, room, file, read, o) {
  io.ensureDir(room);
  return withLock(room, () => kept(io, file, read, o), io, "another check of this checkout's connectivity is writing what it observed: try again in a moment");
}

function kept(io, file, read, o) {
  const doc = read();
  writeState(io, file, { observations: { ...(doc.unreadable ? {} : doc.observations ?? {}), [keyOf(o.target, o.provider)]: o } }, OBSERVATIONS_SCHEMA);
  return o;
}

// What one run of a check comes to, as it is kept: the facts, and the attempts of that run only.
export const observationOf = (target, provider, done) => ({ target: target.id, provider, targetPrint: target.print, state: done.state, resolution: done.resolution, transport: done.transport, because: said(done.because), checkedAt: done.checkedAt, attemptsUsed: done.attemptsUsed, configuredAttempts: done.configuredAttempts, attempts: done.attempts.map((a) => ({ number: a.number, state: a.state, because: said(a.because) })) });

// Pure. -> { age (ms) | null, stale }
export function aged(o, nowMs) {
  const at = Date.parse(o?.checkedAt ?? "");
  return Number.isFinite(at) ? { age: Math.max(0, nowMs - at), stale: nowMs - at > CONNECTIVITY_FRESH_MS } : { age: null, stale: true };
}

const NOT_CHECKED = (t, provider, because) => ({ target: t.id, provider, state: "NOT_CHECKED", resolution: "NOT_ATTEMPTED", transport: "NOT_ATTEMPTED", because, checkedAt: null, attemptsUsed: 0, configuredAttempts: t.retry.attempts, attempts: [], freshness: { age: null, stale: true } });

// For each target and each location it is checked from: the observation still ABOUT that target, with
// its age, or NOT_CHECKED with why. A location a target is no longer checked from is not shown.
export const current = (observations, targets, nowMs) => targets.map((t) => ({ target: t.id, locations: t.checkFrom.map((provider) => matched(observations, t, provider, nowMs)) }));

function matched(observations, t, provider, nowMs) {
  const o = observations.find((x) => x.target === t.id && x.provider === provider);
  if (!o) return NOT_CHECKED(t, provider, "not checked yet");
  return o.targetPrint === t.print ? { ...o, freshness: aged(o, nowMs) } : NOT_CHECKED(t, provider, "the target points somewhere else since it was last checked");
}

// What the resolver is handed, as DATA: per component and per location, the FRESH answer of the
// before-start targets it requires. Only REACHABLE and UNREACHABLE are said -- and UNREACHABLE wins --
// because a stale, unknown or unchecked answer says nothing a plan should move on.
export function reachOf(observations, targets, nowMs) {
  const fresh = targets.filter((t) => t.beforeStart).flatMap((t) => t.checkFrom.map((provider) => ({ t, provider, o: matched(observations, t, provider, nowMs) })));
  const told = fresh.filter(({ o }) => ["REACHABLE", "UNREACHABLE"].includes(o.state) && !o.freshness.stale);
  return told.reduce((acc, { t, provider, o }) => t.requiredBy.reduce((into, key) => withVerdict(into, key, provider, { state: o.state, target: t.id, label: t.label, host: t.host, port: t.port, checkedAt: o.checkedAt, age: o.freshness.age }), acc), {});
}

// UNREACHABLE is never overwritten by a REACHABLE of another target: one unreachable gate is enough.
function withVerdict(acc, key, provider, verdict) {
  const was = acc[key]?.[provider];
  return was?.state === "UNREACHABLE" ? acc : { ...acc, [key]: { ...(acc[key] ?? {}), [provider]: verdict } };
}
