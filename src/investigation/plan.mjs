// A BOUNDED verification plan, built from what is already known and touching
// nothing: no browser, no database, no network. It says what an investigation
// would look at, how, as whom, within what budget, what it cannot see, and
// what stops it -- before anything runs.
//
// What is known comes first, and from its own source:
//   the map        surfaces, controls, and the effect each control records
//   the cases      which surfaces an accepted case already covers
//   the history    what earlier investigations found on the same surfaces
//   the gates      what a person has and has not approved (src/investigation/gates.mjs)
// Project knowledge beyond these (architecture, engineering, claims) is the
// `project.context` builtin's job: the playbook asks `cli/context.mjs` first,
// and this file keeps no second copy of any of it.
//
// Priority goes to what nothing has verified yet: a surface no case covers and
// no investigation has visited is planned before one that both already have. A
// discovered behaviour is never planned as a requirement -- `known` lists only
// what the map and the accepted cases say.
import { blockers } from "./gates.mjs";
import { concreteUrl, controlsOn, pathTo } from "./surfaces.mjs";
import { NEVER_OBSERVED } from "../network/observe.mjs";

// What an objective is ABOUT, as generic English words --
// never a product's. Matched on the lower-cased text, first rows first; with no
// row matching, an investigation explores.
export const GOALS = [
  { id: "duplicates", layers: ["network", "data"], cues: ["duplicate", "twice", "two request", "two api", "double submit", "double click"] },
  { id: "persistence", layers: ["network", "data"], cues: ["database", "persist", "no record", "record exists", "saved", "saving"] },
  { id: "tenancy", layers: ["security", "data"], cues: ["tenant", "isolation", "cross-tenant", "another customer", "other customer"] },
  { id: "api", layers: ["network", "api"], cues: ["api", "endpoint", "request", "status code"] },
  { id: "exploration", layers: ["ui", "console", "network"], cues: ["explore", "bug", "autonomous"] },
];

export function goalsOf(text) {
  const t = String(text ?? "").normalize("NFC").toLowerCase();
  const hit = GOALS.filter((g) => g.cues.some((c) => t.includes(c)));
  return hit.length ? hit : GOALS.filter((g) => g.id === "exploration");
}

