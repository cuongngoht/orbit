// A prompt + the Effective Resource Registry -> ONE RouteDecision.
//
// The router is a PLANNER. It names what is relevant and may be used, what
// would be relevant but is not usable, blocked or waiting for approval, and the
// order it would use them in -- and it stops: nothing in this file connects to
// a server, starts a skill, spawns an agent, installs a tool, reads a disk or
// writes anything. The host decides what to do with the decision, including
// nothing.
//
//   classify   prompt -> intent + the requirements it asks, each with its level
//   graph      requirements expanded through the providers chosen for them
//              (src/routing/graph.mjs): required · conditional · optional ·
//              transitive, cycles recorded and not followed
//   select     per requirement, ONE provider (src/routing/select.mjs): what
//              provides it and is eligible, allowed before approval, a person's
//              priority, the task's own words, the engine's own answer first,
//              a stable id last
//   decide     selected · approval · blocked · missing, and an execution plan
//              that puts what a provider needs before the provider
//
// A resource in state `unknown` is never called missing: nobody has looked, and
// "missing" would be a claim nobody can back. An intent's requirement nothing
// provides at all is not a finding either; a CHOSEN provider's need nothing
// provides is.
//
// Every reason is built from table words, requirement names and resource ids,
// never from the prompt, so a decision can be shown to anybody without showing
// what was typed.
//
// RouteDecision v3 (0.5.0, B22, ADR 0050) is v2 and three more answers, made by
// `decide`: the STRATEGY -- how much Orbit the request needs, one word of
// src/routing/strategy.mjs with its row, its reason and whether it is said at all
// -- the ACTIVATION it names, and whether the host wrote the prompt itself
// (`synthetic`). `route` stays the planner's v2 answer, which Orbit Control's Router
// Inspector and `resources.mjs route` show; the prompt hook asks `decide`.
import { everyResource } from "../resources/registry.mjs";
import { classify, heard } from "./classify.mjs";
import { expandGraph } from "./graph.mjs";
import { DOORS, strategyOf } from "./strategy.mjs";

export const ROUTE_DECISION_VERSION = 2;
export const ROUTE_DECISION_V3 = 3;
export const MAX_SELECTED = 6;
export const MAX_MISSING = 3;

export function route(prompt, effective, classifier = classify) {
  return planned(classifier(prompt), effective).decision;
}

// asked: classify()'s answer   facts: what the composition root bound (src/routing/strategy.mjs names them)
export function decide(asked, effective, facts = {}) {
  const plan = planned(asked, effective);
  const chosen = chosenOf(plan.nodes, asked);
  const answer = strategyOf({ ...facts, asked: said(asked), chosen, doors: doorsOf(effective) });
  return { ...plan.decision, version: ROUTE_DECISION_V3, strategy: { ...answer.strategy, shown: shownOf(answer, asked, chosen) }, activation: answer.activation, synthetic: facts.synthetic === true };
}

function planned(asked, effective) {
  const graph = expandGraph(asked.asked ?? asked.requirements.map((requirement) => ({ requirement, level: "required", because: `intent ${asked.intent.id}` })), { resources: everyResource(effective), grams: asked.grams });
  return { decision: decided(asked, graph), nodes: graph.nodes };
}

// The classification as the strategy reads it: table words and counts, never the prompt's grams.
const said = (asked) => ({ intent: asked.intent, matched: asked.matched ?? [], marks: asked.marks ?? [], shape: asked.shape ?? null, requirements: asked.requirements ?? [] });

// What was CHOSEN (selected, or waiting for a person's approval) that the session does not already have -- never an
// implicit provider or one of the engine's built-ins -- in the order the request is about it (classify.mjs `focus`);
// what a provider pulled in comes after everything the prompt asked for.
const chosenOf = (nodes, asked) => nodes.filter(counted).map(chosenEntry).sort(byFocus(asked.focus ?? asked.requirements ?? []));

const counted = (n) => ["selected", "approval"].includes(n.status) && !n.provider.detail?.implicit && !n.provider.detail?.builtin;

const chosenEntry = (n) => ({ kind: n.provider.kind, id: n.provider.id, key: n.provider.key, ownership: n.provider.ownership, requirement: n.requirement, transitive: n.transitive, via: n.provider.routing.via ?? [], gated: n.provider.routing.requiresSignal === true && n.sigHits.length > 0 });

const byFocus = (focus) => (a, b) => rankIn(focus, a) - rankIn(focus, b);

const rankIn = (focus, c) => (c.transitive || !focus.includes(c.requirement) ? focus.length : focus.indexOf(c.requirement));

