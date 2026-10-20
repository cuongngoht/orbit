// Making a requirement fact, a question, a decision -- and reading what a set of them
// comes to. `makeFact` is the ONLY constructor of a fact, as every other memory's is:
// what is not a judgement (its id, when, which session) is stamped here, and what is
// stamped is never asked of a candidate.
//
// An id is a function of WHAT a thing is about, so two sessions saying the same thing
// about the same slot meet in one file: a fact by its requirement, subject and aspect,
// a question by the slots it asks about, a decision by its question and its time.
//
// Authority is DERIVED on every read and never stored on a fact: a person who accepts
// a source tomorrow changes what today's facts rest on, and a stored word would still
// be yesterday's. A decided fact is the team's word; a stated one is as strong as the
// weakest source it cites; a derived one as strong as the weakest fact it follows from.
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { Refused } from "../errors.mjs";
import { sha, short } from "../hash.mjs";
import { canonical } from "../network/fingerprint.mjs";
import { quote } from "../quote.mjs";
import { scrub } from "../scrub.mjs";
import { DECISION_FIELDS, DECISION_REF, DECISION_REQUIRED, FACT_FIELDS, FACT_REQUIRED, MAX_ASKS, MAX_DERIVED_FROM, MAX_SAYS, MAX_SLOTS, MAX_SOURCES, QUESTION_FIELDS, QUESTION_REQUIRED, SLOT, SOURCE_REF } from "./fields.mjs";
import { AUTHORITY_ORDER, humanOnly, isCurrent, settles, weakerAuthority } from "./vocab.mjs";

export const FACT_VERSION = 1;
export const QUESTION_VERSION = 1;
export const DECISION_VERSION = 1;
export const SNAPSHOT_VERSION = 1;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// Absent, not null: a null would be a value nobody declared, in a record that claims to
// have been validated.
const present = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

const unknownKeys = (raw, table, where) => Object.keys(raw).filter((k) => !(k in table)).map((k) => `${where}: unknown field "${k}"`);

// ---- ids ---------------------------------------------------------------------------

export const factId = (root, subject, aspect) => `rf-${short(`${root}\u0000${subject}\u0000${aspect}`, 12)}`;

export const slotKey = (slot) => `${slot.subject}/${slot.aspect}`;

export const questionId = (root, slots) => `rq-${short(`${root}\u0000${slots.map(slotKey).sort().join(",")}`, 12)}`;

// What was decided is part of the id, so two different answers in the same instant are two
// decisions, and the same answer retried is the same one.
export const decisionId = (question, at, says = "") => `rd-${short(`${question}\u0000${at}\u0000${says}`, 12)}`;

// A digest of what a fact SAYS and rests on -- never of when it was written, by whom, or
// what became of it since. Status is left out on purpose: a version that was replaced is
// stored marked superseded, and a snapshot that froze it must still be able to check it
// against the digest it had while it stood. What a slot's status IS is carried beside the
// digest wherever it matters.
export const factDigest = (f) => sha(canonical({ subject: f.subject, aspect: f.aspect, says: f.says, sources: f.sources ?? [], derivedFrom: f.derivedFrom ?? [], decision: f.decision ?? null })).slice(0, 16);

// ---- what a fact rests on -----------------------------------------------------------

const asRef = (list) => (Array.isArray(list) ? list : []);

const refFindings = (refs, where) => asRef(refs).filter((r) => !new RegExp(SOURCE_REF).test(r) && !new RegExp(DECISION_REF).test(r)).map((r) => `${where}: source "${String(r).slice(0, 40)}" is neither a source at a revision nor a decision — how something is built is never where a requirement comes from`);

// A subject or an aspect that looks like a secret is refused, never masked: they are
// what the fact's id is made of, and masking would quietly make it another fact.
const secretFindings = (raw, where) => [raw.subject, raw.aspect].filter((v) => typeof v === "string" && scrub(v) !== v).map(() => `${where}: a subject or an aspect looks like a secret — refused, never masked, because they are the fact's id`);

// The rules that tie a status to what it must rest on. A row per status; a status with
// no row rests on nothing in particular.
const RESTS = {
  stated: (f, where) => (asRef(f.sources).some((s) => s.startsWith("source:")) ? [] : [`${where}: a stated fact cites the source it comes from`]),
  derived: (f, where) => [...(asRef(f.derivedFrom).length ? [] : [`${where}: a derived fact names the facts it follows from`]), ...(asRef(f.sources).length ? [`${where}: a derived fact cites no source of its own — what it rests on is the facts it follows from`] : [])],
  decided: (f, where) => (f.decision && asRef(f.sources).includes(`decision:${f.decision}`) ? [] : [`${where}: a decided fact names the decision, and cites it`]),
};

export function factFindings(raw, where = "fact") {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const shape = [...missingFindings(FACT_REQUIRED, raw, where), ...constraintFindings(FACT_FIELDS, raw, where)];
  const bounds = [...(asRef(raw.sources).length > MAX_SOURCES ? [`${where}: more than ${MAX_SOURCES} sources — a fact that needs more is several facts`] : []), ...(asRef(raw.derivedFrom).length > MAX_DERIVED_FROM ? [`${where}: more than ${MAX_DERIVED_FROM} facts it follows from`] : [])];
  const says = settles(raw.status) && !String(raw.says ?? "").trim() ? [`${where}: a fact that settles something says it`] : [];
  return [...shape, ...unknownKeys(raw, FACT_FIELDS, where), ...bounds, ...says, ...refFindings(raw.sources, where), ...secretFindings(raw, where), ...(RESTS[raw.status]?.(raw, where) ?? [])];
}

