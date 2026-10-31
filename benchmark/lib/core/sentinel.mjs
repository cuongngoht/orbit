// THE SENTINEL: after a run, the run's own room is read for the credential it handed the runner, in every spelling the
// engine's own masking knows (as typed, in base64, percent-encoded). A file that holds it is rewritten with the value
// masked, or removed when it cannot be rewritten, and is named. The runner's host can read its own environment, and an
// agent can write what it read anywhere it may write: what the developer's machine keeps of a run never holds it.
// Links are never followed and only regular files are read; the subject checkout and the frozen case, which the
// controller made from the developer's own files, are not this sentinel's to rewrite.
//
//   leaksMasked(dir, values) -> [{ rel, done: "masked" | "removed" }]
import { lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { maskValues } from "../../../src/scrub.mjs";
import { treeFiles } from "../../../src/store/tree.mjs";

export const MAX_FILE = 16 * 1024 * 1024;

const NOT_SCANNED = ["checkout", "frozen"];

const readable = (path) => ((st) => st.isFile() && st.size <= MAX_FILE)(lstatSync(path));

// Bytes as latin1 text: one character per byte, so a file that is not text is written back exactly as it was read,
// but for the value.
const textAt = (path) => (readable(path) ? readFileSync(path, "latin1") : "");

function rewritten(path, text, values) {
  try { return (writeFileSync(path, maskValues(text, values), "latin1"), "masked"); }
  catch { return (rmSync(path, { force: true }), "removed"); }
}

const leakAt = (dir, rel, values) => ((text) => (maskValues(text, values) === text ? null : { rel, done: rewritten(join(dir, rel), text, values) }))(textAt(join(dir, rel)));

export function leaksMasked(dir, values) {
  const kept = values.filter((v) => typeof v === "string" && v.length >= 8);
  if (!kept.length) return [];
  return treeFiles(dir, NOT_SCANNED.map((d) => join(dir, d))).map((rel) => leakAt(dir, rel, kept)).filter(Boolean);
}