// Who opens each coordinated path here: the first usable skill that provides its capability (strategy.mjs DOORS).
const doorsOf = (effective) => Object.fromEntries(Object.entries(DOORS).map(([how, capability]) => [how, openerOf(effective, capability)]));

const openerOf = (effective, capability) => everyResource(effective).find((r) => r.kind === "skill" && r.eligible && r.routing.provides.includes(capability))?.id ?? null;

// Said unless it is NONE, or a DIRECT whose one-cue intent no signal-gated provider's own word confirmed (B5).
const shownOf = (answer, asked, chosen) => answer.strategy.word !== "NONE" && (answer.strategy.word !== "DIRECT" || heard(asked.intent, chosen));

function decided(asked, graph) {
  const lists = Object.fromEntries(Object.entries(LISTS).map(([name, statuses]) => [name, distinct(graph.nodes.filter((n) => statuses.includes(n.status) && reportable(n)).map(entryOf))]));
  return { version: ROUTE_DECISION_VERSION, intent: asked.intent, cues: asked.cues, requirements: asked.requirements, graph: { nodes: graph.nodes.map(nodeOf), cycles: graph.cycles, truncated: graph.truncated }, selected: lists.selected.slice(0, MAX_SELECTED), approval: lists.approval, blocked: lists.blocked, missing: lists.missing.slice(0, MAX_MISSING), plan: planOf(graph.nodes) };
}

const LISTS = { selected: ["selected"], approval: ["approval"], blocked: ["blocked"], missing: ["missing", "unprovided"] };

// Nothing provides an intent's requirement: not a finding. A chosen provider's
// need that nothing provides: it is.
const reportable = (n) => n.status !== "unprovided" || n.transitive;

function entryOf(n) {
  if (!n.provider) return { kind: "requirement", id: n.requirement, key: n.requirement, summary: "", requirement: n.requirement, implicit: false, reason: `${n.transitive ? `${pulledBy(n)} needs` : "the task needs"} ${n.requirement}, and nothing here provides it` };
  return { kind: n.provider.kind, id: n.provider.id, key: n.provider.key, summary: n.provider.summary, requirement: n.requirement, implicit: n.provider.detail?.implicit === true, reason: reasonOf(n) };
}

const pulledBy = (n) => n.viaId ?? n.from.join(", ");

const REASONS = {
  selected: (n) => `${n.transitive ? `provides ${n.requirement} for ${pulledBy(n)}` : `relevant to ${n.requirement}`}${n.sigHits.length ? ` (mentions ${n.sigHits.join(", ")})` : ""}`,
  approval: (n) => `relevant to ${n.requirement}, but ${n.why} before it is used`,
  blocked: (n) => `relevant to ${n.requirement}, but ${n.why}`,
  missing: (n) => `${n.transitive ? `${pulledBy(n)} needs ${n.requirement}` : `relevant to ${n.requirement}`}, but ${n.provider.id} -- ${n.why}`,
};

const reasonOf = (n) => REASONS[n.status](n);

// The same resource chosen for two requirements is one entry.
const distinct = (entries) => entries.filter((e, at) => entries.findIndex((x) => x.kind === e.kind && x.key === e.key) === at);

// A node as the Router Inspector shows it: the requirement, why it is there,
// what became of it, and every candidate that was weighed.
const nodeOf = (n) => ({ requirement: n.requirement, level: n.level, transitive: n.transitive, from: n.from, via: n.via ?? null, because: n.because ?? null, workflow: n.workflow ?? null, status: n.status, provider: n.provider ? { kind: n.provider.kind, key: n.provider.key, id: n.provider.id } : null, why: n.why ?? null, candidates: n.candidates });

// What would be used, in the order it would be used: a provider's needs
// before the provider (deepest first), approval-bound steps marked, and each
// resource once.
function planOf(nodes) {
  const chosen = nodes.filter((n) => ["selected", "approval"].includes(n.status)).map((n, at) => ({ n, at, depth: depthOf(n, nodes) }));
  const ordered = chosen.sort((a, b) => b.depth - a.depth || a.at - b.at).map(({ n }) => ({ requirement: n.requirement, kind: n.provider.kind, key: n.provider.key, id: n.provider.id, approval: n.status === "approval", implicit: n.provider.detail?.implicit === true }));
  return ordered.filter((s, at) => ordered.findIndex((x) => x.key === s.key && x.kind === s.kind) === at).map((s, at) => ({ step: at + 1, ...s }));
}

function depthOf(node, nodes, seen = new Set()) {
  if (!node.from.length || seen.has(node.requirement)) return 0;
  seen.add(node.requirement);
  return 1 + Math.max(...node.from.map((f) => depthOf(nodes.find((x) => x.requirement === f) ?? { from: [] }, nodes, seen)));
}
