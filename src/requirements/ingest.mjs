// The ONE door a requirement fact is written through -- src/knowledge/ingest.mjs's
// discipline, over requirement facts. Nothing else in this engine calls `saveFact` or
// `keepAside`, and a test greps for it: a second writer would be a way round
// reconciliation.
//
// Three things go through it. A batch of candidates read from sources (`ingest`). A
// question asked of a person, which also stands an `unknown` fact where nothing stood
// (`ask`). And a person's answer (`answer`), which settles the slots the question was
// about as `decided`. All three are stamped by infrastructure, not asked of the caller:
// the SESSION, the TIME, and the ORDER revisions of a source were first cited in, which is
// what makes one revision "later" than another.
//
// The order a line is written in is the order a crash can be explained from: the journal
// line FIRST, then what reconciliation noticed, then the version it replaced, then the
// fact itself, then the question a conflict raised or reopened. A crash anywhere after the
// journal leaves a journal that is AHEAD of the files, and `recover` -- which runs before
// every batch -- finishes what it says: the files it carries whole, and the settling of an
// answer whose facts never landed, so a question is never left answered over a slot that
// still says nothing.
import { Refused } from "../errors.mjs";
import { questionCandidateFindings } from "./candidate.mjs";
import { citesOf, factId, makeDecision, makeQuestion } from "./model.mjs";
import { moved, openQuestion, questionOf, reopened, reopens, runOf } from "./questions.mjs";
import { pending } from "./replay.mjs";
import { reconcile } from "./reconcile.mjs";

export const MAX_FACTS = 2048;

// What a decision and an unknown are reconciled against: no source, so no order and no
// question about whether a source may bear a requirement.
const NO_WORLD = { order: () => [], bearing: () => true };

const HISTORY = 16;

// ---- healing --------------------------------------------------------------------------------

function restoreFact(port, p) {
  if (p.keep) port.keepAside(p.keep);
  port.saveFact(p.fact);
}

const decidedCandidate = (slot, decision) => ({ subject: slot.subject, aspect: slot.aspect, says: decision.says, status: "decided", decision: decision.id, sources: [], seenBy: decision.seenBy });

// The last thing that happened to a question, by the journal: only an answer that is
// still the last word is finished -- one a reopening or a withdrawal came after is not.
const lastWord = (lines, questionId) => lines.filter((l) => ["answered", "reopened", "withdrawn"].includes(l.kind) && l.questionId === questionId).sort((a, b) => a.sequence - b.sequence).at(-1);

const answeredQuestion = (question, decision) => makeQuestion({ ...question, state: "answered", answer: decision.id, history: [...(question.history ?? []), { at: decision.at, action: "answer", by: "person" }].slice(-HISTORY) });

// A slot that already stands on this decision is left as it is.
function settleSlot(port, root, slot, decision) {
  const id = factId(root, slot.subject, slot.aspect);
  if (port.fact(id)?.decision !== decision.id) applied(port, { root, opts: {} }, { id, c: decidedCandidate(slot, decision), run: { world: NO_WORLD, at: decision.at } });
}

// Settle what an answer was for and say it is answered -- the same door, the same
// reconciliation, and nothing done twice.
function finishAnswer(port, root, line) {
  const question = port.question(line.questionId);
  if (!question || !line.decision) return null;
  for (const slot of question.slots) settleSlot(port, root, slot, line.decision);
  if (question.answer !== line.decision.id) port.saveQuestion(answeredQuestion(question, line.decision));
  return question.id;
}

function finishAnswers(port, root) {
  const lines = port.journalLines();
  const ids = [...new Set(lines.filter((l) => l.kind === "answered").map((l) => l.questionId))];
  return ids.map((id) => lastWord(lines, id)).filter((l) => l?.kind === "answered").map((l) => finishAnswer(port, root, l)).filter(Boolean);
}

