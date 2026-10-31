// MUTATIONS a benchmark applies to its OWN frozen copy of the source -- a variant's planted faults, a control's change
// -- before any tree is written, and never to a checkout. Each is exact: the text it finds must be there exactly as
// many times as it says, in the file it names, or nothing is applied and the answer is FIXTURE_DRIFT: the source moved
// under the fault, and a run on a tree where the fault did not take would be measuring nothing.
//
// A CANDIDATE definition is the same exact mutations, plus whole files a candidate brings and files it deletes -- what a
// repair control hands the judge, or a scripted host makes in its engineering task's workspace. A file's text is kept
// as `lines`, so nothing under benchmark/ is ever a test file a bare `node --test` would run.
//
//   mutationFile(dir, rel) -> { id, about, mutations }
//   mutatedEntries(entries, doc) -> { ok, entries, applied } | { ok: false, code: FIXTURE_DRIFT, drift, applied }
//   mutatedText(text, m) -> { ok, text } | { ok: false, found }
//   candidateFile(dir, rel) -> { id, about, mutations, files, deletes }
//   candidateEntries(entries, doc) -> { ok, entries, applied } | the drift      fileText(f) -> text
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { constraintFindings, missingFindings } from "../../../src/constraints.mjs";
import { Refused } from "../../../src/errors.mjs";
import { shaBytes } from "../../../src/hash.mjs";
import { safeRel } from "./paths.mjs";

export const FIXTURE_DRIFT = "FIXTURE_DRIFT";

const MUTATION = { id: { type: "string", pattern: "^[a-z][a-z0-9-]{0,47}$" }, file: { type: "string" }, find: { type: "string", pattern: "\\S" }, replace: { type: "string" }, count: { type: "integer", minimum: 1, maximum: 50 } };

const FILE = { schema: { type: "integer", enum: [1] }, id: MUTATION.id, about: { type: "string", pattern: "\\S" }, mutations: { type: "array", minItems: 1 } };

const mutationFindings = (m, i) => [...missingFindings(Object.keys(MUTATION), m, `mutations[${i}]`), ...constraintFindings(MUTATION, m, `mutations[${i}]`), ...(safeRel(m?.file) ? [] : [`mutations[${i}]: file is not a path inside the tree`])];

const fileFindings = (doc) => [...missingFindings(Object.keys(FILE), doc, "mutation file"), ...constraintFindings(FILE, doc, "mutation file"), ...(Array.isArray(doc?.mutations) ? doc.mutations.flatMap(mutationFindings) : [])];

function parsed(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { throw new Refused(`${file} is not a mutation file this harness can read (${e.code ?? e.message})`); }
}

export function mutationFile(dir, rel) {
  const doc = parsed(join(dir, rel));
  const findings = fileFindings(doc);
  if (findings.length) throw new Refused(`${rel} does not hold: ${findings.join("; ")}`);
  return doc;
}

const occurrences = (text, find) => text.split(find).length - 1;

export const mutatedText = (text, m) => ((found) => (found === m.count ? { ok: true, text: text.split(m.find).join(m.replace) } : { ok: false, found }))(occurrences(text, m.find));

const textOf = (entries, rel) => entries.find((e) => e.rel === rel && e.bytes)?.bytes.toString("utf8") ?? null;

const replacedEntry = (entries, rel, text) => entries.map((e) => (e.rel === rel ? { ...e, bytes: Buffer.from(text, "utf8"), digest: shaBytes(Buffer.from(text, "utf8")) } : e));

// One mutation over the entries the ones before it left: the new entries, or the drift it found.
function oneMutation(state, m) {
  if (state.drift) return state;
  const text = textOf(state.entries, m.file);
  const r = text === null ? { ok: false, found: 0 } : mutatedText(text, m);
  return r.ok ? { ...state, entries: replacedEntry(state.entries, m.file, r.text), applied: [...state.applied, m.id] } : { ...state, drift: { mutation: m.id, file: m.file, expected: m.count, found: r.found } };
}

export function mutatedEntries(entries, doc) {
  const end = (doc?.mutations ?? []).reduce(oneMutation, { entries, applied: [], drift: null });
  return end.drift ? { ok: false, code: FIXTURE_DRIFT, drift: end.drift, applied: end.applied } : { ok: true, entries: end.entries, applied: end.applied };
}

// ---- a candidate: mutations, the files it brings, the files it deletes ----------------------------------------------------

const BROUGHT = { rel: { type: "string" }, lines: { type: "array", items: { type: "string" } } };

const CANDIDATE = { schema: FILE.schema, id: FILE.id, about: FILE.about, mutations: { type: "array" }, files: { type: "array" }, deletes: { type: "array", items: { type: "string" } } };

const broughtFindings = (f, i) => [...missingFindings(Object.keys(BROUGHT), f, `files[${i}]`), ...constraintFindings(BROUGHT, f, `files[${i}]`), ...(safeRel(f?.rel) ? [] : [`files[${i}]: rel is not a path inside the tree`])];

const candidateFindings = (doc) => [...missingFindings(["schema", "id", "about"], doc, "candidate file"), ...constraintFindings(CANDIDATE, doc, "candidate file"), ...(doc?.mutations ?? []).flatMap(mutationFindings), ...(doc?.files ?? []).flatMap(broughtFindings), ...(doc?.deletes ?? []).filter((rel) => !safeRel(rel)).map((rel) => `deletes: ${rel} is not a path inside the tree`), ...((doc?.mutations ?? []).length + (doc?.files ?? []).length + (doc?.deletes ?? []).length ? [] : ["candidate file: it changes nothing"])];

export function candidateFile(dir, rel) {
  const doc = parsed(join(dir, rel));
  const findings = candidateFindings(doc);
  if (findings.length) throw new Refused(`${rel} does not hold: ${findings.join("; ")}`);
  return { mutations: [], files: [], deletes: [], ...doc };
}

// A brought file's text: its lines, each ended -- exactly what a candidate's file holds.
export const fileText = (f) => f.lines.map((l) => `${l}\n`).join("");

const broughtEntry = (f) => ((bytes) => ({ rel: f.rel, mode: "file", bytes, digest: shaBytes(bytes) }))(Buffer.from(fileText(f), "utf8"));

const withFiles = (entries, doc) => [...entries.filter((e) => !(doc.files ?? []).some((f) => f.rel === e.rel) && !(doc.deletes ?? []).includes(e.rel)), ...(doc.files ?? []).map(broughtEntry)];

// A file a definition deletes must be there to delete: one that is not is the same drift as a mutation that no longer
// matches -- the tree moved under the definition.
const goneDrift = (entries, doc) => ((rel) => (rel ? { ok: false, code: FIXTURE_DRIFT, drift: { mutation: `delete:${rel}`, file: rel, expected: 1, found: 0 }, applied: [] } : null))((doc.deletes ?? []).find((rel) => !entries.some((e) => e.rel === rel)));

export const candidateEntries = (entries, doc) => goneDrift(entries, doc) ?? ((m) => (m.ok ? { ...m, entries: withFiles(m.entries, doc) } : m))(mutatedEntries(entries, doc));
