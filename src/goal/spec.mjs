// Goal specification: normalize, bound, digest. User-authored text submitted for execution.
import { Refused } from "../errors.mjs";
import { createHash } from "node:crypto";
import { GOAL_API, TITLE_LIMIT } from "./vocab.mjs";
import { normalizeSpec } from "./spec-normalize.mjs";

export { normalizeSpec };
export const SPEC_FILE = "spec.json";

export function digestOf(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

export function titleOf(text) {
  const line = String(text).split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "Goal";
  const t = line.slice(0, TITLE_LIMIT);
  return t.length < line.length ? `${t.slice(0, TITLE_LIMIT - 1)}…` : t;
}

export function specRecord(body, revision = 1) {
  const digest = digestOf(body);
  return { api: GOAL_API, revision, digest, bytes: Buffer.byteLength(body, "utf8"), body };
}

export function writeSpec(io, dir, record) {
  io.write(`${dir}/${SPEC_FILE}`, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export function readSpec(io, dir) {
  const text = io.read(`${dir}/${SPEC_FILE}`);
  if (text === null) return null;
  return currentSpec(text);
}

function currentSpec(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Refused("Invalid goal specification JSON"); }
  if (value?.api !== GOAL_API || !Number.isInteger(value.revision) || value.revision < 1 || typeof value.body !== "string" || value.digest !== digestOf(value.body) || value.bytes !== Buffer.byteLength(value.body) || Object.keys(value).some((k) => !["api", "revision", "digest", "bytes", "body"].includes(k))) throw new Refused("Unsupported goal specification schema");
  return value;
}
