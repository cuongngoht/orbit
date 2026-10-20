// Everything the decision table reasons over, assembled in one place.
//
// Split from `ensure.mjs` for the reason src/query/triage.mjs splits `facts()`
// from `BANDS`: the table stays pure and a test can describe a stale scope or an
// unanswered capability rather than having to produce one. Nothing in the suite
// needs a clock, a disk or a commit to cover every path through the decision.
//
// What this DOES ask the tree is deliberately narrow: one `rev-parse` to know
// there is a checkout at all, and one `ls-files -s` per distinct scope the facts
// already name. It never lists the tree and never reads a file -- those are what
// a SCAN is, and whether to pay for one is the question being answered.
import { capabilityTokens, unanswered } from "./tokens.mjs";
import { measure, movedScopes } from "../freshness.mjs";
import { flag, words } from "../learn/args.mjs";

export function ensureFacts(ctx, args = []) {
  const state = ctx.arch.model();
  const all = ctx.arch.all();
  const asked = askedOf(args);
  return { ...counted(all, state), asked, forced: args.includes("--rescan"), ...judged(all, state.model, ctx.source, asked), readable: ctx.source.commit() !== null };
}

const counted = (all, state) => ({ facts: all, count: all.length, model: state.model, modelWhy: state.why });

// `--capability=` says it outright; `--for=` finds the proper name in a
// sentence. Both, when both are given -- somebody naming one explicitly has not
// stopped meaning the rest of what they typed.
function askedOf(args) {
  const named = (flag(args, "capability") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...named, ...capabilityTokens(flag(args, "for") ?? words(args).join(" "))])];
}

// A capability question is answered by a CAPABILITY fact and by nothing else. A
// module that happens to share a word with the question is a coincidence, and
// letting it answer is how a token search starts sounding certain about things
// it never looked at.
function judged(all, model, source, asked) {
  const scopes = model ? measure(all, model, source) : {};
  const caps = all.filter((f) => f.kind === "capability");
  return { scopes, moved: movedScopes(scopes), unanswered: asked.length ? unanswered(caps, asked) : [] };
}
