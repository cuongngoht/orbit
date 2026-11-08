// THE STORE: every record one JSON file, written whole and renamed into place, so a service that stops and starts again
// finds exactly what it kept. Every library system's records share it: a record says the `tenant` it belongs to, and
// every id comes from one counter, so no two records ever share one -- in one system or across them.
//
//   openStore(dir) -> store            put(store, kind, record) -> record       get(store, kind, id) -> record | null
//   list(store, kind) -> [record], in the order they were made      created(store, kind, prefix, fields) -> record
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEY = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

// What an id may be: letters, digits and dashes -- never a path.
export const isKey = (v) => typeof v === "string" && KEY.test(v);

export const openStore = (dir) => (mkdirSync(dir, { recursive: true }), { dir });

const fileOf = (store, kind, id) => join(store.dir, kind, `${id}.json`);

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

function writeWhole(file, value) {
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

export function put(store, kind, record) {
  mkdirSync(join(store.dir, kind), { recursive: true });
  writeWhole(fileOf(store, kind, record.id), record);
  return record;
}

export const get = (store, kind, id) => (isKey(id) && existsSync(fileOf(store, kind, id)) ? readJson(fileOf(store, kind, id)) : null);

const bySeq = (a, b) => a.seq - b.seq;

const namesIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")) : []);

export const list = (store, kind) => namesIn(join(store.dir, kind)).map((n) => readJson(join(store.dir, kind, n))).sort(bySeq);

function nextSeq(store) {
  const file = join(store.dir, "counter.json");
  const n = (existsSync(file) ? readJson(file).n : 0) + 1;
  writeWhole(file, { n });
  return n;
}

// A new record of a kind: its id from the one counter, and its place in the order records were made (`seq`).
export const created = (store, kind, prefix, fields) => ((n) => put(store, kind, { ...fields, id: `${prefix}-${n}`, seq: n }))(nextSeq(store));
