// A finished run, read back off disk. run-log.jsonl is the only durable record
// of what happened -- the terminal scrolled away, and the ledger keeps one line
// per run on purpose -- so the report is built from it and from nothing else.
// That also means a report can be made long afterwards, by somebody who was not
// there, which is the whole point of writing evidence down.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { LOG_FILE } from "../run/log.mjs";

export function readRun(dir) {
  const file = join(dir, LOG_FILE);
  if (!existsSync(file)) throw new Error(`no ${LOG_FILE} in ${dir} — point me at one run's evidence directory`);
  return parse(readFileSync(file, "utf8"));
}

// A line lost to a machine going down mid-write costs that line, not the report.
function parse(text) {
  const lines = text.trim().split("\n").filter(Boolean).map(parsed);
  const records = lines.filter(Boolean);
  Object.defineProperty(records, "complete", { value: lines.length === records.length });
  return records;
}
const parsed = (line) => { try { return JSON.parse(line); } catch { return null; } };

// No directory given means "the run I just made".
//
// Sorted on the STAMP, not on the whole name. A directory is `<case>-<stamp>`
// (run/result.mjs), so sorting the names alphabetically only tells the time
// while every run in the room belongs to one case -- and now they all share one
// room, `smoke-2026-01-01` sorted after `archive-thing-2026-09-21` and "the run
// I just made" returned somebody else's from January.
export function latestRun(evidence) {
  const dirs = existsSync(evidence) ? readdirSync(evidence).filter((n) => statSync(join(evidence, n)).isDirectory()) : [];
  if (!dirs.length) throw new Error(`no run under ${evidence} yet — run a case first, or name the directory`);
  return join(evidence, dirs.sort((a, b) => stampOf(a).localeCompare(stampOf(b))).at(-1));
}

// The trailing `YYYY-MM-DD-HH-MM-SS` a run directory always ends in. A name
// without one sorts first: it is not a run this engine made.
const STAMP = /\d{4}(-\d{2}){5}$/;
const stampOf = (name) => STAMP.exec(name)?.[0] ?? "";
