// The UI map: three pretty-printed files, one record kind each. The file a
// record lives in says what it is, so there is no `t` discriminator to disagree
// with itself.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadGraph(graphDir) {
  const files = { screens: read(graphDir, "screens.json"), edges: read(graphDir, "edges.json"), effects: read(graphDir, "effects.json") };
  const load = Object.entries(files).flatMap(([k, v]) => recordFindings(k, v));
  const rows = (k) => (load.length ? [] : files[k]);
  const found = [...load, ...dupFindings(rows)];
  return index({ dir: graphDir, screens: new Map(rows("screens").map((s) => [s.id, s])), edges: rows("edges"), effects: rows("effects"), meta: readMeta(graphDir), load: found });
}

// A map file that is not a list of records cannot be walked, so it is REPORTED
// rather than thrown: `check` exists to name a broken map, not to crash on one.
// Every later rule then sees an empty graph, which is honest -- nothing loaded.
function recordFindings(name, rows) {
  if (!Array.isArray(rows)) return [`${name}.json must be an array of records`];
  return rows.map((r, i) => (isRecord(r) ? null : `${name}.json #${i + 1} is not a record`)).filter(Boolean);
}

const isRecord = (r) => typeof r === "object" && r !== null && !Array.isArray(r);

function read(dir, name) {
  try {
    return JSON.parse(readFileSync(join(dir, name), "utf8"));
  } catch (e) {
    return missing(e, name);
  }
}

function missing(e, name) {
  if (e.code === "ENOENT") return [];
  throw new Error(`${name} is not valid JSON: ${e.message}`);
}

function readMeta(dir) {
  try { return JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")); } catch { return {}; }
}

// An effect hangs off an edge by its "from/via" key, which the map keeps unique.
export const edgeKey = (e) => `${e.from}/${e.via}`;

function index(g) {
  const edgeOn = new Map(g.edges.map((e) => [edgeKey(e), e]));
  const effectOn = new Map(g.effects.map((e) => [e.on, e]));
  return { ...g, edgeOn, effectOn, rows: [...g.screens.values(), ...g.edges, ...g.effects] };
}

// A Map keeps the LAST record with a given key, so two `home` screens or two
// `home/Add` edges silently collapsed and the map went on describing a control
// nobody could see. Counted on the RAW arrays, where both records still exist,
// and reported with the position a reader opens the file at. (Duplicate effects
// have their own rule in graph/check.mjs.)
const KEYED = [["screens", "screen id", (s) => s.id], ["edges", "control", edgeKey]];

const dupFindings = (rows) => KEYED.flatMap(([name, what, key]) => duplicatesIn(name, what, rows(name), key));

function duplicatesIn(name, what, records, key) {
  const at = new Map();
  records.forEach((r, i) => at.set(key(r), [...(at.get(key(r)) ?? []), i + 1]));
  return [...at].filter(([, where]) => where.length > 1).map(([k, where]) => `duplicate ${what} ${k}: ${name}.json #${where.join(", #")}`);
}
