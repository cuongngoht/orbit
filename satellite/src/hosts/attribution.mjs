// WHICH HOST AGENT CARRIES AN AGENT RUN (0.2.2, ADR 0044), and what it was seen doing: a pure JOIN, at read time, of
// the mission's own runs with the session trail the host's hooks keep (src/trace/) -- never a journal line of its own,
// never a second state, and never a guess. Two kinds of word meet here, and src/attribution.mjs settles them:
//
//   observed  the hooks saw the Agent call that carried this run's envelope (`agent.invoked.run`, or the launch's own
//             `agent.launched.run`) and the agent that call launched (`agent.launched`, joined on the call)
//   reported  the dispatcher said which agent carries it (`agent ack --host-agent`: an `agentrun.bound` line)
//
// A run its host carried SERIALLY is never bound: the session followed its instruction itself, so its calls cannot be
// told from the session's own. A run reference of another mission, or of a run this mission does not have, is ignored
// and never re-rooted. One host agent named for two runs makes both CONFLICTING. What a bound agent did is the trail's
// tool events naming it (direct) and those of the agents it launched in turn (descendants), counted apart, never twice.
//
//   bindingsOf({ model, trail, trailSource }) -> Map(arn -> binding)
//   binding: { word, basis, hostAgent, agents, observed, reported, carried, hostLifecycle: { startedAt, endedAt },
//              counts: { direct, descendants, failed, unknown }, calls: [call], children: [agent] }
//   carried: how many Agent calls the hooks saw carry the run's envelope -- one seen and not answered yet is a launch
//            in progress (a foreground agent names itself only when its call ends), never a guess about which agent
//   call: { at, agent, kind, what, ok }      newest first, at most CALLS_KEPT
import { parseRunRef, runRefOf, settle } from "../../../src/attribution.mjs";
import { list } from "../store/text.mjs";

export const CALLS_KEPT = 12;

// How deep a host lets agents launch agents (Claude Code: three below the session); a chain is never followed further.
export const DEPTH = 3;

const TOOL_EVENTS = new Set(["tool.used", "command.ran"]);

const shortOf = (agent) => String(agent ?? "").slice(-8);

// The trail, sorted once by what each event is: a viewer joins on every refresh, and only an agent's own events and
// the calls a subagent made can bind or count anything (the session's own calls name no agent).
const indexOf = (trail) => ({ invoked: trail.filter((e) => e.type === "agent.invoked"), launched: trail.filter((e) => e.type === "agent.launched"), started: trail.filter((e) => e.type === "agent.started"), ended: trail.filter((e) => e.type === "agent.ended"), tools: trail.filter((e) => TOOL_EVENTS.has(e.type) && e.data.agent) });

// ---- who carries a run ----------------------------------------------------------------------------------------

const callsCarrying = (ix, ref) => new Set([...ix.invoked, ...ix.launched].filter((e) => e.data.run === ref).map((e) => e.data.call).filter(Boolean));

const observedFor = (ix, ref) => ((calls) => [...new Set(ix.launched.filter((e) => e.data.run === ref || calls.has(e.data.call)).map((e) => e.data.launched).filter(Boolean))])(callsCarrying(ix, ref));

const reportedFor = (run) => list(run.bound).map((b) => b.hostAgent).filter(Boolean);

const SERIAL = { word: "UNATTRIBUTED", agents: [], observed: [], reported: [] };

const settledFor = (ix, ref, run) => ({ ...(run.dispatch === "serial" ? SERIAL : settle({ observed: observedFor(ix, ref), reported: reportedFor(run) })), carried: run.dispatch === "serial" ? 0 : callsCarrying(ix, ref).size });

const TRAIL_SAY = { off: "is switched off here", unreadable: "could not be read here", none: "was not read by this viewer" };

// What makes a word what it is, said for a person: ordered, the first row that holds.
const BASIS = [
  { when: (b, run) => run.dispatch === "serial", say: () => "carried serially by the session: its calls cannot be told from the session's own" },
  { when: (b) => b.word === "CONFLICTING" && b.agents.length > 1, say: (b) => `${b.agents.map(shortOf).join(" and ")} are each named for it: none is chosen` },
  { when: (b) => b.word === "CONFLICTING", say: (b) => `${shortOf(b.agents[0])} is named for another run of this mission too: it is chosen for neither` },
  { when: (b) => b.word === "HOST_OBSERVED", say: (b) => `the Agent call that carried its envelope launched ${shortOf(b.hostAgent)}${b.reported.length ? ", as the dispatcher also said" : ""}` },
  { when: (b) => b.word === "REPORTED", say: (b) => `the dispatcher said ${shortOf(b.hostAgent)} carries it; no hook saw the launch` },
  { when: (b) => b.carried > 0, say: () => "the hooks saw the Agent call that carried its envelope; the agent it launched is named when that call answers -- at once for an agent in the background, at its end for one in the foreground" },
  { when: (b, run, c) => c.trailSource !== "ok", say: (b, run, c) => `the session trail ${TRAIL_SAY[c.trailSource] ?? TRAIL_SAY.unreadable}: no launch can be observed` },
  { when: () => true, say: () => "no hook saw the Agent call that carried its envelope" },
];

