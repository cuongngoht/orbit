// OBSERVATIONS in, FACTS out: which component each thing belongs to, and what
// each thing is said to be.
//
// The readers (./readers/) each look at one kind of evidence and know nothing of
// each other. What they hand over are observations anchored to a DIRECTORY -- a
// unit here, a command there, a port, a requirement -- and this is the one place
// that joins them: an observation belongs to the nearest component at or above
// its directory, so a launch profile under `api/Properties/` is the `api`
// component's start command and a lock file at the root of a workspace serves
// every package beneath it. An observation with nothing above it belongs to the
// checkout as a whole.
//
// A component is a UNIT an ecosystem adapter read, keyed `<ecosystem>:<dir>` so
// two manifests in one directory are two components and a directory that moves is
// a new one. A script file with no unit above it is a component of its own (a
// `weak` unit), so a project that is only a Makefile and a Dockerfile still has
// somewhere to hang a build and a start.
//
// Nothing here knows an ecosystem, a runtime or a vendor. What KIND of component
// something is comes from what its format DECLARES (`kinds`) and, failing that,
// from whether it has a way to start; and every statement is a template filled
// with computed values.
import { posix } from "node:path";
import { COMPONENT_KIND_NAMES, purposeOf } from "../vocab.mjs";

const encloses = (above, dir) => above === "." || dir === above || dir.startsWith(`${above}/`);

// -> { facts: [raw fact], unknowns: [string] }
export function assemble(observations, input) {
  const components = componentsOf(observations, input.name ?? "project");
  const placed = observations.filter((o) => o.type !== "unit").map((o) => ({ ...o, component: attach(components, o) }));
  const facts = [...components.map((c) => componentFact(c, commandsBy(placed, c.key))), ...placed.map((o) => FACTS[o.type]?.(o, components)).filter(Boolean)];
  const none = components.length || placed.length ? [] : ["no component could be identified: no manifest, build file or container file this reads was found"];
  return { facts: distinct(facts), unknowns: none, gaps: none };
}

const commandsBy = (placed, key) => placed.filter((o) => o.type === "command" && o.component === key);

function componentsOf(observations, rootName) {
  const units = observations.filter((o) => o.type === "unit");
  const real = units.filter((u) => !u.weak);
  const weak = units.filter((u) => u.weak && !real.some((r) => encloses(r.dir, u.dir)));
  const all = [...real, ...weak].map((u) => ({ key: `${u.ecosystem}:${u.dir}`, dir: u.dir, ecosystem: u.ecosystem, name: u.dir === "." ? rootName : posix.basename(u.dir), kinds: u.kinds, path: u.path, source: u.source }));
  return all.filter((c, i) => all.findIndex((o) => o.key === c.key) === i);
}

// The nearest component at or above the observation's directory; two in one
// directory are told apart by which one's manifest the observation came from -- or, for a thing a
// shared file says on a unit's behalf, by the unit it was said for.
function attach(components, o) {
  if (o.dir === null || o.dir === undefined) return null;
  const above = components.filter((c) => encloses(c.dir, o.dir));
  const nearest = above.reduce((n, c) => Math.max(n, c.dir.length), -1);
  const there = above.filter((c) => c.dir.length === nearest);
  return (there.find((c) => c.path === (o.unit ?? o.path)) ?? there[0])?.key ?? null;
}

const nameOf = (components, key) => components.find((c) => c.key === key)?.name ?? "the checkout";

function componentFact(c, commands) {
  const kind = kindOf(c, commands);
  return { kind: "component", key: c.key, statement: `${c.name} is a ${kind} component, from ${c.path}`, scope: [c.path], evidence: [c.path], source: c.source, confidence: "certain", name: c.name, dir: c.dir, componentKind: kind, ecosystem: c.ecosystem, because: kindWhy(c, kind) };
}

function kindOf(c, commands) {
  const declared = c.kinds.find((k) => COMPONENT_KIND_NAMES.includes(k));
  if (declared) return declared;
  if (c.kinds.includes("test")) return "test-harness";
  return commands.some((o) => purposeOf(o.declaredAs) === "start") ? "custom-service" : "library";
}

