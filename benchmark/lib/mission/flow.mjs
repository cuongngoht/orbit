// THE FLOW of one MISSION benchmark run (0.5.0, backlog B4, ADR 0055): a goal taken through Orbit Satellite over a
// fixture, carried exactly as an engineering case's goal is (lib/source/flow.mjs) -- its phases are that kind's own, read
// off the task's journal the same way, so a run interrupted anywhere is carried on from there and a host's round is never
// sent again:
//
//   baseline    attempt 1 (`fresh`), stage TESTING: the target verified twice -- it must fail the hidden checks, the
//               change the goal asks for not made yet
//   round k     attempt k+1 (`fix`): FIXING the runner -- the host takes the goal through `satellite mission`, launches
//               each unit's run as the agent its envelope names, and the mission's implement unit starts the engineering
//               task that makes the change -- REVIEWING the inspection (that task, its workspace, every mission, the
//               trail's agent events and every task an evidence row names, `inspect.mjs --mission`) and the candidate's
//               scope, TESTING and REGRESSION its verification; then the NEXT table
//   ending      PASS only when the verifier holds the change AND every record row of the three legs holds
//               (lib/mission/judge.mjs): the code, the criteria, the privilege
//
// What a mission case adds to an engineering case is in three places, each a row or a word, never a branch on a case:
// the round's prompt (lib/source/brief.mjs `missionPromptOf`), the inspection's read of the missions, and the record rows
// by leg.
//
//   carriedMission(ctx) -> { outcome, exit, summary }
import { carried } from "../source/flow.mjs";

export const carriedMission = (ctx) => carried(ctx);
