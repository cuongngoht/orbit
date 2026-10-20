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
  on: ["pre-tool", "post-tool", "post-tool-failure", "turn-end", "session-end"],
  records: false,
  run: (event, world) => emitted(event, world, world.trace?.()),
};

function emitted(event, world, t) {
  if (!t) return null;
  for (const [slot, e] of (EVENTS[event.event] ?? (() => []))(event, world, t).entries()) t.emit(e.type, dataOf(event, e.data), metaOf(event, slot));
  return null;
}

const EVENTS = {
  "pre-tool": (event, world) => invoked(event.invokes, world),
  "post-tool": (event, world, t) => used(event, t),
  "post-tool-failure": (event, world, t) => used(event, t),
  "turn-end": () => [{ type: "turn.ended", data: {} }],
  "session-end": () => [{ type: "session.ended", data: {} }],
};

function invoked(invokes, world) {
  if (!invokes?.name) return [];
  const ours = switchKey(invokes, world.plugin) !== null;
  return [{ type: `${invokes.kind}.invoked`, data: { id: String(invokes.name).slice(0, 96), ours, outcome: ours && !componentOn(invokes, world.env, world.plugin) ? "refused" : "started" } }];
}

function used(event, t) {
  if (event.tool?.kind !== "command") return [{ type: "tool.used", data: { tool: String(event.tool?.name ?? "tool").slice(0, 96), kind: event.tool?.kind ?? "other", ok: okOf(event) } }];
  const orbitCmds = orbitCommands(event.command, t.lookup);
  if (orbitCmds.length) return orbitCmds.map((c) => ({ type: "command.ran", data: { orbit: c.id, sub: c.sub, ok: okOf(event) } }));
  const shell = commandOf(event);
  return shell ? [{ type: "command.ran", data: { class: shell.class, exe: shell.exe, ok: shell.ok } }] : [];
}

const dataOf = (event, data) => event.protocol === 2 ? { ...data, outcome: outcomeOf(event) } : data;
const metaOf = (event, slot) => event.protocol === 2 ? { v: 2, agentHost: event.host, session: event.session, turn: event.turn, delivery: event.delivery, slot } : { session: event.session };
