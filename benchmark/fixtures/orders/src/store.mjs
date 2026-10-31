// The durable store: one JSON file per record, under its kind -- what a process that stops and starts again still finds.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const fileOf = (dir, kind, id) => join(dir, kind, `${id}.json`);

const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

function written(file, record) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record)}\n`);
  return record;
}

const listed = (dir, kind) => (existsSync(join(dir, kind)) ? readdirSync(join(dir, kind)).filter((n) => n.endsWith(".json")).sort().map((n) => read(join(dir, kind, n))) : []);

export const openStore = (dir) => ({ dir, get: (kind, id) => read(fileOf(dir, kind, id)), put: (kind, id, record) => written(fileOf(dir, kind, id), record), list: (kind) => listed(dir, kind) });