// ---- what the bound agent did ----------------------------------------------------------------------------------

const childrenOf = (ix, agent) => [...new Set(ix.launched.filter((e) => e.data.agent === agent).map((e) => e.data.launched).filter(Boolean))];

// Every agent a chain of launches from `agent` reaches, at most DEPTH deep and each once: a cycle stops where it closes.
function descendantsOf(ix, agent, depth = 1, seen = new Set([agent])) {
  const next = childrenOf(ix, agent).filter((c) => !seen.has(c));
  next.forEach((c) => seen.add(c));
  return depth >= DEPTH ? next : [...next, ...next.flatMap((c) => descendantsOf(ix, c, depth + 1, seen))];
}

const toolsBy = (ix, agents) => ix.tools.filter((e) => agents.includes(e.data.agent));

const okOf = (e) => (e.data.outcome === "unknown" ? null : e.data.ok ?? null);

const callOf = (e) => ({ at: e.at, agent: e.data.agent, kind: e.type === "command.ran" ? "command" : e.data.kind ?? "tool", what: e.data.orbit ? `${e.data.orbit}${e.data.sub ? ` ${e.data.sub}` : ""}` : e.data.exe ?? e.data.class ?? e.data.tool ?? null, ok: okOf(e) });

const lifecycleOf = (ix, agent) => ({ startedAt: ix.started.find((e) => e.data.agent === agent)?.at ?? null, endedAt: ix.ended.find((e) => e.data.agent === agent)?.at ?? null });

function activityOf(ix, agent) {
  const direct = toolsBy(ix, [agent]);
  const below = toolsBy(ix, descendantsOf(ix, agent));
  return { hostLifecycle: lifecycleOf(ix, agent), counts: { direct: direct.length, descendants: below.length, failed: direct.filter((e) => okOf(e) === false).length, unknown: direct.filter((e) => okOf(e) === null).length }, calls: [...direct].reverse().slice(0, CALLS_KEPT).map(callOf), children: childrenOf(ix, agent) };
}

const NOTHING = { hostLifecycle: { startedAt: null, endedAt: null }, counts: { direct: 0, descendants: 0, failed: 0, unknown: 0 }, calls: [], children: [] };

// ---- the join ------------------------------------------------------------------------------------------------------

// An agent the hooks or a dispatcher named for more than one run is never any one of theirs.
const sharedAgents = (settled) => ((counts) => new Set([...counts].filter(([, n]) => n > 1).map(([a]) => a)))([...settled.values()].flatMap((s) => s.agents).reduce((m, a) => m.set(a, (m.get(a) ?? 0) + 1), new Map()));

const finalOf = (s, shared) => (s.agents.some((a) => shared.has(a)) ? { ...s, word: "CONFLICTING", shared: true } : s);

function bindingOf(ix, s, run, c) {
  const hostAgent = s.word === "CONFLICTING" || s.agents.length !== 1 ? null : s.agents[0];
  const b = { ...s, hostAgent, ...(hostAgent ? activityOf(ix, hostAgent) : NOTHING) };
  return { ...b, basis: BASIS.find((r) => r.when(b, run, c)).say(b, run, c) };
}

// trail: the session trail's events (each { type, data, at }), oldest first; a run reference that names another
// mission is not this mission's to bind.
export function bindingsOf({ model, trail = [], trailSource = "ok" }) {
  const mission = model.meta?.id ?? null;
  const ix = indexOf(list(trail).filter((e) => e?.data && (!e.data.run || parseRunRef(e.data.run)?.mission === mission)));
  const settled = new Map([...model.runs.values()].map((run) => [run.id, settledFor(ix, runRefOf(mission, run.id), run)]));
  const shared = sharedAgents(settled);
  return new Map([...model.runs.values()].map((run) => [run.id, bindingOf(ix, finalOf(settled.get(run.id), shared), run, { trailSource })]));
}
