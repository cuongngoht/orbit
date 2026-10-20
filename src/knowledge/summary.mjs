// What project knowledge holds, summarised for Orbit Control -- READ ONLY, and it
// never throws: a project with nothing recorded, a store that cannot be read or
// an extension that will not load is a smaller answer, never an error page.
//
// It is the introspection the brief asks the control plane to be able to show:
// what Orbit currently understands (claims by authority, layer, source and
// concern), where it came from (the vocabulary's layers, and what they refused),
// which contexts it is scoped by (the dimensions in use -- names only), which
// claims conflict (competing objects in one context), and which capabilities
// are missing (the opportunities, and what a person decided about them).
//
// The relation vocabulary is built the way cli/knowledge.mjs builds it -- the
// project's extensions loaded into a THROWAWAY registry, then Orbit's catalog,
// the organisation's room, the project's own -- so Control and the CLI can never
// read one relation two ways.
import { emptyRegistries } from "../extensions/registries.mjs";
import { loadExtensions } from "../extensions/loader.mjs";
import { machineContext } from "../store/context.mjs";
import { authorityOf, competes, roleRow } from "./vocab.mjs";
import { createKnowledge, organizationPaths } from "./store.mjs";
import { catalogLayer, offerLayers, relationOf, roomLayers } from "./vocabulary.mjs";

export const MAX_CONFLICTS = 20;
export const MAX_OPPORTUNITIES = 50;

// deps: { project, env, pluginRoot, storeBase }
export async function projectKnowledge(deps) {
  try { return await summarised(deps); }
  catch (e) { return { version: 1, available: false, why: String(e?.message ?? e).slice(0, 200) }; }
}

async function summarised(deps) {
  const machine = machineContext({ project: deps.project, config: deps.project.config }, deps.env);
  const know = createKnowledge(machine.store.root, machine.io);
  const parts = await vocabularyOf(deps, machine, know);
  return shaped(know.all(), parts, know.opportunities());
}

async function vocabularyOf(deps, machine, know) {
  const ctx = { store: () => machine.store.root, ...emptyRegistries() };
  const loaded = await loadExtensions(ctx);
  offerLayers(ctx.knowledge, [catalogLayer(deps.pluginRoot, machine.io), ...roomLayers(machine.io, organizationPaths(deps.storeBase).vocabulary, "organization"), ...roomLayers(machine.io, know.paths.vocabulary, "project")]);
  return Object.assign(ctx.knowledge, { extensionsRefused: loaded.refused.map((r) => r.id) });
}

const tally = (list, keyOf) => list.reduce((m, x) => ({ ...m, [keyOf(x)]: (m[keyOf(x)] ?? 0) + 1 }), {});

function shaped(claims, parts, opportunities) {
  const relation = (c) => relationOf(parts, c.relation);
  return { version: 1, available: true, claims: { total: claims.length, byTier: tally(claims, (c) => authorityOf(c).tier), byLayer: tally(claims, (c) => c.layer), bySource: tally(claims, (c) => c.source), byConcern: tally(claims, (c) => roleRow(relation(c).role)?.concern ?? "no role") }, relations: relationsOf(claims, parts), dimensions: dimensionsOf(claims), conflicts: conflictsOf(claims, parts), opportunities: opportunitiesOf(opportunities) };
}

function relationsOf(claims, parts) {
  const declared = parts.relations().map((r) => ({ id: r.id, role: r.role, cardinality: r.cardinality, layer: r.layer, from: r.from }));
  const undeclared = [...new Set(claims.map((c) => c.relation))].filter((id) => !parts.relation(id)).sort();
  return { declared, undeclared, interpreters: parts.interpreters().map((i) => ({ id: i.id, from: i.from, understands: i.understands })), refused: parts.refused(), extensionsRefused: parts.extensionsRefused ?? [] };
}

// The dimensions contexts are keyed by -- names and how many values each takes,
// never the values themselves.
function dimensionsOf(claims) {
  const values = new Map();
  for (const c of claims) for (const [k, v] of Object.entries(c.context ?? {})) values.set(k, new Set([...(values.get(k) ?? []), v]));
  return [...values].map(([name, set]) => ({ name, values: set.size })).sort((a, b) => (a.name < b.name ? -1 : 1));
}

// Competing objects for one subject and relation in ONE context -- the
// conflicts a person may need to settle. Which prevails is the query's to say.
function conflictsOf(claims, parts) {
  const groups = new Map();
  for (const c of claims.filter((x) => competes(relationOf(parts, x.relation).cardinality))) groups.set(JSON.stringify([c.subject, c.relation, c.context]), [...(groups.get(JSON.stringify([c.subject, c.relation, c.context])) ?? []), c]);
  return [...groups.values()].filter((g) => new Set(g.map((c) => c.object)).size > 1).map((g) => ({ subject: g[0].subject, relation: g[0].relation, context: g[0].context, objects: g.map((c) => ({ object: c.object, tier: authorityOf(c).tier, id: c.id })) })).slice(0, MAX_CONFLICTS);
}

function opportunitiesOf(docs) {
  const items = docs.map((o) => ({ id: o.id, capability: o.capability, state: o.state, remedy: o.remedy, subjects: new Set((o.needs ?? []).map((n) => n.subject)).size, last: o.last, decided: o.decided ?? null }));
  return { byState: tally(docs, (o) => o.state), items: items.sort((a, b) => (a.last < b.last ? 1 : -1)).slice(0, MAX_OPPORTUNITIES) };
}