const words = (text) => String(text ?? "").normalize("NFC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);

// in: { graph, cases, settings, environment, mode, objective, scope, history,
//       sqlConfigured, detailSupported, capabilities, on, runtime }
export function planOf(w) {
  const surfaces = surfacesFor(w);
  const actions = actionsFor(w, surfaces);
  const budget = { actions: w.settings.limits.actions, minutes: w.settings.limits.minutes, requestsPerAction: w.settings.limits.requestsPerAction };
  return { goals: goalsOf(`${w.objective ?? ""} ${w.scope ?? ""}`).map((g) => g.id), surfaces, actions: { planned: actions.planned.slice(0, budget.actions), beyondBudget: Math.max(actions.planned.length - budget.actions, 0), skipped: actions.skipped }, layers: layersFor(w), blockers: blockers(w), unknowns: unknownsOf(w, surfaces), known: knownOf(w, surfaces), budget, stops: stopsOf(budget), history: historyOf(w, surfaces) };
}

// The surfaces a scope names -- screen id, name, URL or a control on it -- or,
// with no scope, every screen with a URL. Least-TOUCHED first: `touched` counts
// the cases that drive a surface and the investigations that visited it, which
// is how much attention it has had -- never how much of it was verified. A
// visit verifies nothing; what is still unproven is the frontier's question.
function surfacesFor(w) {
  const scope = words(w.scope);
  const all = [...w.graph.screens.values()];
  const named = scope.length ? all.filter((s) => scope.some((t) => words(`${s.id} ${s.name} ${s.url} ${controlsOn(w.graph, s.id).map((c) => c.via).join(" ")}`).includes(t))) : all.filter((s) => concreteUrl(s) || openedFromUrl(w.graph, s));
  return named.map((s) => surfaceRow(w, s)).sort((a, b) => a.touched - b.touched || a.id.localeCompare(b.id));
}

// A dialog or a panel has no URL of its own; one hop from a screen that has
// one is still a surface an exploration can reach.
const openedFromUrl = (graph, s) => graph.edges.some((e) => e.to === s.id && concreteUrl(graph.screens.get(e.from)));

function surfaceRow(w, s) {
  const cases = (w.cases ?? []).filter((c) => touches(c, s.id)).map((c) => c.id);
  const visited = (w.history ?? []).filter((h) => (h.surfaces ?? []).includes(s.id)).map((h) => h.id);
  return { id: s.id, name: s.name ?? s.id, url: concreteUrl(s), seen: s.seen ?? null, cases, visited, touched: cases.length + visited.length };
}

const touches = (c, screen) => c.start === screen || (c.steps ?? []).some((st) => st.screen === screen || String(st.on ?? "").startsWith(`${screen}/`));

function actionsFor(w, surfaces) {
  const controls = surfaces.flatMap((s) => controlsOn(w.graph, s.id)).filter((c) => c.action === "click");
  const judged = controls.map((c) => ({ ...c, skip: SKIPS.find((r) => r.when(w, c)) ?? null }));
  return { planned: judged.filter((c) => !c.skip).map(plannedRow(w)), skipped: judged.filter((c) => c.skip).map((c) => ({ on: c.key, code: c.skip.code, why: c.skip.why(c) })) };
}

// First reason wins. Every skipped control is listed, so a plan never implies
// it looked at something it chose not to touch. `code` is what a reader (the
// loop's obligations) branches on; `why` is the sentence a person reads.
const SKIPS = [
  { code: "destructive", when: (w, c) => c.destructive, why: () => "destructive — never touched by autonomous QA" },
  { code: "no-selector", when: (w, c) => !c.selector, why: () => "the map has no selector for it — orbit-ui-map records one first" },
  { code: "needs-write-mode", when: (w, c) => c.writes && w.mode !== "explore-write", why: (c) => `may change data (${c.why}) — needs explore-write, approved for this environment` },
  { code: "unreachable", when: (w, c) => !pathTo(w.graph, c), why: () => "no screen with a URL leads to it within one hop" },
];

const plannedRow = (w) => (c) => ({ on: c.key, writes: c.writes, why: c.why, reach: pathTo(w.graph, c), tables: (c.effect?.layers?.sql ?? []).map((l) => l.table), timing: c.effect?.timing ?? null });

// Which layers this plan CAN witness, and why not where it cannot.
function layersFor(w) {
  return {
    ui: { state: "planned" },
    console: { state: "planned" },
    network: { state: w.detailSupported === false ? "partial" : "planned", details: w.settings.network.details ? "per request (request <n>)" : "off in settings", neverObserved: NEVER_OBSERVED },
    api: { state: "planned", through: "the browser's own requests after each action's mark" },
    data: w.sqlConfigured ? { state: "planned", through: "read-only SQL, tables the map records only" } : { state: "blocked", why: "project.json has no sql.command — every data check will be BLOCKED, never a defect", capabilities: w.capabilities ?? [] },
    security: w.settings.tenancy ? { state: w.mode === "security-test" ? "planned" : "not-observed", why: w.mode === "security-test" ? null : "security-test mode was not asked for" } : { state: "not-observed", why: "no accepted tenancy contract in settings — a tenant check has nothing to be held to" },
  };
}

function unknownsOf(w, surfaces) {
  const controls = surfaces.flatMap((s) => controlsOn(w.graph, s.id));
  return [...surfaces.filter((s) => !s.url).map((s) => `${s.id} has no URL a browser can go to`), ...controls.filter((c) => !c.selector).map((c) => `${c.key} has no selector`), ...controls.filter((c) => c.effect && !c.effect.layers).map((c) => `${c.key}: the map records a call but no data layer (untraced)`), ...controls.filter((c) => c.writes && !c.effect).map((c) => `${c.key}: what it does is not recorded`)];
}

const knownOf = (w, surfaces) => surfaces.flatMap((s) => controlsOn(w.graph, s.id)).filter((c) => c.effect).map((c) => ({ on: c.key, effect: c.effect.api, timing: c.effect.timing ?? null, seen: c.effect.seen ?? null, from: "map" }));

const stopsOf = (b) => [`${b.actions} actions (limits.actions)`, `${b.minutes} minutes (limits.minutes)`, "any gate refusing: a destructive control, an unapproved mode, a wrong host", "the session signing out", "a cancel"];

const historyOf = (w, surfaces) => (w.history ?? []).filter((h) => (h.surfaces ?? []).some((s) => surfaces.some((x) => x.id === s))).map((h) => ({ id: h.id, findings: h.findings ?? [] }));
