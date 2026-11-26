// THE ACCOUNT POLICY: a declarative document, never prose. It is data a machine evaluates, and the only source of an
// authorization: a sentence in a document nobody parses authorizes nothing. (The type keeps its older name,
// `Constitution`: it is the same kind of document, now one per account.)
//
// Layers narrow and never widen. The policy is the account's; an OVERRIDE (a `PolicyOverlay`) belongs to one of the
// account's chats or research workspaces and can only make a decision stricter (../evaluate.ts takes the strictest of
// every layer, so an override that says "allow" changes nothing). The deployment's own limits -- each action's ceiling,
// an action nothing can carry out -- stand above both.
//
// The document carries no revision number and no author: those are facts ABOUT a revision, kept by whoever stores it,
// so that the same content always has the same digest.
import { checked, isRecord, unknownFields, type Checked } from "./canonical.js";
import { EMPLOYEE_NETWORK_MODES, employeeNetworkErrors, isAllowEntry, NETWORK_LIMIT_KEYS, type EmployeeNetwork, type EmployeeNetworkMode, type NetworkLimits } from "./network.js";
import { runtimeSecurityErrors, type RuntimeSecurity } from "./runtime.js";
import {
  ACTIONS,
  CLAUDE_ACCOUNT_HOSTS,
  isActionKind,
  isEffect,
  isEnvironment,
  isPrincipalType,
  rankOf,
  type ActionKind,
  type Effect,
  type Environment,
  type PrincipalType,
} from "./vocabulary.js";

export const API_VERSION = "orbit.governance/v2";

export const LIMITS = { rules: 500, idLength: 64, nameLength: 120, resourceLength: 256, noteLength: 500 } as const;

export interface Rule {
  id: string;
  action: ActionKind;
  effect: Effect;
  // What the action is done TO. Exact, or a prefix ending in `*`. Without it the rule covers every resource.
  resource?: string;
  principalType?: PrincipalType;
  environment?: Environment;
  note?: string;
  // The account policy's rules only. MANDATORY (the default when unsaid) binds every department; DEFAULT is the company's
  // answer for an action it DELEGATED to its departments (`delegation`), which a department's own rule replaces within
  // the delegation's limit. An action not delegated is the company's whatever a rule says here.
  binding?: Binding;
}

export const BINDINGS = ["mandatory", "default"] as const;
export type Binding = (typeof BINDINGS)[number];

// WHAT THE COMPANY LETS ITS DEPARTMENTS DECIDE for their employees (department.ts), each with how far:
//   actions          an action delegated, with the LOOSEST effect a department may give it (a department may always
//                    narrow; an action not listed it may only narrow)
//   employeeNetwork  the loosest mode a department may choose, the hosts its allow-list may name (`allowWithin`: absent
//                    any public host, [] none) and the highest limit it may set; absent: a department only narrows
//   models           the models a department may choose among (absent: any the company allows)
export interface DepartmentDelegation {
  actions?: Partial<Record<ActionKind, Effect>>;
  employeeNetwork?: NetworkDelegation;
  models?: { allow?: string[] };
}

export interface NetworkDelegation {
  mode: EmployeeNetworkMode;
  allowWithin?: string[];
  limits?: NetworkLimits;
}

// Which models employees may run on, as `<runtime>:<model>` (claude:sonnet). Absent: any model the connection's catalog
// offers; [] none. Model selection has semantics of its own: sets only intersect downward -- company ∩ delegation ∩
// department -- and an unset department inherits.
export interface EmployeeModels {
  allow?: string[];
}

// What the account owes itself whatever the rules say. Each has a strong and a weak word; moving to the weak one
// is a high-risk change (../risk.ts).
export interface Obligations {
  // Which decisions leave an audit record: every one, or only those that did not simply allow.
  auditDecisions: "all" | "non_allow";
  dailyReport: boolean;
  // Whether a run may start where the agent's isolation from the control plane was not proven.
  isolation: "required" | "optional";
}

export const DEFAULT_DECISIONS = ["deny", "require_approval"] as const;
export type DefaultDecision = (typeof DEFAULT_DECISIONS)[number];

export const POLICY_KIND = "AccountPolicy";
export const OVERRIDE_KIND = "PolicyOverride";

