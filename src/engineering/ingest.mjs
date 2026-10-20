// The ONE door an engineering fact is written through.
//
// Validated candidates in (src/engineering/record.mjs has already held them to
// src/engineering/candidate.mjs), decisions out. Nothing else in this engine
// calls `eng.save`, and test/engineering-ingest.test.mjs greps for it: a second
// writer would be a way round reconciliation, and every rule reconcile.mjs
// holds -- confidence derived, sessions a set, strength moved only by a person,
// a contradiction never overwriting -- would be a rule with a side entrance.
//
// What this adds is everything that is not a judgement, stamped by
// infrastructure rather than asked of the candidate:
//
//   the SESSION     `{ host, at }` off the store's own io, unless a caller that
//                   knows better (a hook with the host's session) passes one
//   the COMMIT      the source port's, once for the batch
//   the FINGERPRINT one `ls-files -s` for every scope the batch names, and the
//                   status that follows from it: `fresh` when the scope hashed
//                   clean, `unknown` when it is dirty or gone. A fact recorded
//                   over uncommitted edits is not claimed current.
//
// The whole batch is one lock on the engineering state: reconciliation is
// read-modify-write over facts another session may be reconciling right now.
import { JOURNAL_VERSION, pendingResult, readOnce } from "../memory/journal.mjs";
import { factId, makeFact, watched } from "./model.mjs";
import { replayed } from "./replay.mjs";
import { reconcile } from "./reconcile.mjs";
import { factState, scopeState } from "../freshness.mjs";
import { sha } from "../hash.mjs";
import { scrubEngineering } from "../scrub.mjs";

export { JOURNAL_VERSION };
import { evidenceOf } from "../memory/evidence.mjs";

export function ingest(ctx, candidates, opts = {}) {
  const seenBy = opts.seenBy ?? ctx.seenBy ?? { host: ctx.eng.host, at: ctx.now() };
  const stamps = stampsFor(ctx, candidates);
  return ctx.eng.transact(() => batch(ctx, candidates, seenBy, stamps, opts));
}

// Returns the fact AS SAVED -- id, stamps and masking applied -- so what a
// caller prints is what the store holds, never the draft before makeFact.
function one(ctx, candidate, stamps, opts) {
  recoverPending(ctx, factId(candidate));
  const prior = opts.operation ? ctx.eng.observations().find((l) => l.operation === opts.operation && l.factId === factId(candidate)) : null;
  if (prior) return recovered(ctx, prior);
  return reconciled(ctx, candidate, stamps, opts);
}

function reconciled(ctx, candidate, stamps, opts) {
  const trusted = { ...opts, evidence: evidenceOf(candidate, stamped(candidate, stamps), candidate.seenBy, ctx.eng.find(factId(candidate))) };
  const decision = reconcile(candidate, ctx.eng.find(factId(candidate)), trusted);
  const fact = decision.fact ? makeFact(decision.fact, stamped(decision.fact, stamps)) : null;
  written(ctx, journalEntry(ctx, candidate, decision, stamps, trusted, fact), decision.finding, fact);
  return { ...decision, fact };
}

// Journal first, then the finding, then the fact -- the order a crash can be
// explained from.
function written(ctx, line, finding, fact) {
  ctx.eng.journal(line);
  if (finding) ctx.eng.addFinding(finding);
  if (fact) ctx.eng.save(fact);
}

// Written AHEAD of the save: a journal line with no fact behind it is a crash
// `replay` can report; a fact with no journal line behind it would be a claim
// nobody could explain. The candidate is kept as reconciliation received it --
// scrubbed, and without its session, which travels separately and hashed.
function entry(candidate, decision, stamps, opts) {
  const { seenBy, ...claim } = candidate;
  return { v: JOURNAL_VERSION, ...(opts.evidence ? { evidence: opts.evidence } : {}), at: stamps.at, factId: factId(candidate), outcome: decision.outcome, human: Boolean(opts.human), seenBy, commit: stamps.commit, candidate: scrubEngineering(claim) };
}

// One git call for every scope in the batch -- the reason `fingerprints` takes
// a list (src/frontend/index.mjs).
function stampsFor(ctx, candidates) {
  const scopes = [...new Set(candidates.flatMap(watched))];
  const now = (scopes.length ? ctx.source.fingerprints(scopes) : null) ?? {};
  return { commit: ctx.source.commit() ?? undefined, now, at: ctx.now() };
}

// Compared against ITSELF: at the moment of recording, a clean scope is by
// definition what was observed, so the only honest answers are fresh (clean)
// and unknown (dirty, gone, or no checkout to ask).
function stamped(fact, stamps) {
  const states = Object.fromEntries(watched(fact).map((s) => [s, scopeState(stamps.now[s] ?? null, stamps.now[s]?.hash)]));
  const hashes = watched(fact).map((s) => stamps.now[s]?.hash);
  const fingerprint = hashes.every(Boolean) ? sha(hashes.join("\n")) : undefined;
  return { commit: stamps.commit, fingerprint, status: factState({ scope: watched(fact) }, states), now: () => stamps.at };
}

// The scope hashes the freshness check will compare against later. Kept in
// state, never on a fact file, because two facts sharing a scope share one
// baseline -- src/architecture/store.mjs's same split.
function remembered(ctx, stamps) {
  const found = ctx.eng.model();
  const model = found.model ?? ctx.eng.emptyModel(stamps.at);
  const scopes = Object.fromEntries(Object.entries(stamps.now).filter(([, v]) => v?.hash).map(([s, v]) => [s, { hash: v.hash }]));
  (ctx.eng.setModelLocked ?? ctx.eng.setModel)({ ...model, at: stamps.at, commit: stamps.commit ?? model.commit, scopes: { ...model.scopes, ...scopes } });
}

function batch(ctx, candidates, seenBy, stamps, opts) {
  const locked = { ...ctx, eng: readOnce(ctx.eng, "observations") };
  const decided = candidates.map((c) => one(locked, { ...c, seenBy }, stamps, opts));
  remembered(ctx, stamps);
  return decided;
}

function journalEntry(ctx, candidate, decision, stamps, opts, fact) {
  const line = entry(candidate, decision, stamps, opts);
  const sequence = Math.max(0, ...ctx.eng.observations().map((l) => l.sequence ?? 0)) + 1;
  return { ...line, v: JOURNAL_VERSION, sequence, result: fact, operation: opts.operation, stamp: { at: fact?.at, commit: fact?.commit, fingerprint: fact?.fingerprint, status: fact?.status } };
}

function recovered(ctx, prior) {
  const lines = ctx.eng.observations();
  const derived = replayed(lines).get(prior.factId);
  const latest = lines.filter((l) => l.factId === prior.factId).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)).at(-1);
  const fact = makeFact(derived, { ...latest.stamp, now: () => latest.stamp?.at ?? latest.at });
  return repaired(ctx, fact, prior.outcome);
}

function repaired(ctx, fact, outcome) {
  ctx.eng.save(fact);
  return { fact, outcome, finding: null, recovered: true };
}

function recoverPending(ctx, id) {
  const result = pendingResult(ctx.eng.observations(), 'factId', id, ctx.eng.find(id));
  if (result) ctx.eng.save(result);
}
