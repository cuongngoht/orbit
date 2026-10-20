// Running the composed parts, in order, each ISOLATED: a part that fails is
// recorded as failed with what it said, and every other part runs as though it
// had never existed. What one part hands the next is a PATH -- the model, the
// metrics so far, a transform's derived collection -- never an object in this
// process, so a part can only ever read what was written.
//
// The standard kit is checked before each of its parts: the digest taken when
// this render began must still hold. A plugin updated while a report runs stops
// the kit's remaining parts, saying so, rather than mixing two kits in one page.
import { join } from "node:path";
import { envelopeFor, seedOf } from "./envelope.mjs";
import { runPart } from "./execute.mjs";

// unit: { runId, snapshot, snapshotFile, dir, entryOf, rootsOf, settingsOf, kitChanged }
// deps: { process, python (the interpreter's file), shim, env, io, secrets, nowMs }
export async function computeParts(parts, unit, deps) {
  const state = { model: null, metrics: [], derived: [], results: [], stop: null };
  for (const part of parts) state.results.push(await step(part, unit, deps, state));
  return state;
}

const KIT_MOVED = "the plugin changed while this report ran, so this part and the standard parts after it did not run; render the report again";

async function step(part, unit, deps, state) {
  if (!state.stop && part.source === "builtin" && unit.kitChanged()) state.stop = KIT_MOVED;
  if (state.stop && part.source === "builtin") return { part, outcome: notRun(state.stop) };
  const outcome = await executed(part, unit, deps, state);
  absorb(state, part, outcome, outDir(unit, part));
  return { part, outcome };
}

const notRun = (why) => ({ ok: false, kind: "engine", status: "not-run", error: why, notes: [], missing: [], outputs: {} });

export const outDir = (unit, part) => join(unit.dir, "parts", part.id);

async function executed(part, unit, deps, state) {
  const dir = outDir(unit, part);
  const envelope = envelopeFor({ part, entry: unit.entryOf(part), runId: unit.runId, window: unit.snapshot.window, calendar: unit.snapshot.calendar, seed: seedOf(unit.runId), inputs: inputsOf(unit, state, part), outputDir: dir, settings: unit.settingsOf(part) });
  const outcome = await runPart({ part, envelope, dir }, deps);
  deps.io.write(join(unit.dir, "logs", `${part.id}.log`), outcome.log ?? "");
  return outcome;
}

function inputsOf(unit, state, part) {
  const snapshot = unit.snapshotFile ? { snapshot: unit.snapshotFile } : {};
  return { ...snapshot, ...(state.model ? { model: state.model } : {}), metrics: [...state.metrics], derived: [...state.derived], roots: unit.rootsOf(part) };
}

// What a finished part leaves for the parts after it: the model, its metrics,
// and -- for a transform -- every file it wrote, as a derived collection.
function absorb(state, part, outcome, dir) {
  if (!outcome.ok) return;
  const files = outcome.files ?? {};
  if (files.model) state.model = join(dir, files.model);
  if (files.metrics) state.metrics.push(join(dir, files.metrics));
  if (part.kind === "transform") state.derived.push(...Object.values(files).map((f) => join(dir, f)));
}
