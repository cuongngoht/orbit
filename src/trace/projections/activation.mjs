// THE ACTIVATION CHAIN (0.5.0, B22 M3, ADR 0050 §5.11): for each turn, and for each work its turns served, the five
// links from a suggestion to a verified outcome -- each from its OWN source and with its own basis, kept apart:
//
//   suggested    the router named it, with the strategy               prompt.submitted              Orbit's own decision
//   selected     the model called Skill or Agent naming it            skill.invoked · agent.invoked  HOST_OBSERVED
//   dispatched   the call passed the switch; an agent launched        skill.invoked started ·        HOST_OBSERVED
//                and started                                          agent.launched · agent.started
//   executed     an owner record was created or moved for this        an owner's own event, stamped  RUNTIME_BOUND
//                session                                              with the session by its command
//   verified     the owner's own word                                 the WORK VIEW, handed in       the owner's
//
// Selection is not execution, and execution is not verification: only the last link may ever say verified, and it
// comes ONLY from the work view (src/work/track/view.mjs `workViewOf`) the composition root reads back and hands in
// (`opts.work`) -- never from the trail, which holds what happened and never what it came to.
//
// The verdict is the turn's `followed` verdict (src/trace/projections/turns.mjs), extended by one word: OVER-DELEGATED,
// when the turn dispatched one of Orbit's agents its strategy did not account for -- a `via` agent whose parent skill
// did not run in the turn, an agent no strategy path named (a DIRECT skill's turn, a NONE), or one agent type dispatched
// twice for one work outside a mission. A Satellite run, named by its mission's envelope, is its mission's to account for.
//
// A PROJECTION: a pure fold over the trail, rebuilt on every read and storing nothing, so a terminal and Orbit Control
// cannot disagree about it. It reuses `suggestedEntries` and `invoked` from turns.mjs, so what was suggested and what
// was dispatched mean here exactly what the `followed` verdict judged.
import { ATTRIBUTION_WORDS } from "../../attribution.mjs";
import { FOLLOW_VERDICTS, invoked, MAX_TURNS, sessionKey, stepOf, suggestedEntries, turnsOf } from "./turns.mjs";

export const ACTIVATION_VERSION = 1;

// The five links, each with its source and its basis: the three in the middle are src/attribution.mjs words; the two at
// the ends are the decision's own and the owner's own.
export const LINKS = [
  { link: "suggested", source: "prompt.submitted", basis: "ORBIT_DECISION", say: "the router named it, with the strategy" },
  { link: "selected", source: "skill.invoked · agent.invoked", basis: "HOST_OBSERVED", say: "the model called Skill or Agent naming it" },
  { link: "dispatched", source: "skill.invoked (started) · agent.launched · agent.started", basis: "HOST_OBSERVED", say: "the call passed its switch; an agent launched and started" },
  { link: "executed", source: "an owner's own event, stamped with this session by its command (task.* · work.* · requirements.* · runtime.*)", basis: "RUNTIME_BOUND", say: "an owner record was created or moved for this session" },
  { link: "verified", source: "the work view (workViewOf), read back from the owners and handed in", basis: "OWNER_RECORD", say: "the owner's own word: a linked task completed by its own proof" },
];

export const ACTIVATION_VERDICTS = [...FOLLOW_VERDICTS, "over-delegated"];

if (!LINKS.slice(1, 4).every((l) => ATTRIBUTION_WORDS.includes(l.basis))) throw new Error("an activation link's basis is an attribution word");

const LINK = Object.fromEntries(LINKS.map((l) => [l.link, { source: l.source, basis: l.basis }]));

// The owners whose own commands stamp an event with the session that ran them.
export const OWNER_FAMILIES = ["task", "work", "requirements", "runtime"];

// A strategy path that coordinates owners dispatches its own steps' agents: what it dispatches it accounts for.
export const COORDINATING_PATHS = ["workflow", "goal", "mission", "resume"];

const bare = (id) => String(id ?? "").split(":").at(-1);

const unique = (list) => [...new Set(list)];

// ---- one turn's own events: the boundary turnsOf draws, a prompt to the next, a step before any prompt its own turn ----

const pushed = (map, key, value) => (map.has(key) ? map.get(key).push(value) : map.set(key, [value]), map);

function placed(e, open, buckets) {
  const key = e.session ? sessionKey(e) : "";
  const id = e.type === "prompt.submitted" ? e.id : open.get(key) ?? (stepOf(e) ? `${e.id}-pre` : null);
  if (!id) return;
  open.set(key, id);
  pushed(buckets, id, e);
}

function eventsByTurn(events) {
  const open = new Map();
  const buckets = new Map();
  for (const e of events) placed(e, open, buckets);
  return buckets;
}

// ---- the links ------------------------------------------------------------------------------------------------------

const calls = (raw) => raw.filter((e) => e.type === "skill.invoked" || e.type === "agent.invoked");

const count = (raw, type) => raw.filter((e) => e.type === type).length;

const ownerIdOf = (e) => e.data?.task ?? e.data?.work ?? e.data?.root ?? null;

const ownersOf = (raw) => raw.filter((e) => OWNER_FAMILIES.includes(String(e.type).split(".")[0])).map((e) => ({ type: e.type, id: ownerIdOf(e) }));

// Verified only where the work view says so -- and nothing at all said where no view was handed in.
const verifiedOf = (view) => (view ? { work: view.work ?? null, level: view.evidence?.level ?? null, verified: view.evidence?.level === "verified", lifecycle: view.lifecycle?.state ?? null, why: view.evidence?.why ?? null, ...LINK.verified } : { work: null, level: null, verified: false, lifecycle: null, why: "no work view was read for this turn", ...LINK.verified });

