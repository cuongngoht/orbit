// The PERMISSION PROFILES a role may REQUEST, and the one the engine itself acts under. A profile is a set of operation
// kinds -- never a tool, never a title. A role named "Administrator" requesting READ_ONLY gets READ_ONLY; a role cannot
// request ORCHESTRATOR at all. What a run may actually do is the intersection grants.mjs computes, never this alone.
import { READ_KINDS } from "./operations.mjs";

export const PROFILES = Object.freeze({
  READ_ONLY: { kinds: [...READ_KINDS], requestable: true, say: "reads source, logs and evidence; changes nothing" },
  DESIGN: { kinds: [...READ_KINDS, "artifact.publish"], requestable: true, say: "reads, and publishes a design artifact through a handoff; changes no product code" },
  IMPLEMENT: { kinds: [...READ_KINDS, "artifact.publish", "source.patch", "check.run"], requestable: true, say: "changes source only in an engineering task's own workspace, and runs the checks it declared" },
  VERIFY: { kinds: [...READ_KINDS, "artifact.publish", "check.run", "sandbox.test.run"], requestable: true, say: "runs declared checks and isolated tests through their owners; changes no source" },
  ORCHESTRATOR: { kinds: [...READ_KINDS, "plan.revise", "definition.register", "skill.draft", "artifact.publish"], requestable: false, say: "the engine's own: plans, registers definitions and dispatches; never touches source" },
});

export const PROFILE_IDS = Object.freeze(Object.keys(PROFILES));

export const REQUESTABLE = Object.freeze(PROFILE_IDS.filter((p) => PROFILES[p].requestable));

export const kindsOf = (profile) => PROFILES[profile]?.kinds ?? [];

// Whether every kind one profile carries is carried by another -- how a reused role is held to what was requested.
export const within = (narrow, wide) => kindsOf(narrow).every((k) => kindsOf(wide).includes(k));
