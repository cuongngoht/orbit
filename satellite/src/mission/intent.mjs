// The STRUCTURED INTENT of a mission: what the host's model read the goal as, in typed lists the engine validates and
// keeps APART -- facts, hypotheses, assumptions, constraints, acceptance criteria, unknowns, evidence -- so a
// hypothesis can never become a fact because somebody repeated it. Nothing here reads the goal's words; a goal in
// Vietnamese and its English twin are two texts and one reading.
//
//   facts              { statement, sourceRef: goal@<digest8>[#L<n>] | evidence:evd-<n> }   what is known, and from where
//   hypotheses         { statement, settles?: [unk-<n>] }      what might be true; only evidence moves one (view.mjs)
//   assumptions        { statement }                           what the work proceeds on, said out loud
//   constraints        { statement, kind: policy|scope|time|resource }
//   acceptanceCriteria { statement, verification? }            what the outcome is held to -- FROZEN once recorded
//   unknowns           { statement, blocks?: [unit kind] }     what nobody knows yet; a unit of a kind it blocks is
//                                                              UNRESOLVED until an amendment settles it with evidence
//   evidence           [evd-<n> | goal@<digest8>]              evidence the reading rests on
//   capabilities       [dotted capability words]
//   settled            (an amendment only) [{ id: unk-<n>, evidence: [evd-<n>] }]
//
// The FIRST analysis must name at least one acceptance criterion and one fact or hypothesis. A later one is an
// AMENDMENT: it may add facts, hypotheses, assumptions, constraints and unknowns and settle unknowns with evidence the
// journal holds, and never touches the acceptance criteria (ACCEPTANCE_FROZEN) -- one agent cannot quietly change
// what the mission is held to. The engine stamps every id.
import { CAPABILITY } from "../../../src/goal/fields.mjs";
import { short, canonicalJson } from "../../../src/hash.mjs";
import { UNIT_KIND_NAMES } from "../execution/unit-kinds.mjs";
import { isObject, isSentence, list, secretShaped } from "../store/text.mjs";
import { GOAL_REF } from "./goal.mjs";
import { MAX_LIST } from "./vocab.mjs";

export const INTENT_FIELDS = Object.freeze(["facts", "hypotheses", "assumptions", "constraints", "acceptanceCriteria", "unknowns", "evidence", "capabilities", "settled"]);

export const LISTS = Object.freeze({ facts: "fct", hypotheses: "hyp", assumptions: "asm", constraints: "cst", acceptanceCriteria: "acc", unknowns: "unk" });

export const CONSTRAINT_KINDS = Object.freeze(["policy", "scope", "time", "resource"]);

const ITEM_FIELDS = { facts: ["statement", "sourceRef"], hypotheses: ["statement", "settles"], assumptions: ["statement"], constraints: ["statement", "kind"], acceptanceCriteria: ["statement", "verification"], unknowns: ["statement", "blocks"] };

const EVIDENCE_REF = /^evidence:evd-[1-9][0-9]{0,5}$/;

const evidenceIds = (m) => new Set([...m.evidence.keys()]);

const goalRefOk = (ref, m) => ((g) => Boolean(g) && m.meta?.goalDigest?.startsWith(g[1]))(GOAL_REF.exec(String(ref)));

const sourceOk = (ref, m) => goalRefOk(ref, m) || (EVIDENCE_REF.test(String(ref)) && evidenceIds(m).has(String(ref).slice(9)));

const ITEM_RULES = {
  facts: (f, m) => isSentence(f.statement) && sourceOk(f.sourceRef, m),
  hypotheses: (h) => isSentence(h.statement) && list(h.settles).every((x) => /^unk-[1-9][0-9]{0,4}$/.test(String(x))),
  assumptions: (a) => isSentence(a.statement),
  constraints: (c) => isSentence(c.statement) && CONSTRAINT_KINDS.includes(c.kind),
  acceptanceCriteria: (a) => isSentence(a.statement) && (a.verification === undefined || isSentence(a.verification)),
  unknowns: (u) => isSentence(u.statement) && list(u.blocks).every((k) => UNIT_KIND_NAMES.includes(k)),
};

const SAY = {
  facts: "{ statement, sourceRef } where sourceRef is goal@<the goal's digest8>[#L<n>] or evidence:evd-<n> this mission recorded",
  hypotheses: "{ statement, settles?: [unk-<n>] }",
  assumptions: "{ statement }",
  constraints: `{ statement, kind: ${CONSTRAINT_KINDS.join("|")} }`,
  acceptanceCriteria: "{ statement, verification? }",
  unknowns: `{ statement, blocks?: [${UNIT_KIND_NAMES.join("|")}] }`,
};

