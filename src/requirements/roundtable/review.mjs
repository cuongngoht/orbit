// What a REVIEWER may hand in: proposals for questions, judged whole before anything is kept.
//
// A reviewer is a model on somebody's host, and what it hands back is untrusted text. It is held to
// the contract a question candidate already has (candidate.mjs: which slots, what is asked, whether it
// blocks, what is proposed, what it rests on -- and nothing the engine stamps), and to a few more rules
// the roundtable adds, one row each. A hand-in is ALL OR NOTHING: one bad line refuses the lot and says
// which, because a half-kept review is a review nobody made. Nothing is repaired, and nothing a
// reviewer sends can become a fact, a decision or an authority: the only things this returns are
// question proposals, which the question engine then treats like any other.
import { Refused } from "../../errors.mjs";
import { quote } from "../../quote.mjs";
import { scrub } from "../../scrub.mjs";
import { questionCandidateFindings } from "../candidate.mjs";
import { MAX_ASKS, MAX_SAYS, MAX_SLOTS } from "../fields.mjs";
import { parseCandidates } from "../record.mjs";
import { ANSWERING, LIMITS, REVIEWERS } from "./vocab.mjs";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const slotsOf = (raw) => (Array.isArray(raw.slots) ? raw.slots : []);

const answering = (raw) => ANSWERING.filter((k) => k in raw);

export const words = (text) => quote(scrub(String(text ?? "")), MAX_ASKS);

// One row per rule the roundtable adds to a question candidate. Each says what it refuses, in a sentence
// somebody can read, and none looks at anything but the line.
export const SPECS = [
  { name: "answering", when: (raw) => answering(raw).length > 0, say: (raw) => `${answering(raw).join(", ")} would be an answer or a claim of authority — a reviewer proposes questions, and a person decides` },
  { name: "slot-keys", when: (raw) => slotsOf(raw).some((s) => isObject(s) && Object.keys(s).some((k) => k !== "subject" && k !== "aspect")), say: () => "a slot is a subject and an aspect, nothing else" },
  { name: "slot-count", when: (raw) => slotsOf(raw).length > MAX_SLOTS, say: () => `a question is about at most ${MAX_SLOTS} slots — ask about fewer, or split it` },
  { name: "slot-secret", when: (raw) => slotsOf(raw).some((s) => isObject(s) && [s.subject, s.aspect].some((v) => typeof v === "string" && scrub(v) !== v)), say: () => "a subject or an aspect that looks like a secret is refused, never masked" },
  { name: "asks", when: (raw) => typeof raw.asks === "string" && raw.asks.trim() !== "" && words(raw.asks) === "", say: () => "a question asks something, in one sentence" },
];

const findingsOf = (row) => {
  const at = `line ${row.i + 1}`;
  return [...questionCandidateFindings(row.raw, at), ...(isObject(row.raw) ? SPECS.filter((r) => r.when(row.raw)).map((r) => `${at}: ${r.say(row.raw)}`) : [])];
};

export const present = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const slotOf = (s) => ({ subject: s.subject, aspect: s.aspect });

export const proposedOf = (raw) => (raw.proposed ? quote(scrub(raw.proposed), MAX_SAYS) || undefined : undefined);

// The proposal as it is kept: its own fields, bounded and masked, under an id that says who proposed it.
export const candidateOf = (id, raw) => present({ id, slots: raw.slots.map(slotOf), asks: words(raw.asks), blocking: raw.blocking === true, proposed: proposedOf(raw), dependsOn: raw.dependsOn?.length ? raw.dependsOn : undefined });

const refusal = (what, why) => new Refused(`nothing was handed in — ${what} is all or nothing:\n  ${why.join("\n  ")}`);

function judged(rows) {
  const why = [...rows.filter((r) => r.why).map((r) => r.why), ...rows.filter((r) => !r.why).flatMap(findingsOf)];
  if (why.length) throw refusal("a review", why);
  return rows.map((r) => r.raw);
}

function bounded(rows, perspective) {
  if (rows.length > LIMITS.candidates) throw new Refused(`${perspective} handed in ${rows.length} candidates, and a perspective hands in at most ${LIMITS.candidates} candidates — keep the ones that decide the most, or merge them`);
  return rows;
}

export function reviewer(perspective) {
  if (!REVIEWERS.includes(perspective)) throw new Refused(`${perspective} is not a reviewer — the reviewers are ${REVIEWERS.join(", ")}, and the critic hands in with --critique`);
  return perspective;
}

// text: the lines a reviewer handed in, one JSON object each. Returns the candidates, numbered
// <perspective>-1 .. -n, or refuses the whole hand-in. An empty hand-in is "found nothing", and is a review.
export function judgeReview(perspective, text) {
  reviewer(perspective);
  const raws = judged(bounded(parseCandidates(text), perspective));
  return raws.map((raw, n) => candidateOf(`${perspective}-${n + 1}`, raw));
}
