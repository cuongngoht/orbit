// MUTATIONS a benchmark applies to its OWN frozen copy of the source -- a variant's planted faults, a control's change
// -- before any tree is written, and never to a checkout. Each is exact: the text it finds must be there exactly as
// many times as it says, in the file it names, or nothing is applied and the answer is FIXTURE_DRIFT: the source moved
// under the fault, and a run on a tree where the fault did not take would be measuring nothing.
//
//   mutationFile(dir, rel) -> { id, about, mutations }
//   mutatedEntries(entries, doc) -> { ok, entries, applied } | { ok: false, code: FIXTURE_DRIFT, drift, applied }
//   mutatedText(text, m) -> { ok, text } | { ok: false, found }
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
