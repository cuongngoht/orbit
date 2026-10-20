// WHAT an action can touch below the UI is the PROJECT's vocabulary, not the
// engine's: one product's stack (a queue, a directory, a blob store) is another
// product's noise. The map declares its own layers in graph/meta.json:
//
//   "layers": [
//     { "key": "sql", "label": "SQL", "describe": ["${table}", " (${cols})"] },
//     { "key": "queue", "label": "Queue", "describe": ["${topic}", " -> ${consumer}"] }
//   ]
//
// The engine ships one default, `sql`, because that is the only layer it can go
// and verify itself (the `sql` verb). A declared list replaces the default
// wholesale, so a project that wants SQL alongside its own layers says so.
const SQL = { key: "sql", label: "SQL", describe: ["${table}", " (${cols})"] };

export const layersOf = (meta) => (Array.isArray(meta?.layers) && meta.layers.length ? meta.layers : [SQL]).map((l) => ({ ...l, label: l.label ?? l.key }));

export const layerKeys = (meta) => new Set(layersOf(meta).map((l) => l.key));

// One line per layer entry, phrased as the thing QC has to go and look at.
export function describe(layer, item) {
  if (!Array.isArray(layer?.describe)) return JSON.stringify(item);
  const text = layer.describe.map((s) => segment(s, item)).join("").trim();
  return text || JSON.stringify(item);
}

// A segment is one piece of that sentence carrying one ${field}. A segment
// whose field is absent disappears, so "Things (id, name)" and "Things" come
// out of one template without the project writing a conditional.
function segment(s, item) {
  const key = String(s).match(/\$\{(\w+)\}/)?.[1];
  if (!key) return s;
  const v = item?.[key];
  if (v === undefined || v === null || v === "") return "";
  return s.replace(/\$\{\w+\}/, Array.isArray(v) ? v.join(", ") : String(v));
}

export const layerItems = (effect, key) => effect.layers?.[key] ?? [];
