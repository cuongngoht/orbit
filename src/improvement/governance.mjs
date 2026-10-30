// What each `improve` command may change, as a table the usage header and the command table are held to
// (test/improvement-boundary.test.mjs): READ commands write nothing at all, RECORD commands write this project's
// improvement room -- and, only through the owners' own doors, a successor draft, a candidate, an evaluation task and
// which version of a definition runs. What no command here does is the point of NOT_IMPROVE.
export const OPERATIONS = [
  { id: "IMPROVEMENT_READ", commands: ["status", "opportunities", "candidates", "show", "history", "metrics", "doctor", "where"], writes: "nothing" },
  { id: "IMPROVEMENT_RECORD", commands: ["analyse", "start", "step", "resume", "evaluate", "candidate", "link", "reconcile"], writes: "the project's improvement room, and through their owners' doors: a successor draft, a candidate, an evaluation task, which version runs" },
];

// A person's decisions and a person's settings are Orbit Control's: a terminal cannot prove who typed them, and an
// agent must never promote its own candidate or raise its own autonomy. Nothing here installs, pushes, deploys,
// migrates or deletes anything.
export const NOT_IMPROVE = ["promote", "revert", "reject", "settings", "approve", "select", "activate", "revoke", "push", "deploy", "install"];
