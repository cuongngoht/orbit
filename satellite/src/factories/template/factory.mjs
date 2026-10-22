// The AGENT TEMPLATE FACTORY: a reusable execution definition for one role, one provider and the skills it carries.
// Its content is DERIVED from what it pins -- the role's contract becomes the instruction contract, its output
// contract the template's -- so the same role, provider and skills are the same template in every mission, and a
// later mission REUSES it (template.reused) instead of generating it again. A template never carries a run's state.
//
//   planTemplate(ports, lw, a)      -> { word: REUSE|GENERATE|REJECT, content, id, findings }
//   runTemplate(ports, lw, a, plan) -> { outcome, pin, summary }
import { short } from "../../../../src/hash.mjs";
import { digestOf } from "../../store/definitions.mjs";
import { quietly } from "../../store/text.mjs";
import { UNIT_KINDS } from "../../execution/unit-kinds.mjs";
import { PROFILE_AGENTS } from "../../hosts/agents.mjs";

export const TEMPLATE_SCHEMA = 1;

export const REPORT_API = "orbit.satellite.report/v1";

export const CONTEXT_PARTS = Object.freeze(["unit", "criteria", "handoffs", "skills"]);

const unitOf = (lw, a) => lw.m.units.get(a.unit) ?? null;

const providerFor = (unit) => UNIT_KINDS[unit.kind].provider;

export const templateContentOf = (rolePin, role, provider, skillPins) => ({ rolePin, instructionContract: { objective: "the work unit's own objective", inputs: role.content.inputContract?.accepts ?? [], outputs: role.content.outputContract, report: REPORT_API, restrictions: role.content.restrictions, completionCriteria: role.content.completionCriteria }, contextPolicy: { memoryFirst: true, includes: [...CONTEXT_PARTS], maxExcerpts: 8, conversation: false, secrets: false }, requiredCapabilities: role.content.requiredCapabilities ?? [], skillPins: [...skillPins].sort(), providerRequirements: { provider, agent: PROFILE_AGENTS[role.content.requestedPermissionProfile], nativeAgents: "preferred" }, outputContract: role.content.outputContract });

const templateIdOf = (role, provider, skillPins) => `atp-${role.id.slice(4)}-${provider}${skillPins.length ? `-${short([...skillPins].sort().join(","), 6)}` : ""}`.slice(0, 52).replace(/-+$/, "");

const REJECTIONS = [
  { id: "TEMPLATE_NO_UNIT", fails: (c) => !c.unit, say: () => "resolve-template names the unit it is for" },
  { id: "TEMPLATE_NO_ROLE", fails: (c) => !c.unit.rolePin, say: (c) => `${c.unit.id} has no role yet: resolve-role first` },
  { id: "TEMPLATE_ROLE_UNREADABLE", fails: (c) => !c.role, say: (c) => `${c.unit.rolePin} could not be read back intact` },
  { id: "TEMPLATE_ROLE_REVOKED", fails: (c) => c.revoked(c.unit.rolePin), say: (c) => `${c.unit.rolePin} was revoked by a person` },
  { id: "TEMPLATE_PROVIDER", fails: (c) => c.provider !== providerFor(c.unit), say: (c) => `a ${c.unit.kind} unit is provided by ${providerFor(c.unit)}, never ${c.provider}` },
];

export function planTemplate(ports, lw, a) {
  const unit = unitOf(lw, a);
  const c = { unit, role: unit?.rolePin ? quietly(() => ports.definitions.read(unit.rolePin)) : null, provider: a.provider ?? (unit ? providerFor(unit) : null), revoked: (pin) => ports.definitions.revoked(pin) };
  const failed = REJECTIONS.find((r) => r.fails(c));
  return failed ? { word: "REJECT", findings: [{ id: failed.id, say: failed.say(c) }] } : planned(ports, c, a);
}

function planned(ports, c, a) {
  const skillPins = a.skillPins ?? c.unit.skillPins ?? [];
  const content = templateContentOf(c.unit.rolePin, c.role, c.provider, skillPins);
  const proposed = { id: templateIdOf(c.role, c.provider, skillPins), kind: "agent-template", schemaVersion: TEMPLATE_SCHEMA, scope: "project", dependencies: [c.unit.rolePin, ...skillPins], compatibility: { providers: [c.provider] }, content };
  const same = ports.definitions.offered("agent-template").find((r) => r.record.contentDigest === digestOf(proposed));
  return { word: same ? "REUSE" : "GENERATE", proposed, found: same ?? null, findings: [] };
}

export const templateModeOf = (plan) => (plan.word === "REUSE" ? "REUSING" : "AGENT_GENERATING");

function pinnedTemplate(lw, a, w, word) {
  lw.append(word === "reused" ? "template.reused" : "template.generated", { pin: w.pin, rolePin: w.record.content.rolePin, provider: w.record.content.providerRequirements.provider, unit: a.unit, action: lw.action });
  if (word !== "reused") lw.append("template.registered", { pin: w.pin, version: w.record.version, action: lw.action });
  lw.append("unit.updated", { id: a.unit, templatePin: w.pin, ...(a.skillPins ? { skillPins: a.skillPins } : {}), action: lw.action });
  return { outcome: word, pin: w.pin, summary: `${w.pin} ${word} for ${a.unit}` };
}

const STEPS = {
  REJECT: (ports, lw, a, plan) => ({ outcome: "rejected", pin: null, summary: plan.findings.map((f) => `${f.id}: ${f.say}`).join("; ") }),
  REUSE: (ports, lw, a, plan) => pinnedTemplate(lw, a, { pin: plan.found.pin, record: plan.found.record }, "reused"),
  GENERATE: (ports, lw, a, plan) => pinnedTemplate(lw, a, ports.definitions.write({ ...plan.proposed, provenance: { by: "engine", mission: lw.id, at: ports.now(), reason: "no template pins this role, provider and skill set" } }), "generated"),
};

export const runTemplate = (ports, lw, a, plan) => STEPS[plan.word](ports, lw, a, plan);
