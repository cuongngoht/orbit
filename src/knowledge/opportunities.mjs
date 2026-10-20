// CAPABILITY OPPORTUNITIES -- a way to prove something this project does that
// nothing here provides yet. An opportunity, never a failure: development goes
// on, nothing is provisioned, and the gap is REMEMBERED, so the next workflow
// that actually needs it finds it instead of rediscovering it.
//
// ONE per missing capability (`opp-<hash of the capability>`), whatever number
// of subjects or contexts need it -- those are its `needs`, bounded inside it --
// so one missing capability is one question, never one per consequence.
//
// Its life is two tables. The ENGINE moves what evidence moves: a gap
// discovered, rediscovered, provided at last, gone stale. A PERSON decides:
// defer ("not now"), accept ("prepare it"), ignore, reopen. Neither may make the
// other's moves (TRANSITIONS `by`), and accepting provisions nothing: a builder
// (orbit-qc-builder) picks an accepted opportunity up as its input.
//
// A run is authoritative only for what it EXAMINED -- the subjects it walked
// from, in the context it was asked in. A verify over one feature never stales
// an opportunity another feature raised. And a need that rests on anything a
// host's memory said this session never enters the store at all.
import { Refused } from "../errors.mjs";
import { short } from "../hash.mjs";
import { KEEP_SESSIONS } from "../memory/support.mjs";
import { sessionMarks } from "../memory/session.mjs";
import { quote } from "../quote.mjs";
import { scrub } from "../scrub.mjs";
import { applies } from "./applies.mjs";

export const STATES = ["candidate", "offered", "deferred", "accepted", "resolved", "ignored", "stale"];
export const MAX_OPPORTUNITIES = 256;
export const MAX_NEEDS = 16;
export const MAX_HISTORY = 16;
export const MAX_WORKFLOWS = 8;

export const TRANSITIONS = [
  { action: "offer", by: "engine", from: ["candidate"], to: "offered" },
  { action: "resolve", by: "engine", from: ["candidate", "offered", "deferred", "accepted", "stale"], to: "resolved" },
  { action: "stale", by: "engine", from: ["candidate", "offered", "deferred", "accepted"], to: "stale" },
  { action: "raise", by: "engine", from: ["resolved", "stale"], to: "candidate" },
  { action: "defer", by: "person", from: ["candidate", "offered", "accepted"], to: "deferred" },
  { action: "accept", by: "person", from: ["candidate", "offered", "deferred"], to: "accepted" },
  { action: "ignore", by: "person", from: ["candidate", "offered", "deferred", "accepted", "stale"], to: "ignored" },
  { action: "reopen", by: "person", from: ["ignored", "deferred", "accepted", "stale", "resolved"], to: "candidate" },
];

export const DECISIONS = TRANSITIONS.filter((t) => t.by === "person").map((t) => t.action);

export const opportunityId = (capability) => `opp-${short(String(capability), 12)}`;

const allowed = (state, action) => TRANSITIONS.some((t) => t.action === action && t.from.includes(state));

// Only what does not rest on a host's hint may ever be kept.
const persistable = (result) => result.needs.filter((n) => !n.session);

const needOf = (n) => ({ ...n.proves, context: n.context, conditional: n.conditional, tier: n.tier, because: n.because.slice(0, 8), by: n.by });

const entry = (run, action, by, reason) => ({ at: run.at, action, by, ...(run.workflow ? { workflow: run.workflow } : {}), ...(run.purpose ? { purpose: run.purpose } : {}), ...(reason ? { reason } : {}) });

const historyOf = (doc, line) => [...(doc.history ?? []), line].slice(-MAX_HISTORY);

// What this run did to each opportunity: one row per capability it resolved, and
// the staling of any it examined the subjects of and no longer derived.
export function discovered(docs, results, run) {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const touched = results.map((r) => ENGINE.find((e) => e.when(byId.get(opportunityId(r.capability)) ?? null, r)).apply(byId.get(opportunityId(r.capability)) ?? null, r, run)).filter(Boolean);
  const unmentioned = docs.filter((d) => !results.some((r) => opportunityId(r.capability) === d.id)).map((d) => unexamined(d, run)).filter(Boolean);
  return [...touched, ...unmentioned];
}

