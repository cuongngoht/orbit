// SANDBOX: run a component in a task's own workspace, through the way a person would run it.
//
// It is not a way to run anything. It is a provider that DELEGATES: it places each component on the native
// or the dev container provider, and everything that touches the machine -- a process, a container, a probe
// -- is theirs, through the Process port, unchanged. What it adds is the four things a person's runtime does
// not need: the source root is the task's workspace (the context's `root`), a start is owned by the task and
// carries the source tree it was built from, a port is one a sandbox LEASED rather than the one a file
// declares, and nothing a developer is running is ever taken for the task's own application.
//
// It is asked only in a sandbox's world (`composite`), and a person's world never sees it, so the resolver
// needs no branch for it: the candidates it answers with are the ways the component COULD run, and a person's
// own placement settings choose among them exactly as they do for a checkout.
import { portsOpenedBy } from "../readiness.mjs";
import { bindingOf, withBinding } from "../sandbox/binding.mjs";

const NOT_HERE = "a sandbox runs only a task's workspace";

const answer = (state, because, extra = {}) => ({ state, because, ...extra });

const backingOf = (id, providers) => ((p) => p ?? failed(id))((providers ?? []).find((b) => b.id === id && b.id !== "sandbox"));

function failed(id) {
  throw new Error(`a sandbox has no way to run something on ${id ?? "nothing"}: the placement it recorded is not one this engine has`);
}

// A dev container the sandbox has not built yet is what its preparation builds -- the definition is in the
// workspace, and bringing it up is `sandbox-prepare`'s step under a person's trust -- so, to place a component
// on it, it is asked about as if it were built. A person's runtime never does this: there, an unbuilt
// environment is something to design and adopt.
const willBuild = (p, world) => p.id === "devcontainer" && world.view.definitions.length > 0 && !world.instances.some((i) => i.provider === "devcontainer" && i.state === "VALIDATED");

const asIfBuilt = (world) => ({ ...world, instances: [...world.instances.filter((i) => i.provider !== "devcontainer"), { id: world.envId, kind: "sandbox", provider: "devcontainer", state: "VALIDATED", files: {}, name: "devcontainer" }] });

const candidates = (component, world, providers) => providers.filter((p) => p.id !== "sandbox" && p.id !== "isolated").map((p) => ({ provider: p.id, via: "sandbox", ...p.compatibility(component, willBuild(p, world) ? asIfBuilt(world) : world) }));

const leaseOf = (world, key) => (world.sandbox?.endpoints ?? []).find((e) => e.component === key && e.source === "lease") ?? null;

// The ports a start will open: the one it LEASED for the component, else the ones its files declare (a fixed port).
const ports = (component, command, world) => ((lease) => (lease ? [lease.port] : portsOpenedBy(component, command)))(leaseOf(world, component.key));

// Whether the place is ready, in the order a person would look: the sandbox itself, then the way it is placed.
// Ordered; the last row asks the provider that runs it.
const READY_ROWS = [
  { name: "NOT_PREPARED", when: (world) => ["ALLOCATED", "PREPARING", "AMBIGUOUS"].includes(world.sandbox?.state), ok: false, say: () => "the sandbox is not prepared: `sandbox-prepare` brings it up from the task's workspace" },
  { name: "STALE", when: (world) => world.sandbox?.state === "STALE", ok: false, say: () => "the workspace moved after the sandbox was built from it: `sandbox-start` prepares it again on the current tree" },
  { name: "RELEASED", when: (world) => world.sandbox?.state === "RELEASED", ok: false, say: () => "the sandbox was released: a new one is prepared by `sandbox-prepare`" },
];

function ready(world, deps, target) {
  const row = READY_ROWS.find((r) => r.when(world));
  return row ? { ok: row.ok, because: row.say(world) } : backingOf(target?.execution ?? "native", deps.providers).ready(world, deps);
}

// The command a component starts with and what it is told about the port it was GIVEN. A component that cannot
// be told one (nothing says how) keeps the port its files declare, and was blocked on it in the lifecycle if
// something else held it.
function bound(component, command, world, deps) {
  const lease = leaseOf(world, component.key);
  const declared = component.commands.find((c) => c.declaredAs === command.declaredAs) ?? command;
  const { binding } = bindingOf({ settings: { port: deps.portSetting }, command: declared });
  return lease && binding ? withBinding(command, binding, lease.port) : { argv: command.argv, env: {}, names: [] };
}

function started(component, command, world, deps) {
  const way = bound(component, command, world, deps);
  const launched = backingOf(deps.execution, deps.providers);
  return launched.start(component, { ...command, argv: way.argv }, world, { ...deps, env: { ...(deps.env ?? {}), ...way.env }, envNames: [...(deps.envNames ?? []), ...way.names] });
}

const here = (world) => (world.sandbox ? answer("compatible", "a sandbox runs it through the way it is placed on") : answer("incompatible", NOT_HERE));

function doctor(world) {
  return { provider: "sandbox", checks: [{ what: "a task's workspace", state: world.sandbox ? world.sandbox.state : "NOT_A_SANDBOX", because: world.sandbox ? null : NOT_HERE }], sandbox: world.sandbox ? { id: world.sandbox.id, state: world.sandbox.state, tree: world.sandbox.source?.tree ?? null, placements: world.sandbox.placements } : null };
}

const preparing = (world) => ({ provider: "sandbox", host: [], environment: [{ step: "sandbox-prepare", needed: world.sandbox?.state !== "READY", say: "prepare the sandbox from the task's workspace: understand it, restore what a person trusted, lease ports, bring up what its definition needs" }], repository: "no changes" });

const SAID = "a sandbox is prepared by `runtime sandbox-prepare`, which holds every step to a person's trust and a receipt";

export const sandbox = {
  apiVersion: "orbit.runtime-provider/v1",
  id: "sandbox",
  doc: "runs a task's workspace through the provider each component is placed on, owned by the task and isolated from a person's runtime",
  composite: true,
  reuses: false,
  compatibility: (component, world) => here(world),
  candidates,
  doctor,
  prepare: (world, deps, opts = {}) => (opts.apply ? { ok: false, because: SAID, receipt: null } : preparing(world)),
  validate: () => ({ ok: false, because: SAID, receipt: null }),
  ready,
  ports,
  start: started,
  status: (session, deps) => backingOf(session.executionProvider, deps.providers).status(session, deps),
  stop: (session, deps) => backingOf(session.executionProvider, deps.providers).stop(session, deps),
  down: (world, deps) => backingOf("devcontainer", deps.providers).down({ checkout: world.checkout, envId: world.envId }, deps),
};
