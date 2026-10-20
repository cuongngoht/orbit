// What each orchestration command and each action a step may take TOUCHES, and who must allow it --
// one table that a person, a host's permission prompt, a test and the documentation all read.
//
//   ORCHESTRATION_READ   reads the task, the requirement or an investigation; writes nothing
//   TASK_RECORD          writes the task's own journal through the task's one door (and, for `start`,
//                        the work's first adoption of a snapshot through the work's)
//   OWNER_DELEGATION     asks an owner -- project context, runtime understanding -- through its own
//                        memory-first command; what it writes is that owner's memory, never a repository
//   WORKSPACE_WRITE      the task's OWN workspace: making it, the change the host makes in it, its own
//                        index read back, and removing it on request -- never the primary checkout
//   PROJECT_CHECK        one build or test command the checkout DECLARED, argv only, in the workspace
//   RUNTIME_DELEGATION   runtime's start and stop, behind runtime's own gates and ownership rules
//   SANDBOX_DELEGATION   runtime's sandbox of THIS task: prepare it, start the changed code in it. It
//                        is the task's own environment on this machine, behind runtime's own trust,
//                        isolation and ownership rules; releasing it is cleanup's
//   CAPABILITY_INVOKE    a project capability through the capability pipeline; one that declares it
//                        changes state outside the workspace only with a person's grant, once
//   APPROVAL_REQUEST     asks a person; never decides
//
// `step` is not a row: it takes exactly one action, and the action is. Named so a test can hold the
// line, and owned by NO command or action: writing the primary checkout, pushing, merging, deploying,
// writing production, running a shell line, granting a person's approval.
export const OPERATIONS = [
  { class: "ORCHESTRATION_READ", commands: ["context", "resume", "log", "protocol", "where"], actions: ["check-requirement", "link-investigation"], ops: [], mutates: "none", approval: "none", says: "reads the task, its requirement and the investigations it links; writes, runs and probes nothing" },
  { class: "TASK_RECORD", commands: ["start", "finish", "reconcile"], actions: ["plan", "diagnose"], ops: [], mutates: "store", approval: "none", says: "records what the execution did in the task's own journal, through the task's one write door; a plan's scope and a check's log are kept beside it in the store" },
  { class: "OWNER_DELEGATION", commands: [], actions: ["gather-context", "check-environment"], ops: [], mutates: "store", approval: "none", says: "asks project context or runtime understanding through its own memory-first command; what is written is that owner's own memory" },
  { class: "WORKSPACE_WRITE", commands: ["remove-workspace"], actions: ["prepare-workspace", "implement", "record-changes", "review"], ops: [], mutates: "workspace", approval: "none", says: "the task's own isolated workspace, and nothing outside it: never the primary checkout" },
  { class: "PROJECT_CHECK", commands: [], actions: ["check"], ops: [], mutates: "workspace", approval: "none", says: "one build or test command the checkout declared, chosen by id, run argv-only in the workspace with a deadline" },
  { class: "RUNTIME_DELEGATION", commands: ["cleanup"], actions: ["start-runtime"], ops: [], mutates: "machine", approval: "none", says: "runtime's own start and stop; stop reaches only the sessions this task started, and only what runtime proves its own -- and, once the task ended, its sandbox's sessions and the sandbox itself" },
  { class: "SANDBOX_DELEGATION", commands: [], actions: ["prepare-sandbox", "start-sandbox"], ops: [], mutates: "machine", approval: "none", says: "the task's own sandbox through runtime's own gates: prepared at the workspace's tree, the application started from the changed code; it never reaches the developer's checkout, and what needs a person's trust is blocked until Control grants it" },
  { class: "CAPABILITY_INVOKE", commands: [], actions: ["invoke"], ops: [], mutates: "external", approval: "control", says: "a project capability through the one capability pipeline; one that changes state outside the workspace runs only on a person's grant, once" },
  { class: "APPROVAL_REQUEST", commands: [], actions: [], ops: ["request-approval"], mutates: "store", approval: "none", says: "asks a person to allow one action, once; never decides" },
];

export const NOT_ORCHESTRATION = ["PRIMARY_CHECKOUT_WRITE", "PUSH", "MERGE", "DEPLOY", "PRODUCTION_WRITE", "ARBITRARY_SHELL", "HUMAN_APPROVAL_GRANT"];

// The one command that is the surface of every action.
export const DISPATCHER = "step";

export const classOfCommand = (name) => OPERATIONS.find((o) => o.commands.includes(name)) ?? null;

export const classOfAction = (kind) => OPERATIONS.find((o) => o.actions.includes(kind)) ?? null;

export const governed = () => OPERATIONS.flatMap((o) => [...o.commands.map((c) => ({ command: c, class: o.class, mutates: o.mutates, approval: o.approval })), ...o.actions.map((a) => ({ action: a, class: o.class, mutates: o.mutates, approval: o.approval }))]);
