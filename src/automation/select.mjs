// WHO runs a step, from what the resolver answered for its capability (src/knowledge/verify.mjs OUTCOMES,
// handed in as data) and what the host can do. An ordered table, the last row always answering: the
// coordinator never invents a provider, never routes past a switch a person turned off, and never treats a
// capability nobody provides as a reason to generate one -- that is the skill factory's call, on a WORKFLOW
// gap only, made before the plan is written.
//
//   selectionOf(step, kind, resolved, host) -> { dispatch: { mode, provider } } | { blocked: { needs, because } }
//
// `mode` is engine (an owner's port, run by the engine), agent (the host dispatches an agent), skill (the
// host runs a shipped skill's playbook in its own session) or playbook (a project playbook, printed by the
// skill factory and followed by the host).
import { NEEDS } from "./vocab.mjs";

const engine = (kind) => ({ dispatch: { mode: "engine", provider: { kind: "engine", id: kind.id, key: `engine:${kind.id}` } } });

// A step a SHIPPED skill or agent owns: its agent on a host that has native agents, else its skill.
const owned = (kind, host) => (kind.agent && host.agents ? { mode: "agent", provider: { kind: "agent", id: kind.agent, key: `agent:${kind.agent}` } } : { mode: "skill", provider: { kind: "skill", id: kind.skill, key: kind.skill } });

const fromResolver = (r) => (r.provider.ownership === "project" ? { mode: "playbook", provider: r.provider } : { mode: r.provider.kind === "agent" ? "agent" : "skill", provider: r.provider });

const blocked = (needs, because) => ({ blocked: { needs, because } });

export const SELECTION = [
  { id: "engine", when: (s, k, r, h, f) => k.engine(f), then: (s, k) => engine(k) },
  { id: "no-resolution", when: (s, k, r) => !r, then: (s, k, r, h) => (k.skill ? { dispatch: owned(k, h) } : blocked(NEEDS.CAPABILITY, `nothing answered for ${s.provides ?? s.kind}`)) },
  { id: "provided", when: (s, k, r) => r.outcome === "provided", then: (s, k, r, h) => (k.skill && r.provider.id === k.skill ? { dispatch: owned(k, h) } : { dispatch: fromResolver(r) }) },
  // Provided, with a need of its own unmet here: the owner is still the one to run the step -- its own gates
  // decide what it needs (a work item's reader only matters for a work item) -- and the note travels with it.
  { id: "impaired", when: (s, k, r) => r.outcome === "impaired" && k.skill !== null, then: (s, k, r, h) => ({ dispatch: { ...owned(k, h), note: r.why } }) },
  { id: "impaired-unowned", when: (s, k, r) => r.outcome === "impaired", then: (s, k, r) => blocked(NEEDS.ENVIRONMENT, r.why) },
  { id: "decision", when: (s, k, r) => r.outcome === "decision", then: (s, k, r) => blocked(NEEDS.PERSON, r.why) },
  { id: "switched-off", when: (s, k, r) => r.outcome === "gap" && r.remedy === "enable", then: (s, k, r) => blocked(NEEDS.PERSON, `${r.why} — a step is never routed past a switch a person turned off, and nothing is generated to replace it`) },
  { id: "unprovided", when: (s, k, r) => r.outcome === "gap", then: (s, k, r) => blocked(NEEDS.CAPABILITY, `${r.why} — orbit-qc-builder prepares a capability; a person decides the opportunity`) },
  { id: "cannot-tell", when: () => true, then: (s, k, r) => blocked(NEEDS.CAPABILITY, r?.why ?? "nobody can tell what would provide it") },
];

// `resolved` is the resolver's answer for the step's capability, or null when the step names none.
export const selectionOf = (step, kind, resolved, host, facts = {}) => ({ ...SELECTION.find((row) => row.when(step, kind, resolved, host, facts)).then(step, kind, resolved, host, facts), verdict: resolved?.status === "approval" ? "approval" : "allow" });
