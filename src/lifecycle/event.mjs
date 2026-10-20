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
};

export const EVENT_NAMES = [...new Set(Object.values(EVENTS))];

export function lifecycleEvent(host, input, argv = []) {
  const seen = host.normalize?.(input, argv) ?? null;
  const event = EVENT_NAMES.includes(seen?.event) ? seen.event : EVENTS[seen?.hostEvent];
  if (!event) return null;
  return { ...seen, event, host: host.name, session: hostSession(host.name, seen.session), paths: seen.paths ?? [], ok: okOf(seen), ...identities(host, seen) };
}

const identities = (host, seen) => seen.protocol === 2 ? { turn: hostSession(host.name, seen.turn), delivery: hostSession(host.name, seen.delivery) } : {};
