// The STRUCTURED INTENT of a goal (0.0.4): what the host's model read the specification as, in typed fields the
// engine validates and then plans from. Nothing here reads the specification's words -- a goal in Vietnamese and
// the same goal in English are two texts and ONE reading, and they plan the same way.
//
//   category       one of INTENT_CATEGORIES: what the goal is about
//   workKinds      1-5 of WORK_KINDS, unique: the kinds of work it takes (one unit each)
//   capabilities   dotted capability words it needs that no work kind implies (a procedure's own capability)
//   verification   sentences: how its outcome must be shown -- kept for a person, never a verdict
//   dependencies   sentences: what it rests on outside this goal
//   missing        { statement, blocks: [work kind] }: a prerequisite nobody has yet; every unit of a kind it blocks
//                  is UNRESOLVED and never started on a guess
//
//   intentFindings(raw) -> [sentence]      what is wrong with a reading, all of it at once
//   intentOf(raw)       -> the reading, with every optional list present
import { scrub } from "../scrub.mjs";
import { CAPABILITY, INTENT_FIELDS, INTENT_REQUIRED, MISSING_FIELDS } from "./fields.mjs";
import { INTENT_CATEGORIES, INTENT_LIMITS, TITLE_LIMIT, WORK_KIND_IDS } from "./vocab.mjs";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const list = (v) => (Array.isArray(v) ? v : []);

const isText = (v) => typeof v === "string" && v.trim().length > 0 && v.length <= TITLE_LIMIT;

const isCapability = (v) => typeof v === "string" && CAPABILITY.test(v);

const isKind = (v) => WORK_KIND_IDS.includes(v);

const bounded = (v, key) => Array.isArray(v) && v.length <= INTENT_LIMITS[key];

// A list the reading may leave out; when it is there, bounded and every item what it should be.
const listFindings = (i, key, ok, what) => (i[key] === undefined || (bounded(i[key], key) && i[key].every(ok)) ? [] : [`intent: ${key} is at most ${INTENT_LIMITS[key]} item(s), each ${what}`]);

const kindsFindings = (v) => (v === undefined || (bounded(v, "workKinds") && v.length > 0 && v.every(isKind) && new Set(v).size === v.length) ? [] : [`intent: workKinds is 1 to ${INTENT_LIMITS.workKinds} different kinds of work, each one of ${WORK_KIND_IDS.join(", ")}`]);

const missingRow = (m) => isObject(m) && Object.keys(m).every((k) => MISSING_FIELDS.includes(k)) && isText(m.statement) && bounded(m.blocks ?? [], "workKinds") && list(m.blocks).every(isKind);

const missingFindings = (v) => (v === undefined || (bounded(v, "missing") && v.every(missingRow)) ? [] : [`intent: missing is at most ${INTENT_LIMITS.missing} prerequisite(s), each { "statement": one sentence, "blocks": [the kinds of work it stops] }`]);

const textsOf = (i) => [...list(i.verification), ...list(i.dependencies), ...list(i.missing).map((m) => m?.statement)].filter((t) => typeof t === "string");

const secretFindings = (i) => (textsOf(i).some((t) => scrub(t) !== t) ? ["intent: text that looks like a secret is refused"] : []);

// Each row says one thing that can be wrong; every row is asked.
const RULES = [
  (i) => Object.keys(i).filter((k) => !INTENT_FIELDS.includes(k)).map((k) => `intent: unknown field "${k}"`),
  (i) => INTENT_REQUIRED.filter((k) => i[k] === undefined).map((k) => `intent: ${k} is required`),
  (i) => (i.category === undefined || INTENT_CATEGORIES.includes(i.category) ? [] : [`intent: category is one of ${INTENT_CATEGORIES.join(", ")}`]),
  (i) => kindsFindings(i.workKinds),
  (i) => listFindings(i, "capabilities", isCapability, "a dotted, lower-case capability word"),
  (i) => listFindings(i, "verification", isText, `one sentence of at most ${TITLE_LIMIT} characters`),
  (i) => listFindings(i, "dependencies", isText, `one sentence of at most ${TITLE_LIMIT} characters`),
  (i) => missingFindings(i.missing),
  secretFindings,
];

const MISSING_INTENT = 'analysis: intent is required — the structured reading of the goal: { "category", "workKinds", "capabilities"?, "verification"?, "dependencies"?, "missing"? }';

export const intentFindings = (raw) => (isObject(raw) ? RULES.flatMap((rule) => rule(raw)) : [MISSING_INTENT]);

const trimmed = (v) => list(v).map((t) => t.trim());

export const intentOf = (raw) => ({ category: raw.category, workKinds: [...raw.workKinds], capabilities: [...new Set(list(raw.capabilities))], verification: trimmed(raw.verification), dependencies: trimmed(raw.dependencies), missing: list(raw.missing).map((m) => ({ statement: m.statement.trim(), blocks: [...new Set(list(m.blocks))] })) });
