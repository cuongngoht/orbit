// The words of the SKILL FACTORY: an instruction-only PLAYBOOK a coordinated workflow may generate for the
// CURRENT project when nothing here provides the workflow its objective needs -- held to the same contract a
// shipped SKILL.md is held to, registered in the project's own room of the machine store, never in a
// repository and never in the plugin, offered to the resolver only while active, and pinned by every task
// that uses it.
//
// A generated playbook is never a host's native skill: hosts read skills from the plugin's own tree, which
// is immutable product code. A playbook is printed (`skill-factory show`) and followed by the host inside a
// coordinated workflow.

export const DIR = "generated-skills";

export const MANIFEST = "manifest.json";

export const SKILL_FILE = "SKILL.md";

export const SIDECAR = ".registered.json";

export const MANIFEST_SCHEMA = 2;

// The stored lifecycle, in the words an extension's already uses. `loadable` is offered to the resolver
// (only `active`); `pinnable` may still be served to a task that pinned it.
export const STATUSES = [
  { id: "draft", offered: false, pinnable: false, say: "generated, not held to the contract yet" },
  { id: "verified", offered: false, pinnable: true, say: "held to the contract, waiting to be activated" },
  { id: "active", offered: true, pinnable: true, say: "offered to the resolver for this project" },
  { id: "disabled", offered: false, pinnable: true, say: "a person switched it off" },
  { id: "retired", offered: false, pinnable: true, say: "kept for the tasks that pinned it, offered to nobody" },
  { id: "broken", offered: false, pinnable: false, say: "its files no longer verify" },
];

export const STATUS_IDS = STATUSES.map((s) => s.id);

export const statusRow = (id) => STATUSES.find((s) => s.id === id) ?? null;

// What a person may move a registered playbook to, and from where. Activating needs the files to be what was
// verified; nothing goes back to draft.
export const MOVES = {
  active: ["verified", "disabled", "retired"],
  disabled: ["verified", "active"],
  retired: ["verified", "active", "disabled"],
};

// Which scopes a playbook may have, narrowest first: a task's own, or the project's.
export const SCOPES = ["task", "project"];

export const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;

export const LIMITS = { skillBytes: 32 * 1024, references: 8, totalBytes: 64 * 1024 };

// The tools any playbook may name without borrowing them from a shipped workflow: reading.
export const READ_TOOLS = ["Read", "Grep", "Glob"];

// The one workflow a playbook is drafted under: the coordinator that drafts it. Its tools are the widest a
// playbook may name; a draft never chooses another shipped skill's.
export const DRAFTED_UNDER = "orbit-help";

// The PHASE a playbook is shown in (1.8.6): a reading of what is stored -- its registry row, whether its files
// are still what was verified, its draft and the attempts held against it -- never a word stored beside them.
// Ordered, the first row that holds decides, the last always does. `r`: a registry row with `intact`, or a
// draft as `{ draft: true, written, attempts, findings }`.
//
//   DRAFT              scaffolded for a workflow gap; the host has not written its text yet
//   VALIDATING         written, and waiting to be held to the contract by the workflow's register step
//   FAILED             held to the contract and refused (its findings say why), or its files no longer verify
//   APPROVAL_REQUIRED  verified and registered, offered to nobody until a person activates it in Orbit Control
//   ACTIVE             offered to the resolver for this project
//   ROLLED_BACK        active, and its files are an earlier version a person restored
//   DISABLED · RETIRED a person's move; kept for the tasks that pinned it
//   QUARANTINED        its files changed after they were verified: listed, never offered
//   ARCHIVED           moved out of the way by a person; still read by pin
export const PHASES = [
  { id: "ARCHIVED", when: (r) => r.archived === true, say: "archived by a person; a task that pinned it still reads it" },
  { id: "QUARANTINED", when: (r) => !r.draft && r.intact === false, say: "its files changed after they were verified — never offered until it is registered again" },
  { id: "FAILED", when: (r) => r.status === "broken" || (r.draft === true && (r.findings?.length ?? 0) > 0), say: "held to the contract and refused — its findings say why" },
  { id: "VALIDATING", when: (r) => r.draft === true && r.written === true, say: "written, and waiting to be held to the contract" },
  { id: "DRAFT", when: (r) => r.draft === true, say: "scaffolded for a workflow gap; its text is not written yet" },
  { id: "APPROVAL_REQUIRED", when: (r) => r.status === "verified", say: "verified, offered to nobody until a person activates it in Orbit Control" },
  { id: "ROLLED_BACK", when: (r) => r.status === "active" && Boolean(r.rolledBackTo), say: "active, restored from an earlier version by a person" },
  { id: "ACTIVE", when: (r) => r.status === "active", say: "offered to the resolver for this project" },
  { id: "DISABLED", when: (r) => r.status === "disabled", say: "a person switched it off" },
  { id: "RETIRED", when: () => true, say: "kept for the tasks that pinned it, offered to nobody" },
];

export const PHASE_IDS = PHASES.map((p) => p.id);

export const phaseOf = (r) => PHASES.find((p) => p.when(r)).id;
