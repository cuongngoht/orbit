// A WORK UNIT as a host proposes it, held to its contract before the engine accepts it into the graph. The host says
// what the unit is for and what it rests on; the engine stamps its id, derives its mode and operation from its kind
// (src/execution/unit-kinds.mjs), and refuses -- by name -- a unit that arrives carrying anything the engine owns.
import { CAPABILITY } from "../../../src/goal/fields.mjs";
import { EVIDENCE_LEVELS } from "../evidence/vocab.mjs";
import { MODES } from "../execution/modes.mjs";
import { UNIT_KINDS, UNIT_KIND_NAMES } from "../execution/unit-kinds.mjs";
import { OPERATION_NAMES } from "../permissions/operations.mjs";
import { isObject, isSentence, list, secretShaped } from "../store/text.mjs";
import { MAX_LIST } from "../mission/vocab.mjs";

export const UNIT_FIELDS = Object.freeze(["key", "kind", "objective", "dependsOn", "requiredCapabilities", "requestedEffects", "scope", "inputContract", "outputContract", "acceptanceCriteriaRefs", "verificationContract", "executionBudget", "inputArtifactRefs", "parentUnit"]);

export const FORBIDDEN_ON_UNIT = Object.freeze(["id", "state", "status", "evidence", "verdict", "assignedAgentRunIds", "attempt", "mode", "operationKind", "grants", "rolePin", "templatePin", "outcome"]);

export const UNIT_KEY = /^[a-z][a-z0-9-]{0,39}$/;

const WORD = /^[a-z][a-z0-9._-]{0,39}$/;

const PATH = /^(?![\\/])(?![A-Za-z]:)(?!.*(^|[\\/])\.\.([\\/]|$))[^\0]{1,200}$/;

export const BUDGET_LIMITS = Object.freeze({ maxAttempts: [1, 10], maxAgentRuns: [1, 20], maxMinutes: [1, 1440] });

export const OUTPUT_DEFAULTS = Object.freeze({ explore: { shape: "findings", fields: ["findings"] }, diagnose: { shape: "diagnosis", fields: ["findings"] }, design: { shape: "design", fields: ["findings"] }, review: { shape: "review", fields: ["findings"] }, verify: { shape: "verification", fields: ["evidenceRefs"] }, implement: { shape: "change", fields: ["evidenceRefs"] }, build: { shape: "checks", fields: ["evidenceRefs"] }, test: { shape: "checks", fields: ["evidenceRefs"] } });

const words = (v, n = MAX_LIST) => v === undefined || (Array.isArray(v) && v.length <= n && v.every((w) => WORD.test(String(w))));

const scopeOk = (s) => s === undefined || (isObject(s) && Object.keys(s).every((k) => ["paths", "subjects"].includes(k)) && (s.paths === undefined || (Array.isArray(s.paths) && s.paths.length <= 16 && s.paths.every((p) => PATH.test(String(p))))) && (s.subjects === undefined || (Array.isArray(s.subjects) && s.subjects.length <= 16 && s.subjects.every((w) => isSentence(w, 60)))));

const contractOk = (o) => o === undefined || (isObject(o) && Object.keys(o).every((k) => ["shape", "fields"].includes(k)) && WORD.test(String(o.shape)) && words(o.fields));

const inputOk = (o) => o === undefined || (isObject(o) && Object.keys(o).every((k) => k === "accepts") && words(o.accepts));

const verificationOk = (v) => v === undefined || (isObject(v) && Object.keys(v).every((k) => ["min", "owner"].includes(k)) && (v.min === undefined || EVIDENCE_LEVELS.includes(v.min)) && (v.owner === undefined || ["any", "independent"].includes(v.owner)));

const budgetOk = (b) => b === undefined || (isObject(b) && Object.keys(b).every((k) => BUDGET_LIMITS[k] && Number.isInteger(b[k]) && b[k] >= BUDGET_LIMITS[k][0] && b[k] <= BUDGET_LIMITS[k][1]));

const effectsOk = (u) => u.requestedEffects === undefined || (Array.isArray(u.requestedEffects) && u.requestedEffects.every((e) => OPERATION_NAMES.includes(e)));

const modeCarries = (u) => !UNIT_KINDS[u.kind] || list(u.requestedEffects).every((e) => MODES[UNIT_KINDS[u.kind].mode].kinds.includes(e));

const accIds = (m) => new Set(list(m.intent?.acceptanceCriteria).map((a) => a.id));

