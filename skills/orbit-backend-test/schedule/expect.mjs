// What an ACCEPTED schedule contract implies, as occurrences: the engine of orbit.schedule.expect.
// Pure -- nothing here reads a clock, a scheduler or a store; the caller hands in every instant.
// What the contract does not declare is never assumed: a missing DST, misfire or overlap policy is
// an UNKNOWN in the answer, and the occurrences it would decide are flagged or left undecided.
//
// contract: { id?, dialect, expression, timezone, revision, calendar?, misfire?, overlap?,
//             catchUpLimit?, catchUpKeep?, deadlineMs?, dst?: { gap?, overlap? } }
// An occurrence is { occurrenceId: <scheduleId>:<scheduledFor>, scheduledFor (ISO 8601 with the
// zone's offset), instantMs, local, revision, flags }; an unresolved one has instantMs and
// scheduledFor null, its id built on the local wall time, and its `candidates`.
import { dialectOf } from "./index.mjs";
import { DST_GAP, DST_OVERLAP } from "./resolve.mjs";
import { LIMITS, seriesOf } from "./series.mjs";
import { DAY, HOUR, localText } from "./wall.mjs";
import { isoAt, zoneOf } from "./zone.mjs";

export const MISFIRES = ["skip", "fire-once", "fire-all"];
export const OVERLAPS = ["allow", "forbid", "replace"];
export const CATCH_UP_KEEPS = ["latest", "earliest"];

const KNOWN = new Set(["id", "dialect", "expression", "timezone", "revision", "calendar", "misfire", "overlap", "catchUpLimit", "catchUpKeep", "deadlineMs", "dst"]);
const CALENDAR = new Set(["exclude", "weekdays"]);
const SPANS = [HOUR, DAY, 7 * DAY, 32 * DAY, 367 * DAY, LIMITS.horizonDays * DAY];

const oneOf = (value, allowed) => value === undefined || allowed.includes(value);
const count = (value) => value === undefined || (Number.isInteger(value) && value >= 0);
const span = (value) => value === undefined || (typeof value === "number" && value >= 0);

const CHECKS = [
  { ok: (c) => oneOf(c.misfire, MISFIRES), say: () => `misfire is one of ${MISFIRES.join(", ")}` },
  { ok: (c) => oneOf(c.overlap, OVERLAPS), say: () => `overlap is one of ${OVERLAPS.join(", ")}` },
  { ok: (c) => oneOf(c.catchUpKeep, CATCH_UP_KEEPS), say: () => `catchUpKeep is one of ${CATCH_UP_KEEPS.join(", ")}` },
  { ok: (c) => count(c.catchUpLimit), say: () => "catchUpLimit is a whole number, 0 or more" },
  { ok: (c) => span(c.deadlineMs), say: () => "deadlineMs is a number of milliseconds, 0 or more" },
  { ok: (c) => oneOf(c.dst?.gap, DST_GAP), say: () => `dst.gap is one of ${DST_GAP.join(", ")}` },
  { ok: (c) => oneOf(c.dst?.overlap, DST_OVERLAP), say: () => `dst.overlap is one of ${DST_OVERLAP.join(", ")}` },
];

export function check(contract) {
  const c = contract ?? {};
  const problems = CHECKS.filter((k) => !k.ok(c)).map((k) => k.say());
  const strange = Object.keys(c).filter((k) => !KNOWN.has(k)).map((k) => `contract.${k}`);
  return { problems, unknowns: [...strange, ...Object.keys(c.calendar ?? {}).filter((k) => !CALENDAR.has(k)).map((k) => `calendar.${k}`)] };
}

function prepared(contract) {
  const checked = check(contract);
  const dialect = dialectOf(contract?.dialect);
  if (dialect.gap) return stopped({ gap: "dialect", error: `no schedule dialect "${contract?.dialect}" is registered` }, checked.unknowns);
  if (checked.problems.length) return stopped({ error: checked.problems.join("; ") }, checked.unknowns);
  return parsedWith(dialect, dialect.parse(contract.expression), contract, checked.unknowns);
}

const stopped = (why, unknowns) => ({ stop: { ...why, occurrences: [], skipped: [], truncated: false, unknowns } });

function parsedWith(dialect, parsed, contract, unknowns) {
  if (!parsed.ok) return stopped({ error: parsed.error }, unknowns);
  const zone = zoneOf(contract.timezone ?? dialect.defaultZone?.(parsed.spec));
  if (zone.error && contract.timezone === undefined && dialect.needsZone(parsed.spec)) return stopped({}, [...unknowns, "timezone"]);
  if (zone.error) return stopped({ error: zone.error }, unknowns);
  return { dialect, spec: parsed.spec, zone, unknowns };
}

// The occurrences in [window.fromMs, window.toMs), at most window.limit of them.
export function occurrences(contract, window, scheduleId) {
  const p = prepared(contract);
  if (p.stop) return p.stop;
  const series = seriesOf(p.dialect, p.spec, { zone: p.zone, dst: contract.dst }, window);
  const listed = calendared(series.entries.map((e) => occurrenceOf(e, p.zone, scheduleId ?? contract.id, contract.revision)), contract.calendar);
  return { occurrences: listed.kept, skipped: [...series.skipped, ...listed.skipped], truncated: series.truncated, unknowns: unknownsOf(p.unknowns, listed.kept) };
}

