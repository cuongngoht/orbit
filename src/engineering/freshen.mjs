// Everything `engineering ensure` reasons over, assembled once -- and the one
// write it may make.
//
// Split from the decision table for src/architecture/facts.mjs's reason: the
// table stays pure and a test can DESCRIBE a moved scope instead of producing
// one. What this asks the tree is one `rev-parse` and one `ls-files -s` for
// every scope the facts watch -- never a listing, never a file read.
import { factState, measure, movedScopes } from "../freshness.mjs";
import { flag, words } from "../learn/args.mjs";
import { tokens } from "../tokens.mjs";
import { answeredBy } from "./subject.mjs";
import { watched } from "./model.mjs";

export function ensureFacts(ctx, args = []) {
  const all = ctx.eng.all();
  const readable = ctx.source.commit() !== null;
  const scopes = readable ? measure(all.map((f) => ({ scope: watched(f) })), ctx.eng.model().model, ctx.source) : {};
  const asked = tokens(flag(args, "for") ?? words(args).join(" "));
  return { facts: all, count: all.length, readable, scopes, moved: movedScopes(scopes), asked, answered: answeredBy(all, asked), changes: changesOf(all, scopes) };
}

// A fact whose measured state differs from the one it carries. Every other fact
// is left byte for byte as it was.
const changesOf = (all, scopes) => all.map((fact) => ({ fact, status: factState({ scope: watched(fact) }, scopes) })).filter((c) => c.status !== c.fact.status);

// The only write, and only when the decision's `restamps` column says so. It
// moves `status` and nothing else -- a judgement is reconciliation's, never
// freshness's -- under the same lock reconciliation takes.
export function restamped(ctx, facts, decision) {
  if (!decision.restamps || !facts.changes.length) return [];
  return ctx.eng.transact(() => facts.changes.map((c) => restampedOne(ctx, c)));
}

function restampedOne(ctx, change) {
  const current = ctx.eng.find(change.fact.id);
  if (!current || current.fingerprint !== change.fact.fingerprint || current.at !== change.fact.at) return { ...change, skipped: true };
  ctx.eng.restamp(current, change.status);
  return change;
}
