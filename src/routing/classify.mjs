// A prompt -> an intent, the requirements it implies, and which table words it
// matched. Pure and deterministic: the same prompt always classifies the same.
//
// Each requirement says HOW it was asked for -- `required` when the intent
// implies it, `conditional` when a refinement cue in the prompt added it -- so
// the requirement graph (src/routing/graph.mjs) can say why every node is there.
//
// `grams` rides along so the resolver can match resources' own signals against
// the SAME reduction, and it never leaves this process: the decision a caller
// gets back names table words (`cues`), never a fragment of what was typed.
//
// A cue that sits INSIDE a longer cue another intent matched is that intent's word, not its own (1.8.7):
// "bugs" is a development word, but in "find bugs" it is part of an investigation's phrase, and a person
// asking to find bugs has asked for no change to the code. `matched` is every intent with a cue of its own
// left -- what a coordinated workflow is planned from (src/automation/workflows.mjs).
import { GENERAL, INTENTS, REFINEMENTS } from "./intents.mjs";
import { gramsOf, keyOf } from "./terms.mjs";

export function classify(prompt, intents = INTENTS, refinements = REFINEMENTS) {
  const grams = gramsOf(prompt);
  const scored = ownHits(intents.map((row) => ({ row, hits: hitsOf(row.cues, grams) })));
  const best = scored.reduce(better, null);
  return decided(best, scored, refinedOf(refinements, best?.row.id ?? GENERAL, grams), grams);
}

function decided(best, scored, refined, grams) {
  const id = best?.row.id ?? GENERAL;
  return { intent: { id, confidence: confidenceOf(best) }, cues: [...(best?.hits ?? []), ...refined.flatMap((x) => x.hits)], requirements: unique([...(best?.row.requires ?? []), ...refined.flatMap((x) => x.r.requires)]), asked: askedOf(best, refined), matched: scored.filter((x) => x.hits.length).map((x) => x.row.id), grams };
}

const refinedOf = (refinements, id, grams) => refinements.filter((r) => applies(r, id)).map((r) => ({ r, hits: hitsOf(r.cues, grams) })).filter((x) => x.hits.length);

const hitsOf = (cues, grams) => cues.filter((c) => grams.has(keyOf(c)));

const inside = (a, b) => keyOf(a) !== keyOf(b) && ` ${keyOf(b)} `.includes(` ${keyOf(a)} `);

const ownHits = (scored) => scored.map((x) => ({ ...x, hits: x.hits.filter((c) => !scored.some((y) => y !== x && y.hits.some((d) => inside(c, d)))) }));

// The most cues wins; the earlier row keeps a tie, so table order is priority.
const better = (best, next) => (next.hits.length > (best?.hits.length ?? 0) ? next : best);

const applies = (refinement, id) => refinement.within.includes("*") || refinement.within.includes(id);

const confidenceOf = (best) => ((best?.hits.length ?? 0) >= 2 ? "high" : "low");

// Top-level nodes, in order: the intent's own, then what a refinement added.
function askedOf(best, refined) {
  const own = (best?.row.requires ?? []).map((requirement) => ({ requirement, level: "required", because: `intent ${best.row.id}` }));
  const added = refined.flatMap((x) => x.r.requires.map((requirement) => ({ requirement, level: "conditional", because: `mentions ${x.hits.join(", ")}` })));
  return [...own, ...added].filter((n, at, all) => all.findIndex((m) => m.requirement === n.requirement) === at);
}

const unique = (list) => [...new Set(list)];
