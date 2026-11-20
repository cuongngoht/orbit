// THE COMPANY CONSTITUTION: a declarative document, never prose. It is data a machine evaluates, and the only source
// of an authorization: a sentence in a document nobody parses authorizes nothing.
//
// Layers narrow and never widen. The Constitution is the organization's; a PolicyOverlay belongs to a project, a
// workspace or an agent and can only make a decision stricter (../evaluate.ts takes the strictest of every layer, so
// an overlay that says "allow" changes nothing).
//
// The document carries no revision number and no author: those are facts ABOUT a revision, kept by whoever stores it,
// so that the same content always has the same digest.
import { checked, isRecord, unknownFields, type Checked } from "./canonical.js";
import {
  ACTIONS,
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

export const API_VERSION = "orbit.governance/v1";

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
}

// What the organization owes itself whatever the rules say. Each has a strong and a weak word; moving to the weak one
// is a high-risk change (../risk.ts).
export interface Obligations {
  // Which decisions leave an audit record: every one, or only those that did not simply allow.
  auditDecisions: "all" | "non_allow";
  dailyReport: boolean;
  // Whether a governed run may start where the agent's isolation was not proven.
  isolation: "required" | "optional";
}

export const DEFAULT_DECISIONS = ["deny", "require_approval"] as const;
export type DefaultDecision = (typeof DEFAULT_DECISIONS)[number];

export interface Constitution {
  apiVersion: typeof API_VERSION;
  kind: "CompanyConstitution";
  metadata: { organizationId: string; name: string };
  // What an action no rule speaks about receives. Never "allow": an action nobody thought of is not permitted.
  defaults: { decision: DefaultDecision };
  obligations: Obligations;
  rules: Rule[];
}

export const OVERLAY_LEVELS = ["project", "workspace", "agent"] as const;
export type OverlayLevel = (typeof OVERLAY_LEVELS)[number];

export interface PolicyOverlay {
  apiVersion: typeof API_VERSION;
  kind: "PolicyOverlay";
  metadata: { organizationId: string; level: OverlayLevel; target: string; name: string };
  rules: Rule[];
}

const ID = /^[a-z0-9][a-z0-9-]*$/;
// A resource names a thing, never a pattern language: one `*`, and only as the last character; no control character.
// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const RESOURCE = /^[^*\s\u0000-\u001f\u007f]*\*?$/;

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

