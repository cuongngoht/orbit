// What the CRITIC may do with what the reviewers proposed: keep, drop, merge or refine each
// candidate, once -- and never answer one.
//
// The critic is a model on somebody's host, and what it hands back is untrusted text, judged whole
// like a review is. It may say which candidates are worth a person's time and how to ask them more
// atomically. It may not say what the answer is, what the requirement decided, or whose word anything
// is, and it may not change which slots a question is about: that is what makes it THAT question, and
// a critic that could would be making a different one. Everything it does is a pure function over the
// pool it was handed; nothing here reads a room, and what comes out is question proposals for the
// question engine, which dedupes by slot set and keeps every answered question answered.
import { Refused } from "../../errors.mjs";
import { quote } from "../../quote.mjs";
import { scrub } from "../../scrub.mjs";
import { MAX_SLOTS } from "../fields.mjs";
import { questionId, slotKey } from "../model.mjs";
import { parseCandidates } from "../record.mjs";
import { present, proposedOf, words } from "./review.mjs";
import { ANSWERING, LIMITS, VERDICTS, VERDICT_NAMES } from "./vocab.mjs";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// What would change WHICH question this is.
const IDENTITY = ["slots"];

const TYPES = { asks: "string", blocking: "boolean", proposed: "string", because: "string", into: "string" };

const keysOf = (verdict) => ["candidate", "verdict", ...(VERDICTS[verdict] ?? [])];

const named = (r, list) => list.filter((k) => k in r);

const mistyped = (r) => Object.entries(TYPES).filter(([k, t]) => k in r && typeof r[k] !== t).map(([k, t]) => `${k} is a ${t}`);

const stray = (r) => Object.keys(r).filter((k) => !keysOf(r.verdict).includes(k) && ![...ANSWERING, ...IDENTITY].includes(k));

// One row per rule over one verdict line, in a sentence somebody can read. `ids`: the pool's candidates.
export const RULES = [
  { name: "candidate", when: (r, ids) => !ids.includes(r.candidate), say: (r) => `candidate ${quote(String(r.candidate), 40)} is not one a reviewer handed in` },
  { name: "verdict", when: (r) => !VERDICT_NAMES.includes(r.verdict), say: () => `a verdict is ${VERDICT_NAMES.join(", ")}` },
  { name: "answering", when: (r) => named(r, ANSWERING).length > 0, say: (r) => `${named(r, ANSWERING).join(", ")} would be an answer — the critic challenges a question and never answers it` },
  { name: "identity", when: (r) => named(r, IDENTITY).length > 0, say: () => "which slots a question is about is what makes it that question — keep it, drop it, or merge it into another" },
  { name: "fields", when: (r) => VERDICT_NAMES.includes(r.verdict) && stray(r).length > 0, say: (r) => `a ${r.verdict} says ${keysOf(r.verdict).join(", ")}, nothing else` },
  { name: "types", when: (r) => mistyped(r).length > 0, say: (r) => mistyped(r).join(", ") },
  { name: "into", when: (r) => r.verdict === "merge" && typeof r.into !== "string", say: () => "a merge names the candidate it goes into" },
  { name: "refine", when: (r) => r.verdict === "refine" && !["asks", "blocking", "proposed"].some((k) => k in r), say: () => "a refine changes asks, blocking or proposed" },
  { name: "asks", when: (r) => typeof r.asks === "string" && words(r.asks) === "", say: () => "a question asks something, in one sentence" },
];

const findingsOf = (row, ids) => {
  const at = `line ${row.i + 1}`;
  return isObject(row.raw) ? RULES.filter((r) => r.when(row.raw, ids)).map((r) => `${at}: ${r.say(row.raw)}`) : [`${at}: a verdict is a JSON object`];
};

const survivors = (raws) => new Set(raws.filter((r) => r.verdict === "keep" || r.verdict === "refine").map((r) => r.candidate));

// Rules over the verdicts as a SET: each candidate once, and a merge into one that stays.
function setFindings(raws, ids) {
  const seen = raws.map((r) => r.candidate);
  const missing = ids.filter((id) => !seen.includes(id));
  const twice = [...new Set(seen.filter((id, i) => seen.indexOf(id) !== i))];
  const bad = raws.filter((r) => r.verdict === "merge" && !survivors(raws).has(r.into)).map((r) => r.candidate);
  return [...(missing.length ? [`no verdict for ${missing.join(", ")} — every candidate gets exactly one`] : []), ...twice.map((id) => `${id} has more than one verdict`), ...(bad.length ? [`${bad.join(", ")} merges into a candidate that is not kept or refined`] : [])];
}

