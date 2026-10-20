// The three STAGES of a round, over one requirement's room -- the only place the roundtable touches it.
//
//   handoff   read the round, print the board, and hand the perspective at work its ENVELOPE
//   review    one reviewer's proposals, judged whole and journaled against the state it saw
//   critique  the critic's verdicts, judged whole; what is retained goes through the question
//             engine's one door (`ask`), and the round is closed with the state it LEFT behind
//
// The engine calls no model. A host does the reviewing, on whatever it has -- a subagent where it
// has them, the main session where it does not -- and the order the reviewers run in is the host's
// business: what a round keeps is the same however they were scheduled. What a stage never does is
// decide: it writes a journal line about the round, and it asks questions through `ask`, which is
// the same door `requirements ask` uses, so a question already answered stays answered, one already
// open is extended, and a person's word is the only thing that ever settles a slot.
import { Refused } from "../../errors.mjs";
import { ask } from "../ingest.mjs";
import { factId } from "../model.mjs";
import { runOf } from "../questions.mjs";
import { standingFacts } from "../snapshot.mjs";
import { humanOnly, isCurrent, isOpen, unsettled } from "../vocab.mjs";
import { judgeCritique } from "./critique.mjs";
import { roundDigest } from "./digest.mjs";
import { failedOf, foldOf, nextOf, poolOf, roundOfFold, stopOf, stopSay } from "./model.mjs";
import { eventsOf } from "./progress.mjs";
import { judgeReview, present, reviewer } from "./review.mjs";
import { CRITIC, LIMITS, REVIEWERS, perspective, plural } from "./vocab.mjs";

// ---- where the round stands -------------------------------------------------------------------------

export function standing(port, root) {
  const digest = roundDigest(port, root);
  const fold = foldOf(port.journalLines(), digest);
  const open = port.questions().filter(isOpen);
  return { digest, fold, open, stop: stopOf(fold, { blockingOpen: open.some((q) => q.blocking === true) }) };
}

// ---- the envelope ---------------------------------------------------------------------------------------

const byId = (a, b) => a.id.localeCompare(b.id);

const byUnsettled = (a, b) => Number(unsettled(b)) - Number(unsettled(a)) || byId(a, b);

const byBlocking = (a, b) => Number(b.blocking === true) - Number(a.blocking === true) || byId(a, b);

const orNone = (list) => (list.length ? list : undefined);

const slotsOf = (q) => q.slots.map((s) => `${s.subject}/${s.aspect}`);

const sourceRefs = (f) => (f.sources ?? []).filter((s) => s.startsWith("source:"));

// A standing fact as a reviewer reads it: where it stands, what it says, what it rests on. What
// nobody has said is a slot with a status and no words.
const factRow = (f) => present({ slot: `${f.subject}/${f.aspect}`, status: f.status, says: f.says || undefined, sources: orNone(sourceRefs(f)), decision: f.decision });

const openRow = (q) => ({ id: q.id, blocking: q.blocking === true, asks: q.asks, slots: slotsOf(q) });

const settledRow = (q) => ({ id: q.id, state: q.state, slots: slotsOf(q) });

const cut = (list, max) => ({ shown: list.slice(0, max), left: Math.max(0, list.length - max) });

// What the room holds, bounded, with a count of what was left out -- never silently.
function contextOf(port, at) {
  const facts = cut([...standingFacts(port)].sort(byUnsettled), LIMITS.envelope.facts);
  const open = cut([...at.open].sort(byBlocking), LIMITS.envelope.open);
  const settled = cut(port.questions().filter((q) => !isOpen(q)).sort(byId), LIMITS.envelope.settled);
  return { facts: facts.shown.map(factRow), open: open.shown.map(openRow), settled: settled.shown.map(settledRow), truncated: { facts: facts.left, open: open.left, settled: settled.left } };
}

const limitsOf = (id) => (id === CRITIC ? { retained: LIMITS.retained } : { candidates: LIMITS.candidates });

const pooledRow = (c) => present({ id: c.id, perspective: c.perspective, slots: slotsOf(c), asks: c.asks, blocking: c.blocking, proposed: c.proposed });

// Everything a perspective is handed: what it is for, where it looks, the state, and the bounds.
// The critic is also handed what the reviewers proposed. There is no work item's text in it: the
// engine never keeps one.
export function envelopeOf(port, at, id) {
  const row = perspective(id);
  const base = { perspective: id, purpose: row.purpose, focus: row.focus, round: roundOfFold(at.fold), digest: at.digest, limits: limitsOf(id), ...contextOf(port, at) };
  return id === CRITIC ? { ...base, pooled: poolOf(at.fold).map(pooledRow) } : base;
}

// ---- the document a stage prints -------------------------------------------------------------------------

const identityOf = (port) => {
  const identity = port.state().identity;
  return identity ? { identity } : {};
};

const failedIn = (at) => (at.stop.stop && at.fold.settled ? at.fold.settled.failed ?? [] : failedOf(at.fold));

const questionRow = (q) => present({ id: q.id, state: q.state, blocking: q.blocking === true, asks: q.asks, proposed: q.proposed });