function ruleErrors(rule: unknown, at: string): string[] {
  if (!isRecord(rule)) return [`${at} must be an object`];
  const errors = unknownFields(rule, ["id", "action", "effect", "resource", "principalType", "environment", "note"], `${at}.`);
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

function rulesErrors(rules: unknown, at: string): string[] {
  if (!Array.isArray(rules)) return [`${at} must be a list`];
  if (rules.length > LIMITS.rules) return [`${at} holds more than ${LIMITS.rules} rules`];
  const errors = rules.flatMap((r, i) => ruleErrors(r, `${at}[${i}]`));
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
  const errors = unknownFields(m, ["organizationId", "name"], "metadata.");
  if (!isText(m.organizationId, LIMITS.idLength)) errors.push("metadata.organizationId must name the organization");
  if (!isText(m.name, LIMITS.nameLength)) errors.push(`metadata.name must be text of at most ${LIMITS.nameLength} characters`);
  return errors;
}

function defaultsErrors(d: unknown): string[] {
  if (!isRecord(d)) return ["defaults must be an object"];
  const errors = unknownFields(d, ["decision"], "defaults.");
  if (d.decision !== "deny" && d.decision !== "require_approval") errors.push('defaults.decision must be "deny" or "require_approval": an action no rule names is never simply allowed');
  return errors;
}

export function checkConstitution(body: unknown): Checked<Constitution> {
  if (!isRecord(body)) return { ok: false, errors: ["a Constitution is a JSON object"] };
  const errors = [
    ...unknownFields(body, ["apiVersion", "kind", "metadata", "defaults", "obligations", "rules"]),
    ...headErrors(body, "CompanyConstitution"),
    ...constitutionMetadataErrors(body.metadata),
    ...defaultsErrors(body.defaults),
    ...obligationErrors(body.obligations),
    ...rulesErrors(body.rules, "rules"),
  ];
  return checked(errors, () => body as unknown as Constitution);
}

function overlayMetadataErrors(m: unknown): string[] {
  if (!isRecord(m)) return ["metadata must be an object"];
  const errors = unknownFields(m, ["organizationId", "level", "target", "name"], "metadata.");
  if (!isText(m.organizationId, LIMITS.idLength)) errors.push("metadata.organizationId must name the organization");
  if (typeof m.level !== "string" || !(OVERLAY_LEVELS as readonly string[]).includes(m.level)) errors.push("metadata.level must be project, workspace or agent");
  if (!isText(m.target, LIMITS.resourceLength)) errors.push("metadata.target must name what the overlay applies to");
  if (!isText(m.name, LIMITS.nameLength)) errors.push(`metadata.name must be text of at most ${LIMITS.nameLength} characters`);
  return errors;
}

export function checkOverlay(body: unknown): Checked<PolicyOverlay> {
  if (!isRecord(body)) return { ok: false, errors: ["an overlay is a JSON object"] };
  const errors = [...unknownFields(body, ["apiVersion", "kind", "metadata", "rules"]), ...headErrors(body, "PolicyOverlay"), ...overlayMetadataErrors(body.metadata), ...rulesErrors(body.rules, "rules")];
  return checked(errors, () => body as unknown as PolicyOverlay);
}

export interface PolicyWarning {
  ruleId: string;
  code: "NO_EXECUTOR" | "RUNTIME_ONLY" | "OVERLAY_CANNOT_WIDEN";
  message: string;
}

// What a valid policy still cannot do. Said beside the policy, so that nobody reads a rule as a wall it is not.
export function lintRules(rules: readonly Rule[], overlay = false): PolicyWarning[] {
  return rules.flatMap((rule): PolicyWarning[] => {
    const spec = ACTIONS[rule.action];
    if (overlay && rule.effect === "allow") return [{ ruleId: rule.id, code: "OVERLAY_CANNOT_WIDEN", message: "An overlay only narrows: an allow rule in it changes nothing." }];
    if (spec.enforcement === "none" && rule.effect !== "deny") return [{ ruleId: rule.id, code: "NO_EXECUTOR", message: `Nothing in Orbit Web can carry out ${rule.action}: it is denied whatever this rule says.` }];
    if (spec.enforcement === "runtime" && rule.effect !== "allow") return [{ ruleId: rule.id, code: "RUNTIME_ONLY", message: `${rule.action} is held by the agent runtime's own configuration: defence in depth, not a boundary.` }];
    return [];
  });
}

// The Constitution a new organization starts from, and what a first revision is compared with: an agent may work in
// its own workspace and reach the model's own service; everything that leaves the workspace is denied or waits for a
// person; nothing about governance is the agent's.
export function defaultConstitution(organizationId: string, name = "default"): Constitution {
  return {
    apiVersion: API_VERSION,
    kind: "CompanyConstitution",
    metadata: { organizationId, name },
    defaults: { decision: "deny" },
    obligations: { auditDecisions: "all", dailyReport: true, isolation: "required" },
    rules: [
      { id: "run-start", action: "agent.run.start", effect: "allow" },
      { id: "workspace-read", action: "repository.read", effect: "allow" },
      { id: "workspace-write", action: "repository.write", effect: "allow" },
      { id: "workspace-execute", action: "workspace.execute", effect: "allow" },
      { id: "web-tools", action: "tool.web", effect: "deny" },
      { id: "egress-model-api", action: "network.egress", resource: "api.anthropic.com:443", effect: "allow" },
      { id: "egress-model-auth", action: "network.egress", resource: "platform.claude.com:443", effect: "allow" },
      { id: "egress-model-account", action: "network.egress", resource: "claude.ai:443", effect: "allow" },
      { id: "outside-workspace", action: "filesystem.outside_workspace", effect: "deny" },
      { id: "raw-secret-access", action: "credential.read_raw", effect: "deny" },
      { id: "privileged-settings", action: "settings.privileged.write", principalType: "human", effect: "allow" },
      { id: "git-push", action: "repository.push", effect: "require_approval" },
      { id: "production-deploy", action: "deployment.production", effect: "deny" },
      { id: "production-migrate", action: "database.production.migrate", effect: "deny" },
      { id: "production-data", action: "data.production.destroy", effect: "deny" },
      { id: "propose-policy", action: "governance.policy.propose", effect: "allow" },
      { id: "modify-governance", action: "governance.policy.modify", principalType: "agent", effect: "deny" },
    ],
  };
}
