// What a PROPOSED fact or question may say -- and the rows that decide it.
//
// A candidate is somebody's reading of a source: a model's, usually. It is held to the
// contract before anything is kept, one row per rule, so a rule is a sentence somebody
// can read and a new one is a row. A candidate cannot bring what the engine stamps, and
// it cannot claim a status only a person or the engine can give: `decided` is a
// person's, `unknown` and `conflict` and `superseded` are the engine's.
//
// It also cannot cite anything that is not a source at a revision or a decision. What
// the product does today, what a test asserts, what a run showed and what the code says
// are all things that HAPPEN; none is something that SHOULD, so none is a source here.
import { constraintFindings } from "../constraints.mjs";
import { scrub } from "../scrub.mjs";
import { CANDIDATE_FIELDS, FACT_FIELDS, MAX_DERIVED_FROM, MAX_SOURCES, QUESTION_CANDIDATE_FIELDS, QUESTION_FIELDS, QUESTION_STAMPED, SLOT, SOURCE_REF, STAMPED } from "./fields.mjs";
import { candidateStatuses } from "./vocab.mjs";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const list = (v) => (Array.isArray(v) ? v : []);

// A candidate cites a source, never a decision: a decision is what a person makes by
// answering, and the engine cites it on the fact that follows.
const cites = (c) => list(c.sources);

export const SPECS = [
  { name: "stamped", when: (c) => STAMPED.some((k) => k in c), say: (c) => `${STAMPED.filter((k) => k in c).join(", ")} ${STAMPED.filter((k) => k in c).length > 1 ? "are" : "is"} the engine's to say, never a candidate's` },
  { name: "status", when: (c) => c.status !== undefined && !candidateStatuses().includes(c.status), say: (c) => `a candidate is ${candidateStatuses().join(" or ")}, not ${String(c.status).slice(0, 20)} — deciding is a person's, and unknown, conflict and superseded are the engine's` },
  { name: "sources", when: (c) => (c.status ?? "stated") === "stated" && !cites(c).some((s) => new RegExp(SOURCE_REF).test(s)), say: () => "a stated fact cites the source it comes from, as source:<id>@<revision>" },
  { name: "cited", when: (c) => cites(c).some((s) => !new RegExp(SOURCE_REF).test(s)), say: () => "a candidate cites only sources at a revision (source:<id>@<revision>[#locator]) — code, a test, a screen, a run, a pull request or a person's decision is not where a requirement comes from" },
  { name: "derived", when: (c) => c.status === "derived" && (cites(c).length > 0 || list(c.derivedFrom).length === 0), say: () => "a derived fact names the facts it follows from and cites no source of its own" },
  { name: "follows", when: (c) => list(c.derivedFrom).some((id) => !/^rf-[0-9a-f]{12}$/.test(id)), say: () => "derivedFrom names facts by their rf- ids" },
  { name: "bounds", when: (c) => cites(c).length > MAX_SOURCES || list(c.derivedFrom).length > MAX_DERIVED_FROM, say: () => `at most ${MAX_SOURCES} sources and ${MAX_DERIVED_FROM} facts it follows from — more is several facts` },
  { name: "text", when: (c) => typeof c.says !== "string" || !c.says.trim(), say: () => "a fact says something, briefly, in its own words" },
  { name: "slot", when: (c) => !new RegExp(SLOT).test(c.subject) || !new RegExp(SLOT).test(c.aspect), say: () => "a fact is about a subject and an aspect, each a plain slug" },
  { name: "secret", when: (c) => [c.subject, c.aspect].some((v) => typeof v === "string" && scrub(v) !== v), say: () => "a subject or an aspect that looks like a secret is refused, never masked" },
];

export function factCandidateFindings(raw, where = "candidate") {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const unknown = Object.keys(raw).filter((k) => !CANDIDATE_FIELDS.includes(k) && !STAMPED.includes(k)).map((k) => `${where}: unknown field "${k}"`);
  return [...unknown, ...constraintFindings(pickTable(FACT_FIELDS, CANDIDATE_FIELDS), raw, where), ...SPECS.filter((r) => r.when(raw)).map((r) => `${where}: ${r.say(raw)}`)];
}

const pickTable = (table, keys) => Object.fromEntries(keys.map((k) => [k, table[k]]));

// A question candidate: which slots it is about, what it asks, whether it blocks, what
// is proposed, and which sources it rests on.
export const QUESTION_SPECS = [
  { name: "stamped", when: (c) => QUESTION_STAMPED.some((k) => k in c), say: (c) => `${QUESTION_STAMPED.filter((k) => k in c).join(", ")} is the engine's to say, never a candidate's` },
  { name: "slots", when: (c) => !Array.isArray(c.slots) || !c.slots.length || c.slots.some((s) => !isObject(s) || !new RegExp(SLOT).test(s.subject) || !new RegExp(SLOT).test(s.aspect)), say: () => "a question is about one or more slots, each a subject and an aspect" },
  { name: "asks", when: (c) => typeof c.asks !== "string" || !c.asks.trim(), say: () => "a question asks something, in one sentence" },
  { name: "depends", when: (c) => list(c.dependsOn).some((s) => !new RegExp(SOURCE_REF).test(s)), say: () => "dependsOn names sources at a revision (source:<id>@<revision>)" },
];

export function questionCandidateFindings(raw, where = "question") {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const unknown = Object.keys(raw).filter((k) => !QUESTION_CANDIDATE_FIELDS.includes(k) && !QUESTION_STAMPED.includes(k)).map((k) => `${where}: unknown field "${k}"`);
  return [...unknown, ...constraintFindings(pickTable(QUESTION_FIELDS, QUESTION_CANDIDATE_FIELDS), raw, where), ...QUESTION_SPECS.filter((r) => r.when(raw)).map((r) => `${where}: ${r.say(raw)}`)];
}
