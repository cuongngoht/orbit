// ONE shape for a lifecycle moment, whatever host raised it.
//
// A host adapter (skills/orbit-learn/hosts/) knows its host's JSON; nothing
// below this line does. It hands back a partial description -- which host
// event, which session, which tool touched which paths -- and this maps the
// host's event NAME onto the engine's six, and turns the host's session id
// into the only form this engine keeps (src/memory/session.mjs `hostSession`:
// namespaced and hashed, never the raw id).
//
// `user-prompt` carries the prompt the person typed, as `prompt`, and it is the
// one field on an event that must never be KEPT: the router reads it in this
// process's memory and nothing stores, logs or forwards it (test/router-hook).
//
// A host event with no row is not an event: `null`, and the dispatcher does
// nothing. That is the whole of "an unknown host is a safe no-op" -- the
// fallback adapter has no `normalize`, so every one of its events lands here.
//
// `synthetic` (0.5.0): an adapter's word that the HOST wrote a user-prompt itself
// (a background task's notification), carried as `true` on that event alone and
// absent everywhere else -- the router answers nothing for it. Two more marks are
// carried the same way (0.5.0, B22 M3), each on its own event alone: `held` on a
// turn-end a Stop hook already kept going (a held turn is never held again in a
// row), and `resumed` on a session-start that picks up a conversation that already
// happened (its open work is said again).
import { hostSession } from "../memory/session.mjs";
import { okOf } from "../outcome.mjs";

export const EVENTS = {
  SessionStart: "session-start",
  PreInvocation: "session-start",
  PreToolUse: "pre-tool",
  PostToolUse: "post-tool",
  PostToolUseFailure: "post-tool-failure",
  SessionEnd: "session-end",
  UserPromptSubmit: "user-prompt",
  // The host finished answering one prompt -- the boundary the session trail
  // reads a turn up to (src/trace/projections/turns.mjs).
  Stop: "turn-end",
  // A subagent began and ended (0.2.2, ADR 0044): what an agent run's own
  // lifecycle looks like from the host's side, and nothing about what it did.
  SubagentStart: "agent-start",
  SubagentStop: "agent-end",
};

export const EVENT_NAMES = [...new Set(Object.values(EVENTS))];

export function lifecycleEvent(host, input, argv = []) {
  const seen = host.normalize?.(input, argv) ?? null;
  const event = EVENT_NAMES.includes(seen?.event) ? seen.event : EVENTS[seen?.hostEvent];
  if (!event) return null;
  return { ...unmarked(seen), event, host: host.name, session: hostSession(host.name, seen.session), paths: seen.paths ?? [], ok: okOf(seen), ...identities(host, seen), ...agents(host, seen), ...marksOf(event, seen) };
}

const unmarked = ({ synthetic: _s, held: _h, resumed: _r, ...seen }) => seen;

// Each mark on the one event it can be true of, and on no other: [mark, event].
const MARKS = [["synthetic", "user-prompt"], ["held", "turn-end"], ["resumed", "session-start"]];

const marksOf = (event, seen) => Object.fromEntries(MARKS.filter(([mark, on]) => on === event && seen[mark] === true).map(([mark]) => [mark, true]));

// The agent a hook speaks for and the one an Agent call launched (0.2.2, ADR 0044), hashed the way a session is: the
// host's raw id never travels past this line. Present only when the host said one, so a main-session event is unchanged.
const agentIdOf = (host, seen) => (seen.agent?.id ? { agent: { id: hostSession(host.name, seen.agent.id), type: seen.agent.type ?? null } } : {});

const launchedIdOf = (host, seen) => (seen.launched ? { launched: hostSession(host.name, seen.launched) } : {});

const agents = (host, seen) => ({ ...agentIdOf(host, seen), ...launchedIdOf(host, seen) });

// A call's delivery key is hashed for every host that sends one (0.0.2: Claude's too); a turn is protocol 2's.
const deliveryOf = (host, seen) => (seen.delivery ? { delivery: hostSession(host.name, seen.delivery) } : {});

const identities = (host, seen) => seen.protocol === 2 ? { turn: hostSession(host.name, seen.turn), delivery: hostSession(host.name, seen.delivery) } : deliveryOf(host, seen);
