// The families, as a table. Adding one is a row plus a file; no caller anywhere
// spells the five names out.
import { drift } from "./drift.mjs";
import { failures } from "./failures.mjs";
import { notes } from "./notes.mjs";
import { recovery } from "./recovery.mjs";
import { timing } from "./timing.mjs";

export const FAMILIES = { failures, drift, timing, recovery, notes };

export const FAMILY_NAMES = Object.keys(FAMILIES);

export const findingsOf = (evidence, opts = {}) => chosen(opts).flatMap(([name, run]) => tagged(name, run, evidence, opts));

const chosen = (opts) => Object.entries(FAMILIES).filter(([name]) => !opts.family || opts.family === name);

// A family that throws must not take the other four down with it: a store that
// learned nothing because one grouping hit an odd ledger line is worse than one
// that learned four fifths and said which fifth is missing.
function tagged(name, run, evidence, opts) {
  try {
    return run(evidence, opts);
  } catch (e) {
    return [broken(name, e)];
  }
}

const broken = (name, e) => ({ family: name, failed: true, say: `the ${name} family could not read this history — ${e.message}` });
