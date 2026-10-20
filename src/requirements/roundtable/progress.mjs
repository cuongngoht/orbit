// What a person SEES of a round: a board of who has reviewed, who is at work and what is left.
//
// The board is DERIVED from the round's fold every time, so the text a person reads, the one quiet
// line and the JSON a host parses can never disagree, and nothing here is stored. It is task STATUS and
// nothing more: who, in what state, doing what kind of work, with a short sentence that is a template
// filled with counts. A summary can never carry a candidate's words or a reasoning trace, because
// nothing it is made from does, and an event field nobody declared is dropped (`progressOf`).
//
// No process is alive while a reviewer thinks -- each stage is its own command -- so there is no
// spinner to update in place. A stage prints the board as it stands: the perspectives that have handed
// in, the one at work (named by the vocabulary, with three dots), the ones still queued. Append-only
// text works in any terminal and in a log; there is no escape sequence anywhere to get wrong.
import { nextOf, poolOf, roundOfFold } from "./model.mjs";
import { CRITIC, LIMITS, PROGRESS_FIELDS, REVIEWERS, glyphOf, perspective, plural } from "./vocab.mjs";

// An event as it may be kept: the declared fields that have a value, and nothing else.
export const progressOf = (raw) => Object.fromEntries(PROGRESS_FIELDS.filter((k) => raw[k] !== undefined && raw[k] !== null).map((k) => [k, raw[k]]));

// What the board is about: the live round, or the closed round a state was settled by.
function viewOf({ root, fold, stop, open }) {
  const closed = stop && fold.settled ? fold.settled : null;
  const live = !closed && !stop;
  return { root, round: roundOfFold(fold), stop, open, closed, reviews: closed ? closed.reviews : fold.reviews, next: live ? nextOf(fold) : null, pooled: closed ? closed.pooled : poolOf(fold).length };
}

const event = (v, actor, state, summary, more = {}) => progressOf({ type: "roundtable.progress", root: v.root, round: v.round, actor, state, ...more, summary });

const activityOf = (p, state) => ({ working: perspective(p).activity, completed: "completed", failed: "completed", skipped: "completed" })[state];

// Each table: the first row that holds says the state and the sentence, and the last always holds.
const REVIEWER_ROWS = [
  { when: (v, p) => v.reviews[p]?.outcome === "reviewed", state: "completed", say: (v, p) => plural((v.reviews[p].candidates ?? []).length, "candidate ambiguity", "candidate ambiguities") },
  { when: (v, p) => v.reviews[p]?.outcome === "failed", state: "failed", say: () => "review failed — not counted as coverage" },
  { when: (v, p) => v.next === p, state: "working", say: (v, p) => perspective(p).working },
  { when: () => true, state: "queued", say: () => "" },
];

function reviewerEvent(v, p) {
  const row = REVIEWER_ROWS.find((r) => r.when(v, p));
  return event(v, p, row.state, row.say(v, p), { activity: activityOf(p, row.state) });
}

const CRITIC_ROWS = [
  { when: (v) => v.closed && v.closed.pooled === 0, state: "skipped", say: () => "no candidates to challenge" },
  { when: (v) => v.closed, state: "completed", say: (v) => `${plural(v.closed.pooled, "candidate", "candidates")} → ${v.closed.retained} retained · ${v.closed.asked} asked · ${v.closed.settled} already settled` },
  { when: (v) => v.next === CRITIC, state: "working", say: (v) => `challenging ${plural(v.pooled, "candidate", "candidates")}`, total: (v) => v.pooled },
  { when: () => true, state: "queued", say: () => "" },
];

function criticEvent(v) {
  const row = CRITIC_ROWS.find((r) => r.when(v));
  return event(v, CRITIC, row.state, row.say(v), { activity: activityOf(CRITIC, row.state), total: row.total?.(v) });
}

// How a round ENDS, in a sentence a person can act on. A round that goes on has none.
const ROUND_ROWS = [
  { stop: "waiting-human", state: "waiting-human", activity: "waiting-for-human", say: (v) => `Human decision required · ${plural(v.open, "question", "questions")}` },
  { stop: "round-limit", state: "skipped", activity: "completed", say: () => `no further round — the limit of ${LIMITS.rounds} rounds is reached` },
  { stop: "reviewer-failed", state: "failed", activity: "completed", say: () => "no perspective could review this requirement — nothing was reviewed" },
  { stop: "no-new-questions", state: "completed", activity: "completed", say: () => "no new questions on this requirement state" },
  { stop: "already-reviewed", state: "completed", activity: "completed", say: () => "this requirement state was already reviewed — nothing new to review" },
];

// input: { root, fold, stop (a stop id, or null while the round goes on), open (questions waiting on a person) }
export function eventsOf(input) {
  const v = viewOf(input);
  const round = ROUND_ROWS.filter((r) => r.stop === v.stop).map((r) => event(v, "roundtable", r.state, r.say(v), { activity: r.activity }));
  return v.stop === "round-limit" ? round : [...REVIEWERS.map((p) => reviewerEvent(v, p)), criticEvent(v), ...round];
}

// ---- in words ---------------------------------------------------------------------------------------

const lineOf = (e) => (e.actor === "roundtable" ? ["", `${glyphOf(e.state)} ${e.summary}`] : [`${glyphOf(e.state)} ${perspective(e.actor).label}`, ...(e.summary ? [`  ${e.summary}${e.state === "working" ? "..." : ""}`] : [])]);

export const render = (events) => events.flatMap(lineOf);

export const headline = (doc) => `Requirement Roundtable · ${doc.root}${doc.identity ? ` (${doc.identity.provider} ${doc.identity.id})` : ""} · Round ${doc.round}`;

const flagOf = (q) => (q.blocking ? "BLOCKING" : " ".repeat(8));

const questionLines = (q) => [`  ${q.id}  ${flagOf(q)}  ${q.asks}`, ...(q.proposed ? [`    suggestion, not a decision: ${q.proposed}`] : [])];

const questionsOf = (doc) => (doc.questions?.length ? doc.questions.flatMap(questionLines) : []);

const envelopeOf = (doc) => (doc.envelope ? ["", `ENVELOPE  ${JSON.stringify(doc.envelope)}`] : []);

export const say = (doc) => [headline(doc), "", ...render(doc.events), ...questionsOf(doc), ...envelopeOf(doc)].join("\n");

const tail = (doc) => (doc.stop ? `${doc.stop}${doc.questions?.length ? ` · ${doc.questions.length} question(s)` : ""}` : `next ${doc.next}`);

// The one line `--quiet` prints: where the round stands, and what happens next.
export const brief = (doc) => `ROUNDTABLE  ${doc.root} round ${doc.round} · ${doc.did ? `${doc.did} · ` : ""}${tail(doc)}`;
