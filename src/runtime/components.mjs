// The facts of one checkout, laid out as what a person means by "the project":
// its components, and for each what it requires, how it is built, started and
// tested, and where it listens.
//
// Pure. It joins facts by the `component` key they carry and hands the rest --
// anything that belongs to the checkout as a whole -- over as `shared`, to be held
// against every component that is started. Nothing is decided here: which of two
// start commands runs, whether a machine can run it, and whether it is ready are
// the questions of the modules that ask this one.
import { preferenceOf, purposeOf, startsKind } from "./vocab.mjs";

export function componentsOf(facts) {
  const by = (kind) => facts.filter((f) => f.kind === kind);
  const components = by("component").map((c) => ({ key: c.key, name: c.name, dir: c.dir, kind: c.componentKind, ecosystem: c.ecosystem ?? null, source: c.source, evidence: c.evidence, ...belonging(facts, c.key) }));
  const definitions = by("environment-definition").map(definitionOf);
  return { components: components.sort((a, b) => a.key.localeCompare(b.key)), shared: belonging(facts, null), services: serversAmong(by("service").map(serviceOf), definitions), definitions };
}

// A compose service a dev container definition runs AS its own container -- its `service`, in a
// compose file it brings up -- is the environment, never a server the project is defined with.
function serversAmong(services, definitions) {
  const own = new Set(definitions.flatMap((d) => (d.definition?.service ? (d.definition.references ?? []).map((file) => `${file}|${d.definition.service}`) : [])));
  return services.filter((s) => !own.has(`${s.file}|${s.name}`));
}

const sameOwner = (f, key) => (f.component ?? null) === key;

function belonging(facts, key) {
  const mine = facts.filter((f) => sameOwner(f, key));
  const commands = mine.filter((f) => f.kind === "command").map(commandOf);
  return { requirements: mine.filter((f) => f.kind === "requirement").map(requirementOf), dependencies: mine.filter((f) => f.kind === "dependency").map(dependencyOf), commands: commands.filter((c) => !c.implied).sort(byPreference), restore: commands.find((c) => c.implied && c.purpose === "restore") ?? null, ports: mine.filter((f) => f.kind === "port").map(portOf), os: mine.filter((f) => f.kind === "os-constraint").map(osOf) };
}

const requirementOf = (f) => ({ id: f.id, requirement: f.requirement, range: f.range ?? null, stage: f.stage ?? "run", confidence: f.confidence, source: f.source, evidence: f.evidence, why: f.because ?? null });

const commandOf = (f) => ({ id: f.id, purpose: f.purpose ?? purposeOf(f.declaredAs), declaredAs: f.declaredAs, text: f.text ?? "", argv: f.argv ?? [], cwd: f.cwd ?? ".", safe: f.safe === true, runner: f.runner ?? null, ports: f.ports ?? null, portOverride: f.portOverride ?? null, implied: f.implied === true, scope: f.scope ?? f.evidence, why: f.because ?? null, evidence: f.evidence });

const dependencyOf = (f) => ({ id: f.id, dependsOn: f.dependsOn ?? null, reference: f.reference, via: f.via, evidence: f.evidence });

const portOf = (f) => ({ id: f.id, port: f.port, confidence: f.confidence, evidence: f.evidence });

const osOf = (f) => ({ id: f.id, os: f.os ?? [], exclusive: f.exclusive === true, source: f.source, evidence: f.evidence });

const serviceOf = (f) => ({ id: f.id, service: f.service, name: f.name ?? f.service, image: f.image ?? null, port: f.port ?? null, file: f.evidence[0], evidence: f.evidence });

const definitionOf = (f) => ({ id: f.id, path: f.key, mechanism: f.mechanism, definition: f.definition, evidence: f.evidence });

const byPreference = (a, b) => preferenceOf(a.declaredAs) - preferenceOf(b.declaredAs) || a.declaredAs.localeCompare(b.declaredAs);

// The command that STARTS a component: one a file declared, whose name says it
// starts something, that can be launched without a shell -- the one a person
// chose by name (`choice`, from the checkout's settings) or else the first by the
// order the project's own names suggest. -> { command } | { none: why }
export function startCommand(component, choice = null) {
  if (!startsKind(component.kind)) return { none: `a ${component.kind} is not something to start` };
  const starts = component.commands.filter((c) => c.purpose === "start");
  if (!starts.length) return { none: "no file declares a way to start it" };
  const chosen = choice ? starts.find((c) => c.declaredAs === choice) : starts.find((c) => c.safe);
  return chosen?.safe ? { command: chosen, alternatives: starts.filter((c) => c !== chosen && c.safe).map((c) => c.declaredAs) } : { none: whyNot(starts, chosen, choice) };
}

function whyNot(starts, chosen, choice) {
  if (choice && !chosen) return `the setting names ${JSON.stringify(choice)} as its start command, and no file declares one of that name`;
  return (chosen ?? starts[0]).why ?? "its command cannot be launched without a shell";
}

// What is evidenced as a way to TEST: every command whose name says so, safe or
// not, for a person to read. Which is the right one for a change is not decided.
export const testCommands = (component) => component.commands.filter((c) => c.purpose === "test");
