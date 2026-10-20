// PATCH: the minimal edits that bring an EXISTING definition up to what a checkout
// needs -- and refuse the rest.
//
// A definition somebody wrote has things in it that are nobody's to regenerate:
// features they chose, extensions, mounts, environment, lifecycle hooks, comments
// about why a version is pinned. So a patch never rewrites it. It edits exactly
// three things, each by splicing (src/runtime/jsonc.mjs) so every other byte stays:
//
//   a feature that is MISSING   a member added to `features`
//   a feature that is OUTDATED  its version value replaced
//   a port not published       an item appended to `appPort`
//
// Everything else a gap can ask for -- a requirement no catalog feature provides, a
// server a container cannot add, a version that cannot be compared -- is returned
// as UNRESOLVED with its reason, because that is a decision for the person whose
// environment it is. An edit the JSONC editor refuses (a comment sits inside the
// value, the file would not re-parse) is unresolved too, and says why.
import { edit, get } from "../jsonc.mjs";
import { keyOf } from "./create.mjs";

// -> { edits, refused: [{ id, why }], unresolved: [{ id, why }] }: the edits that
// apply, the ones the editor would not make, and what no edit could ever provide.
export function patch({ gaps, ports, definition }) {
  const wanted = [...featureEdits(gaps, definition), ...portEdits(ports, definition)];
  const kept = tried(definition.text, wanted);
  return { edits: kept.edits, refused: kept.refused, unresolved: gaps.filter(unplaceable).map((g) => ({ id: g.id, why: g.because })) };
}

const unplaceable = (g) => ["impossible", "unplaced"].includes(g.state);

// Each edit is tried against the file AS IT WOULD BE after the ones before it; one
// the editor refuses is dropped and named, and the rest still apply.
function tried(text, wanted) {
  const edits = [];
  const refused = [];
  let current = text;
  for (const w of wanted) {
    const done = edit(current, [w.edit]);
    if (!done.ok) {
      refused.push({ id: w.id, why: done.reason });
      continue;
    }
    edits.push(w.edit);
    current = done.text;
  }
  return { edits, refused };
}

function featureEdits(gaps, definition) {
  const features = get(definition.parsed.tree, ["features"]);
  const missing = gaps.filter((g) => g.state === "missing");
  const outdated = gaps.filter((g) => g.state === "outdated");
  return [...missingEdits(missing, features), ...outdated.map((g) => outdatedEdit(g, definition))];
}

const optionOf = (g) => (g.wanted ? { [g.feature.option]: g.wanted } : {});

// With no `features` at all, one insert carries every missing one; with some, one
// insert each, so each stays a separate and separately refusable edit.
function missingEdits(missing, features) {
  if (!missing.length) return [];
  if (!features) return [{ id: missing.map((g) => g.id).join(","), edit: { op: "insert", path: [], key: "features", value: Object.fromEntries(missing.map((g) => [keyOf(g.feature), optionOf(g)])) } }];
  return missing.map((g) => ({ id: g.id, edit: { op: "insert", path: ["features"], key: keyOf(g.feature), value: optionOf(g) } }));
}

// The feature's existing key (with whatever tag the file uses), and the shape its
// value has: options (with or without a version), a bare version string, or
// something else that is replaced by options.
function outdatedEdit(g, definition) {
  const at = existingKey(definition, g.feature);
  return { id: g.id, edit: shapeEdit(g, at, definition.parsed.value.features[at]) };
}

function existingKey(definition, feature) {
  const found = definition.summary.features.find((f) => f.id === feature.id);
  return Object.keys(definition.parsed.value.features).find((k) => k === keyOf(found));
}

function shapeEdit(g, at, value) {
  if (typeof value === "string") return { op: "set", path: ["features", at], value: g.wanted };
  if (!value || typeof value !== "object") return { op: "set", path: ["features", at], value: optionOf(g) };
  return value[g.feature.option] === undefined ? { op: "insert", path: ["features", at], key: g.feature.option, value: g.wanted } : { op: "set", path: ["features", at, g.feature.option], value: g.wanted };
}

// A port is published by `appPort`: appended to its list, a single value made a list, or the key
// added. A definition built from compose files publishes through those, and they are never edited.
function portEdits(ports, definition) {
  if (!ports.length || definition.summary.composeFiles.length) return [];
  const published = get(definition.parsed.tree, ["appPort"]);
  if (!published) return [{ id: "ports", edit: { op: "insert", path: [], key: "appPort", value: ports } }];
  return published.type === "array" ? ports.map((p) => ({ id: `port ${p}`, edit: { op: "append", path: ["appPort"], value: p } })) : [{ id: "ports", edit: { op: "set", path: ["appPort"], value: [definition.parsed.value.appPort, ...ports] } }];
}
