// A DEPARTMENT'S POLICY: what one department decides for ITS employees' work, inside what the company delegated to it
// (constitution.ts `delegation`) -- never for a chat, a research question or a person, which the company's policy alone
// decides. A department with no policy of its own inherits the company's.
//
// The layers, in order, each kind of rule with semantics of its own -- never one JSON merge:
//   1. the deployment's invariants and ceilings (vocabulary.ts), above everything;
//   2. the company's MANDATORY rules, binding every department;
//   3. the company's DEFAULT rules for an action it DELEGATED, which a department's own rules for that action replace,
//      held to the delegation's loosest effect;
//   4. the department's rules: within the delegation for a delegated action, only narrowing for any other;
//   5. an employee's or a mission's restrictions (overrides) and the grants its principal holds, which only narrow.
//
//   effect rules   strictest within a layer; a mandatory company rule always applies; a delegated department answer is
//                  capped at the delegation (a cap lowered after it was published caps it: DELEGATION_CAPPED)
//   network mode   RESTRICTED < AUTONOMOUS; the department's (else the company's), at most the delegation's (else the
//                  company's own)
//   allow-list     the department's (else the company's); every entry inside `allowWithin` when the company declared it,
//                  inside the company's own list when it did not and is RESTRICTED. UNSET inherits, [] names none
//   numeric limit  the department's (else the company's), at most the delegation's cap (else the company's own value);
//                  the account-wide daily download is the company's alone
//   models         sets intersect downward: the department's ∩ the delegation's (else the company's); unset inherits
import { checked, isRecord, unknownFields, type Checked } from "./canonical.js";
import { API_VERSION, employeeModelsErrors, LIMITS, rulesErrors, type Constitution, type EmployeeModels, type Rule } from "./constitution.js";
import { allowListed, EMPLOYEE_NETWORK_MODES, employeeNetworkOf, isAllowEntry, NETWORK_LIMIT_KEYS, type EmployeeNetwork, type EmployeeNetworkMode, type NetworkLimitKey, type NetworkLimits } from "./network.js";
import { departmentRuntimeErrors, departmentRuntimeSecurityErrors, type DepartmentRuntimeSecurity } from "./runtime.js";
import { rankOf, type Effect } from "./vocabulary.js";

export const DEPARTMENT_POLICY_KIND = "DepartmentPolicy";

// What a department sets of its employees' network access: each key optional -- unset inherits the company's.
export interface DepartmentNetwork {
  mode?: EmployeeNetworkMode;
  allow?: string[];
  limits?: NetworkLimits;
}

export interface DepartmentPolicy {
  apiVersion: typeof API_VERSION;
  kind: typeof DEPARTMENT_POLICY_KIND;
  metadata: { accountId: string; departmentId: string; name: string };
  rules: Rule[];
  employeeNetwork?: DepartmentNetwork;
  employeeModels?: EmployeeModels;
  // Runtime security for its employees' attempts: only ever stricter than the company's (runtime.ts).
  runtimeSecurity?: DepartmentRuntimeSecurity;
}

// The limit the account counts across all its employees (one UTC day): the company's alone.
export const COMPANY_ONLY_LIMITS: readonly NetworkLimitKey[] = ["downloadBytesPerDay"];

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

function departmentNetworkErrors(n: unknown): string[] {
  if (n === undefined) return [];
  if (!isRecord(n)) return ["employeeNetwork must be an object"];
  const errors = unknownFields(n, ["mode", "allow", "limits"], "employeeNetwork.");
  if (n.mode !== undefined && !(EMPLOYEE_NETWORK_MODES as readonly unknown[]).includes(n.mode)) errors.push('employeeNetwork.mode must be "AUTONOMOUS" or "RESTRICTED" (leave it out to inherit)');
  if (n.allow !== undefined && (!Array.isArray(n.allow) || !n.allow.every(isAllowEntry) || new Set(n.allow).size !== n.allow.length)) errors.push("employeeNetwork.allow must be hosts or *.domains, each once (leave it out to inherit; empty for none)");
  if (n.limits !== undefined) {
    if (!isRecord(n.limits)) errors.push("employeeNetwork.limits must be an object");
    else {
      errors.push(...unknownFields(n.limits, NETWORK_LIMIT_KEYS.filter((k) => !COMPANY_ONLY_LIMITS.includes(k)), "employeeNetwork.limits."));
      for (const [k, v] of Object.entries(n.limits)) if (!(Number.isSafeInteger(v) && (v as number) >= 1)) errors.push(`employeeNetwork.limits.${k} must be a whole number of at least 1`);
    }
  }
  return errors;
}

