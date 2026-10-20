// The ECOSYSTEM ADAPTER REGISTRY: which adapter reads which manifest.
//
// The core knows three things about an adapter -- `id`, `detects(path)` and
// `parseManifest(path, text)` -- and never branches on which one it is holding.
// A new ecosystem is `register(adapter)`: no enum to widen, no switch to extend,
// no caller to edit. The capability registry's three rules hold here for the
// same reasons: a duplicate id is REFUSED rather than overwritten, a malformed
// adapter is a sentence rather than a TypeError, and nothing answers undefined.
//
// Reading is FAIL-SOFT, and deliberately so. An adapter that throws on a torn
// file costs that one manifest -- it comes back `unreadable` with the reason --
// and an adapter that returns a field of the wrong shape has that field dropped
// and said out loud. What it may not do is take the next manifest down with it.
//
// An adapter never sees a namespaced path. A secondary checkout's
// `worker::src/app.manifest` reaches it as `src/app.manifest`, so no adapter
// has to know that a project can span repositories -- src/frontend/composite.mjs
// owns that language, and `splitPath` is its one reading.
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { Refused } from "../errors.mjs";
import { splitPath } from "../frontend/composite.mjs";
import { ADAPTER_FIELDS, ADAPTER_METHODS, ADAPTER_REQUIRED, DEPENDENCY_FIELDS, MANIFEST_FIELDS, REFERENCE_FIELDS, normalized } from "./contract.mjs";

export function createEcosystemRegistry(adapters = []) {
  const byId = new Map();
  const api = { register: (a, from) => add(byId, a, from), list: () => [...byId.values()], ids: () => [...byId.keys()], forPath: (p) => owner(byId, p), read: (p, readText) => readWith(byId, p, readText) };
  for (const a of adapters) api.register(a, "core");
  return api;
}

function add(byId, adapter, from) {
  const bad = problems(byId, adapter);
  if (bad.length) throw new Refused(`${from ?? "this caller"}: cannot register an ecosystem adapter — ${bad.join("; ")}`);
  byId.set(adapter.id, { ...adapter, from: from ?? "core" });
}

function problems(byId, a) {
  if (!isObject(a)) return ["an adapter is an object"];
  const at = `ecosystem adapter "${a.id ?? "?"}"`;
  return [...missingFindings(ADAPTER_REQUIRED, a, at), ...constraintFindings(ADAPTER_FIELDS, a, at), ...methodProblems(a, at), ...takenProblem(byId, a.id, at)];
}

const methodProblems = (a, at) => ADAPTER_METHODS.filter((m) => typeof a[m] !== "function").map((m) => `${at}: has no ${m}()`);

const takenProblem = (byId, id, at) => (byId.has(id) ? [`${at}: already registered by ${byId.get(id).from} — two readers of one format is two answers to one question`] : []);

// First registration wins a path both detect, and that is the order they were
// registered in -- the built-ins first, a project's own after.
const owner = (byId, path) => [...byId.values()].find((a) => attempt(() => a.detects(splitPath(path).local)).value === true) ?? null;

// The text is read only once an adapter has claimed the path, so a listing of
// ten thousand files costs a read per MANIFEST, never per file. A read that
// throws is NOT caught here: that is the source port failing, and the caller's
// isolation (one analysis, one answer) is where that belongs.
function readWith(byId, path, readText) {
  const adapter = owner(byId, path);
  if (!adapter) return null;
  const text = readText(path);
  return text === null ? null : parsedBy(adapter, path, unmarked(text));
}

// A byte-order mark is how a file says what ENCODING it is in, not part of what it says. Visual Studio
// writes one at the head of `launchSettings.json` and a good many other files, and `JSON.parse` refuses a
// text that starts with one: without this a manifest that is perfectly well formed is "unreadable".
export const unmarked = (text) => (String(text).charCodeAt(0) === 0xfeff ? String(text).slice(1) : text);

function parsedBy(adapter, path, text) {
  const out = attempt(() => adapter.parseManifest(splitPath(path).local, text));
  if (out.error) return unreadable(adapter, path, `the ${adapter.id} adapter could not read ${path} — ${out.error}`);
  if (!isObject(out.value)) return unreadable(adapter, path, `${path} could not be read as ${adapter.doc}`);
  return { ecosystem: adapter.id, path, ...checked(out.value) };
}

const unreadable = (adapter, path, why) => ({ ecosystem: adapter.id, path, unreadable: true, ...normalized({ unknowns: [why] }) });

// A field of the wrong shape is DROPPED and said, never passed on: every reader
// above this trusts the canonical record, and a string where a list belongs is
// how that trust turns into a TypeError three layers up.
function checked(out) {
  const kept = Object.fromEntries(Object.entries(out).filter(([k, v]) => acceptable(k, v)));
  const deps = recordsOf(kept.dependencies ?? [], "name", DEPENDENCY_FIELDS, "dependency");
  const refs = recordsOf(kept.references ?? [], "path", REFERENCE_FIELDS, "reference");
  const said = Object.keys(out).filter((k) => !(k in kept)).map((k) => `the adapter returned a ${k} this engine does not accept, so it was dropped`);
  return normalized({ ...kept, dependencies: deps.good, references: refs.good, unknowns: [...(kept.unknowns ?? []), ...said, ...deps.said, ...refs.said] });
}

const acceptable = (k, v) => k in MANIFEST_FIELDS && !constraintFindings({ [k]: MANIFEST_FIELDS[k] }, { [k]: v }, "manifest").length;

// The records of one list a reader trusts: an object with the field that names it, in the declared shape.
function recordsOf(all, key, fields, what) {
  const good = all.filter((d) => isObject(d) && typeof d[key] === "string" && !constraintFindings(fields, d, what).length);
  return { good, said: good.length < all.length ? [`${all.length - good.length} ${what} record(s) were not in the shape this engine reads, and were dropped`] : [] };
}

function attempt(fn) {
  try {
    return { value: fn() };
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 160) };
  }
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
