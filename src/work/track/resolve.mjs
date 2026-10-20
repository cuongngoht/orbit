// WHICH WORK A SESSION IS DOING, and which works a checkout has -- read off the journals and nothing else (1.8.8).
//
// A session resolves to the work of its LATEST `bound` line across this checkout's works: two sessions never share one
// because each binding names its own session, and a session nothing bound resolves to nothing -- never to "the newest
// work on the machine". The scan is bounded (the LIMITS.SCAN newest journals by modification time), so an old work
// that has not been touched for long drops out of the session's reach and out of `list`, and is still readable by id.
// Pure over the work store handed in.
import { LIMITS } from "./vocab.mjs";
import { trackOf } from "./fold.mjs";

const newestFirst = (a, b) => b.at - a.at;

const stamped = (works) => (id) => ({ id, at: works.stamp?.(id) ?? 0 });

const folded = (works) => ({ id }) => ({ id, fold: trackOf(works.read(id) ?? []) });

// The newest works, folded once. Hand the result down so one look folds each journal once.
export const scanOf = (works) => works.list().map(stamped(works)).sort(newestFirst).slice(0, LIMITS.SCAN).map(folded(works));

// A work is a checkout's when it was tracked there: its first line, or any binding, names the checkout.
export const ownedBy = (fold, checkout) => fold.tracked && (fold.meta?.checkout === checkout || fold.bindings.some((b) => b.checkout === checkout));

const inCheckout = (checkout) => (w) => ownedBy(w.fold, checkout);

export const trackedIn = (scan, checkout) => scan.filter(inCheckout(checkout));

const bindingsOf = (mark) => (w) => w.fold.bindings.filter((b) => b.session === mark).map((b) => ({ at: b.at, work: w.id, fold: w.fold }));

const latestFirst = (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);

// Every binding a session made, across works, newest first. `at` of equal moments keeps the scan's order.
export const timelineOf = (scan, mark) => (mark ? scan.flatMap(bindingsOf(mark)).sort(latestFirst) : []);

// The session's current work in this checkout: the work of its latest binding made here.
export function currentOf(scan, mark, checkout) {
  const mine = timelineOf(trackedIn(scan, checkout), mark);
  return mine[0] ? { id: mine[0].work, fold: mine[0].fold, at: mine[0].at } : null;
}

// One line per work, from the fold alone -- cheap enough to list a checkout. It says what was REPORTED, and never a
// lifecycle: that needs the session's activity and the tasks, which only `status` reads.
const STANDING = [
  { when: (f) => f.closed?.outcome === "cancelled", word: "CANCELLED" },
  { when: (f) => f.closed?.outcome === "failed", word: "FAILED" },
  { when: (f) => f.closed?.outcome === "done", word: "REPORTED_DONE" },
  { when: (f) => ["paused", "blocked", "waiting"].includes(f.reported?.state), word: (f) => f.reported.state.toUpperCase() },
  { when: () => true, word: "OPEN" },
];

const wordOf = (f) => ((row) => (typeof row.word === "function" ? row.word(f) : row.word))(STANDING.find((r) => r.when(f)));

export const rowOf = (w) => ({ work: w.id, title: w.fold.meta?.objective ?? null, ref: w.fold.meta?.ref ?? w.fold.meta?.root?.id ?? null, mode: w.fold.handoffs.at(-1)?.to ?? w.fold.bindings.at(-1)?.mode ?? "developer", standing: wordOf(w.fold), sessions: new Set(w.fold.bindings.map((b) => b.session).filter(Boolean)).size, links: w.fold.links.length, createdAt: w.fold.meta?.at ?? null, updatedAt: w.fold.updatedAt });

const byUpdated = (a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));

export const listOf = (scan, checkout) => trackedIn(scan, checkout).map(rowOf).sort(byUpdated);