function kindWhy(c, kind) {
  if (c.kinds.some((k) => COMPONENT_KIND_NAMES.includes(k) || k === "test")) return `its format declares it a ${c.kinds.join(", ")} unit`;
  return kind === "custom-service" ? "it declares a way to start, and nothing says more about it" : "it declares no way to start, so it is treated as code others use";
}

const FACTS = {
  requirement: (o, components) => ({ ...from(o), kind: "requirement", key: `${o.component ?? "*"}|${o.requirement}|${o.path}`, statement: `${nameOf(components, o.component)} requires ${o.requirement}${o.range ? ` ${o.range}` : ""}`, requirement: o.requirement, ...(o.range ? { range: o.range } : {}), ...(o.stage ? { stage: o.stage } : {}), ...scoped(o), because: o.why }),
  command: (o, components) => ({ ...from(o), kind: "command", key: `${o.component ?? o.dir}|${o.declaredAs}|${o.path}`, statement: `${nameOf(components, o.component)} declares a ${purposeOf(o.declaredAs)} command, ${o.declaredAs}`, purpose: o.purpose ?? purposeOf(o.declaredAs), declaredAs: o.declaredAs, text: o.text, argv: o.argv, cwd: homeOf(components, o), safe: o.safe, ...(o.runner ? { runner: o.runner } : {}), ...(o.ports ? { ports: o.ports } : {}), ...(o.portOverride ? { portOverride: o.portOverride } : {}), ...(o.implied ? { implied: true } : {}), ...scoped(o), ...(o.why ? { because: o.why } : {}) }),
  dependency: (o, components) => dependencyFact(o, components),
  port: (o, components) => ({ ...from(o), kind: "port", key: `${o.component ?? "*"}|${o.port}|${o.path}`, statement: `${nameOf(components, o.component)} is said to listen on port ${o.port}`, port: o.port, ...scoped(o) }),
  service: (o) => ({ ...from(o), kind: "service", key: `${o.service}|${o.path}`, statement: `the project is defined with a ${o.service} server${o.image ? ` (${o.image})` : ""}`, service: o.service, image: o.image, ...(o.name ? { name: o.name } : {}), ...(o.port ? { port: o.port } : {}) }),
  definition: (o) => ({ ...from(o), kind: "environment-definition", key: o.path, statement: `${o.path} defines a ${o.mechanism} environment`, scope: o.scope, mechanism: o.mechanism, definition: o.definition }),
  os: (o, components) => ({ ...from(o), kind: "os-constraint", key: `${o.component ?? "*"}|${o.path}`, statement: `${o.path} runs on ${o.os.join(", ")}`, os: o.os, exclusive: o.exclusive, ...scoped(o), because: o.because ?? "a pipeline runs there; that says where it is known to run, not where it cannot" }),
};

// One component depends on another (or inherits a shared file). A reference that resolved to no unit
// keeps no `dependsOn`: the fact says what the file names, and that nothing read answers it.
function dependencyFact(o, components) {
  const target = components.find((c) => c.path === o.target) ?? null;
  const statement = target ? `${nameOf(components, o.component)} depends on ${target.name}` : o.via === "shared" ? `${nameOf(components, o.component)} inherits ${o.reference}` : `${nameOf(components, o.component)} names ${o.reference}, which no unit read here resolves`;
  return { ...from(o), kind: "dependency", key: `${o.component ?? "*"}|${o.via}|${o.reference}`, statement, reference: o.reference, via: o.via, ...(target ? { dependsOn: target.key, scope: [o.path, target.path] } : {}), ...scoped(o) };
}

// A command runs from its COMPONENT's directory: the project a launch profile belongs to, not the
// `Properties/` folder the profile file happens to sit in. With no component above it, from where
// it was read.
const homeOf = (components, o) => components.find((c) => c.key === o.component)?.dir ?? o.dir;

const from = (o) => ({ scope: [o.path, ...(o.unit ? [o.unit] : []), ...(o.lock ? [o.lock] : [])], evidence: [o.path], source: o.source, confidence: o.confidence });

const scoped = (o) => (o.component ? { component: o.component } : {});

// The same fact said twice -- two files that state one thing -- is one fact per
// FILE, because the key carries the path; this only drops an exact repeat.
const distinct = (facts) => facts.filter((f, i) => facts.findIndex((o) => o.kind === f.kind && o.key === f.key) === i);
