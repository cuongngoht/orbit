// Everything the decision table reasons over, assembled in one place.
//
// Split from ensure.mjs for the reason src/architecture/facts.mjs is split from
// its table: the table stays pure and a test can DESCRIBE a stale scope. What this
// does ask the tree is deliberately narrow: one listing (so a file that APPEARS
// or goes away is noticed without reading anything) and one fingerprint call
// over the evidence files already recorded. It never reads a file -- that is what
// a scan is, and whether to pay for one is the question being answered.
//
// Freshness is src/freshness.mjs's, unchanged: fresh, stale, unknown, scoped to
// each evidence file. `stale` is a file that moved; `unknown` is one with
// uncommitted edits, which cannot be called either way and is therefore not a
// reason to read again -- the answer would be the same commit's, and is said as
// UNKNOWN until the edit is committed.
import { measure } from "../freshness.mjs";
import { evidenceOf, readersPrint } from "./discover/index.mjs";

export function ensureFacts(ctx, args = {}) {
  const files = ctx.source.files();
  const state = ctx.store.model();
  const all = ctx.store.all();
  const readable = files !== null && ctx.source.commit() !== null;
  return { forced: Boolean(args.rescan), readable, facts: all, count: all.length, model: state.model, modelWhy: state.why, readers: readersPrint(ctx), ...judged(ctx, files ?? [], state.model) };
}

function judged(ctx, files, model) {
  const inventory = evidenceOf(files, ctx);
  const scopes = model ? measure(inventory.map((p) => ({ scope: [p] })), model, ctx.source) : {};
  const was = new Set(model?.inventory ?? []);
  const is = new Set(inventory);
  return { inventory, scopes, stale: named(scopes, "stale"), dirty: named(scopes, "unknown"), added: addedOf(ctx, model, inventory, was), removed: [...was].filter((p) => !is.has(p)) };
}

// New evidence -- and evidence that could not be READ last time, once a commit has moved since: a file
// that was listed but not yet in the last commit (staged) is readable after it is committed, and one
// that stays unreadable (too large, not text) is asked again at most once per commit, never on every
// look.
function addedOf(ctx, model, inventory, was) {
  if (!model) return [];
  const retry = new Set(ctx.source.commit() !== model.commit ? model.unreadable ?? [] : []);
  return inventory.filter((p) => !was.has(p) || retry.has(p));
}

const named = (scopes, state) => Object.entries(scopes).filter(([, v]) => v.state === state).map(([k]) => k);
