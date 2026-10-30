// Every tool a session uses → one line in that session's working set. Cheap
// on purpose: no git, no file read, no analysis -- an append of a few hundred
// bytes, in a hook the host runs in the background.
//
// It never listens to session-start: opening a session writes nothing. It
// DOES listen to post-tool-failure: a failed command is still something the
// session did, recorded as `ok: false` and never as anything more -- a failure
// here is metadata, and it is never engineering truth. Since 1.8.7 it also keeps
// a command STARTING (pre-tool) and a turn ENDING, which Orbit Live reads to say
// what this session is running now when no task's journal speaks for the work.
//
// The session a line belongs to is the host's own (hashed by
// src/lifecycle/event.mjs); a host that sends none falls back to this machine
// and this UTC day, src/memory/session.mjs's rule.
import { collect } from "../../engineering/working-set/collect.mjs";
import { sessionId } from "../../memory/session.mjs";

export const sessionOf = (event, host, at) => event.session ?? sessionId({ host, at });

export const workingSet = {
  name: "working-set",
  on: ["pre-tool", "post-tool", "post-tool-failure", "turn-end", "session-end", "agent-start", "agent-end"],
  records: true,
  run: (event, world) => appended(event, world.workingSet?.()),
};

// A native host's line carries the call's delivery key when it sent one (0.0.2), so a hook delivered twice is one call
// however long apart the two deliveries ran.
const delivered = (line, event) => (event.delivery ? { ...line, delivery: event.delivery } : line);

function appended(event, ws) {
  if (!ws) return null;
  const line = collect(event, ws.roots, ws.now());
  if (line) ws.append(sessionOf(event, ws.host, ws.now()), event.protocol === 2 ? { ...line, v: 2, delivery: event.delivery, turn: event.turn, outcome: event.outcome } : delivered(line, event));
  return null;
}
