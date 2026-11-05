// THE SEED of an activation run (0.5.0, B22 M4): what the runner's store holds before the host's round -- a seated project
// and its test data, a ledger with a failed run in it, a workflow left where a person stopped it -- laid in by a SCRIPTED
// host that runs the run's own Orbit commands, with no network and no model, and the case's seed files copied where Orbit
// itself says they belong (`query storage`). Whichever arm the host is on, the seed is the same, and made by the same
// Orbit. What it left -- the values its steps kept, the test data's digests and what each case's steps say -- is what a
// truth's records compare the round against: a workflow moved past where the seed left it, a map nobody changed.
//
//   seededRan(ctx) -> { ran, seed }      seedState(doc) -> { state, why }      seedBriefOf(ctx) -> the seed round's brief
//   SEED_DEFAULT
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fresh, jsonAt, offlineRan, runnerSpecOf } from "../core/runner.mjs";
import { briefWritten, PLUGIN_AT, REPO_AT } from "./round.mjs";

// ---- the seed -----------------------------------------------------------------------------------------------------------

// What a seed of files alone does: seat the project, then lay its test data and its store files where Orbit keeps them.
export const SEED_DEFAULT = [{ do: "orbit", argv: ["init.mjs", REPO_AT] }, { do: "copy", from: "ui-tests", to: "data", optional: true }, { do: "copy", from: "store", to: "store", optional: true }];

const seedSteps = (ctx) => (ctx.case.seed?.script ? JSON.parse(readFileSync(join(ctx.frozenCase, ctx.case.seed.script), "utf8")).steps : SEED_DEFAULT);

export const seedBriefOf = (ctx) => ({ kind: "activation", round: 0, host: "scripted:seed", plugin: PLUGIN_AT, script: { id: "seed", mode: "seed", steps: seedSteps(ctx) }, prompt: "" });

const seedFiles = (ctx) => (ctx.case.seed?.files ? [{ source: join(ctx.frozenCase, ctx.case.seed.files), target: "/run/seed", readOnly: true }] : []);

const seedMounts = (ctx, d) => [{ source: ctx.worktreeDir, target: REPO_AT, readOnly: true }, { source: ctx.inspectorDir, target: PLUGIN_AT, readOnly: true }, { source: ctx.runnerStore, target: "/work/store", readOnly: false }, { source: d.out, target: "/work/out", readOnly: false }, { source: d.brief, target: "/run/brief", readOnly: true }, ...seedFiles(ctx)];

const SEED_MS = 15 * 60000;

export async function seededRan(ctx) {
  const d = { brief: briefWritten(ctx, ["seed", "brief"], seedBriefOf(ctx)), out: fresh(ctx, "seed", "out") };
  const r = await offlineRan(ctx, 0, runnerSpecOf(ctx, null, 0, seedMounts(ctx, d), {}, PLUGIN_AT), { deadlineMs: SEED_MS, out: d.out });
  return { ran: { exit: r.container?.exit ?? null, timedOut: r.container?.timedOut === true, refused: r.container?.refused ?? null, host: r.host ?? null }, seed: jsonAt(join(d.out, "seed.json")) };
}

// What a seed round came to: SEEDED when every step held and its record was written; FAILED, with why, otherwise.
export const seedState = (r) => (r.ran.refused ? { state: "BLOCKED", why: r.ran.refused } : r.seed && !(r.seed.problems ?? []).length ? { state: "SEEDED", why: null } : { state: "FAILED", why: (r.seed?.problems ?? []).join("; ") || `the seed round ended ${r.ran.timedOut ? "at its deadline" : `with ${r.ran.exit}`} and kept nothing` });
