// THE FAST TIER (`ship.mjs --ci`): the definition of done, the rows a release only reports, and release qualification
// AWAITED -- never passed here, because what qualifies a release is a record of the independent evaluator (ADR 0057:
// `node evaluator/cli.mjs record`, held-out campaigns run with a model) for this very artifact, read by
// `ship.mjs --evidence --evaluation=<record>`. A green fast tier is never release qualification, and says so.
//
//   AWAITED · markOf(row) -> "ok  " | "FAIL" | "wait" | "opt "      ciVerdict(rows) -> sentence
import { shippable } from "../gates.mjs";

export const AWAITED = Object.freeze({ name: "release qualification: the independent evaluator's record of this artifact", ok: true, pending: true, detail: "not decided by the fast tier -- node evaluator/cli.mjs record (the pre-registered held-out campaigns, run with a model) and then node skills/orbit-release/ship.mjs --evidence --evaluation=<record> qualify a release; a green fast tier never does" });

export const markOf = (r) => (r.pending ? "wait" : r.required === false && !r.ok ? "opt " : r.ok ? "ok  " : "FAIL");

export const ciVerdict = (rows) => (shippable(rows) ? "every gate of the fast tier held; release qualification is awaited -- the evaluator's record of this artifact, read by ship.mjs --evidence --evaluation=<record>, is what qualifies a release." : "NOT shippable — fix the FAIL above; nothing is tagged.");
