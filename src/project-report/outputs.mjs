// What a part WROTE, held to what its kind may write -- before anything reads
// it. A part names its outputs in its result; each must be a flat JSON file
// inside the part's own output directory (never a symlink, never out of it),
// within a size limit, and shaped as that output is shaped.
//
// A metric the part did not DECLARE is dropped with a note: the declaration is
// where its unit and definition live, and a number with neither is not a
// metric a report may print. Section blocks are plain data of known types; the
// renderer escapes every string in them.
import { join } from "node:path";
import { contained } from "../project/boundary.mjs";

export const OUTPUT_LIMIT = 32 * 1024 * 1024;
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}\.json$/;
const BLOCKS = new Set(["tiles", "table", "chart", "text", "notes"]);

// The shape each known output must have; anything else a part may write is
// passed through only when its kind lists it.
const SHAPES = {
  model: (v) => (v?.contract === "orbit.report.model/v1" ? null : "model.json is not a orbit.report.model/v1 model"),
  metrics: (v) => (Array.isArray(v) ? null : "metrics.json is a list of metric records"),
  section: (v) => (Array.isArray(v) && v.every(sectionOk) ? null : `section.json is a list of sections made of ${[...BLOCKS].join(", ")} blocks`),
  forecast: (v) => (v && typeof v.status === "string" ? null : "forecast.json says its status"),
};

const sectionOk = (s) => Array.isArray(s?.blocks) && s.blocks.every((b) => BLOCKS.has(b?.type));

// -> { ok, outputs: { name: value }, exports: [{ name, file }], notes, problems }
export function readOutputs(part, result, dir, io) {
  const read = Object.entries(result?.outputs ?? {}).map(([key, file]) => one(key, file, dir, io));
  const exported = (result?.exports ?? []).map((name) => exportOf(part, name, dir, io));
  const problems = [...read, ...exported].filter((r) => r.problem).map((r) => r.problem);
  const kept = Object.fromEntries(read.filter((r) => !r.problem).map((r) => [r.key, r.value]));
  return declared(part, { ok: problems.length === 0, outputs: kept, exports: exported.filter((r) => !r.problem), problems });
}

function one(key, file, dir, io) {
  if (!NAME.test(String(file))) return { key, problem: `${file}: an output is a flat, lower-case .json name` };
  const path = contained(dir, join(dir, file));
  const wrong = fileProblem(file, path, io);
  return wrong ? { key, problem: wrong } : parsed(key, file, io.read(path));
}

// A file a part wrote is a regular file of its own, within the limit -- never a
// link to one somewhere else.
function fileProblem(file, path, io) {
  if (io.kind?.(path) === "symlink") return `${file} is a symbolic link; a part writes its outputs, it does not point at them`;
  return (io.size(path) ?? 0) > OUTPUT_LIMIT ? `${file} is larger than ${OUTPUT_LIMIT} bytes` : null;
}

// What an EXPORTER writes beside the report: text in a format it declared.
const EXPORT = /^[a-z0-9][a-z0-9._-]{0,63}\.(csv|json|md|txt)$/;

const EXPORT_RULES = [
  { fails: (part) => part.kind !== "exporter", says: (part, name) => `${name}: only an exporter writes files beside the report` },
  { fails: (part, name) => !EXPORT.test(String(name)), says: (part, name) => `${name}: an export is a flat, lower-case name ending .csv, .json, .md or .txt` },
  { fails: (part, name) => !(part.formats ?? []).includes(String(name).split(".").pop()), says: (part, name) => `${name}: ${part.id} declared ${(part.formats ?? []).join(", ") || "no formats"}` },
];

function exportOf(part, name, dir, io) {
  const rule = EXPORT_RULES.find((r) => r.fails(part, name));
  if (rule) return { name, problem: rule.says(part, name) };
  const file = contained(dir, join(dir, name));
  const wrong = io.exists(file) ? fileProblem(name, file, io) : `${name} was named in the result and not written`;
  return wrong ? { name, problem: wrong } : { name, file };
}

function parsed(key, file, text) {
  if (text === null || text === undefined) return { key, problem: `${file} was named in the result and not written` };
  try { return shaped(key, file, JSON.parse(text)); }
  catch (e) { return { key, problem: `${file} is not readable JSON — ${e.message}` }; }
}

function shaped(key, file, value) {
  const wrong = SHAPES[key]?.(value) ?? null;
  return wrong ? { key, problem: wrong } : { key, value };
}

// Only metrics the part declared survive, and each carries the declaration's
// own unit and definition -- whatever the file said about them.
function declared(part, read) {
  const allowed = new Map((part.metrics ?? []).map((m) => [m.id, m]));
  const metrics = (read.outputs.metrics ?? []).filter((m) => allowed.has(m?.id));
  const dropped = (read.outputs.metrics ?? []).length - metrics.length;
  const notes = dropped ? [`${dropped} metric(s) ${part.id} did not declare were dropped`] : [];
  return { ...read, outputs: { ...read.outputs, ...(read.outputs.metrics ? { metrics: metrics.map((m) => ({ ...m, ...pick(allowed.get(m.id)) })) } : {}) }, notes };
}

const pick = (d) => ({ id: d.id, version: d.version, label: d.label, unit: d.unit, definition: d.definition, compare: d.compare ?? "rate", direction: d.direction ?? null });