function documentOf(port, root, stage, extra = {}) {
  const at = standing(port, root);
  const { stop } = at.stop;
  const next = stop === null ? nextOf(at.fold) : null;
  const doc = { root, stage, digest: at.digest, round: roundOfFold(at.fold), ...identityOf(port), stop, next, failed: failedIn(at), ...extra, events: eventsOf({ root, fold: at.fold, stop, open: at.open.length }) };
  return { ...doc, ...(next ? { envelope: envelopeOf(port, at, next) } : {}), ...(stop ? { questions: [...at.open].sort(byBlocking).map(questionRow) } : {}) };
}

// Read the round. Writes nothing.
export const handoff = (ctx, root) => documentOf(ctx.requirements.open(root), root, "handoff");

// ---- what a stage refuses before it writes anything ---------------------------------------------------

function fresh(at, digest) {
  if (digest !== undefined && digest !== at.digest) throw new Refused("the requirement moved while this was being reviewed — run clarify again and review the state it prints");
}

function open(at) {
  if (at.stop.stop !== null) throw new Refused(`this requirement state is not open for review: ${stopSay(at.stop.id)}`);
}

function once(at, perspectiveId) {
  if (at.fold.reviews[perspectiveId]?.outcome === "reviewed") throw new Refused(`${perspectiveId} has already reviewed this state — a perspective reviews a state once`);
}

// A failed review is a hand-in, not coverage, so the critic may go on without it: it is the ones
// that never handed in at all that it waits for.
function allHandedIn(at) {
  const missing = REVIEWERS.filter((p) => !at.fold.reviews[p]);
  if (missing.length) throw new Refused(`${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} not reviewed — the critic judges what every reviewer handed in, or failed at`);
}

function readyForReview(at, hand) {
  reviewer(hand.perspective);
  fresh(at, hand.digest);
  open(at);
  once(at, hand.perspective);
}

function readyForCritique(at, hand) {
  fresh(at, hand.digest);
  open(at);
  allHandedIn(at);
}

// ---- a review handed in --------------------------------------------------------------------------------------

const didOf = (hand, candidates) => (hand.failed ? `${hand.perspective} failed` : `${hand.perspective} reviewed (${plural(candidates.length, "candidate", "candidates")})`);

function handedIn(ctx, port, root, hand) {
  const at = standing(port, root);
  readyForReview(at, hand);
  const candidates = hand.failed ? [] : judgeReview(hand.perspective, hand.text);
  port.journal({ kind: "reviewed", digest: at.digest, perspective: hand.perspective, outcome: hand.failed ? "failed" : "reviewed", candidates, seenBy: runOf(ctx, port, {}).seenBy });
  return documentOf(port, root, "review", { did: didOf(hand, candidates), perspective: hand.perspective, candidates: candidates.length });
}

// hand: { perspective, text (the lines handed in), failed?, digest? (the state it was handed, to be sure) }
export function review(ctx, root, hand) {
  const port = ctx.requirements.open(root);
  return port.transact(() => handedIn(ctx, port, root, hand));
}

// ---- the critique ----------------------------------------------------------------------------------------------

const decidedSlot = (port, root, s) => {
  const f = port.fact(factId(root, s.subject, s.aspect));
  return Boolean(f) && isCurrent(f.status) && humanOnly(f.status);
};

// A question about slots a person has already decided is not asked: that is a person's word standing,
// whichever question it was given under.
export const settledBy = (port, root, spec) => spec.slots.every((s) => decidedSlot(port, root, s));

function planned(port, root, hand) {
  const at = standing(port, root);
  readyForCritique(at, hand);
  const pool = poolOf(at.fold);
  return { at, pool, ...judgeCritique(pool, hand.text, root) };
}

// Step one: the retained questions, through the same door `requirements ask` uses. That door takes its
// own lock, so this is NOT inside the round's close.
function putQuestions(ctx, port, root, plan) {
  const decided = plan.retained.filter((k) => settledBy(port, root, k.spec));
  const toAsk = plan.retained.filter((k) => !decided.includes(k));
  const questions = toAsk.length ? ask(ctx, root, toAsk.map((k) => k.spec)) : [];
  return { asked: questions.filter(isOpen), settled: decided.length + questions.filter((q) => !isOpen(q)).length };
}

// Step two: the close, which remembers the state it reviewed and the state asking left behind.
function closing(ctx, port, root, plan, put) {
  const counts = { pooled: plan.pool.length, retained: plan.retained.length, asked: put.asked.length, settled: put.settled };
  port.journal({ kind: "round-closed", digest: plan.at.digest, after: roundDigest(port, root), round: roundOfFold(plan.at.fold), ...counts, verdicts: plan.verdicts, questions: put.asked.map((q) => q.id), failed: failedOf(plan.at.fold), seenBy: runOf(ctx, port, {}).seenBy });
  return documentOf(port, root, "critique", { counts, did: `closed: ${counts.retained} retained, ${counts.asked} asked` });
}

// hand: { text (the critic's lines), digest? }. A crash between the two steps leaves questions that
// stand and no close; the state has moved, so the next round starts fresh and SEES them, and nothing is
// asked twice because a question is one per set of slots.
export function critique(ctx, root, hand) {
  const port = ctx.requirements.open(root);
  const plan = planned(port, root, hand);
  const put = putQuestions(ctx, port, root, plan);
  return port.transact(() => closing(ctx, port, root, plan, put));
}