// The document's own shape (what it may say at all). What it may say for THIS company is departmentPolicyErrors.
export function checkDepartmentPolicy(body: unknown): Checked<DepartmentPolicy> {
  if (!isRecord(body)) return { ok: false, errors: ["a department policy is a JSON object"] };
  const errors = unknownFields(body, ["apiVersion", "kind", "metadata", "rules", "employeeNetwork", "employeeModels", "runtimeSecurity"]);
  if (body.apiVersion !== API_VERSION) errors.push(`apiVersion must be ${API_VERSION}`);
  if (body.kind !== DEPARTMENT_POLICY_KIND) errors.push(`kind must be ${DEPARTMENT_POLICY_KIND}`);
  const m = body.metadata;
  if (!isRecord(m)) errors.push("metadata must be an object");
  else {
    errors.push(...unknownFields(m, ["accountId", "departmentId", "name"], "metadata."));
    if (!isText(m.accountId, LIMITS.idLength)) errors.push("metadata.accountId must name the account");
    if (!isText(m.departmentId, LIMITS.idLength)) errors.push("metadata.departmentId must name the department");
    if (!isText(m.name, LIMITS.nameLength)) errors.push(`metadata.name must be text of at most ${LIMITS.nameLength} characters`);
  }
  errors.push(...rulesErrors(body.rules, "rules"), ...departmentNetworkErrors(body.employeeNetwork), ...employeeModelsErrors(body.employeeModels), ...departmentRuntimeSecurityErrors(body.runtimeSecurity));
  if (Array.isArray(body.rules)) for (const [i, r] of body.rules.entries()) if (isRecord(r) && r.principalType !== undefined && r.principalType !== "agent") errors.push(`rules[${i}].principalType: a department's policy decides for its employees (agent) alone`);
  return checked(errors, () => body as unknown as DepartmentPolicy);
}

const MODE_RANK: Record<EmployeeNetworkMode, number> = { RESTRICTED: 0, AUTONOMOUS: 1 };

// The loosest effect a department may give `action`: what the company delegated, else -- not delegated -- the department
// only narrows (require_approval or deny).
export function delegatedCap(company: Constitution, action: string): Effect | null {
  return company.delegation?.departments?.actions?.[action as keyof NonNullable<NonNullable<NonNullable<Constitution["delegation"]>["departments"]>["actions"]>] ?? null;
}

// Whether every host `entry` lets in, some entry of `list` lets in too.
export function coveredBy(entry: string, list: readonly string[]): boolean {
  if (!entry.startsWith("*.")) return allowListed(list, entry) !== null;
  return list.some((e) => e.startsWith("*.") && (e === entry || entry.endsWith(e.slice(1))));
}

// The hosts a department's allow-list may name: within `allowWithin` when the company declared it; within the company's
// own list when it did not and is RESTRICTED; any public host under an AUTONOMOUS company (any list narrows it).
function allowWithinOf(company: Constitution): readonly string[] | null {
  const declared = company.delegation?.departments?.employeeNetwork?.allowWithin;
  if (declared !== undefined) return declared;
  const c = employeeNetworkOf(company);
  return c.mode === "RESTRICTED" ? c.allow : null;
}

// The loosest mode a department may choose: the delegation's, else the company's own (only narrowing).
const modeCapOf = (company: Constitution): EmployeeNetworkMode => company.delegation?.departments?.employeeNetwork?.mode ?? employeeNetworkOf(company).mode;

// The highest a department may set a limit: the delegation's cap, else the company's own value (undefined: no cap).
const limitCapOf = (company: Constitution, key: NetworkLimitKey): number | undefined => company.delegation?.departments?.employeeNetwork?.limits?.[key] ?? employeeNetworkOf(company).limits?.[key];

// The models a department may choose among: the delegation's, else the company's (null: any).
const modelCapOf = (company: Constitution): readonly string[] | null => company.delegation?.departments?.models?.allow ?? company.employeeModels?.allow ?? null;

