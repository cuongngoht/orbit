// A role proposal held to the role contract, every rule asked. A role that fails is REJECTED (role.rejected) and never
// published; one that passes is generated, named by naming.mjs, and registered as an immutable definition.
import { CAPABILITY } from "../../../../src/goal/fields.mjs";
import { UNIT_KINDS } from "../../execution/unit-kinds.mjs";
import { PROFILES, REQUESTABLE } from "../../permissions/profiles.mjs";
import { isObject, isSentence, list, secretShaped } from "../../store/text.mjs";
import { ACTIVITY, MAX_RESPONSIBILITIES, ROLE_PROPOSAL_FIELDS, ROLE_REFUSED, SUBJECT } from "./vocab.mjs";
import { pairsOf } from "./naming.mjs";

const sentences = (v, lo, hi) => Array.isArray(v) && v.length >= lo && v.length <= hi && v.every((s) => isSentence(s));

const responsibilityOk = (r) => isObject(r) && Object.keys(r).every((k) => ["activity", "subject"].includes(k)) && ACTIVITY.test(String(r.activity)) && SUBJECT.test(String(r.subject));

const responsibilitiesOk = (rs) => Array.isArray(rs) && rs.length >= 1 && rs.length <= MAX_RESPONSIBILITIES && rs.every(responsibilityOk) && pairsOf(rs).length === rs.length;

const contractOk = (o, keys) => o === undefined || (isObject(o) && Object.keys(o).every((k) => keys.includes(k)));

const textsOf = (p) => [p.purpose, ...list(p.restrictions), ...list(p.completionCriteria), ...list(p.responsibilities).map((r) => r?.subject)].filter((t) => typeof t === "string");

// unit: the unit the role is resolved for, when there is one.
export const ROLE_RULES = Object.freeze([
  { id: "ROLE_GRANTS_ITSELF", fails: (p) => Object.keys(p).some((k) => ROLE_REFUSED.includes(k)), say: (p) => `a role requests a profile and grants nothing; ${Object.keys(p).filter((k) => ROLE_REFUSED.includes(k)).join(", ")} is the engine's or a person's, never a role's` },
  { id: "ROLE_UNKNOWN_FIELD", fails: (p) => Object.keys(p).some((k) => !ROLE_PROPOSAL_FIELDS.includes(k) && !ROLE_REFUSED.includes(k) && k !== "kind"), say: (p) => `unknown field(s): ${Object.keys(p).filter((k) => !ROLE_PROPOSAL_FIELDS.includes(k) && !ROLE_REFUSED.includes(k) && k !== "kind").join(", ")}` },
  { id: "ROLE_RESPONSIBILITIES", fails: (p) => !responsibilitiesOk(p.responsibilities), say: () => `responsibilities are 1 to ${MAX_RESPONSIBILITIES} different { activity: a lower-case verb, subject: a few lower-case words }` },
  { id: "ROLE_PURPOSE", fails: (p) => !isSentence(p.purpose), say: () => "purpose is one sentence" },
  { id: "ROLE_RESTRICTIONS", fails: (p) => !sentences(p.restrictions, 1, 8), say: () => "restrictions are 1 to 8 sentences: what the role never does" },
  { id: "ROLE_COMPLETION", fails: (p) => !sentences(p.completionCriteria, 1, 8), say: () => "completionCriteria are 1 to 8 sentences: what its output must show" },
  { id: "ROLE_PROFILE", fails: (p) => !REQUESTABLE.includes(p.profile), say: (p) => `profile is one of ${REQUESTABLE.join(", ")}${p.profile === "ORCHESTRATOR" ? " — ORCHESTRATOR is the engine's own" : ""}` },
  { id: "ROLE_PROFILE_TOO_NARROW", fails: (p, unit) => Boolean(unit) && REQUESTABLE.includes(p.profile) && !PROFILES[p.profile].kinds.includes(UNIT_KINDS[unit.kind]?.operation), say: (p, unit) => `a ${unit.kind} unit carries ${UNIT_KINDS[unit.kind]?.operation}, which a ${p.profile} role never carries` },
  { id: "ROLE_CAPABILITIES", fails: (p) => !(p.requiredCapabilities === undefined || (Array.isArray(p.requiredCapabilities) && p.requiredCapabilities.length <= 8 && p.requiredCapabilities.every((c) => CAPABILITY.test(String(c))))), say: () => "requiredCapabilities are dotted capability words" },
  { id: "ROLE_CONTRACTS", fails: (p) => !contractOk(p.inputContract, ["accepts"]) || !contractOk(p.outputContract, ["shape", "fields"]), say: () => "inputContract is { accepts } and outputContract is { shape, fields }" },
  { id: "ROLE_SECRET", fails: (p) => textsOf(p).some(secretShaped), say: () => "text that looks like a secret is refused" },
]);

export const roleFindings = (proposal, unit) => (isObject(proposal) ? ROLE_RULES.filter((r) => r.fails(proposal, unit)).map((r) => ({ id: r.id, say: r.say(proposal, unit) })) : [{ id: "ROLE_SHAPE", say: "a role proposal is an object" }]);