const linksOf = (t, raw, view) => ({ suggested: { ids: suggestedEntries(t).map((e) => bare(e.id)), strategy: t.routing?.strategy?.word ?? null, ...LINK.suggested }, selected: { ids: unique(calls(raw).map((e) => bare(e.data?.id))), ...LINK.selected }, dispatched: { ids: invoked(t), launched: count(raw, "agent.launched"), started: count(raw, "agent.started"), ...LINK.dispatched }, executed: { owners: ownersOf(raw), ...LINK.executed }, verified: verifiedOf(view) });

// ---- over-delegation ------------------------------------------------------------------------------------------------

// One of Orbit's agents the turn dispatched: a call its switch let start.
const agentsOf = (raw) => raw.filter((e) => e.type === "agent.invoked" && e.data?.ours === true && e.data?.outcome !== "refused").map((e) => ({ id: bare(e.data.id), run: e.data.run ?? null }));

const skillsOf = (raw) => unique(raw.filter((e) => e.type === "skill.invoked" && e.data?.outcome !== "refused").map((e) => bare(e.data?.id)));

const parentRan = (a, c) => (c.via[a.id] ?? []).some((p) => c.skills.includes(p));

const named = (a, c) => COORDINATING_PATHS.includes(c.activation?.path) || (c.activation?.path === "agent" && c.activation.id === a.id);

// Why ONE dispatched agent was more than the turn's strategy accounted for, or null. Ordered; the last always answers.
export const EXCESS = [
  { why: null, when: (a) => Boolean(a.run) },
  { why: "via-without-parent", when: (a, c) => (c.via[a.id] ?? []).length > 0 && !parentRan(a, c) },
  { why: "twice-for-one-work", when: (a, c) => c.counts[a.id] > 1 },
  { why: "not-in-strategy", when: (a, c) => c.strategy !== null && !named(a, c) && !parentRan(a, c) },
  { why: null, when: () => true },
];

const countsOf = (agents) => agents.filter((a) => !a.run).reduce((m, a) => ({ ...m, [a.id]: (m[a.id] ?? 0) + 1 }), {});

const contextOf = (t, agents, raw, opts) => ({ strategy: t.routing?.strategy ?? null, activation: t.routing?.activation ?? null, via: opts.via ?? {}, skills: skillsOf(raw), counts: countsOf(agents) });

// Each excess said once per agent and reason.
const excessOf = (agents, c) => unique(agents.map((a) => `${a.id}|${EXCESS.find((r) => r.when(a, c)).why ?? ""}`)).map((k) => k.split("|")).filter(([, why]) => why).map(([agent, why]) => ({ agent, why }));

const SAY = { "via-without-parent": "is dispatched only from its parent skill, which did not run in this turn", "twice-for-one-work": "was dispatched twice for one work outside a mission", "not-in-strategy": "was not what the strategy named" };

const verdictOf = (t, excess) => (excess.length ? { verdict: "over-delegated", say: `dispatched more than the strategy accounted for: ${excess.map((x) => `${x.agent} ${SAY[x.why]}`).join("; ")}` } : t.followed);

function turnActivation(t, raw, opts) {
  const agents = agentsOf(raw);
  const excess = excessOf(agents, contextOf(t, agents, raw, opts));
  const view = opts.work?.(t) ?? null;
  return { id: t.id, session: t.session, project: t.project, at: t.at, endedAt: t.endedAt, strategy: t.routing?.strategy ?? null, activation: t.routing?.activation ?? null, links: linksOf(t, raw, view), excess, verdict: verdictOf(t, excess) };
}

// ---- per work: the turns one work's view was read for, joined ------------------------------------------------------

const joined = (rows, link, key) => unique(rows.flatMap((r) => r.links[link][key]));

const twiceAcross = (rows) => Object.entries(countsOf(rows.flatMap((r) => r.agentsFor ?? []))).filter(([, n]) => n > 1).map(([agent]) => ({ agent, why: "twice-for-one-work" }));

function workActivation(work, rows) {
  const excess = [...rows.flatMap((r) => r.excess), ...twiceAcross(rows)];
  const newest = rows[0];
  return { work, turns: rows.map((r) => r.id), links: { suggested: { ids: joined(rows, "suggested", "ids"), ...LINK.suggested }, selected: { ids: joined(rows, "selected", "ids"), ...LINK.selected }, dispatched: { ids: joined(rows, "dispatched", "ids"), ...LINK.dispatched }, executed: { owners: rows.flatMap((r) => r.links.executed.owners), ...LINK.executed }, verified: newest.links.verified }, verdict: excess.length ? { verdict: "over-delegated", say: `dispatched more than the strategy accounted for, ${excess.length} time(s) across ${rows.length} turn(s)` } : newest.verdict };
}

const worksOf = (rows) => [...rows.filter((r) => r.links.verified.work).reduce((m, r) => pushed(m, r.links.verified.work, r), new Map())].map(([work, list]) => workActivation(work, list));

// The work's own agents, kept beside a row for the per-work count and dropped before anything is shown.
const withAgents = (row, raw) => ({ ...row, agentsFor: agentsOf(raw) });

const shown = ({ agentsFor: _a, ...row }) => row;

// events: oldest first, as src/trace/log.mjs reads them.
// opts: { work(turn) -> the work view that turn served | null, via: { <agent>: [<parent skill>, …] }, limit }
export function activationOf(events, opts = {}) {
  const raw = eventsByTurn(events);
  const rows = turnsOf(events, { limit: opts.limit ?? MAX_TURNS }).map((t) => withAgents(turnActivation(t, raw.get(t.id) ?? [], opts), raw.get(t.id) ?? []));
  return { version: ACTIVATION_VERSION, links: LINKS, turns: rows.map(shown), works: worksOf(rows).map(shown) };
}
