// What each automation command and each step kind TOUCHES, and who must allow it -- one table a person, a
// host's permission prompt, a test and the documentation all read.
//
//   AUTOMATION_READ    reads the workflow, its plan, its settings and its child; writes nothing
//   TASK_RECORD        writes the coordinator's own journal through the task's one door, and its plan
//                      artifacts beside it in the store
//   OWNER_DELEGATION   asks an owner -- requirements, project context, runtime understanding, the skill
//                      factory -- through its own memory-first door; what is written is that owner's own
//   CHILD_TASK         starts or picks up the engineering task a step hands on, through autonomous
//                      engineering's own command; that task's own governance applies to everything it does
//   HOST_DISPATCH      a step the HOST runs -- a skill, an agent, a project playbook. The engine runs
//                      nothing; the host's own permissions govern what the skill does
//   APPROVAL_REQUEST   asks a person; never decides
//
// Named so a test can hold the line, and owned by NO command or step: calling a model, running a shell
// line, writing the primary checkout, writing a child task's journal, granting a person's approval,
// pushing, merging, deploying.
export const OPERATIONS = [
  { class: "AUTOMATION_READ", commands: ["context", "resume", "plan", "status", "doctor", "protocol", "where"], steps: ["regression", "review"], mutates: "none", approval: "none", says: "reads the workflow, its plan, its settings and its child's journal; writes, runs and probes nothing" },
  { class: "TASK_RECORD", commands: ["start", "settle", "reconcile", "finish"], steps: [], mutates: "store", approval: "none", says: "records what the workflow did in its own journal, through the task's one write door; a plan is kept beside it" },
  { class: "OWNER_DELEGATION", commands: [], steps: ["requirement", "context", "runtime", "register-skill"], mutates: "store", approval: "none", says: "asks an owner through its own memory-first door; what is written is that owner's own memory or room" },
  { class: "CHILD_TASK", commands: [], steps: ["engineering"], mutates: "store", approval: "none", says: "starts or picks up the engineering task through autonomous engineering's own start; that task's governance applies to all it does" },
  { class: "HOST_DISPATCH", commands: ["step"], steps: ["qa", "propose-skill", "playbook"], mutates: "none", approval: "none", says: "tells the host which skill, agent or project playbook runs the step; the engine runs nothing itself" },
  { class: "APPROVAL_REQUEST", commands: [], steps: [], mutates: "store", approval: "none", says: "asks a person to allow one step, once; never decides" },
];

export const NOT_AUTOMATION = ["MODEL_CALL", "ARBITRARY_SHELL", "PRIMARY_CHECKOUT_WRITE", "CHILD_JOURNAL_WRITE", "HUMAN_APPROVAL_GRANT", "SETTINGS_WRITE", "PUSH", "MERGE", "DEPLOY"];

export const classOfCommand = (name) => OPERATIONS.find((o) => o.commands.includes(name)) ?? null;

export const classOfStep = (kind) => OPERATIONS.find((o) => o.steps.includes(kind)) ?? null;

export const governed = () => OPERATIONS.flatMap((o) => [...o.commands.map((c) => ({ command: c, class: o.class, mutates: o.mutates })), ...o.steps.map((s) => ({ step: s, class: o.class, mutates: o.mutates }))]);