// What a department's document says that THIS company does not let it say, in words its owner acts on. Empty: it may be
// published. Checked against the company's policy in effect when it is validated and again when it is published.
export function departmentPolicyErrors(dept: DepartmentPolicy, company: Constitution): string[] {
  const errors: string[] = [];
  if (dept.metadata.accountId !== company.metadata.accountId) errors.push("metadata.accountId is not this company's account");
  for (const rule of dept.rules) {
    const cap = delegatedCap(company, rule.action);
    if (cap === null && rule.effect === "allow") errors.push(`rules.${rule.id}: ${rule.action} is not delegated to departments -- a department may only narrow it (require_approval or deny)`);
    if (cap !== null && rankOf(rule.effect) < rankOf(cap)) errors.push(`rules.${rule.id}: the company lets a department give ${rule.action} at most "${cap}"`);
  }
  const n = dept.employeeNetwork;
  if (n?.mode !== undefined && MODE_RANK[n.mode] > MODE_RANK[modeCapOf(company)]) errors.push(`employeeNetwork.mode: the company lets a department choose at most ${modeCapOf(company)}`);
  const within = allowWithinOf(company);
  if (n?.allow !== undefined && within !== null) for (const entry of n.allow) if (!coveredBy(entry, within)) errors.push(`employeeNetwork.allow: ${entry} is outside the hosts the company lets a department name`);
  for (const key of NETWORK_LIMIT_KEYS) {
    const v = n?.limits?.[key];
    const cap = limitCapOf(company, key);
    if (v !== undefined && cap !== undefined && v > cap) errors.push(`employeeNetwork.limits.${key}: the company lets a department set it at most ${cap}`);
  }
  const models = modelCapOf(company);
  if (dept.employeeModels?.allow !== undefined && models !== null) for (const m of dept.employeeModels.allow) if (!models.includes(m)) errors.push(`employeeModels.allow: ${m} is not a model the company lets a department choose`);
  errors.push(...departmentRuntimeErrors(dept, company));
  return errors;
}

// ---- composition (what is in effect for the department's employees) ---------------------------------------------------

export type NetworkSource = "company" | "department";

export interface EffectiveEmployeeNetwork extends EmployeeNetwork {
  // Where each part came from, and what the company's delegation held back (a department's choice above its cap).
  from: { mode: NetworkSource; allow: NetworkSource; limits: Partial<Record<NetworkLimitKey, NetworkSource>> };
  capped: string[];
}

// The employee network access in effect for a department's employees (the company's when `dept` is null).
export function composeEmployeeNetwork(company: Constitution, dept: DepartmentPolicy | null): EffectiveEmployeeNetwork {
  const c = employeeNetworkOf(company);
  const d = dept?.employeeNetwork;
  const capped: string[] = [];
  let mode: EmployeeNetworkMode = c.mode;
  if (d?.mode !== undefined) {
    const cap = modeCapOf(company);
    mode = MODE_RANK[d.mode] <= MODE_RANK[cap] ? d.mode : cap;
    if (mode !== d.mode) capped.push("employeeNetwork.mode");
  }
  let allow = c.allow;
  if (d?.allow !== undefined) {
    const within = allowWithinOf(company);
    allow = within === null ? [...d.allow] : d.allow.filter((e) => coveredBy(e, within));
    if (allow.length !== d.allow.length) capped.push("employeeNetwork.allow");
  }
  const limits: NetworkLimits = {};
  const limitsFrom: Partial<Record<NetworkLimitKey, NetworkSource>> = {};
  for (const key of NETWORK_LIMIT_KEYS) {
    const own = COMPANY_ONLY_LIMITS.includes(key) ? undefined : d?.limits?.[key];
    const cap = limitCapOf(company, key);
    const value = own === undefined ? c.limits?.[key] : cap === undefined ? own : Math.min(own, cap);
    if (own !== undefined && cap !== undefined && own > cap) capped.push(`employeeNetwork.limits.${key}`);
    if (value !== undefined) {
      limits[key] = value;
      limitsFrom[key] = own === undefined ? "company" : "department";
    }
  }
  return {
    mode,
    allow,
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
    from: { mode: d?.mode === undefined ? "company" : "department", allow: d?.allow === undefined ? "company" : "department", limits: limitsFrom },
    capped,
  };
}

// The models in effect for a department's employees (the company's when `dept` is null): null means any the connection's
// catalog offers.
export function composeEmployeeModels(company: Constitution, dept: DepartmentPolicy | null): { allow: string[] | null; capped: boolean } {
  const own = dept?.employeeModels?.allow;
  if (own === undefined) return { allow: company.employeeModels?.allow ?? null, capped: false };
  const cap = modelCapOf(company);
  if (cap === null) return { allow: [...own], capped: false };
  const allow = own.filter((m) => cap.includes(m));
  return { allow, capped: allow.length !== own.length };
}

export const modelAllowed = (allow: readonly string[] | null, runtime: string, model: string): boolean => allow === null || allow.includes(`${runtime}:${model}`);
