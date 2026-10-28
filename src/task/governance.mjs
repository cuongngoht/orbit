// What each task command is, what it touches, and who must ask for it -- one table that a
// person, a host's permission prompt, Orbit Control, a test and the documentation all read.
//
//   TASK_READ     reads task journals. Writes, probes and runs nothing
//   TASK_RECORD   appends what an execution did to that task's own journal, in the project's
//                 machine store. It RECORDS an action; it never performs one
//   TASK_STOP     a person's decision that STOPS work -- pause, cancel, reject an approval -- on
//                 the revision they read: refused without --human, refused on a moved task. From a
//                 terminal too, because stopping work escalates nothing
//   TASK_GRANT    a person's decision that ALLOWS something -- approve once, resume after a pause.
//                 Written only through Orbit Control, whose page proves a person with its mutation
//                 token (`approval: "control"`); a terminal cannot prove who typed a command, so an
//                 agent could otherwise relay its own --human and approve its own action
//
// `mutates` says where: nothing, or the machine store -- never a repository, a process or the
// machine. Named so a test can hold the line, and owned by NO task command: running a command,
// stopping a process, writing a repository, deploying. Cancelling a task stops nothing; what a
// task started is the runtime's to stop, under the runtime's own ownership rules.
export const OPERATIONS = [
  { class: "TASK_READ", commands: ["show", "events", "list", "machine", "where"], mutates: "none", approval: "none", says: "reads task journals; writes, probes and runs nothing" },
  { class: "TASK_RECORD", commands: ["create", "stage", "attempt", "decide", "act", "link", "request-approval", "approval", "block", "unblock", "complete", "fail"], mutates: "store", approval: "none", says: "appends what an execution did to its own journal in the project's machine store; records an action and never performs one" },
  { class: "TASK_STOP", commands: ["pause", "cancel", "reject"], mutates: "store", approval: "human", says: "a person's decision that stops work on one task, made on the revision they read; stops no process" },
  { class: "TASK_GRANT", commands: ["approve", "resume"], mutates: "store", approval: "control", says: "a person's decision that allows something -- one action, once, or work again after a pause -- made in Orbit Control on the revision they read; never from a terminal, and never more than the one action it approves" },
];

// A task RECORDS what happened; the protected boundaries (src/protected/) are crossed by an owner's action, never by a
// task command -- a task only keeps the approval a person gave for exactly that action, and spends it once.
export const NOT_TASK = ["RUN_COMMAND", "STOP_PROCESS", "REPOSITORY_WRITE", "DEPLOY"];

export const classOf = (command) => OPERATIONS.find((o) => o.commands.includes(command)) ?? null;

export const governed = () => OPERATIONS.flatMap((o) => o.commands.map((command) => ({ command, class: o.class, mutates: o.mutates, approval: o.approval })));