// The ONLY constructor. `fields` carry everything the engine decided; `says` is
// restated short and masked here, so no text reaches a fact any other way.
export function makeFact(fields) {
  const base = { v: FACT_VERSION, sources: [], ...fields, says: quote(scrub(fields.says ?? ""), MAX_SAYS) };
  const fact = present({ ...base, id: factId(base.root, base.subject, base.aspect), revision: base.revision ?? 1 });
  const found = factFindings(fact);
  if (found.length) throw new Refused(`not a requirement fact:\n  ${found.join("\n  ")}`);
  return fact;
}

// Is revision `a` LATER than `b`? Only when both were seen, and in this order: what
// "later" means is the order revisions were first cited, never how a system numbers them.
export const revisionLater = (order, a, b) => order.includes(a) && order.includes(b) && order.indexOf(a) > order.indexOf(b);

// What a version looks like once something replaced it -- derived, so an old version can
// be rewritten from the journal alone when a crash left it out.
export const superseded = (fact, by) => ({ ...fact, status: "superseded", supersededBy: by });

// ---- questions and decisions ---------------------------------------------------------

const slotFindings = (slots, where) => (Array.isArray(slots) && slots.length && slots.length <= MAX_SLOTS && slots.every((s) => isObject(s) && new RegExp(SLOT).test(s.subject) && new RegExp(SLOT).test(s.aspect)) ? [] : [`${where}: slots are one to ${MAX_SLOTS} objects of a subject and an aspect, each a plain slug`]);

const dependsFindings = (refs, where) => asRef(refs).filter((r) => !new RegExp(SOURCE_REF).test(r)).map((r) => `${where}: dependsOn "${String(r).slice(0, 40)}" is not a source at a revision (source:<id>@<revision>)`);

export function questionFindings(raw, where = "question") {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const shape = [...missingFindings(QUESTION_REQUIRED, raw, where), ...constraintFindings(QUESTION_FIELDS, raw, where)];
  return [...shape, ...unknownKeys(raw, QUESTION_FIELDS, where), ...slotFindings(raw.slots, where), ...dependsFindings(raw.dependsOn, where)];
}

export function makeQuestion(fields) {
  const base = { v: QUESTION_VERSION, blocking: false, dependsOn: [], ...fields, asks: quote(scrub(fields.asks ?? ""), MAX_ASKS), ...(fields.proposed ? { proposed: quote(scrub(fields.proposed), MAX_SAYS) } : {}) };
  const question = present({ ...base, id: questionId(base.root, base.slots ?? []) });
  const found = questionFindings(question);
  if (found.length) throw new Refused(`not a requirement question:\n  ${found.join("\n  ")}`);
  return question;
}

export function decisionFindings(raw, where = "decision") {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  return [...missingFindings(DECISION_REQUIRED, raw, where), ...constraintFindings(DECISION_FIELDS, raw, where), ...unknownKeys(raw, DECISION_FIELDS, where), ...(raw.human === true ? [] : [`${where}: a decision is a person's, relayed with --human`])];
}

export function makeDecision(fields) {
  const base = { v: DECISION_VERSION, by: "person", ...fields, says: quote(scrub(fields.says ?? ""), MAX_SAYS) };
  const decision = present({ ...base, id: decisionId(base.question, base.at, base.says) });
  const found = decisionFindings(decision);
  if (found.length) throw new Refused(`not a decision:\n  ${found.join("\n  ")}`);
  return decision;
}

// ---- what a set of facts comes to -----------------------------------------------------

// The sources a list of references cites, each at the revision it cites it at.
export const citesOf = (refs) => asRef(refs).map((ref) => /^source:(src-[0-9a-f]{12})@([^#\s]+)/.exec(ref)).filter(Boolean).map((m) => ({ sid: m[1], revision: m[2] }));

const sourceIdOf = (ref) => /^source:(src-[0-9a-f]{12})@/.exec(ref)?.[1] ?? null;

const MAX_DEPTH = 8;

// One fact's authority, from what it rests on NOW. `ctx`: { sourceAuthority(sid) ->
// "accepted" | "draft", fact(id) -> a fact or null }. What cannot be found is a draft:
// nobody can vouch for it.
export function factAuthority(fact, ctx, depth = 0) {
  if (humanOnly(fact.status)) return "accepted";
  if (fact.status === "derived") return depth >= MAX_DEPTH ? "draft" : weakest((fact.derivedFrom ?? []).map((id) => (ctx.fact(id) ? factAuthority(ctx.fact(id), ctx, depth + 1) : "draft")));
  return weakest(asRef(fact.sources).map((ref) => (ref.startsWith("decision:") ? "accepted" : ctx.sourceAuthority(sourceIdOf(ref)) ?? "draft")));
}

// The weakest of a list, and a draft of nothing at all: no fact means nothing anybody
// accepted.
const weakest = (list) => (list.length ? list.reduce(weakerAuthority) : AUTHORITY_ORDER.at(-1));

// A set's authority is its weakest standing fact that says something.
export function authorityOf(facts, ctx) {
  return weakest(facts.filter((f) => isCurrent(f.status) && settles(f.status)).map((f) => factAuthority(f, ctx)));
}
