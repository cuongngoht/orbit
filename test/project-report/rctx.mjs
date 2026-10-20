// A report context over a temporary store, bound the way the CLI binds one --
// the real pack, the real renderer, real io -- for the tests that drive a whole
// run or render. Only the source and the clock are the test's.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KIT_DIR, SHIM, kitVersion, providers, renderAssets, standardParts, standardSections } from "../../skills/orbit-report/pack.mjs";
import { renderReport } from "../../skills/orbit-report/render.mjs";
import { identityOf } from "../../src/project-report/collect.mjs";
import { DEFAULTS } from "../../src/project-report/settings.mjs";
import { freeze } from "../../src/project-report/snapshot.mjs";
import { reportRoom } from "../../src/project-report/store.mjs";
import { writeRun } from "../../src/project-report/runs.mjs";
import { createProcess } from "../../src/process/index.mjs";
import { realIo } from "../../src/store/io.mjs";
import { TZ } from "./snapshots.mjs";

let assets;
export const pack = () => ({ parts: standardParts(), sections: standardSections(), providers: providers(), shim: SHIM, kitDir: KIT_DIR, kitVersion: kitVersion(), render: (input) => renderReport(input, (assets ??= renderAssets())) });

export function tempBase(t) {
  const base = mkdtempSync(join(tmpdir(), "orbit-report-run-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return base;
}

// python: { file, version } or null
export function rctxOf(base, python, over = {}) {
  const room = reportRoom(join(base, "store"));
  const settings = { ...DEFAULTS, provider: "github", timezone: TZ, ...(over.settings ?? {}) };
  return { project: { name: "Portal", key: "repo-test", root: base }, room, io: realIo(), outputIo: realIo(), connection: null, python, extensions: { parts: [], states: {}, contested: [], refused: [] }, pack: pack(), engine: "1.6.0", env: process.env, reportsDir: join(base, "reports"), ...over, settings };
}

// A snapshot frozen into the room as a run would leave it, with its run.json.
export function frozen(rctx, snapshot, runId = snapshot.run.id) {
  const s = { ...snapshot, run: { ...snapshot.run, id: runId }, source: { ...snapshot.source, identity: identityOf(snapshot.source) } };
  freeze({ room: rctx.room, io: rctx.io, id: runId, snapshot: s, raw: [], secrets: [] });
  writeRun(rctx.room, rctx.io, { runId, createdAt: s.run.createdAt, project: s.project, source: s.source, identity: s.source.identity, window: s.window, completeness: {}, collectors: [], renders: [] });
  return runId;
}

export const deps = (over = {}) => ({ process: createProcess(), nowMs: () => Date.parse("2026-09-25T04:00:00Z"), entropy: () => "a1b2", sources: {}, fetch: () => { throw new Error("a render must not reach any source"); }, log: () => {}, ...over });