function occurrenceOf(e, zone, id, revision) {
  if (e.instant === null) return { occurrenceId: `${id}:${localText(e.wall)}`, scheduledFor: null, instantMs: null, local: localText(e.wall), revision, flags: e.flags, candidates: e.candidates.map((t) => ({ instantMs: t, scheduledFor: isoAt(t, zone) })) };
  const scheduledFor = isoAt(e.instant, zone);
  return { occurrenceId: `${id}:${scheduledFor}`, scheduledFor, instantMs: e.instant, local: localText(zone.wallAt(e.instant)), revision, flags: e.flags };
}

function calendared(list, calendar) {
  const off = (o) => excluded(o.local, calendar);
  return { kept: list.filter((o) => !off(o)), skipped: list.filter(off).map((o) => ({ local: o.local, reason: "calendar", occurrenceId: o.occurrenceId })) };
}

// A calendar rule is read on the occurrence's LOCAL date: an excluded date, or a weekday outside
// the allowed ones (0 is Sunday).
function excluded(local, calendar) {
  const date = local.slice(0, 10);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return Boolean(calendar) && ((calendar.exclude ?? []).includes(date) || (calendar.weekdays !== undefined && !calendar.weekdays.includes(weekday)));
}

const unknownsOf = (base, list) => [...new Set([...base, ...(list.some((o) => o.flags.includes("dst-policy-unknown")) ? ["dst policy"] : [])])];

// What is due by an evaluation point: the occurrences in (sinceMs, evaluatedThroughMs] -- `due`, or
// `overdue` once the contract's execution deadline has passed, or `undecided` when unresolved --
// and the next occurrence after it. sinceMs defaults to one day before.
export function due(contract, evaluatedThroughMs, opts = {}) {
  const since = opts.sinceMs ?? evaluatedThroughMs - DAY;
  const listed = occurrences(contract, { fromMs: since + 1, toMs: evaluatedThroughMs + 1, limit: opts.limit }, opts.scheduleId);
  const states = listed.occurrences.map((o) => ({ ...o, state: stateOf(o, contract, evaluatedThroughMs) }));
  return { ...listed, occurrences: states, next: upcoming(contract, evaluatedThroughMs, opts.scheduleId, 0) };
}

const late = (o, contract, atMs) => contract?.deadlineMs !== undefined && atMs > o.instantMs + contract.deadlineMs;
const stateOf = (o, contract, atMs) => (o.instantMs === null ? "undecided" : late(o, contract, atMs) ? "overdue" : "due");

function upcoming(contract, afterMs, scheduleId, i) {
  if (i >= SPANS.length) return null;
  const window = { fromMs: afterMs + 1 + (SPANS[i - 1] ?? 0), toMs: afterMs + 1 + SPANS[i], limit: LIMITS.maxOccurrences };
  const found = occurrences(contract, window, scheduleId).occurrences[0];
  return found ?? upcoming(contract, afterMs, scheduleId, i + 1);
}

// What should have run since lastRunMs, up to and including nowMs, and what the contract's misfire
// policy does with it: `fire`, `skip` (each with its reason) or `undecided`. An occurrence past its
// execution deadline is skipped whatever the policy, and an unresolved one is always undecided.
export function missed(contract, lastRunMs, nowMs, opts = {}) {
  const listed = occurrences(contract, { fromMs: lastRunMs + 1, toMs: nowMs + 1, limit: opts.limit }, opts.scheduleId);
  const parts = partsOf(listed.occurrences, contract, nowMs);
  const decided = MISFIRE[contract?.misfire ?? "unknown"](parts.eligible, contract ?? {});
  const skip = [...decided.skip, ...parts.expired.map((o) => ({ ...o, reason: "deadline" }))];
  return { ...failure(listed), fire: decided.fire, skip, undecided: [...decided.undecided, ...parts.undecided], truncated: listed.truncated, unknowns: [...new Set([...listed.unknowns, ...decided.unknowns])] };
}

const failure = (listed) => Object.fromEntries(["error", "gap"].filter((k) => listed[k] !== undefined).map((k) => [k, listed[k]]));

function partsOf(list, contract, nowMs) {
  const resolved = list.filter((o) => o.instantMs !== null);
  return { eligible: resolved.filter((o) => !late(o, contract, nowMs)), expired: resolved.filter((o) => late(o, contract, nowMs)), undecided: list.filter((o) => o.instantMs === null) };
}

const MISFIRE = {
  skip: (list) => ({ fire: [], skip: list.map((o) => ({ ...o, reason: "misfire-skip" })), undecided: [], unknowns: [] }),
  "fire-once": (list) => ({ fire: list.slice(-1), skip: list.slice(0, -1).map((o) => ({ ...o, reason: "misfire-coalesced" })), undecided: [], unknowns: [] }),
  "fire-all": (list, c) => caughtUp(list, c.catchUpLimit ?? Infinity, c.catchUpKeep ?? "latest"),
  unknown: (list) => ({ fire: [], skip: [], undecided: list, unknowns: ["misfire policy"] }),
};

function caughtUp(list, limit, keep) {
  const fire = keep === "earliest" ? list.slice(0, limit) : list.slice(Math.max(0, list.length - limit));
  const fired = new Set(fire.map((o) => o.occurrenceId));
  return { fire, skip: list.filter((o) => !fired.has(o.occurrenceId)).map((o) => ({ ...o, reason: "catch-up-limit" })), undecided: [], unknowns: [] };
}

const OVERLAP_DECISIONS = { allow: "start-alongside", forbid: "skip-new", replace: "replace-running" };

// What the contract says happens when an occurrence comes due while the previous run still runs.
export const onOverlap = (contract) => (contract?.overlap ? { decision: OVERLAP_DECISIONS[contract.overlap] ?? null, unknowns: [] } : { decision: null, unknowns: ["overlap policy"] });
