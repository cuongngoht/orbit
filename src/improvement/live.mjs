// A campaign as a LIVE SOURCE (0.3.0, ADR 0045): which campaigns a task names (an evaluation task links the campaign it
// evaluates for, as an `improvement` receipt), each campaign's projection (views.mjs, the one every reader draws) and its
// journal's newest lines as Live events -- an allow-list per line, a name per kind. Handed to src/live/ by a composition
// root (cli/live.mjs, Orbit Control's core), never imported there; reading creates nothing and writes nothing.
//
//   IMPROVEMENT_SOURCE
//     campaignsOf(taskView) -> [imp-…]                      at most four
//     open(storeRoot, io, values?) -> { read(id) -> view | null, list() -> [row] }
//     fingerprintOf(view) -> what makes a viewer get the projection again
//     eventsOf(lines, meta) -> [event]                       the newest, bounded
import { createImprovement, journalLine } from "./store.mjs";
import { modelOf } from "./model.mjs";
import { campaignRow, campaignView } from "./views.mjs";

const CAMPAIGN = /^imp-[a-f0-9]{12}$/;

const MAX_FOLLOWED = 4;

const MAX_EVENTS = 24;

export const campaignsOf = (view) => [...new Set((view?.receipts ?? []).filter((r) => r.domain === "improvement" && CAMPAIGN.test(String(r.ref ?? ""))).map((r) => r.ref))].slice(0, MAX_FOLLOWED);

// What each kind of line is called on Live, in the names the transitions are known by.
export const EVENT_NAMES = { started: "improvement.detected", diagnosed: "improvement.diagnosed", proposed: "improvement.proposed", generating: "candidate.generating", generated: "candidate.proposed", "generation-refused": "candidate.refused", validated: "candidate.validated", "evaluation-started": "evaluation.started", "evaluation-run": "evaluation.run", linked: "evaluation.linked", "evaluation-settled": "evaluation.completed", "evaluation-interrupted": "evaluation.interrupted", qualified: "candidate.qualified", gated: "candidate.gated", "awaiting-authority": "candidate.awaiting_authority", "promotion-started": "candidate.promoting", "promotion-interrupted": "candidate.promotion_interrupted", promoted: "candidate.promoted", rejected: "candidate.rejected", observed: "candidate.monitored", regression: "regression.detected", "rollback-started": "candidate.rolling_back", "rollback-interrupted": "candidate.rollback_interrupted", "rolled-back": "candidate.rolled_back", blocked: "improvement.blocked", unblocked: "improvement.unblocked", ended: "improvement.completed", learned: "improvement.learned" };

// What an event may carry: ids, words, pins and counts -- never a sentence a host wrote, and nothing else of a line.
const FIELDS = ["evaluation", "task", "side", "n", "verdict", "outcome", "stop", "needs", "door", "by", "mode", "attribution", "evidence", "word", "from", "to", "candidate", "pin", "reason", "cause", "confidence", "failed"];

const eventOf = (id, meta) => (line, n) => ({ event: EVENT_NAMES[line.kind] ?? "improvement.other", campaign: id, n, at: line.at, subject: meta?.subjectId ?? null, subjectPin: meta?.pin ?? null, ...Object.fromEntries(FIELDS.filter((k) => line[k] !== undefined && typeof line[k] !== "object").map((k) => [k, line[k]])) });

export const eventsOf = (id, lines) => ((meta) => lines.map(eventOf(id, meta)).slice(-MAX_EVENTS))(lines.find((l) => l.kind === "started") ?? null);

export const fingerprintOf = (view) => `${view.revision}|${view.phase}|${view.blocked?.stop ?? ""}`;

const viewWith = (store, values) => (id) => ((lines) => (lines ? { ...campaignView(id, modelOf(lines), values), events: eventsOf(id, lines) } : null))(CAMPAIGN.test(String(id)) ? store.read(id) : null);

export const IMPROVEMENT_SOURCE = Object.freeze({
  version: 1,
  campaignsOf,
  line: journalLine,
  fingerprintOf,
  open: (storeRoot, io, values = {}) => ((store) => ({ read: viewWith(store, values), list: () => store.list().map(viewWith(store, values)).filter(Boolean).map(campaignRow) }))(createImprovement(storeRoot, io)),
});
