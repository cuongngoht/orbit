// THE SKILL FACTORY, reuse first, through Orbit's own (src/skill-factory/, bound as ports.factory): a capability a unit
// needs is DISCOVERED -- a Satellite skill already pinning a provider that still serves it, or a provider Orbit's
// resolver finds (a shipped skill, a project playbook, a managed server, a project capability) -- and only a genuine
// gap the person's automation settings let the factory fill is GENERATED: an instruction-only draft Orbit scaffolds,
// the host writes, Orbit's contract VALIDATES and REGISTERS, and Satellite PINS as a definition of its own. A gap that
// is a person's decision -- a provider switched off, an approval, a policy -- is BLOCKED: nothing is generated to get
// around it, and no executable code is ever generated.
//
//   a Satellite skill: { capability, source: orbit-shipped|orbit-project|orbit-generated, provider: { kind, id, key,
//                        ownership }, orbitPin: <Orbit playbook pin> | null, runs: followed|declared }
import { quietly } from "../../store/text.mjs";

export const SKILL_SCHEMA = 1;

export const skillIdOf = (capability) => `skl-${String(capability).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`.slice(0, 52).replace(/-+$/, "");

// Whether a project playbook may serve a mission NOW: verified and in place, not switched off, retired or broken by a
// person. A pin never outranks that.
export const servable = (ports, orbitPin) => ((row) => Boolean(row?.loadable) && ["active", "verified"].includes(row.status))(quietly(() => ports.factory?.pinned(orbitPin)));

const stillServed = (ports, own) => (own.record.content.orbitPin ? servable(ports, own.record.content.orbitPin) : quietly(() => ports.resolve(own.record.content.capability))?.provider?.key === own.record.content.provider?.key);

const factoryAllows = (ports, lw) => (ports.limits.values.skillFactory?.maxSkillsPerTask ?? 0) > 0 && Boolean(ports.factory) && lw.spent().generated < lw.limits.maxGeneratedDefinitions;

const LABEL_OF = { decision: "APPROVAL_REQUIRED", impaired: "ENVIRONMENT_GAP", gap: "POLICY_GAP", "cannot-tell": "CAPABILITY_GAP" };

const RESOLUTION = [
  { word: "WRAP", label: "REUSABLE", when: (r) => r?.outcome === "provided" },
  { word: "GENERATE", label: "WORKFLOW_GAP", when: (r, ports, lw) => r?.outcome === "gap" && factoryAllows(ports, lw) },
  { word: "BLOCKED", label: null, when: () => true },
];

// What the action will do, decided before it is proposed (so its mode is right): reuse, wrap, generate or blocked.
// A skill this project pinned whose provider a person since WITHDREW is a person's decision: nothing is generated to
// get around it.
const withdrawn = (own) => ({ word: "BLOCKED", label: "WITHDRAWN", resolved: { provider: own.record.content.provider, why: `${own.record.content.orbitPin ?? own.record.content.provider?.key} was withdrawn by a person; nothing is generated to get around it` } });

export function planSkill(ports, lw, a) {
  const own = ports.definitions.offered("skill").find((row) => row.record.content.capability === a.capability) ?? null;
  if (own) return stillServed(ports, own) ? { word: "REUSE", label: "REUSABLE", found: own } : withdrawn(own);
  const resolved = quietly(() => ports.resolve(a.capability));
  const row = RESOLUTION.find((x) => x.when(resolved, ports, lw));
  return { word: row.word, label: row.label ?? LABEL_OF[resolved?.outcome] ?? "CAPABILITY_GAP", resolved };
}

export const skillModeOf = (plan) => (plan.word === "GENERATE" ? "SKILL_GENERATING" : "REUSING");

export const skillOperationOf = (plan) => ({ REUSE: "store.read", WRAP: "definition.register", GENERATE: "skill.draft", BLOCKED: "store.read" })[plan.word];

const sourceOf = (provider) => (provider?.ownership === "project" ? "orbit-project" : "orbit-shipped");

const playbookPin = (ports, provider) => (provider?.kind === "skill" && provider.ownership === "project" ? ports.factory?.current?.(provider.id)?.pin ?? null : null);

export const wrappedContent = (ports, a, resolved) => ({ capability: a.capability, source: sourceOf(resolved.provider), provider: resolved.provider, orbitPin: playbookPin(ports, resolved.provider), runs: "followed" });

export const generatedContent = (capability, draft, orbit) => ({ capability, source: "orbit-generated", provider: { kind: "skill", id: draft, key: `project:${draft}`, ownership: "project" }, orbitPin: orbit.pin, runs: orbit.runs ?? "followed" });

export const skillProposed = (lw, ports, content, reason) => ({ id: skillIdOf(content.capability), kind: "skill", schemaVersion: SKILL_SCHEMA, scope: "project", dependencies: content.orbitPin ? [content.orbitPin] : [], compatibility: { providers: [content.provider?.kind ?? "skill"] }, content, provenance: { by: "engine", mission: lw.id, at: ports.now(), reason }, evidenceRefs: [] });
