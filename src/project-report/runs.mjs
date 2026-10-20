// The RECORD of one run: what was collected -- from where, for which window, by
// which collector -- and every render of it: which parts ran at which versions
// and hashes, what each produced, what was left out and why, and where the page
// went. Contract orbit.report.run/v1, one run.json per run, written atomically.
//
// It is what the next run's baseline reads, what Orbit Control lists, and what
// `render` needs to render a snapshot again -- so it holds structure and the
// metric values a baseline compares, and never a credential, a request or a
// response.
import { join } from "node:path";
import { writeAtomic } from "../store/atomic.mjs";
import { withLock } from "../store/lock.mjs";
import { runIds } from "./store.mjs";

export const RUN_CONTRACT = "orbit.report.run/v1";

export function readRun(room, io, id) {
  try { return JSON.parse(io.read(room.runFile(id)) ?? "null"); }
  catch { return null; }
}

export const writeRun = (room, io, record) => writeAtomic(room.runFile(record.runId), `${JSON.stringify({ contract: RUN_CONTRACT, ...record }, null, 2)}\n`, io, false);

// The next render's number: one past the highest on disk, so a render that
// failed half way still owns its number and is never overwritten.
export function nextRender(room, io, id) {
  const taken = io.list(join(room.run(id), "renders")).map(Number).filter(Number.isInteger);
  return taken.length ? Math.max(...taken) + 1 : 1;
}

// A render's line in run.json, added under the run's own lock: two renders of
// one snapshot at once each keep their line.
export function addRender(room, io, id, render) {
  return withLock(room.run(id), () => writeRun(room, io, { ...readRun(room, io, id), renders: [...(readRun(room, io, id)?.renders ?? []).filter((r) => r.n !== render.n), render] }), io);
}

// Every run on record, newest first, as its record; a run whose record cannot
// be read is listed as such rather than dropped.
export const history = (room, io) => runIds(room, io).map((id) => readRun(room, io, id) ?? { runId: id, unreadable: true });

export const latestRender = (record) => [...(record?.renders ?? [])].sort((a, b) => b.n - a.n)[0] ?? null;

// The newest render that got as far as a page, for a baseline to compare against.
export const lastGoodRender = (record) => [...(record?.renders ?? [])].filter((r) => r.status !== "failed" && r.metrics).sort((a, b) => b.n - a.n)[0] ?? null;
