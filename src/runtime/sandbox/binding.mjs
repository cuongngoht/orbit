// How a component is TOLD its port, and whether it can be.
//
// A sandbox leases a port only for a component that can be told to listen on it. "Can be told" is EVIDENCE: a
// person said how (`components[key].port.override`), or the project's own files said so for that command (its
// `portOverride`, kept by discovery). Nothing here guesses that an application honours PORT, or has a flag for
// it: a component with neither is FIXED on the port its files declare, and a collision on that port is a
// BLOCKED start that names its holder -- not another port and not a kill.
//
// A binding is data -- `{ kind: "env", name, format }` or `{ kind: "argv", flag, format, after? }`, `format`
// holding `{port}` once -- so this module names no variable, no flag and no stack.
export const BINDING_SOURCES = [
  { name: "PERSON", when: (c) => Boolean(c.settings?.port?.override), pick: (c) => c.settings.port.override, say: "a person said how this component is told its port" },
  { name: "COMMAND", when: (c) => Boolean(c.command?.portOverride), pick: (c) => c.command.portOverride, say: "the project's own files say how its command is told a port" },
  { name: "FIXED", when: () => true, pick: () => null, say: "nothing says how it is told a port, so it keeps the one its files declare" },
];

// -> { binding, source }. `c` is { settings (the component's own), command }.
export const bindingOf = (c) => ((row) => ({ binding: row.pick(c), source: row.name }))(BINDING_SOURCES.find((s) => s.when(c)));

// Where a component RUNS decides whether a port can move at all: a container publishes the port its definition
// names, whatever a process inside listens on.
export const PORT_MODE = [
  { name: "CONTAINER", when: (c) => c.execution === "devcontainer", mode: "fixed", say: "a dev container publishes the port its definition names, so it is the port to use" },
  { name: "POLICY", when: (c) => c.policy?.ports?.mode === "fixed", mode: "fixed", say: "a person set the sandbox's ports to fixed" },
  { name: "MANY_PORTS", when: (c) => (c.ports ?? 0) > 1, mode: "fixed", say: "it opens more than one port, and a lease gives one" },
  { name: "NO_BINDING", when: (c) => !c.binding, mode: "fixed", say: "nothing says how it is told a port" },
  { name: "LEASE", when: () => true, mode: "lease", say: "it can be told, so a port is leased for it" },
];

export const portModeOf = (c) => PORT_MODE.find((r) => r.when(c)).mode;

const filled = (format, port) => String(format).replace("{port}", String(port));

// How a binding changes a launch: what is added to the command's arguments, and what to its environment.
// Ordered; the last always matches (no binding changes nothing).
const APPLY = [
  { kind: "env", apply: (b, port, command) => ({ argv: command.argv, env: { [b.name]: filled(b.format, port) }, names: [b.name] }) },
  { kind: "argv", apply: (b, port, command) => ({ argv: [...command.argv, ...(b.after ? [b.after] : []), b.flag, filled(b.format, port)], env: {}, names: [] }) },
  { kind: undefined, apply: (b, port, command) => ({ argv: command.argv, env: {}, names: [] }) },
];

export const withBinding = (command, binding, port) => APPLY.find((a) => a.kind === binding?.kind || a.kind === undefined).apply(binding, port, command);

// A readiness probe a person set, asked on the port the sandbox was GIVEN rather than the one the person wrote
// for their own machine. Rows are ordered; a probe that names no port is left as it is.
const ON_LEASE = [
  { kind: "tcp", when: (p) => p.source === "human", apply: (p, port) => ({ ...p, target: port }) },
  { kind: "http", when: (p) => p.source === "human", apply: (p, port) => ({ ...p, target: urlOn(p.target, port) }) },
  { kind: undefined, when: () => true, apply: (p) => p },
];

function urlOn(target, port) {
  const url = new URL(target);
  url.port = String(port);
  return url.toString();
}

export const probeOnLease = (probe, leased) => (!probe || !leased?.length ? probe : ON_LEASE.find((r) => (r.kind === probe.kind || r.kind === undefined) && r.when(probe)).apply(probe, leased[0]));
