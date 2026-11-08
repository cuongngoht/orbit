// THE LEGS a goal case is held to (0.5.0): a workflow case's code, QA and path (ADR 0053), a mission case's code,
// criteria and privilege (ADR 0055). A leg is the record rows that name it -- and the code leg is also the verifier's own
// verdict on what the round left: every hidden check, gate and own test, inside its scope, one engineering task. A kind
// with no legs is judged as a whole, and its rounds say none.
//
//   legsOf(c, round) -> { <leg>: held } | null        failedLegs(legs) -> [leg], in the kind's own order
import { MISSION_LEGS, WORKFLOW_LEGS } from "./suites.mjs";

export const LEGS = { workflow: WORKFLOW_LEGS, mission: MISSION_LEGS };

const codeHeld = (r) => r.v.complete && r.v.failures.length === 0 && r.cand.scope.length === 0 && r.extraTasks === 0;

const rowsHeld = (r, leg) => (r.records ?? []).filter((x) => x.leg === leg).every((x) => x.ok);

export const legsOf = (c, r) => (LEGS[c.kind] ? Object.fromEntries(LEGS[c.kind].map((leg) => [leg, rowsHeld(r, leg) && (leg !== "code" || codeHeld(r))])) : null);

export const failedLegs = (legs) => (legs ? Object.keys(legs).filter((leg) => legs[leg] === false) : []);