const refusal = (why) => new Refused(`nothing was kept — a critique is all or nothing:\n  ${why.join("\n  ")}`);

// A line that is not JSON, then what each parsed line breaks.
const whyOf = (rows, ids) => [...rows.filter((r) => r.why).map((r) => r.why), ...rows.filter((r) => !r.why).flatMap((r) => findingsOf(r, ids))];

function judged(rows, ids) {
  const raws = rows.filter((r) => !r.why).map((r) => r.raw);
  const why = whyOf(rows, ids);
  const sets = why.length ? [] : setFindings(raws, ids);
  if (why.length + sets.length) throw refusal([...why, ...sets]);
  return raws;
}

// ---- applying the verdicts ---------------------------------------------------------------------

const union = (a, b) => [...new Set([...(a ?? []), ...(b ?? [])])];

const unionSlots = (a, b) => [...new Map([...a, ...b].map((s) => [slotKey(s), s])).values()];

const specOf = (c) => present({ slots: c.slots, asks: c.asks, blocking: c.blocking === true, proposed: c.proposed, dependsOn: c.dependsOn });

const orNone = (list) => (list.length ? list : undefined);

// Two proposals about one question: both sets of slots, blocking if either blocks, what the first one
// said and the first suggestion there is.
const joined = (into, from) => present({ slots: unionSlots(into.slots, from.slots), asks: into.asks, blocking: into.blocking || from.blocking, proposed: into.proposed ?? from.proposed, dependsOn: orNone(union(into.dependsOn, from.dependsOn)) });

const changed = (row, key, was, now) => (row[key] === undefined ? was : now(row[key]));

const refined = (spec, row) => present({ ...spec, asks: changed(row, "asks", spec.asks, words), blocking: changed(row, "blocking", spec.blocking, (b) => b), proposed: changed(row, "proposed", spec.proposed, () => proposedOf(row)) });

const standing = (pool, rows) => new Map(pool.filter((c) => survivors(rows).has(c.id)).map((c) => [c.id, { spec: specOf(c), from: [c.id] }]));

const rowOf = (rows, id) => rows.find((r) => r.candidate === id);

function refinedAll(kept, rows) {
  for (const [id, k] of kept) kept.set(id, { ...k, spec: rowOf(rows, id).verdict === "refine" ? refined(k.spec, rowOf(rows, id)) : k.spec });
  return kept;
}

function merge(kept, pool, row) {
  const target = kept.get(row.into);
  const spec = joined(target.spec, specOf(pool.find((c) => c.id === row.candidate)));
  if (spec.slots.length > MAX_SLOTS) throw refusal([`${row.candidate} merged into ${row.into} would be about ${spec.slots.length} slots, and a question is about at most ${MAX_SLOTS} slots`]);
  kept.set(row.into, { spec, from: [...target.from, row.candidate] });
}

function applied(pool, rows) {
  const kept = refinedAll(standing(pool, rows), rows);
  for (const row of rows.filter((r) => r.verdict === "merge")) merge(kept, pool, row);
  return [...kept.values()];
}

const coalesce = (found, k) => (found ? { spec: joined(found.spec, k.spec), from: [...found.from, ...k.from] } : k);

// One question per set of slots, however many candidates were about it -- what the question engine
// would do anyway, done here so a round counts, shows and bounds what a person will actually be asked.
function coalesced(kept, root) {
  const byQuestion = new Map();
  for (const k of kept) byQuestion.set(questionId(root, k.spec.slots), coalesce(byQuestion.get(questionId(root, k.spec.slots)), k));
  return [...byQuestion.values()];
}

function bounded(retained) {
  if (retained.length > LIMITS.retained) throw new Refused(`${retained.length} questions would be kept, and a round keeps at most ${LIMITS.retained} questions — drop or merge until there are ${LIMITS.retained}`);
  return retained;
}

const recordOf = (r) => present({ candidate: r.candidate, verdict: r.verdict, into: r.verdict === "merge" ? r.into : undefined, because: r.because ? quote(scrub(r.because), LIMITS.because) || undefined : undefined });

// pool: the candidates the reviewers handed in (each with an id). text: the critic's lines, one JSON
// object each. Returns the questions to put, each with the candidates it came from, and the verdicts
// as they are kept -- or refuses the lot.
export function judgeCritique(pool, text, root) {
  const raws = judged(parseCandidates(text), pool.map((c) => c.id));
  const retained = bounded(coalesced(applied(pool, raws), root));
  return { retained, verdicts: raws.map(recordOf) };
}
