// The SESSION TRAIL, for Orbit Control's Trace and Analytics pages -- read only.
//
// The projections are the engine's own (src/trace/projections/, through
// core.mjs), over the trail the hooks append to in the machine store: the
// decision trace (one turn per prompt -- what the router decided, the path the
// session took, whether it followed) and the usage analytics (commands, skills,
// flows, failures, least privilege). A projection is rebuilt on every request
// and nothing is stored beside the trail, so the page and `cli/trace.mjs` can
// never disagree. What the trail holds is metadata only: no prompt's text, no
// argument, no output, no path.
//
// 0.5.0 (B22 M3, ADR 0050): each row also carries the turn's ACTIVATION verdict
// (src/trace/projections/activation.mjs) -- the `followed` verdict, or
// over-delegated when the turn dispatched more of Orbit's agents than its strategy
// accounted for -- judged against the agents' `via` as the registry's own rows say.
// `cli/trace.mjs activation` prints the whole chain, owner-verified link included.
import { activationOf, effectiveResourcesOf, suggestedEntries, traceLog, turnOf, turnsOf, usageOf } from "../core.mjs";
import { invalid, missing } from "../errors.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const TURN_ID = /^(e-[0-9a-z]+-[0-9a-f]{8}|h-[0-9a-f]{64})(-pre)?$/;
const MAX_TURNS = 100;

export const RECORDING = { where: "this machine's Orbit store only — never sent anywhere", retentionDays: 90, switch: "the plugin's Trace option, or ORBIT_TRACE=off", never: ["a prompt's text", "a response", "a command's arguments", "a tool's output", "a path", "a file's contents"] };

function daysOf(query, fallback) {
  const n = Number(query?.days ?? fallback);
  if (!Number.isInteger(n) || n < 1 || n > 90) throw invalid("INVALID_DAYS", "days must be a whole number from 1 to 90 — the trail keeps 90 days");
  return n;
}

const eventsSince = (ctx, days) => traceLog(ctx.world.rooms, ctx.world.io).read({ sinceMs: ctx.now().getTime() - days * DAY_MS });

// A turn as a list row shows: the decision's headline and the path, never more.
// `suggested` is what the FOLLOWED verdict is judged against -- the skills and
// agents the router suggested starting -- so the column and the badge agree.
const rowOf = (t) => ({ id: t.id, session: t.session, project: t.project, at: t.at, endedAt: t.endedAt, ms: t.ms, prompt: t.prompt, intent: t.routing?.intent ?? null, confidence: t.routing?.confidence ?? null, routing: t.routing?.routing ?? null, suggested: suggestedEntries(t).map((e) => ({ kind: e.kind, id: e.id })), followed: t.followed, outcome: t.outcome, steps: t.steps.length, path: t.path.slice(0, 12) });

export function traceTurns(ctx, query) {
  const days = daysOf(query, 1);
  const events = eventsSince(ctx, days);
  const verdicts = new Map(activationOf(events, { via: viaOf(ctx), limit: MAX_TURNS }).turns.map((t) => [t.id, t.verdict]));
  return { version: 1, days, recording: RECORDING, turns: turnsOf(events, { limit: MAX_TURNS }).map((t) => ({ ...rowOf(t), activation: verdicts.get(t.id) ?? t.followed })) };
}

// The agents a parent skill alone dispatches, off the registry's own rows (`routing.via`); none when it cannot be read.
function viaOf(ctx) {
  try { return Object.fromEntries((effectiveResourcesOf({ ...ctx.world }).agents ?? []).filter((a) => a.routing.via.length).map((a) => [a.id, a.routing.via])); }
  catch { return {}; }
}

export function traceTurn(ctx, id) {
  if (!TURN_ID.test(String(id))) throw invalid("INVALID_TURN_ID", "a turn id looks like e-<time>-<8 hex>");
  const turn = turnOf(eventsSince(ctx, 90), id);
  if (!turn) throw missing("TURN_NOT_FOUND", `no turn ${id} in the last 90 days of the trail`);
  return { version: 1, turn };
}

// The least-privilege view needs each skill's pre-approved tools, off its
// SKILL.md -- the same list the Analytics page's permission matrix reads,
// handed in by the router as skill id → allowed-tools.
export function usageAnalytics(ctx, query, allowed = new Map()) {
  const days = daysOf(query, 30);
  return { version: 1, days, recording: RECORDING, ...usageOf(eventsSince(ctx, days), { allowed, sinceMs: ctx.now().getTime() - days * DAY_MS }) };
}
