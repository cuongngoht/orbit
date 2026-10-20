// What is ASKED of a person, and where it stands.
//
// A question is about a set of slots, and there is one per set: asking again about the
// same slots extends the question that is there -- more that it rests on, more reason it
// blocks -- and never makes a second, so a person is asked once. It is written into the
// journal before its file, like everything here, so a crash between the two is explained.
//
// A question's life is a TABLE, and the table says WHO moves it. The engine opens a
// question, and reopens one -- but only a person answers or withdraws one: the decision a
// person makes is what settles a slot as `decided`. Nothing here proposes an answer as a
// fact: a `proposed` text is a suggestion for the person to accept or change.
//
// An answer STAYS an answer until the ground it rested on moves. It reopens when -- and
// only when -- a later revision of a source the question rested on says something that
// contradicts what the person decided; the decision itself keeps holding until they
// answer again. A source that agrees with it, or a revision that says nothing new about
// the slot, asks nobody anything.
import { Refused } from "../errors.mjs";
import { knownIn, sessionMarks } from "../memory/session.mjs";
import { KEEP_SESSIONS } from "../memory/support.mjs";
import { citesOf, makeQuestion, questionId, revisionLater } from "./model.mjs";
import { isOpen } from "./vocab.mjs";

// action, who makes it, where it can be made from, where it leads.
export const TRANSITIONS = [
  { action: "open", by: "engine", from: [], to: "open" },
  { action: "answer", by: "person", from: ["open", "reopened"], to: "answered" },
  { action: "reopen", by: "engine", from: ["answered"], to: "reopened" },
  { action: "withdraw", by: "person", from: ["open", "reopened"], to: "withdrawn" },
];

// The state an action leads to, or a sentence about why not.
export function moved(question, action, by) {
  const row = TRANSITIONS.find((t) => t.action === action);
  if (row.by !== by) throw new Refused(`${action} is ${row.by === "person" ? "a person's" : "the engine's"} to do, never ${by === "person" ? "a person's" : "the engine's"}`);
  if (!row.from.includes(question?.state)) throw new Refused(`${question?.id ?? "that question"} is ${question?.state}; it can be ${action}ed only from ${row.from.join(" or ")}`);
  return row.to;
}

const union = (a, b) => [...new Set([...(a ?? []), ...(b ?? [])])];

const entry = (run, action, by = "engine") => ({ at: run.at, action, by });

const historyOf = (q, run, action, by) => [...(q.history ?? []), entry(run, action, by)].slice(-16);

// A question that already stands is extended, not repeated.
const extended = (q, spec, run) => makeQuestion({ ...q, blocking: q.blocking || spec.blocking === true, ...(spec.proposed && !q.proposed ? { proposed: spec.proposed } : {}), dependsOn: union(q.dependsOn, spec.dependsOn), history: historyOf(q, run, "extended") });

const created = (root, spec, run) => makeQuestion({ root, slots: spec.slots, asks: spec.asks, blocking: spec.blocking === true, ...(spec.proposed ? { proposed: spec.proposed } : {}), dependsOn: spec.dependsOn ?? [], state: "open", at: run.at, history: [entry(run, "opened")] });

// A question that was answered or withdrawn stays as it is when it is asked again. Only a person
// answers or withdraws one, and only a source that MOVED and now says something else reopens one
// (`reopened`); a host that asks the same thing again has learned nothing that does either, and
// must not be able to undo a person's word by repeating a question.
//
// spec: { slots, asks, blocking?, proposed?, dependsOn? }; run: { at, seenBy }.
// Journal first, then the file; returns the question as it stands.
export function openQuestion(port, root, spec, run) {
  const existing = port.question(questionId(root, spec.slots));
  if (existing && !isOpen(existing)) return existing;
  return kept(port, existing ? extended(existing, spec, run) : created(root, spec, run), run);
}

function kept(port, question, run) {
  port.journal({ kind: "asked", questionId: question.id, question, seenBy: run.seenBy });
  port.saveQuestion(question);
  return question;
}

// ---- once per session --------------------------------------------------------------------

