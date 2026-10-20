// What a plan is checked and reported AGAINST, resolved once.
//
// Everything a rule, the coverage model or the impact view may ask for arrives
// here as data: the cases on disk, the map, what this project can verify, the
// ledger, the build and the environment. Nothing below reaches for a file or an
// environment variable on its own, so the whole of src/qa/ is testable with a
// plain object -- which is what every test in test/qa-*.test.mjs passes it.
//
// A linked case is validated with the project's EFFECTIVE vocabulary and
// validators -- what run-case would hold it to -- so a case using a verb or a
// rule the project registered is not read as unvalidated, and one its own rules
// refuse is not read as valid. `digestOf` answers what the case as written
// hashes to today, which is what a run's `case_digest` is compared with.
//
// `drafts: true` is for a DRAFT plan: it links the draft cases an agent wrote
// beside it, and those join its world (labelled `_draft`, and never over a case
// of the same id in the checkout). A committed plan never sees a draft case --
// an agent-authored case must not verify the team's plan by being linked to it.
import { caseDigest, loadCases, validate } from "../dsl/index.mjs";
import { draftPaths } from "../draft/store.mjs";
import { capabilitiesOf } from "./capability.mjs";

export function planWorld(ctx, opts = {}) {
  const cases = new Map([...(opts.drafts ? draftCases(ctx) : []), ...loadCases(ctx.project.screensDir)].map((c) => [c.id, c]));
  const base = { cases, dir: ctx.project.screensDir, graph: ctx.graph, caps: capabilitiesOf(ctx.config), runs: ctx.memory.runs(), head: ctx.frontend.commit(), env: ctx.config.launch?.env ?? null, digestOf: (id) => (cases.has(id) ? caseDigest(cases.get(id)) : null) };
  return { ...base, validate: (c) => validate(c, ctx.graph, ctx.dsl, ctx.validators), ...opts };
}

function draftCases(ctx) {
  try { return loadCases(draftPaths(ctx.store(false)).cases).map((c) => ({ ...c, _draft: true })); }
  catch { return []; }
}