// c: { m, i } -- every row is asked, and each says what it holds the unit to.
const RULES = [
  (u) => Object.keys(u).filter((k) => FORBIDDEN_ON_UNIT.includes(k)).map((k) => `"${k}" is the engine's to derive, never a plan's to say`),
  (u) => Object.keys(u).filter((k) => !UNIT_FIELDS.includes(k) && !FORBIDDEN_ON_UNIT.includes(k)).map((k) => `unknown field "${k}"`),
  (u) => (UNIT_KEY.test(String(u.key ?? "")) ? [] : ["key is a lower-case word of at most 40 characters, unique in the mission"]),
  (u) => (UNIT_KIND_NAMES.includes(u.kind) ? [] : [`kind is one of ${UNIT_KIND_NAMES.join(", ")}`]),
  (u) => (isSentence(u.objective) && !secretShaped(u.objective) ? [] : ["objective is one sentence of at most 240 characters, with nothing that looks like a secret"]),
  (u) => (u.dependsOn === undefined || (Array.isArray(u.dependsOn) && u.dependsOn.length <= MAX_LIST && u.dependsOn.every((d) => typeof d === "string")) ? [] : [`dependsOn is at most ${MAX_LIST} unit keys or ids`]),
  (u) => (u.requiredCapabilities === undefined || (Array.isArray(u.requiredCapabilities) && u.requiredCapabilities.length <= MAX_LIST && u.requiredCapabilities.every((x) => CAPABILITY.test(String(x)))) ? [] : ["requiredCapabilities is a list of dotted capability words"]),
  (u) => (effectsOk(u) ? [] : [`requestedEffects names operation kinds (${OPERATION_NAMES.join(", ")})`]),
  (u) => (modeCarries(u) ? [] : [`a ${u.kind} unit works in ${UNIT_KINDS[u.kind]?.mode}, which never carries ${list(u.requestedEffects).filter((e) => !MODES[UNIT_KINDS[u.kind].mode].kinds.includes(e)).join(", ")}`]),
  (u) => (scopeOk(u.scope) ? [] : ["scope is { paths: [repository-relative paths], subjects: [short words] }"]),
  (u) => (inputOk(u.inputContract) && contractOk(u.outputContract) ? [] : ["inputContract is { accepts: [shapes] } and outputContract is { shape, fields: [names] }"]),
  (u, c) => (list(u.acceptanceCriteriaRefs).every((a) => accIds(c.m).has(a)) ? [] : ["acceptanceCriteriaRefs names acc-<n> ids the intent recorded"]),
  (u) => (verificationOk(u.verificationContract) ? [] : [`verificationContract is { min: ${EVIDENCE_LEVELS.join("|")}, owner: any|independent }`]),
  (u) => (budgetOk(u.executionBudget) ? [] : [`executionBudget holds ${Object.entries(BUDGET_LIMITS).map(([k, [lo, hi]]) => `${k} ${lo}-${hi}`).join(", ")}`]),
  (u) => (u.inputArtifactRefs === undefined || (Array.isArray(u.inputArtifactRefs) && u.inputArtifactRefs.length <= 16 && u.inputArtifactRefs.every((r) => /^hof-[1-9][0-9]{0,4}$/.test(String(r)))) ? [] : ["inputArtifactRefs names handoffs (hof-<n>) this mission published"]),
];

export const unitFindings = (raw, c) => (isObject(raw) ? RULES.flatMap((rule) => rule(raw, c)).map((f) => `unit ${c.i + 1}${raw.key ? ` (${raw.key})` : ""}: ${f}`) : [`unit ${c.i + 1}: a unit is an object`]);

const minOf = (raw) => raw.verificationContract?.min ?? UNIT_KINDS[raw.kind].min;

// The unit as the engine accepts it: an id, its dependencies resolved to ids, and every default said out loud.
export const normalizedUnit = (raw, id, deps, budget) => ({ id, key: raw.key, kind: raw.kind, objective: raw.objective.trim(), dependencyIds: deps, requiredCapabilities: list(raw.requiredCapabilities), requestedEffects: raw.requestedEffects ?? [UNIT_KINDS[raw.kind].operation], scope: raw.scope ?? { paths: [], subjects: [] }, inputContract: raw.inputContract ?? { accepts: [] }, outputContract: raw.outputContract ?? OUTPUT_DEFAULTS[raw.kind], acceptanceCriteriaRefs: list(raw.acceptanceCriteriaRefs), verificationContract: { min: minOf(raw), owner: raw.verificationContract?.owner ?? "any" }, executionBudget: { maxAttempts: raw.executionBudget?.maxAttempts ?? budget.attempts, maxAgentRuns: raw.executionBudget?.maxAgentRuns ?? budget.attempts, ...(raw.executionBudget?.maxMinutes ? { maxMinutes: raw.executionBudget.maxMinutes } : {}) }, inputArtifactRefs: list(raw.inputArtifactRefs), ...(raw.parentUnit ? { parentUnit: raw.parentUnit } : {}) });
