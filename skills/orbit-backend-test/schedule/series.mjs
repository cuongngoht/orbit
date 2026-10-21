// One series engine for every dialect. A dialect yields CANDIDATES -- a wall time, an instant, or a
// wall time plus an exact offset -- in order; the contract's DST policy resolves each into
// occurrences (resolve.mjs), and the window keeps what falls inside it, ordered by instant.
//
// Bounded twice, so no expression can hang a caller: a scan HORIZON (a sparse expression such as
// 29 February, or one that never matches, is answered as truncated rather than searched forever)
// and an ITERATION budget over the candidates.
import { zoneOf } from "./zone.mjs";
import { resolveWall } from "./resolve.mjs";
import { DAY, HOUR, localText } from "./wall.mjs";

export const LIMITS = { horizonDays: 2922, iterations: 200000, occurrences: 1000, maxOccurrences: 10000 };

// The dialect primitive `next` answers for one instant with no contract around it, so it takes the
// DST policy most schedulers apply; the contract-level answers (expect.mjs) never default it.
export const NEXT_DST = { gap: "shift-forward", overlap: "first" };

// A wall time and the instant it names are never further apart than a DST shift beyond the
// offset the window's own ends already account for.
const MARGIN = 4 * HOUR;
const SPANS = [HOUR, DAY, 7 * DAY, 32 * DAY, 367 * DAY, LIMITS.horizonDays * DAY];

export function seriesOf(dialect, spec, ctx, window) {
  const range = rangeOf(ctx.zone, window);
  const out = collected(dialect.candidates(spec, range), ctx, range);
  const entries = merged(out.entries).sort((a, b) => keyOf(a) - keyOf(b));
  const limit = Math.min(window.limit ?? LIMITS.occurrences, LIMITS.maxOccurrences);
  return { entries: entries.slice(0, limit), skipped: out.skipped, truncated: range.cut || out.exhausted || entries.length > limit };
}

function rangeOf(zone, window) {
  const end = window.fromMs + LIMITS.horizonDays * DAY;
  const toMs = Math.min(window.toMs, end);
  return { zone, fromMs: window.fromMs, toMs, cut: window.toMs > end, fromWall: zone.wallAt(window.fromMs) - MARGIN, toWall: zone.wallAt(toMs) + MARGIN };
}

function collected(candidates, ctx, range) {
  const out = { entries: [], skipped: [], iterations: 0, exhausted: false };
  for (const c of candidates) if (!took(out, c, ctx, range)) break;
  return out;
}

function took(out, candidate, ctx, range) {
  out.iterations += 1;
  for (const e of resolvedOf(candidate, ctx)) placed(out, e, range);
  out.exhausted = out.iterations >= LIMITS.iterations;
  return !out.exhausted;
}

function resolvedOf(c, ctx) {
  if (c.instant !== undefined) return [{ instant: c.instant, flags: [], wall: ctx.zone.wallAt(c.instant) }];
  return resolveWall(c.wall, ctx.zone, ctx.dst).map((e) => shifted(e, c.plusMs ?? 0));
}

const plus = (t, ms) => (t === null || t === undefined ? t : t + ms);
const shifted = (e, ms) => (ms ? { ...e, instant: plus(e.instant, ms), near: plus(e.near, ms), candidates: e.candidates?.map((t) => t + ms), wall: e.wall + ms } : e);

function placed(out, e, range) {
  const key = keyOf(e);
  if (key < range.fromMs || key >= range.toMs) return;
  if (e.skipped) return out.skipped.push({ local: localText(e.wall), reason: e.skipped });
  out.entries.push(e);
}

const keyOf = (e) => e.instant ?? e.candidates?.[0] ?? e.near;

// Two wall times that name ONE instant (a time shifted forward out of a gap onto a time that
// exists anyway) are one occurrence: a schedule cannot fire twice at the same instant.
function merged(entries) {
  const by = new Map();
  for (const e of entries) by.set(identity(e), by.has(identity(e)) ? joined(by.get(identity(e)), e) : e);
  return [...by.values()];
}

const identity = (e) => (e.instant === null ? `wall:${e.wall}` : `at:${e.instant}`);
const joined = (a, b) => ({ ...a, flags: [...new Set([...a.flags, ...b.flags, "coincides"])] });

// The dialect primitive: the first occurrence strictly after `fromMs`, searched in growing spans so
// a dense expression answers from its first hour and a sparse one stops at the horizon (null).
export function withNext(row) {
  return Object.freeze({ ...row, next: (spec, fromMs, zone, dst = NEXT_DST) => nextIn(row, spec, { zone: zoneFor(row, spec, zone), dst }, fromMs + 1, 0) });
}

function nextIn(row, spec, ctx, origin, i) {
  if (i >= SPANS.length) return null;
  const window = { fromMs: origin + (SPANS[i - 1] ?? 0), toMs: origin + SPANS[i], limit: LIMITS.maxOccurrences };
  const hit = seriesOf(row, spec, ctx, window).entries.find((e) => e.instant !== null);
  return hit ? hit.instant : nextIn(row, spec, ctx, origin, i + 1);
}

function zoneFor(row, spec, zone) {
  const z = zone?.wallAt ? zone : zoneOf(zone ?? row.defaultZone?.(spec));
  if (z.error) throw new RangeError(z.error);
  return z;
}