const summary = (plan, answers) => ({ facts: plan.facts.map((p) => p.fact.id), questions: plan.questions.map((q) => q.id), decisions: plan.decisions.map((d) => d.id), answers });

// Heal what a crash left out: the journal is ahead of the files, never behind, so this
// only ever writes what the journal already carries whole.
export function recover(port) {
  const plan = pending(port);
  for (const p of plan.facts) restoreFact(port, p);
  for (const q of plan.questions) port.saveQuestion(q);
  for (const d of plan.decisions) port.saveDecision(d);
  return summary(plan, finishAnswers(port, port.id));
}

// ---- a batch read from sources --------------------------------------------------------------

// ctx: { requirements, now(), world: { resolves(ref) }, seenBy? }
export function ingest(ctx, root, candidates, opts = {}) {
  const port = ctx.requirements.open(root);
  const seen = candidates.map((c) => ({ ...c, seenBy: opts.seenBy ?? ctx.seenBy ?? { host: port.host, at: ctx.now() } }));
  return port.transact(() => settled(ctx, port, { root, candidates: seen, opts }));
}

function prepared(port, batch) {
  recover(port);
  bounded(port, batch);
}

function settled(ctx, port, batch) {
  prepared(port, batch);
  const world = worldOf(ctx, port.state(), batch.candidates);
  const results = batch.candidates.map((c) => one(port, batch, c, { world, at: ctx.now() }));
  remembered(port, world, ctx.now());
  return results;
}

function bounded(port, { root, candidates }) {
  const fresh = new Set(candidates.map((c) => factId(root, c.subject, c.aspect)).filter((id) => !port.fact(id)));
  if (port.facts().length + fresh.size > MAX_FACTS) throw new Refused(`the requirement would hold more than ${MAX_FACTS} facts — the bound; nothing of this batch was written`);
}

// What the batch cites, resolved ONCE, and the order each source's revisions were first
// cited in: what was seen before, then the revision the source stands at now.
function worldOf(ctx, state, candidates) {
  if (!ctx.world?.resolves) throw new Refused("requirements are recorded against sources read here, and none is bound");
  const found = new Map(candidates.flatMap((c) => citesOf(c.sources)).map((cite) => [cite.sid, ctx.world.resolves(`source:${cite.sid}@${cite.revision}`)]));
  const order = (sid) => orderOf(state.sources?.[sid]?.seen ?? [], found.get(sid)?.revision);
  return { found, order, bearing: (sid) => found.get(sid)?.authorityBearing === true };
}

const orderOf = (seen, current) => (current && !seen.includes(current) ? [...seen, current] : seen);

const lineOf = (id, c, decision, opts) => ({ kind: "recorded", factId: id, outcome: decision.outcome, candidate: c, result: decision.fact ?? undefined, operation: opts.operation, seenBy: c.seenBy });

// An operation already applied is REPLAYED, not applied again: a caller that retries after
// a lost answer gets the answer it would have had.
function replay(port, opts, id) {
  const line = opts.operation ? port.journalLines().find((l) => l.kind === "recorded" && l.operation === opts.operation && l.factId === id) : null;
  return line ? { factId: id, outcome: line.outcome, fact: line.result ?? null, changed: false, replayed: true } : null;
}

function one(port, batch, c, run) {
  const id = factId(batch.root, c.subject, c.aspect);
  return replay(port, batch.opts, id) ?? applied(port, batch, { id, c, run });
}

function applied(port, batch, { id, c, run }) {
  const decision = reconcile(c, port.fact(id), { root: batch.root, at: run.at, seenBy: c.seenBy, order: run.world.order, bearing: run.world.bearing });
  written(port, batch, { id, c, decision, run });
  return { factId: id, ...decision };
}

function written(port, batch, { id, c, decision, run }) {
  port.journal(lineOf(id, c, decision, batch.opts));
  if (decision.finding) port.addFinding(decision.finding);
  if (decision.kept) port.keepAside(decision.kept);
  if (decision.changed) port.saveFact(decision.fact);
  raised(port, batch.root, { c, decision, run });
}