const MAX_WORKFLOWS = 8;

// Has this session already put this question to a person, in this workflow?
export const wasAsked = (question, run) => knownIn(question.asked?.[run.workflow] ?? [], run.seenBy);

// The question, marked as put to a person in this session and workflow -- so it is never
// put twice in one. The caller saves it.
export function markAsked(question, run) {
  const marks = [...(question.asked?.[run.workflow] ?? []), ...sessionMarks(run.seenBy)].slice(-KEEP_SESSIONS);
  const asked = Object.fromEntries(Object.entries({ ...(question.asked ?? {}), [run.workflow]: marks }).slice(-MAX_WORKFLOWS));
  return makeQuestion({ ...question, asked, history: historyOf(question, run, "surfaced") });
}

// ---- when an answer stops holding -----------------------------------------------------------

// Did a source the question rested on move on, in the candidate that now speaks?
const dependencyMoved = (question, candidate, order) => citesOf(candidate.sources).some((n) => citesOf(question.dependsOn).some((o) => o.sid === n.sid && revisionLater(order(n.sid), n.revision, o.revision)));

// First row that holds; the last always does. A source that AGREES is a `confirm` in the
// reconciliation and never gets here: this asks only about a candidate that contradicts
// a standing decision.
export const REOPEN = [
  { id: "not-answered", when: (q) => q.state !== "answered", reopen: false },
  { id: "no-later-source", when: (q, c, order) => !dependencyMoved(q, c, order), reopen: false },
  { id: "moved-and-contradicted", when: () => true, reopen: true },
];

export function reopens(question, candidate, order) {
  const row = REOPEN.find((r) => r.when(question, candidate, order));
  return { reopen: row.reopen, row: row.id };
}

// The sources the question rests on, now at the revisions that moved.
const refreshed = (dependsOn, sources) => (dependsOn ?? []).map((ref) => citesOf(sources).reduce((r, n) => (r.startsWith(`source:${n.sid}@`) ? `source:${n.sid}@${n.revision}` : r), ref));

const becauseOf = (c) => `a later revision of a source it rested on says something else about ${c.subject} ${c.aspect}`;

// Journal first, then the file, then what was noticed.
function noted(port, next, because) {
  port.journal({ kind: "reopened", questionId: next.id, because });
  port.saveQuestion(next);
  port.addFinding({ kind: "question-reopened", questionId: next.id, say: `${next.id}: ${because} — the decision still holds until it is answered again` });
  return next;
}

// run: { at, seenBy, order }.
export function reopened(port, question, candidate, run) {
  const next = makeQuestion({ ...question, state: moved(question, "reopen", "engine"), answer: undefined, dependsOn: refreshed(question.dependsOn, candidate.sources), history: historyOf(question, run, "reopened") });
  return noted(port, next, becauseOf(candidate));
}

// ---- a person's other move ---------------------------------------------------------------------

// A person says it need not be asked. The slots stay as they are -- unknown, or whatever
// they were -- and clarity says so; nothing is decided by not asking.
export function withdraw(ctx, root, ask) {
  if (ask.human !== true) throw new Refused("withdrawing a question is a person's decision — relay it with --human");
  const port = ctx.requirements.open(root);
  return port.transact(() => withdrawn(ctx, port, ask));
}

function questionOf(port, id) {
  const question = port.question(id);
  if (!question) throw new Refused(`no question ${id} in this requirement`);
  return question;
}

const runOf = (ctx, port, ask) => ({ at: ctx.now(), seenBy: ask.seenBy ?? ctx.seenBy ?? { host: port.host, at: ctx.now() } });

function withdrawn(ctx, port, ask) {
  const question = questionOf(port, ask.question);
  const run = runOf(ctx, port, ask);
  const next = makeQuestion({ ...question, state: moved(question, "withdraw", "person"), history: historyOf(question, run, "withdrawn", "person") });
  port.journal({ kind: "withdrawn", questionId: next.id, because: ask.why, seenBy: run.seenBy });
  return port.saveQuestion(next) && next;
}

export { questionOf, runOf };
