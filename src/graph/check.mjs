// Integrity of the map with itself: every finding is a rule broken, not a
// heuristic. The advisories (coverage, identities) live in query/check.mjs.
import { layerItems, layerKeys, layersOf } from "./layers.mjs";
import { timingOf } from "./timings.mjs";

export function graphFindings(g) {
  const own = [...edgeFindings(g), ...screenFindings(g), ...g.effects.flatMap((f) => effectFindings(g, f))];
  return [...(g.load ?? []), ...own, ...duplicateEffects(g), ...strayKinds(g)];
}

function edgeFindings(g) {
  const out = [];
  for (const e of g.edges) {
    if (!g.screens.has(e.from)) out.push(`dangling from: ${e.from} (${e.via})`);
    if (e.to && !g.screens.has(e.to)) out.push(`dangling to:   ${e.to} (from ${e.from} via ${e.via})`);
  }
  return out;
}

function screenFindings(g) {
  const reached = new Set(g.edges.filter((e) => e.to).map((e) => e.to));
  return [...g.screens.values()].filter((s) => !reached.has(s.id) && !s.url).map((s) => `unreachable and no url: ${s.id}`);
}

// Effect records make claims a QC engineer acts on, so they are checked harder
// than the navigation half: a wrong table name sends someone to query the
// wrong thing and report a false pass.
function effectFindings(g, f) {
  return [...presenceFindings(g, f), ...backendFindings(f), ...timingFindings(g, f), ...layerFindings(g, f)];
}

function presenceFindings(g, f) {
  const out = [];
  if (!g.edgeOn.has(f.on)) out.push(`effect on unknown control: ${f.on}`);
  if (!f.src) out.push(`effect without src: ${f.on}`);
  if (!f.timing) out.push(`effect without timing: ${f.on}`);
  return out;
}

const backendFindings = (f) => (f.backend === "none" && f.api ? [`effect backend=none but has api: ${f.on}`] : []);

// The engine no longer knows one product's queues and timers, so it holds the
// map to the vocabulary the map itself declares: an undeclared timing is a typo
// or a word that grew in an effect instead of in meta.json, and a deferred
// timing that names nothing to go and look at is worse than no record.
function timingFindings(g, f) {
  const t = timingOf(g.meta, f.timing);
  if (f.timing && !t) return [`effect timing "${f.timing}" is not declared in graph/meta.json timings: ${f.on}`];
  if (t?.layer && !layerItems(f, t.layer).length) return [`effect says timing=${f.timing} but names nothing in the "${t.layer}" layer that finishes it: ${f.on}`];
  return [];
}

function layerFindings(g, f) {
  const known = layerKeys(g.meta);
  const stray = Object.keys(f.layers ?? {}).filter((k) => !known.has(k)).map((k) => `effect touches layer "${k}", which graph/meta.json does not declare: ${f.on}`);
  return [...stray, ...layerSrcFindings(g, f)];
}

const layerSrcFindings = (g, f) => layersOf(g.meta).flatMap(({ key }) => layerItems(f, key).filter((i) => !i.src).map((i) => `effect layer entry without src: ${f.on} -> ${key} ${JSON.stringify(i)}`));

function duplicateEffects(g) {
  const ons = g.effects.map((f) => f.on);
  return ons.filter((v, i) => ons.indexOf(v) !== i).map((d) => `duplicate effect for control: ${d}`);
}

const strayKinds = (g) => g.rows.filter((r) => r.t).map((r) => `record still carries a "t" field (${r.t}) — the file it lives in says its kind now`);
