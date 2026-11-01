// THE FAST TIER a pipeline can hold (`ship.mjs --ci`): the definition of done, the rows a release only reports, and the
// autonomous ship AWAITED -- never run in a pipeline and never passed, because only a machine with Docker and a
// credential (or the release workflow) makes it. A green fast tier is never release qualification, and says so.
//
//   AWAITED · markOf(row) -> "ok  " | "FAIL" | "wait" | "opt "      ciVerdict(rows) -> sentence
import { shippable } from "../gates.mjs";

export const AWAITED = Object.freeze({ name: "the autonomous ship: every case in Docker, model-carried rows by Claude Code", ok: true, pending: true, detail: "not run in a pipeline -- node skills/orbit-release/ship.mjs on a machine with Docker and a credential, or the release workflow, qualifies a release; a green fast CI never does" });

export const markOf = (r) => (r.pending ? "wait" : r.required === false && !r.ok ? "opt " : r.ok ? "ok  " : "FAIL");

export const ciVerdict = (rows) => (shippable(rows) ? "every gate a pipeline can hold held; release qualification is awaited -- ship.mjs without --ci, with Docker and a credential, is what qualifies a release." : "NOT shippable — fix the FAIL above; nothing is tagged.");
