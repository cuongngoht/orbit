// A PERSON's decisions about one task: pause, resume, cancel, and Approve once or Reject one
// action it asked for. Each is the button a person pressed, relayed as `--human` with the revision
// the page read, through the SAME command table cli/task.mjs runs -- so the rules that judge it
// (src/task/ops.mjs: a stale revision, a decided approval, an ended task) are one set, and a
// decision on a task that moved is refused (409), never retried against what is there now.
//
// A body is a choice among named fields and never a way to say something new: no field names a
// project, a checkout, a command or an action. Pausing stops no process; cancelling stops none;
// approving grants that one action, once, and nothing else.
import { TASK_COMMANDS } from "../core.mjs";
import { guarded, invalid } from "../errors.mjs";
import { fieldsOf } from "../project-runtime/body.mjs";
import { readTask } from "./read.mjs";
import { approvalIdOf, taskIdOf, tasksOf } from "./project.mjs";

const CODE = "TASK_BODY_INVALID";

const BODIES = {
  pause: { human: "boolean", expectedRevision: "revision", because: "text" },
  resume: { human: "boolean", expectedRevision: "revision", because: "text" },
  cancel: { human: "boolean", expectedRevision: "revision", because: "text" },
  approve: { human: "boolean", expectedRevision: "revision" },
  reject: { human: "boolean", expectedRevision: "revision", reason: "text" },
};

// What the page must send before anything is asked of the task: a person, and what they read.
function decisionOf(name, body) {
  const given = fieldsOf(body, BODIES[name], CODE);
  if (given.human !== true) throw invalid("HUMAN_REQUIRED", `${name} is a person's decision — send { human: true } from the button a person pressed`);
  if (given.expectedRevision === undefined) throw invalid(CODE, "send expectedRevision: the revision of the task the page showed when the person decided");
  return given;
}

const words = (given) => [...(given.because ? [`--because=${given.because}`] : []), ...(given.reason ? [`--reason=${given.reason}`] : [])];

const argsOf = (positional, given) => [...positional, "--human", `--expect=${given.expectedRevision}`, ...words(given)];

// The task as it now stands, read again after the decision was written.
const decided = (name, positional) => async (ctx, ids, body) => {
  const given = decisionOf(name, body);
  await guarded("TASK_OPERATION_FAILED", () => TASK_COMMANDS[name].run(tasksOf(ctx, ids), argsOf(positional(ids), given)));
  return readTask(ctx, ids);
};

const onTask = (ids) => [taskIdOf(ids[2])];

const onApproval = (ids) => [taskIdOf(ids[2]), approvalIdOf(ids[3])];

export const pauseTask = decided("pause", onTask);
export const resumeTask = decided("resume", onTask);
export const cancelTask = decided("cancel", onTask);
export const approveAction = decided("approve", onApproval);
export const rejectAction = decided("reject", onApproval);
