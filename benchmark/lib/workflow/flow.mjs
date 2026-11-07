// THE FLOW of one WORKFLOW benchmark run (0.5.0, backlog B1, ADR 0053): one request taken through `/orbit-help` over a
// fixture, carried exactly as an engineering case's goal is (lib/source/flow.mjs) -- its phases are that kind's own, read
// off the task's journal the same way, so a run interrupted anywhere is carried on from there and a host's round is never
// sent again:
//
//   baseline    attempt 1 (`fresh`), stage TESTING: the target verified twice -- it must fail the hidden checks, the
//               change the request asks for not made yet
//   round k     attempt k+1 (`fix`): FIXING the runner -- the host takes the request to `/orbit-help` and the coordinated
//               workflow it starts, whose engineering step starts the engineering task -- REVIEWING the inspection (the
//               task, its workspace, and every coordinated workflow read back, `inspect.mjs --workflow`) and the
//               candidate's scope, TESTING and REGRESSION its verification; then the NEXT table
//   ending      PASS only when the verifier holds the change AND every record row of the three legs holds
//               (lib/workflow/judge.mjs): the code, the QA step, the path
//
// What a workflow case adds to an engineering case is in three places, each a row or a word, never a branch on a case:
// the round's prompt (lib/source/brief.mjs `workflowPromptOf`), the inspection's read of the workflows, and the record
// rows by leg. The relayed QA leg on a change's sandbox (ADR 0053, Parts 3 and 4) is not built: a case that asks for it
// is refused when it is loaded (lib/core/suites.mjs WORKFLOW_QA).
//
//   carriedWorkflow(ctx) -> { outcome, exit, summary }
import { carried } from "../source/flow.mjs";

export const carriedWorkflow = (ctx) => carried(ctx);
