// EXPORT: what a person needs from a campaign, copied out of the evaluator's home for committing under
// evaluator/results/ -- the frozen campaign, the journal, the report, and per run its manifest, summary, outcome,
// patch, grader report and entry record. A stream is copied only when it is at most 1 MB; a larger one is kept as its
// digest and size. The copy is scanned for the credential again, and a file that holds it is not kept.
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { credentialValues, scrubbedRoom } from "../core/credential.mjs";
import { ensureDir, evalHome, sha256, writeJson } from "../core/util.mjs";
import { CREDENTIAL_NAMES } from "../arms/claude.mjs";
import { roomOf } from "./campaign.mjs";
import { writtenReport } from "./report.mjs";

export const STREAM_MAX = 1024 * 1024;

const TOP = ["campaign.json", "journal.jsonl", "report.json", "REPORT.md"];

const PER_RUN = ["manifest.json", "summary.json", "outcome.json", "patch.diff", "grade-report.json", "egress.log", "out/entry.json", "out/egress.json"];

const copied = (from, to) => (existsSync(from) ? (ensureDir(join(to, "..")), copyFileSync(from, to), true) : false);

function exportedRun(src, dest) {
  for (const rel of PER_RUN) copied(join(src, rel), join(dest, rel));
  const stream = join(src, "stream.jsonl");
  if (!existsSync(stream)) return;
  if (statSync(stream).size <= STREAM_MAX) return void copied(stream, join(dest, "stream.jsonl"));
  writeJson(join(dest, "stream.digest.json"), { sha256: sha256(readFileSync(stream)), bytes: statSync(stream).size, kept: false, why: `larger than ${STREAM_MAX} bytes` });
}

const dirs = (p) => (existsSync(p) ? readdirSync(p).filter((n) => statSync(join(p, n)).isDirectory()) : []);

export function exportCampaign(id, to, o = {}) {
  const room = roomOf(o.home ?? evalHome(), id);
  writtenReport(room);
  const dest = ensureDir(join(to, id));
  for (const f of TOP) copied(join(room, f), join(dest, f));
  for (const run of dirs(join(room, "runs"))) for (const a of dirs(join(room, "runs", run))) exportedRun(join(room, "runs", run, a), join(dest, "runs", run, a));
  const leak = scrubbedRoom(dest, credentialValues(CREDENTIAL_NAMES));
  return { dest, leaked: leak.leaked };
}