// What a decision about a fact does to the QUESTIONS: a conflict asks one, and a decision
// held against a contradicting later revision may reopen the one that produced it.
function raised(port, root, { c, decision, run }) {
  const at = { at: run.at, seenBy: c.seenBy, order: run.world.order };
  if (decision.question) openQuestion(port, root, decision.question, at);
  if (decision.outcome === "held") reopenIfDue(port, { c, decision }, at);
}

function reopenIfDue(port, { c, decision }, run) {
  const question = port.questions().find((q) => q.answer === decision.fact.decision);
  if (question && reopens(question, c, run.order).reopen) reopened(port, question, c, run);
}

// What later batches measure "later" against: the revisions cited so far, in order, and
// where each source stood. Kept in state, never on a fact.
function remembered(port, world, at) {
  const state = port.state();
  const sources = { ...(state.sources ?? {}) };
  for (const [sid, found] of world.found) if (found) sources[sid] = { revision: found.revision, digest: found.digest ?? null, seen: world.order(sid), read: at };
  port.setState({ ...state, sources, position: port.journalLines().at(-1)?.sequence ?? 0, updatedAt: at });
}

// ---- a question asked of a person -----------------------------------------------------------

const unknownFor = (slot, seenBy) => ({ subject: slot.subject, aspect: slot.aspect, says: "", status: "unknown", sources: [], seenBy });

// Where nothing stands for a slot, an UNKNOWN does: nobody has said, so it is a question
// and not a guess. A slot that already says something is left as it is.
function standUnknown(ctx, port, root, slot, run) {
  const id = factId(root, slot.subject, slot.aspect);
  if (!port.fact(id)) applied(port, { root, opts: {} }, { id, c: unknownFor(slot, run.seenBy), run: { world: NO_WORLD, at: run.at } });
}

function asking(ctx, port, root, spec) {
  const found = questionCandidateFindings(spec, "question");
  if (found.length) throw new Refused(`not a question this requirement can ask:\n  ${found.join("\n  ")}`);
  const run = runOf(ctx, port, spec);
  for (const slot of spec.slots) standUnknown(ctx, port, root, slot, run);
  return openQuestion(port, root, spec, run);
}

// specs: candidate questions. One question per set of slots, however often it is asked.
export function ask(ctx, root, specs) {
  const port = ctx.requirements.open(root);
  return port.transact(() => {
    recover(port);
    return specs.map((spec) => asking(ctx, port, root, spec));
  });
}

// ---- a person's answer ----------------------------------------------------------------------

// ask: { question, says, human, seenBy? }. The decision is a person's, relayed; the
// engine records it and settles the slots it was about -- and nothing else.
export function answer(ctx, root, ask) {
  if (ask.human !== true) throw new Refused("an answer is a person's word — relay it with --human");
  const port = ctx.requirements.open(root);
  return port.transact(() => answered(ctx, port, root, ask));
}

function readied(port, id) {
  recover(port);
  return questionOf(port, id);
}

function decisionOf(ctx, port, root, question, ask) {
  moved(question, "answer", "person");
  return makeDecision({ root, question: question.id, says: ask.says, human: true, at: ctx.now(), seenBy: runOf(ctx, port, ask).seenBy });
}

function answered(ctx, port, root, ask) {
  const question = readied(port, ask.question);
  const decision = decisionOf(ctx, port, root, question, ask);
  port.journal({ kind: "answered", questionId: question.id, decisionId: decision.id, decision, seenBy: decision.seenBy });
  port.saveDecision(decision);
  return { decision, question: question.id, settled: finishAnswer(port, root, { questionId: question.id, decision }), facts: question.slots.map((s) => port.fact(factId(root, s.subject, s.aspect))) };
}
