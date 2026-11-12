// Small helpers every part of the evaluator shares: JSON files written whole (a temporary file renamed over the
// target, so a reader never sees half of one), digests, directories, and the evaluator's own home.
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EVALUATOR_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Where campaigns, caches and tools live: never inside a repository.
export const evalHome = (env = process.env) => resolve(env.ORBIT_EVAL_HOME || join(homedir(), ".orbit-eval"));

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const ensureDir = (dir) => (mkdirSync(dir, { recursive: true }), dir);

export function readJson(file, fallback = undefined) {
  if (!existsSync(file) && fallback !== undefined) return fallback;
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeJson(file, value) {
  ensureDir(dirname(file));
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
  return file;
}

export function writeText(file, text) {
  ensureDir(dirname(file));
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
  return file;
}

// One line appended and flushed to the disk before the call returns: a journal line that was written survives a
// worker that dies right after.
export function appendLine(file, value) {
  ensureDir(dirname(file));
  const fd = openSync(file, "a");
  try {
    writeSync(fd, `${JSON.stringify(value)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export const nowIso = () => new Date().toISOString();

// A name docker and a file system both accept, made of the characters of `s` it can keep.
export const slug = (s, max = 48) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max) || "x";

export const median = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// A seeded shuffle (mulberry32 + Fisher-Yates): the same seed gives the same order on every machine.
export function seededShuffle(list, seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    const t = Math.imul(s ^ (s >>> 15), s | 1);
    const u = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// JSON with its keys sorted at every depth: the text a digest of a value is taken over.
export const canonical = (v) => JSON.stringify(sorted(v));

const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
