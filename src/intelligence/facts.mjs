// Everything the decision table reasons over, assembled in one place -- so the
// table stays pure and a test can DESCRIBE a moved manifest or a narrowed task
// instead of having to produce one.
//
// What this asks the tree is deliberately narrow: one `rev-parse` to know
// there is a checkout, one fingerprint call for every scope the snapshot
// watches, and one LISTING -- the only way to notice a manifest that appeared or
// went away. It reads no file; reading is what a scan is, and whether to pay
// for one is the question being answered.
import { flag, words } from "../learn/args.mjs";
import { measure, movedScopes } from "../freshness.mjs";
import { tokens } from "../tokens.mjs";
import { sortedUnique } from "./group.mjs";
import { manifestPaths } from "./manifests/discover.mjs";
import { registryPrint } from "./registry.mjs";

export function ensureFacts(ctx, args = []) {
  const state = ctx.intel.model();
  const all = ctx.intel.all();
  const asked = tokens(flag(args, "for") ?? words(args).join(" "));
  const readable = ctx.source.commit() !== null;
  return { facts: all, count: all.length, model: state.model, modelWhy: state.why, asked, forced: args.includes("--rescan"), readable, ...(state.model && readable ? measured(ctx, all, state.model, asked) : UNMEASURED) };
}

const UNMEASURED = { scopes: {}, moved: [], manifestsMoved: [], usageMoved: [], skipped: [], fresh: [], registryMoved: false };

// Every scope the snapshot depends on: what the facts name, the unit
// directories a new source file would land in, and the directories the last
// usage pass read and found nothing in.
function measured(ctx, all, model, asked) {
  const watched = sortedUnique([...all.flatMap((f) => f.scope ?? []), ...(model.sweeps ?? []), ...(model.swept ?? [])]);
  const scopes = measure([{ scope: watched }], model, ctx.source);
  const moved = movedScopes(scopes);
  const manifests = new Set(model.manifests ?? []);
  return { scopes, moved, fresh: watched.filter((s) => scopes[s]?.state === "fresh"), registryMoved: registryPrint(ctx.registry) !== model.registry, manifestsMoved: sortedUnique([...moved.filter((s) => manifests.has(s)), ...listingMoved(ctx, model)]), ...narrowed(moved.filter((s) => !manifests.has(s)), all, asked) };
}

// A manifest that appeared or went away, by comparing the listing with what
// the last manifests pass saw. Adapters detect by path alone, so this reads
// nothing.
function listingMoved(ctx, model) {
  const now = manifestPaths(ctx.source.files(), ctx.registry.ecosystems);
  const was = model.manifests ?? [];
  return [...now.filter((p) => !was.includes(p)), ...was.filter((p) => !now.includes(p))];
}

// With a task named, only the moved scopes of facts that SPEAK to it are
// re-read -- a scope is relevant when a fact scoped exactly there carries one
// of the task's tokens in its subject. Everything else that moved is SKIPPED,
// and said to be.
function narrowed(moved, all, asked) {
  if (!asked.length) return { usageMoved: moved, skipped: [] };
  const relevant = moved.filter((s) => all.some((f) => (f.scope ?? []).includes(s) && speaksTo(f, asked)));
  return { usageMoved: relevant, skipped: moved.filter((s) => !relevant.includes(s)) };
}

// Asked of the fields that carry a SUBJECT, never of the statement, which is a
// sentence and would match on its grammar.
export const subjectTokens = (f) => new Set([f.technology, f.integration, f.operation, ...(f.technologies ?? []), ...(f.packages ?? []), ...(f.domains ?? [])].filter(Boolean).flatMap(tokens));

export const speaksTo = (f, asked) => asked.some((t) => subjectTokens(f).has(t));