export interface Constitution {
  apiVersion: typeof API_VERSION;
  kind: typeof POLICY_KIND;
  metadata: { accountId: string; name: string };
  // What an action no rule speaks about receives. Never "allow": an action nobody thought of is not permitted.
  defaults: { decision: DefaultDecision };
  obligations: Obligations;
  // What an employee's assignment may reach from its sandbox (network.ts). Not said: AUTONOMOUS, with no limit.
  employeeNetwork?: EmployeeNetwork;
  // What the company lets its departments decide (department.ts). Not said: nothing -- a department only narrows.
  delegation?: { departments?: DepartmentDelegation };
  // Which models employees may run on. Not said: any the connection's catalog offers.
  employeeModels?: EmployeeModels;
  // What an employee's attempt is held to while its programs run (runtime.ts). Not said: disabled, no control.
  runtimeSecurity?: RuntimeSecurity;
  rules: Rule[];
}

export type AccountPolicy = Constitution;

// What an override applies to: one chat (Claude Code workspace), one research workspace, or one employee (the runs of
// its assignments), of the account.
export const OVERLAY_LEVELS = ["workspace", "research_workspace", "employee"] as const;
export type OverlayLevel = (typeof OVERLAY_LEVELS)[number];

export interface PolicyOverlay {
  apiVersion: typeof API_VERSION;
  kind: typeof OVERRIDE_KIND;
  metadata: { accountId: string; level: OverlayLevel; target: string; name: string };
  rules: Rule[];
}

export type PolicyOverride = PolicyOverlay;

const ID = /^[a-z0-9][a-z0-9-]*$/;
// A resource names a thing, never a pattern language: one `*`, and only as the last character; no control character.
// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const RESOURCE = /^[^*\s\u0000-\u001f\u007f]*\*?$/;

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

function ruleErrors(rule: unknown, at: string, bindings = false): string[] {
  if (!isRecord(rule)) return [`${at} must be an object`];
  const errors = unknownFields(rule, ["id", "action", "effect", "resource", "principalType", "environment", "note", ...(bindings ? ["binding"] : [])], `${at}.`);
  if (rule.binding !== undefined && !(BINDINGS as readonly unknown[]).includes(rule.binding)) errors.push(`${at}.binding must be mandatory or default`);
  if (!isText(rule.id, LIMITS.idLength) || !ID.test(rule.id)) errors.push(`${at}.id must be lower-case letters, digits and dashes (at most ${LIMITS.idLength})`);
  if (!isActionKind(rule.action)) errors.push(`${at}.action is not an action Orbit Web knows`);
  if (!isEffect(rule.effect)) errors.push(`${at}.effect must be allow, require_approval or deny`);
  if (rule.resource !== undefined && (!isText(rule.resource, LIMITS.resourceLength) || !RESOURCE.test(rule.resource))) errors.push(`${at}.resource must be a name, or a prefix ending in *`);
  if (rule.principalType !== undefined && !isPrincipalType(rule.principalType)) errors.push(`${at}.principalType must be human, agent or service`);
  if (rule.environment !== undefined && !isEnvironment(rule.environment)) errors.push(`${at}.environment is not an environment Orbit Web knows`);
  if (rule.note !== undefined && (typeof rule.note !== "string" || rule.note.length > LIMITS.noteLength)) errors.push(`${at}.note must be text of at most ${LIMITS.noteLength} characters`);
  return errors.length > 0 ? errors : ceilingErrors(rule as unknown as Rule, at);
}

const WHOM: Record<PrincipalType, string> = { human: "a person", agent: "an agent", service: "a service" };

// A rule that names a kind of principal may not promise it more than that kind can ever have.
function ceilingErrors(rule: Rule, at: string): string[] {
  if (rule.principalType === undefined) return [];
  const ceiling = ACTIONS[rule.action].ceiling as Partial<Record<PrincipalType, Effect>>;
  const most = ceiling[rule.principalType];
  if (most === undefined || rankOf(rule.effect) >= rankOf(most)) return [];
  return [`${at}: ${rule.action} can never be more than "${most}" for ${WHOM[rule.principalType]}`];
}

export function rulesErrors(rules: unknown, at: string, bindings = false): string[] {
  if (!Array.isArray(rules)) return [`${at} must be a list`];
  if (rules.length > LIMITS.rules) return [`${at} holds more than ${LIMITS.rules} rules`];
  const errors = rules.flatMap((r, i) => ruleErrors(r, `${at}[${i}]`, bindings));
  const seen = new Set<string>();
  for (const r of rules) {
    if (!isRecord(r) || typeof r.id !== "string") continue;
    if (seen.has(r.id)) errors.push(`${at}: the rule id "${r.id}" is used twice`);
    seen.add(r.id);
  }
  return errors;
}

function headErrors(body: Record<string, unknown>, kind: string): string[] {
  const errors: string[] = [];
  if (body.apiVersion !== API_VERSION) errors.push(`apiVersion must be ${API_VERSION}`);
  if (body.kind !== kind) errors.push(`kind must be ${kind}`);
  return errors;
}

