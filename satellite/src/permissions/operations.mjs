// What an action DOES, as an operation kind with an EFFECT column -- the one word a policy, a mode and a profile are
// held against together. `read` changes nothing outside the mission's own journal; `store` writes a record into the
// machine store (a definition, a plan revision, a handoff, a draft); `write` changes a workspace or runs a command with
// side effects, and only ever through the OWNER that row names (an engineering task's own workspace and check runner).
//
// There is deliberately no row for a shell, a secret, an install, a push, a merge or a deploy: nothing Satellite
// dispatches can name one (NOT_SATELLITE in src/governance.mjs, held by test/permissions.test.mjs).
export const EFFECTS = Object.freeze(["read", "store", "write"]);

export const OPERATION_KINDS = Object.freeze({
  "repository.read": { effect: "read", say: "read the project's source" },
  "logs.read": { effect: "read", say: "read logs the project or an owner keeps" },
  "logs.analyze": { effect: "read", say: "analyse logs to find a cause" },
  "store.read": { effect: "read", say: "read what the machine store keeps" },
  "evidence.read": { effect: "read", say: "read an owner's evidence back" },
  "context.gather": { effect: "read", say: "gather the project's context, memory first" },
  "knowledge.recall": { effect: "read", say: "recall what project knowledge already says" },
  "schema.validate": { effect: "read", say: "hold a proposal to its contract" },
  "provider.invoke": { effect: "read", say: "ask a provider through its own gate, reading only" },
  "agent.dispatch": { effect: "read", say: "hand a work unit to an agent run" },
  "plan.revise": { effect: "store", say: "publish a revision of the mission's work graph" },
  "definition.register": { effect: "store", say: "publish an immutable reusable definition" },
  "skill.draft": { effect: "store", say: "write a draft playbook through Orbit's skill factory" },
  "artifact.publish": { effect: "store", say: "publish an immutable artifact or handoff" },
  "source.patch": { effect: "write", owners: ["engineering"], say: "change source, only in an engineering task's own workspace" },
  "check.run": { effect: "write", owners: ["engineering"], say: "run a command the checkout declared, through the engineering task's check runner" },
  "sandbox.test.run": { effect: "write", owners: ["engineering"], say: "run a test in an isolated sandbox an owner proved" },
});

export const OPERATION_NAMES = Object.freeze(Object.keys(OPERATION_KINDS));

export const effectOf = (kind) => OPERATION_KINDS[kind]?.effect ?? null;

export const READ_KINDS = Object.freeze(OPERATION_NAMES.filter((k) => OPERATION_KINDS[k].effect === "read"));
