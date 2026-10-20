// Run the REAL standard parts over a snapshot, the way a report run does, for
// the tests that check what they compute. One helper, so every test drives the
// shim, the guard and the output checks exactly as production does.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envelopeFor } from "../../src/project-report/envelope.mjs";
import { runPart } from "../../src/project-report/execute.mjs";
import { createProcess } from "../../src/process/index.mjs";
import { realIo } from "../../src/store/io.mjs";
import { SHIM, standardParts } from "../../skills/orbit-report/pack.mjs";

export function workspace(t) {
  const base = mkdtempSync(join(tmpdir(), "orbit-report-kit-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return base;
}

export function written(base, snapshot, name = "snapshot.json") {
  mkdirSync(join(base, "snap"), { recursive: true });
  const file = join(base, "snap", name);
  writeFileSync(file, JSON.stringify(snapshot));
  return file;
}

// part: a standard part id or a whole part row (an extension's, in a test)
export async function ran({ python, base, snapshot, part, inputs = {}, settings = {}, env = process.env, secrets = [], seed = 42, entry = null }) {
  const row = typeof part === "string" ? standardParts().find((p) => p.id === part) : part;
  const dir = join(base, "out", row.id);
  const envelope = envelopeFor({ part: row, entry: entry ?? row.file, runId: snapshot.run.id, window: snapshot.window, calendar: snapshot.calendar, seed, inputs, outputDir: dir, settings });
  return runPart({ part: row, envelope, dir }, { process: createProcess(), python, shim: SHIM, env, io: realIo(), secrets, nowMs: Date.now });
}

// The standard metrics and forecast over one snapshot.
export async function standard(t, python, snapshot, settings = {}) {
  const base = workspace(t);
  const file = written(base, snapshot);
  const metrics = await ran({ python, base, snapshot, part: "orbit.report.metrics", inputs: { snapshot: file }, settings });
  const forecast = metrics.ok ? await ran({ python, base, snapshot, part: "orbit.report.forecast", inputs: { snapshot: file, model: join(base, "out", "orbit.report.metrics", "model.json") }, settings }) : null;
  return { base, file, metrics, forecast, model: metrics.outputs?.model };
}