const ENGINE = [
  { name: "create", when: (doc, r) => !doc && r.gap && persistable(r).length > 0, apply: (doc, r, run) => created(r, run) },
  { name: "raise", when: (doc, r) => Boolean(doc) && r.gap && allowed(doc.state, "raise") && persistable(r).length > 0, apply: (doc, r, run) => ({ ...merged(doc, r, run), state: "candidate", history: historyOf(doc, entry(run, "raise", "engine")) }) },
  { name: "merge", when: (doc, r) => Boolean(doc) && r.gap && persistable(r).length > 0, apply: (doc, r, run) => merged(doc, r, run) },
  { name: "resolve", when: (doc, r) => Boolean(doc) && r.outcome === "provided" && allowed(doc.state, "resolve"), apply: (doc, r, run) => ({ ...doc, state: "resolved", resolvedBy: r.provider?.key ?? null, last: run.at, history: historyOf(doc, entry(run, "resolve", "engine")) }) },
  { name: "none", when: () => true, apply: () => null },
];

function created(r, run) {
  const needs = persistable(r).map(needOf).slice(0, MAX_NEEDS);
  return { id: opportunityId(r.capability), capability: r.capability, state: "candidate", remedy: r.remedy, needs, first: run.at, last: run.at, resolvedBy: null, decided: null, offered: null, asked: {}, history: [entry(run, "discovered", "engine")] };
}

// The needs a run did NOT examine are kept as they were; the ones it examined
// are replaced by what it derived now.
function merged(doc, r, run) {
  const kept = (doc.needs ?? []).filter((n) => !examined(n, run));
  return { ...doc, remedy: r.remedy, needs: [...persistable(r).map(needOf), ...kept].slice(0, MAX_NEEDS), last: run.at };
}

const examined = (need, run) => (run.subjects ?? []).includes(need.subject) && applies(need.context, run.context ?? {}) !== "excluded";

function unexamined(doc, run) {
  const kept = (doc.needs ?? []).filter((n) => !examined(n, run));
  if (kept.length === (doc.needs ?? []).length) return null;
  if (kept.length || !allowed(doc.state, "stale")) return { ...doc, needs: kept, last: run.at };
  return { ...doc, needs: [], state: "stale", last: run.at, history: historyOf(doc, entry(run, "stale", "engine")) };
}

// A PERSON's decision, and nothing but: the engine's moves are refused here.
export function decided(doc, action, run) {
  const row = TRANSITIONS.find((t) => t.action === action && t.by === "person");
  if (!row) throw new Refused(`"${action}" is not a decision a person makes here — ${DECISIONS.join(", ")}`);
  if (!row.from.includes(doc.state)) throw new Refused(`${doc.id} is ${doc.state}; "${action}" applies only to ${row.from.join(", ")}`);
  const reason = run.reason ? quote(scrub(run.reason), 200) : null;
  return { ...doc, state: row.to, decided: { action, at: run.at, ...(reason ? { reason } : {}) }, history: historyOf(doc, entry(run, action, "person", reason)) };
}

// Surfaced to a person in this workflow: remembered by session, so the same
// session never asks twice, and a candidate becomes offered.
export function askedIn(doc, run) {
  const marks = [...(doc.asked?.[run.workflow] ?? []), ...sessionMarks(run.seenBy)].slice(-KEEP_SESSIONS);
  const asked = Object.fromEntries(Object.entries({ ...(doc.asked ?? {}), [run.workflow]: marks }).slice(-MAX_WORKFLOWS));
  const state = allowed(doc.state, "offer") ? "offered" : doc.state;
  return { ...doc, state, offered: doc.offered ?? run.at, asked, history: historyOf(doc, entry(run, state === doc.state ? "resurfaced" : "offer", "engine")) };
}

// The only caller of `know.saveOpportunity` -- a test greps for it. A new
// opportunity past the bound is refused and said; a decision is never pruned.
export function settle(ctx, docs) {
  const existing = new Set(ctx.know.opportunities().map((d) => d.id));
  const room = MAX_OPPORTUNITIES - existing.size;
  const fresh = docs.filter((d) => !existing.has(d.id));
  const kept = [...docs.filter((d) => existing.has(d.id)), ...fresh.slice(0, Math.max(0, room))];
  return { written: kept.map((d) => (ctx.know.saveOpportunity(d), d.id)), refused: fresh.slice(Math.max(0, room)).map((d) => d.id) };
}