function obligationErrors(o: unknown): string[] {
  if (!isRecord(o)) return ["obligations must be an object"];
  const errors = unknownFields(o, ["auditDecisions", "dailyReport", "isolation"], "obligations.");
  if (o.auditDecisions !== "all" && o.auditDecisions !== "non_allow") errors.push('obligations.auditDecisions must be "all" or "non_allow"');
  if (typeof o.dailyReport !== "boolean") errors.push("obligations.dailyReport must be true or false");
  if (o.isolation !== "required" && o.isolation !== "optional") errors.push('obligations.isolation must be "required" or "optional"');
  return errors;
}

function constitutionMetadataErrors(m: unknown): string[] {
  if (!isRecord(m)) return ["metadata must be an object"];
  const errors = unknownFields(m, ["accountId", "name"], "metadata.");
  if (!isText(m.accountId, LIMITS.idLength)) errors.push("metadata.accountId must name the account");
  if (!isText(m.name, LIMITS.nameLength)) errors.push(`metadata.name must be text of at most ${LIMITS.nameLength} characters`);
  return errors;
}

function defaultsErrors(d: unknown): string[] {
  if (!isRecord(d)) return ["defaults must be an object"];
  const errors = unknownFields(d, ["decision"], "defaults.");
  if (d.decision !== "deny" && d.decision !== "require_approval") errors.push('defaults.decision must be "deny" or "require_approval": an action no rule names is never simply allowed');
  return errors;
}

