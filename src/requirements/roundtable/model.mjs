// A ROUND, read off the journal: derived on every read, stored nowhere.
//
// Two journal kinds are all a round ever writes -- `reviewed` (one perspective handed in) and
// `round-closed` (the critic's pass was recorded and the retained questions were put) -- and the rest of
// what a person sees is a FOLD over them: who has reviewed, who is next, what the critic has to judge,
// whether this state was already reviewed and why a round would stop. A line is tied to the digest of
// the state it reviewed (digest.mjs); a line for a state that has since moved on is ignored, never
// deleted, so a person's answer in the middle of a round simply starts the next one.
//
// A round is OPEN while reviews exist after the last close at the current digest. A closed round
// remembers the digest it reviewed AND the digest it left behind, because asking questions stands
// unknown facts and opens them, which is itself a change of state: "this state was already reviewed"
// is the state a round LEFT, and only a person can move that.
import { CRITIC, LIMITS, REVIEWERS } from "./vocab.mjs";

const bySequence = (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0);

// The latest line per key. A failed hand-in may be replaced by a later one; the writer enforces that.
const latestBy = (lines, key) => Object.fromEntries([...lines].sort(bySequence).map((l) => [l[key], l]));

const roundLines = (lines) => lines.filter((l) => l.kind === "reviewed" || l.kind === "round-closed").sort(bySequence);

// A closed round, with the reviews written in the window before it at the digest it reviewed.
const roundOf = (close, window) => ({ ...close, reviews: latestBy(window.filter((r) => r.digest === close.digest), "perspective") });

const stepOf = (acc, line) => (line.kind === "reviewed" ? { ...acc, window: [...acc.window, line] } : { window: [], rounds: [...acc.rounds, roundOf(line, acc.window)] });

// A state is reviewed once. A close written twice for it -- a host retried a critique that was still
// running -- is one round, the first, and never spends a second of the bound.
const onceEach = (rounds) => rounds.filter((c, i) => rounds.findIndex((x) => x.digest === c.digest) === i);

// lines: the requirement's journal lines. digest: the state NOW.
export function foldOf(lines, digest) {
  const { window, rounds } = roundLines(lines).reduce(stepOf, { window: [], rounds: [] });
  const closes = onceEach(rounds);
  const fresh = window.filter((r) => r.digest === digest);
  return { digest, closes, reviews: latestBy(fresh, "perspective"), settled: closes.findLast((c) => c.after === digest) ?? null };
}

// The first reviewer still to hand in, in the table's order, and then the critic. A reviewer that
// FAILED has handed in: its failure is on the board and in the close, and it is never a reason to wait.
export const nextOf = (fold) => REVIEWERS.find((p) => !fold.reviews[p]) ?? CRITIC;

// What the critic has to judge: every candidate a reviewer handed in, in the table's order.
export const poolOf = (fold) => REVIEWERS.flatMap((p) => (fold.reviews[p]?.outcome === "reviewed" ? (fold.reviews[p].candidates ?? []).map((c) => ({ ...c, perspective: p })) : []));

export const failedOf = (fold) => REVIEWERS.filter((p) => fold.reviews[p]?.outcome === "failed");

const isSettled = (fold) => fold.settled !== null;

// Why a round does, or does not, go on. The first row that holds decides, and the last always
// does. `stop` is null where the round goes on (or may begin) and the row's own id where it ends.
// `world.blockingOpen`: a blocking question is open in the room right now.
export const STOPS = [
  { id: "continue", stop: null, say: "", when: (f) => Object.keys(f.reviews).length > 0 },
  { id: "waiting-human", stop: "waiting-human", say: "a blocking question is still waiting for a person", when: (f, w) => isSettled(f) && w.blockingOpen === true },
  { id: "reviewer-failed", stop: "reviewer-failed", say: "no perspective could review this state", when: (f) => isSettled(f) && (f.settled.failed ?? []).length >= REVIEWERS.length },
  { id: "no-new-questions", stop: "no-new-questions", say: "this state was reviewed and nothing new was asked", when: (f) => isSettled(f) && f.settled.asked === 0 },
  { id: "already-reviewed", stop: "already-reviewed", say: "this state was already reviewed", when: isSettled },
  { id: "round-limit", stop: "round-limit", say: `the limit of ${LIMITS.rounds} rounds is reached`, when: (f) => f.closes.length >= LIMITS.rounds },
  { id: "start", stop: null, say: "", when: () => true },
];

export function stopOf(fold, world) {
  const row = STOPS.find((r) => r.when(fold, world));
  return { id: row.id, stop: row.stop };
}

// The sentence for a stop, for the person or the host that is told no.
export const stopSay = (id) => STOPS.find((r) => r.id === id)?.say ?? "";

// The round a person is in: the one being filled, or the next one to begin.
export const roundOfFold = (fold) => (fold.settled ? fold.settled.round : fold.closes.length + 1);
