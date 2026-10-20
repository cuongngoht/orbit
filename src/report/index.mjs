// One run's evidence -> one HTML file, and the file goes somewhere ELSE.
//
// It used to live beside the evidence it cited, so the directory could be zipped
// and still make sense. That reasoning is now inverted: every picture the report
// shows is embedded in it (src/report/view.mjs), so it cites nothing outside
// itself and has no siblings to travel with. Keeping it next to the screenshots
// would only bury the one artefact a person wants inside the one room the
// engine owns -- and the evidence room is pruned, while a report is not.
//
// So the evidence stays in the store and the report lands in the reports
// directory -- under the screen the case starts on, then the case, named after
// the run -- the same screen folders the cases themselves sit in
// (src/tests-tree.mjs), so a person looks in one place for both.
import { basename, dirname, join } from "node:path";
import { Refused } from "../errors.mjs";
import { writeAtomic } from "../store/atomic.mjs";
import { realIo } from "../store/io.mjs";
import { withLock } from "../store/lock.mjs";
import { exportKey, meta, ready } from "./export.mjs";
import { page } from "./html.mjs";
import { model } from "./model.mjs";
import { readRun } from "./read.mjs";
import { folderOf } from "../tests-tree.mjs";

// `run` is anything that says {case, start, evidence}: a ledger row, or what a
// run's own log says about itself (runOf) -- the two readers must agree on the
// path without either having to open the other.
export const reportFile = (reports, run) => join(reports, folderOf(run), String(run.case), `${basename(run.evidence)}.html`);

export function runOf(records, dir) {
  const opened = records.find((r) => r.kind === "run") ?? {};
  return { case: opened.case ?? basename(dir), start: opened.source?.start ?? null, evidence: dir };
}

export function writeReport(dir, reports, io = realIo(), history = [], lockDir = reports) {
  const records = readRun(dir);
  const file = reportFile(reports, runOf(records, dir));
  const key = exportKey(records, dir);
  io.ensureDir(dirname(file));
  return publishLocked(lockDir, file, records, key, history, io);
}

function publishLocked(lockDir, file, records, key, history, io) {
  io.ensureDir(lockDir);
  return withLock(lockDir, () => published(file, reportHtml(records, { runKey: key, history }), key, io), io);
}

function published(file, html, key, io) {
  if (io.exists(file) && meta(io.read(file), "run-key") !== key) throw new Refused(`report ${file} belongs to another or an older unidentified run — choose a different reports directory`);
  return writeAtomic(file, html, io, false);
}

// Asked of the run's own log, which it reads anyway for the export key: where
// the report should be and what it should say come from the same records.
export function reportReady(reports, dir, io = realIo()) {
  try { return readyFor(reports, dir, readRun(dir), io); }
  catch { return false; }
}

const readyFor = (reports, dir, records, io) => ready(io.read(reportFile(reports, runOf(records, dir))) ?? "", exportKey(records, dir));

// `history` rides in with the publication because it is the same kind of thing:
// something the CALLER knows and run-log.jsonl cannot -- the ledger is the only
// input to this page that is not the log. It stays optional, so a report
// rendered months later from a copied directory still renders, without a band.
export const reportHtml = (records, publication = {}) => page(model(records, publication.history ?? []), publication);
export { latestRun } from "./read.mjs";
