// The DECISION TRACE -- one TURN per prompt: what the prompt router decided for
// it, and the path the session then took. A projection: a pure fold over trail
// events, rebuilt on every read, storing nothing.
//
// It shows what HAPPENED, which is all anything outside a model can see: the
// routing decision (intent, requirement graph, what it suggested), then every
// skill and agent started, every Orbit command and every other command class run,
// every tool used, in order, with outcomes -- and whether the session FOLLOWED
// the suggestion, went another way, or worked without one. Why a model chose as
// it did is not something a hook is shown, and nothing here pretends otherwise.
//
// A turn runs from its `prompt.submitted` to the next prompt, `turn.ended` or
// `session.ended`, correlated by session and time -- so an async hook's event
// that lands a moment late still joins the turn it happened in.
import { okOf } from "../../outcome.mjs";

export const MAX_TURNS = 200;
export const MAX_STEPS = 80;

const STEP = {
  "skill.invoked": (d) => ({ kind: "skill", label: d.id, ok: d.outcome !== "refused", refused: d.outcome === "refused" }),
  "agent.invoked": (d) => ({ kind: "agent", label: d.id, ok: d.outcome !== "refused", refused: d.outcome === "refused" }),
  "command.ran": (d) => (d.orbit ? { kind: "orbit", label: `${d.orbit}${d.sub ? ` ${d.sub}` : ""}`, ok: okOf(d) } : { kind: "shell", label: `${d.class ?? "other"}${d.exe ? ` (${d.exe})` : ""}`, ok: okOf(d) }),
  "tool.used": (d) => ({ kind: "tool", label: d.tool ?? d.kind ?? "tool", ok: okOf(d) }),
  "knowledge.opportunity.offered": (d) => ({ kind: "opportunity", label: `offered ${d.capability}`, ok: true }),
  "knowledge.opportunity.decided": (d) => ({ kind: "decision", label: `${d.action} ${d.capability}`, ok: true }),
  "trace.dropped": () => ({ kind: "gap", label: "the trail stopped keeping events (cap)", ok: true }),
};

export const stepOf = (e) => (STEP[e.type] ? { at: e.at, ...STEP[e.type](e.data ?? {}) } : null);

// events: oldest first, as src/trace/log.mjs reads them.
//
// Events with no session remain separate; they are never attached by timing alone.
// Each session's events in one list, appended in place (0.2.2: a copy per event made a long window quadratic).
const bySession = (m, e) => (m.has(sessionKey(e)) ? m.get(sessionKey(e)).push(e) : m.set(sessionKey(e), [e]), m);

export function turnsOf(events, opts = {}) {
  const sessions = events.filter((x) => x.session).reduce(bySession, new Map());
  const turns = [...sessions.values()].flatMap(sessionTurns);
  const all = [...turns, ...sessionTurns(events.filter((x) => !x.session))];
  return all.map(finished).sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0)).slice(0, opts.limit ?? MAX_TURNS);
}

function sessionTurns(events) {
  const turns = [];
  for (const e of events) (FOLD[e.type] ?? stepped)(turns, e);
  return turns;
}

const FOLD = {
  "prompt.submitted": (turns, e) => opened(turns, e),
  "turn.ended": (turns, e) => closed(turns, e),
  "session.ended": (turns, e) => closed(turns, e),
};

// A new prompt ends the turn before it, if nothing else did.
function opened(turns, e) {
  closed(turns, e);
  turns.push({ id: e.id, session: e.session, project: e.project, at: e.at, endedAt: null, prompt: e.data.prompt ?? null, routing: e.data, steps: [] });
}

function closed(turns, e) {
  const last = turns.at(-1);
  if (last && !last.endedAt) last.endedAt = e.at;
}

// A step before any prompt belongs to a turn nobody's prompt opened -- a
// resumed session, a trail switched on mid-way -- and is still shown.
function stepped(turns, e) {
  const step = stepOf(e);
  if (!step) return;
  if (!turns.length) turns.push({ id: `${e.id}-pre`, session: e.session, project: e.project, at: e.at, endedAt: null, prompt: null, routing: null, steps: [] });
  if (turns.at(-1).steps.length < MAX_STEPS) turns.at(-1).steps.push(step);
}

function finished(turn) {
  const t = { ...turn, steps: [...turn.steps].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)) };
  const follow = FOLLOWED.find((f) => f.when(t));
  return { ...t, path: collapsed(t.steps), outcome: OUTCOMES.find((o) => o.when(t)).outcome, followed: { verdict: follow.verdict, say: follow.say(t) }, ms: t.endedAt ? Date.parse(t.endedAt) - Date.parse(t.at) : null };
}

// Consecutive identical steps as one, counted: "Read ×4".
export function collapsed(steps) {
  const out = [];
  for (const s of steps) (out.at(-1)?.label === s.label && out.at(-1)?.kind === s.kind && out.at(-1)?.ok === s.ok ? out.at(-1).times++ : out.push({ kind: s.kind, label: s.label, ok: s.ok, times: 1 }));
  return out;
}

const OUTCOMES = [
  { outcome: "refused", when: (t) => t.steps.some((s) => s.refused) },
  { outcome: "failed", when: (t) => t.steps.some((s) => s.ok === false) },
  { outcome: "open", when: (t) => !t.endedAt },
  { outcome: "unknown", when: (t) => t.steps.some((s) => s.ok === null) },
  { outcome: "ok", when: () => true },
];

// A component's name inside its plugin: `orbit:orbit-develop` and a bare
// `orbit-develop` are one skill.
const bare = (id) => String(id ?? "").split(":").at(-1);

// What the router suggested the session START: the skills and agents it
// selected or put up for approval. A capability it selected is something the
// engine provides itself, never something a session follows or ignores.
export const suggestedEntries = (t) => [...(t.routing?.selected ?? []), ...(t.routing?.approval ?? [])].filter((e) => e.kind === "skill" || e.kind === "agent");

export const suggested = (t) => suggestedEntries(t).map((e) => bare(e.id));

export const invoked = (t) => [...new Set(t.steps.filter((s) => (s.kind === "skill" || s.kind === "agent") && !s.refused).map((s) => bare(s.label)))];

const FOLLOWED = [
  { verdict: "nothing-routed", when: (t) => t.routing?.routing !== "on", say: () => "no routing decision was recorded for this turn — the router was off, or the trail started after the prompt" },
  { verdict: "nothing-suggested", when: (t) => !suggested(t).length, say: () => "the router suggested no skill or agent, so there was nothing to follow" },
  { verdict: "followed", when: (t) => suggested(t).some((id) => invoked(t).includes(id)), say: (t) => `the router suggested ${suggested(t).join(", ")}, and the session used it` },
  { verdict: "diverged", when: (t) => invoked(t).length > 0, say: (t) => `the router suggested ${suggested(t).join(", ")}; the session used ${invoked(t).join(", ")} instead` },
  { verdict: "not-invoked", when: () => true, say: (t) => `the router suggested ${suggested(t).join(", ")}; the session started no skill or agent and worked directly` },
];

export const FOLLOW_VERDICTS = FOLLOWED.map((f) => f.verdict);

export const turnOf = (events, id) => turnsOf(events, { limit: Infinity }).find((t) => t.id === id) ?? null;

const sessionKey = (e) => e.turn ? `${e.session}/${e.turn}` : e.session;
