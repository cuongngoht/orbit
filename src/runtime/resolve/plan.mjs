// The EXECUTION PLAN: for every component of a checkout, how it would run on this
// machine -- or why it cannot -- and what that makes of the project.
//
// A pure function over what the other halves already know: the components and
// what each needs (src/runtime/components.mjs), what the machine has
// (src/runtime/machine.mjs), what environments exist, what the person set, and the
// providers. It runs nothing, reads nothing and decides nothing a provider has not
// already answered; its own job is the fold from components to a project.
//
// A project is rarely all or nothing. A React client that runs natively beside a
// classic Windows backend that cannot, on a Mac, is a PARTIAL project with one
// component that is ready and one that is unresolved -- not a failed one, and not
// a ready one. The overall word says exactly that:
//
//   READY        every component that can be started can be
//   PARTIAL      some can and some cannot
//   BLOCKED      none can yet, and at least one could once something is done
//   UNRESOLVED   none can, and nothing a person does to the machine changes that
//   UNKNOWN      nothing could tell
//   EMPTY        there is nothing to start
import { osEvidence, osMatrix } from "./os.mjs";
import { select } from "./select.mjs";

export const OVERALL = ["READY", "PARTIAL", "BLOCKED", "UNRESOLVED", "UNKNOWN", "EMPTY"];

// `world` is { view, machine, catalog, instances, checkout, envId }.
export function resolve(world, settings, providers) {
  const components = world.view.components.map((c) => planned(c, world, settings, providers));
  return { strategy: settings.strategy ?? "auto", host: { platform: world.machine.platform, arch: world.machine.arch }, platforms: world.catalog.platforms ?? [], osEvidence: osEvidence(world.view), components, overall: overallOf(components), services: world.view.services.map(({ service, port, image }) => ({ service, port, image })) };
}

function planned(component, world, settings, providers) {
  const { command, ...chosen } = select(component, world, settings, providers);
  return { key: component.key, name: component.name, kind: component.kind, ecosystem: component.ecosystem, evidence: component.evidence, os: osMatrix(component, world.view.shared, world.catalog), ...chosen, command: command ? { declaredAs: command.declaredAs, text: command.text, argv: command.argv, cwd: command.cwd, ports: command.ports ?? null } : null };
}

// The fold over the components that are something to START.
export function overallOf(components) {
  const starting = components.filter((c) => c.state !== "not-startable");
  const ready = starting.filter((c) => c.state === "ready").length;
  if (!starting.length) return "EMPTY";
  if (ready === starting.length) return "READY";
  return ready ? "PARTIAL" : worst(starting);
}

// With none ready, the most hopeful state present names the project: something
// that could work after an action beats something nobody could tell, which beats
// something that cannot work at all.
const worst = (starting) => ["blocked", "unknown", "unresolved"].find((s) => starting.some((c) => c.state === s))?.toUpperCase() ?? "UNKNOWN";
