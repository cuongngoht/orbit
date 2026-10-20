// A VERIFICATION RECEIPT: what one obligation came to, on what evidence,
// against which oracle, in which context -- recorded at a checkpoint.
//
// A receipt is a RESULT, not a finding and never a verdict: `satisfied` says
// the evidence showed what the oracle says, `violated` that a confirmed finding
// shows it does not hold, `needs-requirement` that what happened is clear and
// nobody wrote down whether it is right. Only obligations with evidence become
// receipts: "blocked" and "needs approval" are reasons nothing was verified.
//
// The key is obligation + outcome + the evidence (sorted) + the oracle's
// revision, so the same result checked again is the same receipt and nothing
// is appended; a different outcome, or new evidence, is a new receipt that
// SUPERSEDES the last one for that obligation, which stays in the history.
//
// The obligation's kind travels as `type`: `kind` is the journal's own word for
// which record a line is, and would overwrite it on the disk.
//
// A receipt keeps the SCOPE it rests on -- the tracked files of the plan, the
// case and the map (the composition root decides which) -- with their
// fingerprints then. Whether it still applies is asked of those files now
// (src/freshness.mjs), never of HEAD: an unrelated commit leaves it fresh.
import { factState, scopeState } from "../freshness.mjs";
import { short } from "../hash.mjs";
import { engineVersion } from "../version.mjs";

const RESULTS = new Set(["satisfied", "violated", "needs-requirement"]);

// b: { scopeOf(obligation) -> [tracked paths], fingerprints(paths) -> {path: {hash}} | null,
//      seen: { host, session } }
export function receiptsOf(lw, b) {
  return lw.obligations.filter((o) => RESULTS.has(o.status) && o.evidence.length).map((o) => receiptFor(lw, o, b));
}

function receiptFor(lw, o, b) {
  const scope = b.scopeOf?.(o) ?? [];
  const oracle = { ...o.oracle, revision: oracleRevision(lw, o) };
  const evidence = [...new Set(o.evidence)].sort();
  return { key: `rcp-${short(JSON.stringify([o.id, o.status, evidence, oracle.revision]), 12)}`, obligation: o.id, type: o.kind, subject: o.subject, layer: o.layer, oracle, outcome: o.status, why: o.why, evidence, scope, fingerprints: hashesOf(b.fingerprints?.(scope), scope), context: contextOf(lw), seen: b.seen ?? null, engine: engineVersion() };
}

const hashesOf = (now, scope) => Object.fromEntries(scope.map((p) => [p, now?.[p]?.hash ?? null]));

// Which revision of the oracle the result was checked against: a plan's own
// revision, the map observation behind a control's effect, or none.
function oracleRevision(lw, o) {
  const plan = o.plan ? lw.plans.find((p) => p.id === o.plan) : null;
  if (plan) return `${plan.id}@${plan.revision ?? "?"}`;
  const effect = o.oracle?.kind === "map" ? lw.ctx.graph.effectOn.get(o.oracle.ref) : null;
  return effect ? effect.fe_commit ?? effect.seen ?? null : null;
}

// The context a result holds in: who acted, where, on which build. The build
// is context only -- it never decides freshness. `runtime` is the sandbox and the source tree the
// investigation was begun against (created.runtime), or null.
const contextOf = (lw) => ({ identity: lw.model.meta?.identity ?? null, environment: lw.model.meta?.environment?.id ?? null, build: lw.model.meta?.revision ?? null, runtime: lw.model.meta?.runtime ?? null });

// What the journal does not hold yet: appended at a checkpoint, each naming the
// receipt for its obligation it replaces.
export function newReceipts(model, derived) {
  const known = new Set(model.receipts.map((r) => r.key));
  return derived.filter((r) => !known.has(r.key)).map((r) => ({ ...r, supersedes: latestFor(model, r.obligation)?.id }));
}

export const latestFor = (model, obligation) => model.receipts.filter((r) => r.obligation === obligation).at(-1) ?? null;

// Does a receipt still apply? Its scope asked NOW against the hashes it kept.
export function applicabilityOf(receipt, now) {
  if (!receipt.scope?.length || !now) return "unknown";
  const states = Object.fromEntries(receipt.scope.map((p) => [p, scopeState(now[p] ?? null, receipt.fingerprints?.[p] ?? null)]));
  return factState({ scope: receipt.scope }, states);
}