// A list of models as `<runtime>:<model>`, each once.
const MODEL_ENTRY = /^(claude|codex|agy):[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/;
export function modelListErrors(list: unknown, at: string): string[] {
  if (!Array.isArray(list)) return [`${at} must be a list of models (runtime:model), empty for none`];
  const errors = list.flatMap((m, i) => (typeof m === "string" && MODEL_ENTRY.test(m) ? [] : [`${at}[${i}] must be runtime:model, as claude:sonnet`]));
  if (new Set(list).size !== list.length) errors.push(`${at} names a model twice`);
  return errors;
}

export function employeeModelsErrors(m: unknown, at = "employeeModels"): string[] {
  if (m === undefined) return [];
  if (!isRecord(m)) return [`${at} must be an object`];
  return [...unknownFields(m, ["allow"], `${at}.`), ...(m.allow === undefined ? [] : modelListErrors(m.allow, `${at}.allow`))];
}

function networkDelegationErrors(n: unknown, at: string): string[] {
  if (n === undefined) return [];
  if (!isRecord(n)) return [`${at} must be an object`];
  const errors = unknownFields(n, ["mode", "allowWithin", "limits"], `${at}.`);
  if (!(EMPLOYEE_NETWORK_MODES as readonly unknown[]).includes(n.mode)) errors.push(`${at}.mode must be the loosest mode a department may choose: "AUTONOMOUS" or "RESTRICTED"`);
  if (n.allowWithin !== undefined && (!Array.isArray(n.allowWithin) || !n.allowWithin.every(isAllowEntry))) errors.push(`${at}.allowWithin must be hosts or *.domains (empty for none)`);
  if (n.limits !== undefined) {
    if (!isRecord(n.limits)) errors.push(`${at}.limits must be an object`);
    else {
      errors.push(...unknownFields(n.limits, NETWORK_LIMIT_KEYS.filter((k) => k !== "downloadBytesPerDay"), `${at}.limits.`));
      for (const [k, v] of Object.entries(n.limits)) if (!(Number.isSafeInteger(v) && (v as number) >= 1)) errors.push(`${at}.limits.${k} must be a whole number of at least 1`);
    }
  }
  return errors;
}

export function delegationErrors(d: unknown): string[] {
  if (d === undefined) return [];
  if (!isRecord(d)) return ["delegation must be an object"];
  const errors = unknownFields(d, ["departments"], "delegation.");
  const dd = d.departments;
  if (dd === undefined) return errors;
  if (!isRecord(dd)) return [...errors, "delegation.departments must be an object"];
  errors.push(...unknownFields(dd, ["actions", "employeeNetwork", "models"], "delegation.departments."));
  if (dd.actions !== undefined) {
    if (!isRecord(dd.actions)) errors.push("delegation.departments.actions must be an object of action → the loosest effect a department may give it");
    else for (const [a, e] of Object.entries(dd.actions)) if (!isActionKind(a) || !isEffect(e)) errors.push(`delegation.departments.actions.${a} must be an action Orbit Web knows, with allow, require_approval or deny`);
  }
  errors.push(...networkDelegationErrors(dd.employeeNetwork, "delegation.departments.employeeNetwork"));
  if (dd.models !== undefined) errors.push(...employeeModelsErrors(dd.models, "delegation.departments.models"));
  return errors;
}

export function checkConstitution(body: unknown): Checked<Constitution> {
  if (!isRecord(body)) return { ok: false, errors: ["a policy is a JSON object"] };
  const errors = [
    ...unknownFields(body, ["apiVersion", "kind", "metadata", "defaults", "obligations", "employeeNetwork", "delegation", "employeeModels", "runtimeSecurity", "rules"]),
    ...headErrors(body, POLICY_KIND),
    ...constitutionMetadataErrors(body.metadata),
    ...defaultsErrors(body.defaults),
    ...obligationErrors(body.obligations),
    ...employeeNetworkErrors(body.employeeNetwork),
    ...delegationErrors(body.delegation),
    ...employeeModelsErrors(body.employeeModels),
    ...runtimeSecurityErrors(body.runtimeSecurity),
    ...rulesErrors(body.rules, "rules", true),
  ];
  return checked(errors, () => body as unknown as Constitution);
}

function overlayMetadataErrors(m: unknown): string[] {
  if (!isRecord(m)) return ["metadata must be an object"];
  const errors = unknownFields(m, ["accountId", "level", "target", "name"], "metadata.");
  if (!isText(m.accountId, LIMITS.idLength)) errors.push("metadata.accountId must name the account");
  if (typeof m.level !== "string" || !(OVERLAY_LEVELS as readonly string[]).includes(m.level)) errors.push("metadata.level must be workspace, research_workspace or employee");
  if (!isText(m.target, LIMITS.resourceLength)) errors.push("metadata.target must name what the override applies to");
  if (!isText(m.name, LIMITS.nameLength)) errors.push(`metadata.name must be text of at most ${LIMITS.nameLength} characters`);
  return errors;
}

export function checkOverlay(body: unknown): Checked<PolicyOverlay> {
  if (!isRecord(body)) return { ok: false, errors: ["an override is a JSON object"] };
  const errors = [...unknownFields(body, ["apiVersion", "kind", "metadata", "rules"]), ...headErrors(body, OVERRIDE_KIND), ...overlayMetadataErrors(body.metadata), ...rulesErrors(body.rules, "rules")];
  return checked(errors, () => body as unknown as PolicyOverlay);
}

export interface PolicyWarning {
  ruleId: string;
  code: "NO_EXECUTOR" | "RUNTIME_ONLY" | "OVERLAY_CANNOT_WIDEN" | "DEFAULT_NOT_DELEGATED" | "APPROVAL_UNSUPPORTED";
  message: string;
}

// The office's own actions an approval would only block: nothing in the office asks a person to approve them, so a
// rule saying "a person approves first" stops the work there.
const NO_APPROVAL_FLOW: readonly ActionKind[] = ["work.delegate", "work.assign", "artifact.publish"];

// What a company's delegation cannot do as written: a rule marked DEFAULT for an action nothing delegates binds every
// department anyway; an approval the office never asks for blocks the work.
export function lintDelegation(policy: Pick<Constitution, "rules" | "delegation">): PolicyWarning[] {
  const delegated = policy.delegation?.departments?.actions ?? {};
  return policy.rules.flatMap((rule): PolicyWarning[] => {
    if (rule.binding === "default" && delegated[rule.action] === undefined) return [{ ruleId: rule.id, code: "DEFAULT_NOT_DELEGATED", message: `${rule.action} is not delegated to departments: this default binds them all, as a mandatory rule would.` }];
    if (rule.effect === "require_approval" && NO_APPROVAL_FLOW.includes(rule.action)) return [{ ruleId: rule.id, code: "APPROVAL_UNSUPPORTED", message: `Nothing asks a person to approve ${rule.action}: requiring it stops that work.` }];
    return [];
  });
}

// What a valid policy still cannot do. Said beside the policy, so that nobody reads a rule as a wall it is not.
export function lintRules(rules: readonly Rule[], overlay = false): PolicyWarning[] {
  return rules.flatMap((rule): PolicyWarning[] => {
    const spec = ACTIONS[rule.action];
    if (overlay && rule.effect === "allow") return [{ ruleId: rule.id, code: "OVERLAY_CANNOT_WIDEN", message: "An override only narrows: an allow rule in it changes nothing." }];
    if (spec.enforcement === "none" && rule.effect !== "deny") return [{ ruleId: rule.id, code: "NO_EXECUTOR", message: `Nothing in Orbit Web can carry out ${rule.action}: it is denied whatever this rule says.` }];
    if (spec.enforcement === "runtime" && rule.effect !== "allow") return [{ ruleId: rule.id, code: "RUNTIME_ONLY", message: `${rule.action} is held by the agent runtime's own configuration: defence in depth, not a boundary.` }];
    return [];
  });
}

// THE DEPLOYMENTS a default policy is made for: one container (`single`, where the agent shares the control plane's user
// and isolation can never be proven) or the governed deployment (the agent in a container of its own).
export type PolicyDeployment = "single" | "governed";

// The policy a new account starts from -- published for it when the account is created, so a person can start right
// after signing in -- and what a first change is compared with. An agent may work in its own workspace and reach the
// model's own service; git with the remote waits for the owner; nothing about governance is the agent's; production is
// never reached.
//
//   single    what one container always allowed: the web tools and the account's connectors (as its owner chooses
//             them), and isolation OPTIONAL -- it can never be proven there, and requiring it would refuse every run.
//   governed  the strict default: the web tools and connectors denied (the agent's only way out is the egress proxy),
//             isolation REQUIRED.
//
// In both, an employee's assignment reaches every public host on ports 80 and 443 (employee network access AUTONOMOUS,
// no limit): its owner restricts it to an allow-list, or sets limits, through the policy's lifecycle. Runtime security
// starts DISABLED -- Orbit Web 0.8.0's behaviour, until its owner (or the deployment's floor) raises it -- with the
// shared-areas control chosen, so that observe or enforce mean something the moment they are turned on.
export function defaultAccountPolicy(accountId: string, deployment: PolicyDeployment, name = "default"): Constitution {
  const single = deployment === "single";
  return {
    apiVersion: API_VERSION,
    kind: POLICY_KIND,
    metadata: { accountId, name },
    defaults: { decision: "deny" },
    obligations: { auditDecisions: "all", dailyReport: true, isolation: single ? "optional" : "required" },
    employeeNetwork: { mode: "AUTONOMOUS", allow: [] },
    runtimeSecurity: { mode: "disabled", controls: ["exec.shared-areas"] },
    rules: [
      { id: "run-start", action: "agent.run.start", effect: "allow" },
      { id: "workspace-read", action: "repository.read", effect: "allow" },
      { id: "workspace-write", action: "repository.write", effect: "allow" },
      { id: "workspace-execute", action: "workspace.execute", effect: "allow" },
      { id: "web-tools", action: "tool.web", effect: single ? "allow" : "deny" },
      { id: "connectors", action: "tool.connector", effect: single ? "allow" : "deny" },
      ...CLAUDE_ACCOUNT_HOSTS.map((h): Rule => ({ id: h.rule, action: "network.egress", resource: `${h.host}:${h.port}`, effect: "allow" })),
      { id: "outside-workspace", action: "filesystem.outside_workspace", effect: "deny" },
      { id: "raw-secret-access", action: "credential.read_raw", effect: "deny" },
      { id: "privileged-settings", action: "settings.privileged.write", principalType: "human", effect: "allow" },
      { id: "git-push", action: "repository.push", effect: "require_approval" },
      { id: "connector-write", action: "connector.write", effect: "require_approval" },
      { id: "production-deploy", action: "deployment.production", effect: "deny" },
      { id: "production-migrate", action: "database.production.migrate", effect: "deny" },
      { id: "production-data", action: "data.production.destroy", effect: "deny" },
      { id: "propose-policy", action: "governance.policy.propose", effect: "allow" },
      { id: "modify-governance", action: "governance.policy.modify", principalType: "agent", effect: "deny" },
      { id: "office-departments", action: "office.department.manage", effect: "allow" },
      { id: "office-roster", action: "office.roster.manage", effect: "allow" },
      { id: "office-hire", action: "employee.hire", effect: "allow" },
      { id: "office-assistants", action: "employee.hire_assistant", effect: "allow" },
      { id: "office-resources", action: "employee.resources.change", effect: "allow" },
      { id: "office-desk-read", action: "employee.desk.read", effect: "allow" },
      { id: "office-desk-clean", action: "employee.desk.clean", effect: "allow" },
      { id: "office-assign", action: "work.assign", effect: "allow" },
      { id: "office-delegate", action: "work.delegate", effect: "allow" },
      { id: "office-artifacts", action: "artifact.publish", effect: "allow" },
      { id: "office-deliveries", action: "notification.send", effect: "allow" },
      { id: "office-budget", action: "budget.change", effect: "allow" },
      { id: "office-connections", action: "connection.manage", effect: "allow" },
    ],
  };
}
