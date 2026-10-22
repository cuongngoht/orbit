// Where conformance RECEIPTS are read from (ADR 0035): the ones this plugin's own reference adapters
// earned on real systems (docs/backend-acceptance.json, written only by a kit's `--record` from a
// real run) and the ones a project's own adapters earned (<store>/adapters/receipts/*.json). Read,
// never created; a file that is not a schema-1 receipts file is skipped and said, never half read.
import { join } from "node:path";
import { sha } from "../hash.mjs";

export const RECEIPTS_SCHEMA = 1;

export const receiptFiles = (pluginRoot, storeRoot, io) => [join(pluginRoot, "docs", "backend-acceptance.json"), ...storeFiles(join(storeRoot ?? "/nonexistent", "adapters", "receipts"), io)];

const storeFiles = (dir, io) => (io.exists(dir) ? io.list(dir).filter((n) => n.endsWith(".json")).sort().map((n) => join(dir, n)) : []);

export function readReceipts(files, io) {
  return files.flatMap((file) => receiptsIn(io.read(file)));
}

function receiptsIn(text) {
  try { return text ? (JSON.parse(text)?.schema === RECEIPTS_SCHEMA ? JSON.parse(text).receipts ?? [] : []) : []; }
  catch { return []; }
}

// The digest of a helper's own CODE: every file under its directory, by path and content, in a
// stable order. A receipt names the code that ran; one whose helper moved since counts for nothing.
export function codeDigestOf(dir, io) {
  const files = filesUnder(dir, "", io).sort();
  return sha(files.map((f) => `${f}:${sha(io.read(join(dir, f)) ?? "")}`).join("\n"));
}

const filesUnder = (dir, rel, io) => io.list(join(dir, rel)).flatMap((name) => entryOf(dir, rel ? `${rel}/${name}` : name, io));

const entryOf = (dir, rel, io) => (io.kind?.(join(dir, rel)) === "dir" ? filesUnder(dir, rel, io) : [rel]);
