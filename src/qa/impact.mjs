// What a change means for a plan that was written before it.
//
// The discipline here is the confidence column. A requirement whose recorded
// revision no longer matches the one in hand has CERTAINLY moved -- that is a
// comparison, not a guess. A frontend commit advancing means something POSSIBLY
// moved, and treating it as proof that every scenario is now wrong is how a team
// learns to ignore the tool: the answer is always "re-do everything", which is
// the same as no answer. And where there is no revision to compare at all, the
// honest word is UNKNOWN, reported as its own row.
//
// Nothing here edits a plan. It says what to re-read, re-write or re-run.
import { freshnessOf } from "./states.mjs";
import { members, scenariosOf } from "./rules/common.mjs";

export const impactOf = (plan, world = {}, opts = {}) => ({
  sources: sourceImpact(plan, opts),
  map: mapImpact(plan, world),
  touched: touchedImpact(plan, world, opts),
  rerun: rerunImpact(plan, world, opts),
});

// `opts.revisions` is what the caller knows NOW, keyed by source id. Supplied by
// whoever read the tickets; this module does not go and fetch anything.
function sourceImpact(plan, opts) {
  const now = opts.revisions ?? {};
  return members(plan, "sources").map((s) => oneSource(s, now[s.id]));
}

function oneSource(s, now) {
  const was = s.revision;
  if (!was || !now) return { id: s.id, ref: s.ref ?? "", confidence: "unknown", say: was ? `nothing was supplied to compare ${was} against` : "no revision was recorded when it was read, so it cannot be dated" };
  return { id: s.id, ref: s.ref ?? "", confidence: "certain", changed: now !== was, was, now, say: now === was ? `unchanged at ${was}` : `moved from ${was} to ${now} — re-read it against the criteria that cite it` };
}

function mapImpact(plan, world) {
  const was = plan.map?.fe_commit;
  const now = world?.graph?.meta?.fe_commit ?? world?.head;
  if (!was || !now) return { confidence: "unknown", say: "the plan or the map records no frontend commit — nothing can say whether the UI has moved under it" };
  return { confidence: "possible", changed: was !== now, was, now, say: was === now ? `the map is still at ${was}` : `the map moved from ${was} to ${now}. A commit moving is not evidence a scenario is wrong — run \`query verify\` and re-read the records it names` };
}

// Which scenarios touch a control the caller says changed. `opts.changed` is a
// set of "<screen>/<via>" keys -- from `query verify`, from a review of a diff,
// or typed by a person. Possible, never certain: an edge can change in ways no
// scenario cares about.
function touchedImpact(plan, world, opts) {
  const changed = new Set(opts.changed ?? []);
  if (!changed.size) return [];
  return scenariosOf(plan).map((s) => ({ id: s.id, edges: edgesOf(s, world).filter((e) => changed.has(e)) })).filter((r) => r.edges.length).map(said);
}

const said = (r) => ({ ...r, confidence: "possible", say: `drives ${r.edges.join(", ")}, which changed — re-read it, and re-run it before trusting its last verdict` });

function edgesOf(s, world) {
  const fromCases = (s.cases ?? []).flatMap((l) => (world.cases?.get(l?.id)?.steps ?? []).map((st) => st.on)).filter(Boolean);
  return [...new Set([s.mutation?.effect, ...fromCases].filter(Boolean))];
}

// Evidence that is no longer about this revision. `stale` is a comparison this
// tool made and can show; `unknown` is not, and stays its own answer.
function rerunImpact(plan, world, opts) {
  const rows = scenariosOf(plan).flatMap((s) => (s.cases ?? []).map((l) => one(plan, s, l, world, opts)));
  return rows.filter((r) => r.state !== "fresh");
}

function one(plan, s, l, world, opts) {
  const run = latest(world.runs ?? [], l?.id);
  const fresh = freshnessOf(run, plan, opts);
  return { scenario: s.id, case: l?.id ?? "", state: fresh.state, confidence: fresh.state === "stale" ? "certain" : "unknown", say: sayOf(fresh, run) };
}

const latest = (runs, id) => runs.filter((r) => r.case === id).sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1) ?? null;

const sayOf = (fresh, run) => (!run ? "has never run here" : `${fresh.state}: ${fresh.refs.filter((r) => r.state !== "fresh").map((r) => `${r.say} is ${r.state}`).join(", ")}`);
