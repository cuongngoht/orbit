// WHERE a project's reports keep what they need: one room of this project's
// machine store, beside the lessons and the architecture facts, and outside
// every repository.
//
//   <storeRoot>/project-report/
//     settings.json              the project's report settings (schema-stamped)
//     runs/<runId>/
//       snapshot/snapshot.json   the collection, frozen: written ONCE
//       snapshot/raw/<n>.json    the source's pages exactly as received
//       stage/<extension>/       the store parts this run executed, copied and hashed
//       renders/<n>/             each render: part outputs, logs, the HTML
//       run.json                 what ran, at which versions, and what it produced
//
// A run id sorts by time and never repeats, so two reports on one day are two
// runs, and a re-render is a new render of the SAME snapshot -- never a second
// collection, and never an overwrite.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";

export const DIR = "project-report";
export const RUN_ID = /^\d{8}T\d{6}Z-[a-f0-9]{4}$/;

export function reportRoom(storeRoot) {
  const root = join(storeRoot, DIR);
  const at = (...parts) => contained(root, join(root, ...parts));
  const run = (id) => at("runs", checkedId(id));
  return { root, settings: at("settings.json"), runs: at("runs"), run, runFile: (id) => join(run(id), "run.json"), snapshot: (id) => join(run(id), "snapshot"), stage: (id) => join(run(id), "stage"), render: (id, n) => join(run(id), "renders", String(n)) };
}

function checkedId(id) {
  if (!RUN_ID.test(String(id))) throw new Refused(`${id} is not a report run id (e.g. 20260925T101502Z-a1b2)`);
  return id;
}

// Sortable by time, unique by four hex digits of the caller's entropy.
export function newRunId(nowMs, entropy) {
  const stamp = new Date(nowMs).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${String(entropy).padStart(4, "0").slice(-4)}`;
}

// The runs on record, newest first. Reading never creates.
export const runIds = (room, io) => io.list(room.runs).filter((n) => RUN_ID.test(n)).sort().reverse();