const itemOk = (key, item, m) => isObject(item) && Object.keys(item).every((k) => ITEM_FIELDS[key].includes(k)) && ITEM_RULES[key](item, m);

const listFindings = (raw, m) => Object.keys(LISTS).filter((k) => raw[k] !== undefined).filter((k) => !(Array.isArray(raw[k]) && raw[k].length <= MAX_LIST && raw[k].every((i) => itemOk(k, i, m)))).map((k) => `intent: ${k} is at most ${MAX_LIST} item(s), each ${SAY[k]}`);

const textsOf = (raw) => Object.keys(LISTS).flatMap((k) => list(raw[k]).flatMap((i) => [i?.statement, i?.verification])).filter((t) => typeof t === "string");

const knownUnknowns = (m) => new Set(list(m.intent?.unknowns).map((u) => u.id));

const settledOk = (s, m) => isObject(s) && knownUnknowns(m).has(s.id) && Array.isArray(s.evidence) && s.evidence.length > 0 && s.evidence.every((e) => evidenceIds(m).has(String(e)));

const RULES = [
  (raw) => Object.keys(raw).filter((k) => !INTENT_FIELDS.includes(k)).map((k) => `intent: unknown field "${k}"`),
  (raw, m) => (m.intent && list(raw.acceptanceCriteria).length > 0 ? ["intent: ACCEPTANCE_FROZEN — the acceptance criteria were recorded by the first analysis and an amendment never changes them"] : []),
  (raw, m) => (!m.intent && list(raw.acceptanceCriteria).length === 0 ? ["intent: acceptanceCriteria — the first analysis names at least one criterion the outcome is held to"] : []),
  (raw, m) => (!m.intent && list(raw.facts).length + list(raw.hypotheses).length === 0 ? ["intent: the first analysis names at least one fact or one hypothesis"] : []),
  listFindings,
  (raw) => (raw.capabilities === undefined || (Array.isArray(raw.capabilities) && raw.capabilities.length <= MAX_LIST && raw.capabilities.every((c) => CAPABILITY.test(String(c)))) ? [] : [`intent: capabilities is at most ${MAX_LIST} dotted, lower-case capability words`]),
  (raw, m) => (raw.evidence === undefined || (Array.isArray(raw.evidence) && raw.evidence.length <= MAX_LIST && raw.evidence.every((e) => goalRefOk(e, m) || evidenceIds(m).has(String(e)))) ? [] : ["intent: evidence names goal@<digest8> or evd-<n> ids this mission recorded"]),
  (raw, m) => (raw.settled === undefined || (m.intent && Array.isArray(raw.settled) && raw.settled.every((s) => settledOk(s, m))) ? [] : ["intent: settled is an amendment's [{ id: unk-<n> this mission recorded, evidence: [evd-<n> it recorded] }]"]),
  (raw) => (textsOf(raw).some(secretShaped) ? ["intent: text that looks like a secret is refused"] : []),
];

export const intentFindings = (raw, m) => (isObject(raw) ? RULES.flatMap((rule) => rule(raw, m)) : ['analyze: intent is required — { "facts", "hypotheses", "assumptions", "constraints", "acceptanceCriteria", "unknowns", "evidence", "capabilities" }']);

const stamped = (key, prior, items) => [...list(prior), ...list(items).map((item, i) => ({ id: `${LISTS[key]}-${list(prior).length + i + 1}`, ...item, statement: item.statement.trim() }))];

const settledUnknowns = (unknowns, settled) => unknowns.map((u) => ((s) => (s ? { ...u, settled: { evidence: s.evidence } } : u))(list(settled).find((x) => x.id === u.id)));

// The intent as it stands after this reading: the prior one's items kept, this one's appended with their ids.
export function intentOf(raw, m) {
  const prior = m.intent ?? {};
  const lists = Object.fromEntries(Object.keys(LISTS).map((k) => [k, stamped(k, prior[k], raw[k])]));
  const intent = { ...lists, unknowns: settledUnknowns(lists.unknowns, raw.settled), evidence: [...new Set([...list(prior.evidence), ...list(raw.evidence)])], capabilities: [...new Set([...list(prior.capabilities), ...list(raw.capabilities)])] };
  return { ...intent, rev: (m.counts["intent.recorded"] ?? 0) + 1, digest: short(canonicalJson(intent), 16) };
}
