// The versioned OPERATIONAL MODE vocabulary: what an action or an agent run is doing, as the accepted work context
// says -- never a guess from an agent's name or a tool's. A mode is a column on an ACTION line and an AGENT RUN line,
// never a mission field: concurrent runs keep their own, and a nested action's mode gives way to its parent's again
// when it ends. Each row names the operation kinds it may carry and the profiles that may act in it, so a write can
// never ride a read-only mode (src/permissions/evaluate.mjs asks all three together).
export const MODE_VOCABULARY = "orbit.satellite.modes/v1";

const AGENTS = ["READ_ONLY", "DESIGN", "IMPLEMENT", "VERIFY"];

const ENGINE = ["ORCHESTRATOR"];

export const MODES = Object.freeze({
  ANALYZING: { kinds: ["schema.validate", "store.read"], profiles: ENGINE, reads: true, say: "reading a goal into a structured intent" },
  RECALLING: { kinds: ["knowledge.recall", "context.gather", "store.read"], profiles: [...ENGINE, ...AGENTS], reads: true, say: "recalling what the project already knows" },
  EXPLORING: { kinds: ["repository.read", "logs.read", "logs.analyze", "evidence.read", "store.read", "provider.invoke"], profiles: AGENTS, reads: true, say: "investigating the project before anything is decided" },
  PLANNING: { kinds: ["plan.revise", "schema.validate", "store.read"], profiles: ENGINE, reads: false, say: "publishing or revising the work graph" },
  ROLE_GENERATING: { kinds: ["definition.register", "schema.validate"], profiles: ENGINE, reads: false, say: "generating a role for a responsibility nothing covers" },
  AGENT_GENERATING: { kinds: ["definition.register", "schema.validate"], profiles: ENGINE, reads: false, say: "generating an agent template" },
  SKILL_GENERATING: { kinds: ["skill.draft", "definition.register", "schema.validate", "store.read"], profiles: ENGINE, reads: false, say: "generating a playbook for a capability nothing provides" },
  SKILL_VALIDATING: { kinds: ["schema.validate", "store.read"], profiles: ENGINE, reads: true, say: "holding a generated playbook to its contract" },
  REUSING: { kinds: ["store.read", "definition.register", "schema.validate"], profiles: ENGINE, reads: false, say: "reusing a definition that already covers the need" },
  DESIGNING: { kinds: ["repository.read", "store.read", "evidence.read", "artifact.publish", "definition.register", "schema.validate"], profiles: [...ENGINE, "DESIGN", "IMPLEMENT", "VERIFY"], reads: false, say: "designing a change or a workflow" },
  IMPLEMENTING: { kinds: ["source.patch", "repository.read"], profiles: ["IMPLEMENT"], reads: false, say: "changing source in a task's own workspace" },
  BUILDING: { kinds: ["check.run", "repository.read"], profiles: ["IMPLEMENT", "VERIFY"], reads: false, say: "building what changed" },
  TESTING: { kinds: ["check.run", "sandbox.test.run", "evidence.read"], profiles: ["VERIFY"], reads: false, say: "running the tests a change is held to" },
  DIAGNOSING: { kinds: ["logs.read", "logs.analyze", "evidence.read", "repository.read"], profiles: AGENTS, reads: true, say: "working out why something failed" },
  REVIEWING: { kinds: ["repository.read", "evidence.read", "store.read"], profiles: AGENTS, reads: true, say: "reviewing a change as a whole" },
  VERIFYING: { kinds: ["evidence.read", "store.read"], profiles: AGENTS, reads: true, say: "reading evidence back against acceptance" },
  DISPATCHING: { kinds: ["agent.dispatch", "provider.invoke"], profiles: ENGINE, reads: true, say: "handing work to a provider" },
  HANDOFF: { kinds: ["artifact.publish", "store.read"], profiles: [...ENGINE, "DESIGN", "IMPLEMENT", "VERIFY"], reads: false, say: "publishing or consuming a handoff" },
  RECOVERING: { kinds: ["store.read", "evidence.read", "artifact.publish"], profiles: ENGINE, reads: false, say: "reading an interrupted action back from its owner, or keeping a checkpoint" },
});

export const MODE_NAMES = Object.freeze(Object.keys(MODES));

export const isMode = (mode) => Object.hasOwn(MODES, String(mode));
