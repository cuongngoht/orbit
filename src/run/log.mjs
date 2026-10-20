// run-log.jsonl: one record per event, buffered until there is somewhere to
// write it (a run may be refused before its evidence dir exists).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contained } from "../project/boundary.mjs";

export const LOG_FILE = "run-log.jsonl";

export function createLog(now = () => new Date().toISOString()) {
  const records = [];
  const record = (o) => records.push({ at: now(), ...o });
  return { records, record, flush: (dir) => flush(dir, records) };
}

function flush(dir, records) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(contained(dir, join(dir, LOG_FILE)), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return join(dir, LOG_FILE);
}
