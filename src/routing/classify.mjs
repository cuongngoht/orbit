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
//
// 0.5.0 (B5, B22): a cue in the prompt's head outweighs one only a pasted tail carries (src/routing/terms.mjs
// WEIGHTS), so the intent -- and `matched` -- are what the person typed; `marks` are the MARKS rows the prompt hit
// (opt-out, continue, halt, status -- table words); `shape` is counts; `focus` the requirements in the order the
// request is about them. Confidence is unchanged in meaning: two cues of the person's own, or more, is `high`.
import { GENERAL, INTENTS, MARKS, REFINEMENTS } from "./intents.mjs";
import { WEIGHTS, gramsOf, headGramsOf, keyOf, openingGramsOf, shapeOf } from "./terms.mjs";

export function classify(prompt, intents = INTENTS, refinements = REFINEMENTS) {
  const read = { grams: gramsOf(prompt), head: headGramsOf(prompt), opening: openingGramsOf(prompt), shape: shapeOf(prompt) };
  const scored = ownHits(intents.map((row) => ({ row, hits: hitsOf(row.cues, read.grams) }))).map(weighedIn(read.head));
  const best = scored.reduce(better, null);
  return decided(best, scored, refinedOf(refinements, best?.row.id ?? GENERAL, read.grams), read);
}

function decided(best, scored, refined, read) {
  const id = best?.row.id ?? GENERAL;
  return { intent: { id, confidence: confidenceOf(best) }, cues: [...(best?.hits ?? []), ...refined.flatMap((x) => x.hits)], requirements: unique([...(best?.row.requires ?? []), ...refined.flatMap((x) => x.r.requires)]), asked: askedOf(best, refined), matched: scored.filter((x) => x.weight > 0).map((x) => x.row.id), grams: read.grams, marks: marksOf(read), shape: read.shape, focus: focusOf(best, refined) };
}

// A cue the head carries weighs WEIGHTS.head; one only the pasted tail carries, WEIGHTS.tail.
const weighedIn = (head) => (x) => ({ ...x, weight: x.hits.reduce((w, cue) => w + (head.has(keyOf(cue)) ? WEIGHTS.head : WEIGHTS.tail), 0) });

const marksOf = (read) => MARKS.filter((m) => m.cues.some((c) => read[m.at].has(keyOf(c)))).map((m) => m.id);

// The requirements in the order the request is ABOUT them: a refinement that adds a word of its own first -- "why
// did" in a test question asks for a classification, "plan" for a plan -- then the intent's own, then a refinement
// whose words were all the intent's ("explore" in an exploration is the investigation itself).
function focusOf(best, refined) {
  const own = new Set((best?.hits ?? []).map(keyOf));
  const leads = refined.filter((x) => x.hits.some((c) => !own.has(keyOf(c))));
  return unique([...leads.flatMap((x) => x.r.requires), ...(best?.row.requires ?? []), ...refined.flatMap((x) => x.r.requires)]);
}

// Whether a low-confidence intent may be SAID (0.5.0, B5): only when a provider recommended on its own words alone
// (`requiresSignal`) was chosen because one of them is in the prompt -- a word that names it, not one anybody uses.
export const heard = (intent, chosen) => intent?.confidence !== "low" || (chosen ?? []).some((c) => c.gated);

const refinedOf = (refinements, id, grams) => refinements.filter((r) => applies(r, id)).map((r) => ({ r, hits: hitsOf(r.cues, grams) })).filter((x) => x.hits.length);

const hitsOf = (cues, grams) => cues.filter((c) => grams.has(keyOf(c)));

const inside = (a, b) => keyOf(a) !== keyOf(b) && ` ${keyOf(b)} `.includes(` ${keyOf(a)} `);

const ownHits = (scored) => scored.map((x) => ({ ...x, hits: x.hits.filter((c) => !scored.some((y) => y !== x && y.hits.some((d) => inside(c, d)))) }));

// The most weight wins -- for a prompt no longer than the head, the most cues; the earlier row keeps a tie, so table
// order is priority.
const better = (best, next) => (next.weight > (best?.weight ?? 0) ? next : best);

const applies = (refinement, id) => refinement.within.includes("*") || refinement.within.includes(id);

const confidenceOf = (best) => ((best?.weight ?? 0) >= 2 * WEIGHTS.head ? "high" : "low");

// Top-level nodes, in order: the intent's own, then what a refinement added.
function askedOf(best, refined) {
  const own = (best?.row.requires ?? []).map((requirement) => ({ requirement, level: "required", because: `intent ${best.row.id}` }));
  const added = refined.flatMap((x) => x.r.requires.map((requirement) => ({ requirement, level: "conditional", because: `mentions ${x.hits.join(", ")}` })));
  return [...own, ...added].filter((n, at, all) => all.findIndex((m) => m.requirement === n.requirement) === at);
}

const unique = (list) => [...new Set(list)];

// An intent somebody DECLARED (0.0.4: a goal's structured reading names the routing intent each unit is planned
// under), answered in classify's shape -- the row's own requirements, no cue, no gram -- so a declared intent is
// never read off the words again. An id no row has is null: the caller refuses it.
export function declared(id, intents = INTENTS) {
  const row = intents.find((r) => r.id === id);
  if (!row) return null;
  return { intent: { id: row.id, confidence: "declared" }, cues: [], requirements: [...row.requires], asked: [], matched: [row.id], grams: new Set(), marks: [], shape: shapeOf(""), focus: [...row.requires] };
}
