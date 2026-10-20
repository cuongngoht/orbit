// The ONE door a knowledge claim is written through -- src/engineering/ingest.mjs's
// discipline. Nothing else in this engine calls `know.save`, and a test greps
// for it: a second writer would be a way round reconciliation.
//
// What this adds is everything that is not a judgement, stamped by
// infrastructure rather than asked of the candidate: the SESSION (`seenBy`),
// the COMMIT, the FINGERPRINT of every scope the claim watches -- in one call
// for the whole batch -- and the status that follows (`fresh` when the scope
// hashed clean, `unknown` when it is dirty or gone: a claim recorded over
// uncommitted edits is never called current). The whole batch is one lock, and
// the BOUND is checked before any of it is written.
import { JOURNAL_VERSION, pendingResult, readOnce } from "../memory/journal.mjs";
import { Refused } from "../errors.mjs";
import { factState, scopeState } from "../freshness.mjs";
import { sha } from "../hash.mjs";
import { scrubKnowledge } from "../scrub.mjs";
import { claimId, makeClaim, watched } from "./model.mjs";
import { reconcile } from "./reconcile.mjs";

export { JOURNAL_VERSION };
import { evidenceOf } from "../memory/evidence.mjs";
export const MAX_CLAIMS = 4096;

export function ingest(ctx, candidates, opts = {}) {
  const seen = candidates.map((c) => ({ ...c, seenBy: opts.seenBy ?? ctx.seenBy ?? { host: ctx.know.host, at: ctx.now() } }));
  const stamps = stampsFor(ctx, seen);
  return ctx.know.transact(() => settled(ctx, seen, stamps, opts));
}

// The claims AND the baseline under one lock: the model is read-modify-write
// too, and a second recorder must not interleave between the two.
function settled(ctx, candidates, stamps, opts) {
  const decided = batch(ctx, candidates, stamps, opts);
  remembered(ctx, stamps);
  return decided;
}

function batch(ctx, candidates, stamps, opts) {
  const fresh = new Set(candidates.map(claimId).filter((id) => !ctx.know.has(id))).size;
  if (ctx.know.count() + fresh > MAX_CLAIMS) throw new Refused(`the knowledge room would hold more than ${MAX_CLAIMS} claims — the bound; nothing of this batch was written`);
  const locked = { ...ctx, know: readOnce(ctx.know, "journalLines") };
  return candidates.map((c) => one(locked, c, stamps, opts));
}

// Returns the claim AS SAVED -- id, stamps and masking applied -- so what a
// caller prints is what the store holds.
function one(ctx, candidate, stamps, opts) {
  recoverPending(ctx, claimId(candidate));
  return reconciled(ctx, candidate, stamps, opts);
}

function reconciled(ctx, candidate, stamps, opts) {
  const trusted = { ...opts, evidence: evidenceOf(candidate, stamped(candidate, stamps), candidate.seenBy, ctx.know.find(claimId(candidate))) };
  const decision = reconcile(candidate, ctx.know.find(claimId(candidate)), trusted);
  const claim = decision.claim ? makeClaim(decision.claim, stamped(decision.claim, stamps)) : null;
  written(ctx, journalEntry(ctx, candidate, decision, stamps, trusted, claim), decision.finding, claim);
  return { ...decision, claim };
}

// Journal first, then the finding, then the claim -- the order a crash can be
// explained from.
function written(ctx, line, finding, claim) {
  ctx.know.journal(line);
  if (finding) ctx.know.addFinding(finding);
  if (claim) ctx.know.save(claim);
}

function entry(candidate, decision, stamps, opts) {
  const { seenBy, ...claim } = candidate;
  return { v: JOURNAL_VERSION, ...(opts.evidence ? { evidence: opts.evidence } : {}), at: stamps.at, claimId: claimId(candidate), outcome: decision.outcome, human: Boolean(opts.human), seenBy, commit: stamps.commit, candidate: scrubKnowledge(claim) };
}

// One git call for every scope in the batch.
function stampsFor(ctx, candidates) {
  const scopes = [...new Set(candidates.flatMap(watched))];
  const now = (scopes.length ? ctx.source.fingerprints(scopes) : null) ?? {};
  return { commit: ctx.source.commit() ?? undefined, now, at: ctx.now() };
}

// Compared against ITSELF: at recording, a clean scope is by definition what
// was observed, so the honest answers are fresh (clean) and unknown.
function stamped(claim, stamps) {
  const states = Object.fromEntries(watched(claim).map((s) => [s, scopeState(stamps.now[s] ?? null, stamps.now[s]?.hash)]));
  const hashes = watched(claim).map((s) => stamps.now[s]?.hash);
  const fingerprint = hashes.length && hashes.every(Boolean) ? sha(hashes.join("\n")) : undefined;
  return { commit: stamps.commit, fingerprint, status: watched(claim).length ? factState({ scope: watched(claim) }, states) : "unknown", now: () => stamps.at };
}

// The baselines later readers measure against, kept in state rather than on a
// claim, because claims sharing a scope share one baseline.
function remembered(ctx, stamps) {
  const model = ctx.know.model().model ?? ctx.know.emptyModel(stamps.at);
  const scopes = Object.fromEntries(Object.entries(stamps.now).filter(([, v]) => v?.hash).map(([s, v]) => [s, { hash: v.hash }]));
  ctx.know.setModel({ ...model, at: stamps.at, commit: stamps.commit ?? model.commit, scopes: { ...model.scopes, ...scopes } });
}

function journalEntry(ctx, candidate, decision, stamps, opts, claim) {
  const line = entry(candidate, decision, stamps, opts);
  return { ...line, result: claim, sequence: Math.max(0, ...ctx.know.journalLines().map((l) => l.sequence ?? 0)) + 1 };
}

function recoverPending(ctx, id) {
  const result = pendingResult(ctx.know.journalLines(), 'claimId', id, ctx.know.find(id));
  if (result) ctx.know.save(result);
}
