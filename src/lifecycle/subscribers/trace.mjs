// Every lifecycle moment worth a line in the SESSION TRAIL → one event
// (src/trace/). A PRODUCER and nothing more: it emits what happened and returns
// null, so the host never hears from it, and `records: false`, so a failure
// costs that line and nothing else.
//
// What it reduces each moment to, as a table:
//
//   pre-tool             a skill or an agent starting -- which, whether it is
//                        this plugin's, and whether its switch refused it
//   post-tool(-failure)  a command: the Orbit script and a subcommand its own
//                        usage documents (src/trace/commands.mjs), or else the
//                        working set's class and the bare executable -- never an
//                        argument; any other tool: its name and kind, never its
//                        input or output
//   turn-end · session-end   the boundaries a turn is read between
//   agent-start · agent-end  (0.2.2, ADR 0044) a subagent's own start and stop, by type and hashed id
//
// Every event carries the call it was about (`call`, the host's hashed delivery id) and, when a subagent made it, that
// agent's hashed id (`agent`); an Agent call that answered with the id it launched adds `agent.launched`, and one that
// handed this plugin's Satellite agent an envelope names its qualified mission run (`run`). The allow-list of each type
// keeps what it declares and drops the rest (src/trace/events.mjs).
//
// The prompt is not this subscriber's: the router's own hook emits
// `prompt.submitted` (src/lifecycle/subscribers/router.mjs), because only it
// holds the decision.
import { okOf, outcomeOf } from "../../outcome.mjs";
import { commandOf } from "../../engineering/working-set/collect.mjs";
import { componentOn, switchKey } from "../../project/components.mjs";
import { orbitCommands } from "../../trace/commands.mjs";

export const trace = {
  name: "trace",
  on: ["pre-tool", "post-tool", "post-tool-failure", "turn-end", "session-end", "agent-start", "agent-end"],
  records: false,
  run: (event, world) => emitted(event, world, world.trace?.()),
};

function emitted(event, world, t) {
  if (!t) return null;
  for (const [slot, e] of (EVENTS[event.event] ?? (() => []))(event, world, t).entries()) t.emit(e.type, defined(dataOf(event, e.data)), metaOf(event, slot));
  return null;
}

const EVENTS = {
  "pre-tool": (event, world) => invoked(event, world),
  "post-tool": (event, world, t) => [...used(event, t), ...launched(event)],
  "post-tool-failure": (event, world, t) => used(event, t),
  "turn-end": () => [{ type: "turn.ended", data: {} }],
  "session-end": () => [{ type: "session.ended", data: {} }],
  "agent-start": (event) => [{ type: "agent.started", data: { id: typeOf(event.agent) } }],
  "agent-end": (event) => [{ type: "agent.ended", data: { id: typeOf(event.agent) } }],
};

const typeOf = (agent) => (agent?.type ? String(agent.type).slice(0, 96) : null);

function invoked(event, world) {
  const invokes = event.invokes;
  if (!invokes?.name) return [];
  const ours = switchKey(invokes, world.plugin) !== null;
  return [{ type: `${invokes.kind}.invoked`, data: { id: String(invokes.name).slice(0, 96), ours, outcome: ours && !componentOn(invokes, world.env, world.plugin) ? "refused" : "started", run: event.dispatched } }];
}

// The agent an Agent call launched, as the call's own answer named it: only when it named one.
const launched = (event) => (event.launched ? [{ type: "agent.launched", data: { id: String(event.invokes?.name ?? "agent").slice(0, 96), launched: event.launched, run: event.dispatched } }] : []);

function used(event, t) {
  if (event.tool?.kind !== "command") return [{ type: "tool.used", data: { tool: String(event.tool?.name ?? "tool").slice(0, 96), kind: event.tool?.kind ?? "other", ok: okOf(event) } }];
  const orbitCmds = orbitCommands(event.command, t.lookup);
  if (orbitCmds.length) return orbitCmds.map((c) => ({ type: "command.ran", data: { orbit: c.id, sub: c.sub, ok: okOf(event) } }));
  const shell = commandOf(event);
  return shell ? [{ type: "command.ran", data: { class: shell.class, exe: shell.exe, ok: shell.ok } }] : [];
}

// What nobody said is not a field: an absent call, agent or run is left out, never written as null.
const defined = (data) => Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null));

// Which call and which agent, on every event: a type that declares neither drops them (src/trace/events.mjs).
const identityOf = (event) => ({ call: event.delivery, agent: event.agent?.id });

const dataOf = (event, data) => event.protocol === 2 ? { ...identityOf(event), ...data, outcome: outcomeOf(event) } : { ...identityOf(event), ...data };

// A delivered event's id is derived from what it is about (src/trace/emit.mjs), so a hook the host delivers twice is
// one event: a call by its delivery id, a subagent's start or stop by the agent (0.2.2: Claude Code's too).
const AGENT_LIFE = new Set(["agent-start", "agent-end"]);

const deliveryOf = (event) => event.delivery ?? (AGENT_LIFE.has(event.event) ? event.agent?.id : undefined);

const metaOf = (event, slot) => event.protocol === 2 ? { v: 2, agentHost: event.host, session: event.session, turn: event.turn, delivery: event.delivery, slot } : { session: event.session, agentHost: event.host, delivery: deliveryOf(event), slot };
