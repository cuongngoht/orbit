// What the ECOSYSTEM ADAPTERS say a checkout needs and can run -- the
// deterministic half of discovery, read through the registry that already knows
// every manifest format (src/ecosystems/) and never through a second one.
//
// A manifest an adapter reads is a UNIT: something buildable, with the
// requirements it declares, the commands it says it can run, the ports it says
// it listens on, and the kind of unit its format declares it to be. This reader
// turns each into OBSERVATIONS -- plain records anchored to a directory -- and
// leaves deciding which component an observation belongs to for the assembler,
// so no reader has to know another exists.
//
// What it will NOT do is decide a command from a stack. A command is offered only
// when the manifest declares it (a script, a launch profile) or when a declared
// kind implies one the catalog says how to run (a test project), and only the
// ones whose NAME says they build, start or test: a script called `deploy` is
// evidence that it exists, and nothing here would offer to run it.
import { posix } from "node:path";
import { byDependency, impliedBy, launcherFor, restoreFor } from "../../catalog.mjs";
import { declares } from "../../../ecosystems/contract.mjs";
import { reachedBy } from "../../../ecosystems/reach.mjs";
import { purposeOf } from "../../vocab.mjs";
import { filled, tokenize } from "../commands.mjs";
import { merged } from "./merge.mjs";

const REQUIREMENT_ID = /^[a-z][a-z0-9-]*$/;

export const ecosystemsReader = {
  name: "ecosystems",
  claims: (path, input) => input.ecosystems.forPath(path) !== null,
  read: (input) => readAll(input),
};

// Every manifest is read ONCE, and together: what a shared file says reaches a unit only by a relation
// between two records -- which units sit beneath it, and which of those say nothing of their own.
function readAll(input) {
  const records = input.paths.map((path) => input.ecosystems.read(path, input.read)).filter(Boolean);
  return merged([...records.map((rec) => oneManifest(input, rec)), inherited(records), linked(records)]);
}

function oneManifest(input, rec) {
  const said = rec.unknowns.map((u) => `${rec.path}: ${u}`);
  return rec.unreadable ? { observations: [], unknowns: said, gaps: said } : derived(input, rec, rec.path, said);
}

function derived(input, rec, path, said) {
  const commands = commandsOf(input, rec, path);
  return { observations: [...unitOf(rec, path), ...requirementsOf(input, rec, path), ...commands.observations, ...portsOf(rec, path)], unknowns: [...said, ...commands.unknowns] };
}

const dirOf = (path) => posix.dirname(path);

const unitOf = (rec, path) => (rec.unit ? [{ type: "unit", path, dir: dirOf(path), ecosystem: rec.ecosystem, kinds: rec.kinds, source: "manifest" }] : []);

// What the manifest says it requires, and what a declared dependency implies by
// the catalog's own rows (a dependency that needs a browser's system libraries).
function requirementsOf(input, rec, path) {
  const declared = ownRequirements(rec).map((r) => ({ ...r, why: "the manifest declares it" }));
  const implied = rec.dependencies.filter((d) => declares(d.relationship)).flatMap((d) => byDependency(input.catalog, d.name).map((r) => ({ requirement: r.id, range: null, stage: d.role === "development" ? "development" : "run", why: `a declared ${d.role ?? ""} dependency (${d.name}) needs it`.replace("  ", " ") })));
  return [...declared, ...implied].map((r) => ({ type: "requirement", dir: dirOf(path), path, source: "manifest", confidence: "certain", ...r }));
}

// What a unit's own manifest requires. A shared file's `requires` are NOT its own -- it is not something
// that runs -- and are what it says of the units beneath it (see `inherited`).
const ownRequirements = (rec) => (rec.reach === "subtree" ? [] : requiredBy(rec));

const requiredBy = (rec) => Object.entries(rec.requires).filter(([id]) => REQUIREMENT_ID.test(id)).map(([id, range]) => ({ requirement: id, range: String(range) || null }));

// What a SHARED file says the units beneath it need, said once for each unit it reaches that states no
// target and no requirement of its own. A unit that does is held to its own: a build treats what a shared
// file sets as the default and what a project sets as the answer. Anchored at the UNIT's directory, so the
// assembler joins it to that unit and to no other; the evidence stays the shared file that says it.
function inherited(records) {
  const shared = records.filter((r) => r.reach === "subtree" && !r.unreadable && Object.keys(r.requires).length > 0);
  const byPath = new Map(records.map((r) => [r.path, r]));
  const heirs = (file) => reachedBy(records, file).map((p) => byPath.get(p)).filter(silent);
  return { observations: shared.flatMap((file) => heirs(file).flatMap((unit) => passedDown(file, unit))), unknowns: [], gaps: [] };
}

const silent = (unit) => Object.keys(unit.requires).length === 0 && unit.targets.length === 0;

const passedDown = (file, unit) => requiredBy(file).map((r) => ({ type: "requirement", dir: dirOf(unit.path), path: file.path, unit: unit.path, source: "manifest", confidence: "certain", ...r, why: `${file.path} states it for every unit beneath it that states none of its own` }));

// ---- what depends on what -------------------------------------------------------------------------------

// The relations between UNITS of this checkout that a file states, as observations anchored at the unit
// that states them: a unit it names by PATH, a unit of its own ecosystem whose own NAME it declares a
// dependency on, and every shared file that reaches it. A path that resolves to no unit read is said as
// one with no target: what depends on what is then unknown, and never assumed absent. A name no unit
// of this checkout gives itself is a package from elsewhere, which is not a relation between components.
function linked(records) {
  const units = records.filter((r) => r.unit && !r.unreadable);
  const observations = [...units.flatMap((u) => [...byPath(units, u), ...byName(units, u)]), ...sharedReach(records)];
  return { observations, unknowns: observations.filter((o) => o.via === "manifest" && !o.target).map((o) => `${o.path}: names ${o.reference}, which no unit read here resolves -- what depends on it is unknown`), gaps: [] };
}

const dependency = (unit, reference, target, via) => ({ type: "dependency", dir: dirOf(unit.path), path: via === "shared" ? reference : unit.path, unit: unit.path, reference, ...(target ? { target: target.path } : {}), via, source: "manifest", confidence: "certain" });

const resolvedPath = (unit, ref) => posix.normalize(posix.join(dirOf(unit.path), ref));

const atPath = (units, at) => units.find((u) => u.path === at || dirOf(u.path) === at) ?? null;

const byPath = (units, unit) => unit.references.map((r) => dependency(unit, r.path, atPath(units, resolvedPath(unit, r.path)), "manifest"));

const namedUnit = (units, unit, name) => units.find((u) => u !== unit && u.ecosystem === unit.ecosystem && u.name === name) ?? null;

const byName = (units, unit) => unit.dependencies.filter((d) => declares(d.relationship) && namedUnit(units, unit, d.name)).map((d) => dependency(unit, d.name, namedUnit(units, unit, d.name), "manifest"));

function sharedReach(records) {
  const byPathOf = new Map(records.map((r) => [r.path, r]));
  return records.filter((r) => r.reach === "subtree" && !r.unreadable).flatMap((file) => reachedBy(records, file).map((p) => dependency(byPathOf.get(p), file.path, null, "shared")));
}

const portsOf = (rec, path) => rec.ports.map((port) => ({ type: "port", dir: dirOf(path), path, port, source: "manifest", confidence: "certain" }));

// -> { observations, unknowns }
function commandsOf(input, rec, path) {
  const dir = dirOf(path);
  const launcher = launcherFor(input.catalog, rec.ecosystem, dir, input.has);
  const declared = rec.commands.filter(([name]) => purposeOf(name) !== "other").map(([name, text, ports, override]) => ({ ...declaredCommand(launcher, name, text), ...listening(ports), ...overriding(override) }));
  const implied = [...rec.kinds.flatMap((kind) => impliedCommand(input, rec.ecosystem, kind)), ...(rec.unit ? restoring(input, rec, launcher) : [])];
  return { observations: [...stamped([...declared, ...implied], dir, path), ...runnerOf(launcher, declared, dir, path)], unknowns: launcher.why && declared.length ? [`${path}: ${launcher.why}`] : [] };
}

// How a manifest says ONE command is told its port, when it says so: an environment variable or an argument, with
// a format that holds `{port}` once. Kept as it was declared; whether it is used is a sandbox's (src/runtime/sandbox/).
const overriding = (override) => (override && typeof override === "object" && !Array.isArray(override) ? { portOverride: override } : {});

// The ports a manifest says ONE command listens on, when it says so per command.
const listening = (ports) => (Array.isArray(ports) && ports.length && ports.every((p) => Number.isInteger(p) && p > 0 && p < 65536) ? { ports } : {});

const stamped = (commands, dir, path) => commands.map((c) => ({ type: "command", dir, path, source: "manifest", confidence: "certain", ...c }));

// The tool that runs a unit's scripts is itself a requirement of the unit.
const runnerOf = (launcher, declared, dir, path) => (launcher.via?.requires && declared.length ? [{ type: "requirement", dir, path, source: "manifest", confidence: "certain", requirement: launcher.via.requires, range: null, why: "it runs the declared scripts" }] : []);

// A script ecosystem declares script BODIES: they are run by a tool the tree
// evidences, with the script's NAME as the only thing put in front of it. Any
// other declares a command line, which is read as one.
function declaredCommand(launcher, name, text) {
  if (launcher.mode === "line") return lineCommand(name, text);
  const argv = launcher.via ? filled(launcher.via.argv, name) : null;
  const why = argv ? null : launcher.via ? `${JSON.stringify(name)} is not a plain script name` : launcher.why;
  return { declaredAs: name, text: String(text), argv: argv ?? [], safe: Boolean(argv), runner: launcher.via?.requires ?? null, why };
}

function lineCommand(name, text) {
  const read = tokenize(text);
  return { declaredAs: name, text: String(text), argv: read.argv, safe: !read.unsafe, runner: null, why: read.unsafe ? `it cannot be launched without a shell: ${read.unsafe}` : null };
}

// Restoring a unit's dependencies is not a command a project declares, so it is IMPLIED by the catalog: the tool
// its lock file names, or the one every unit of its ecosystem has. Evidence that it exists, never a thing this runs.
function restoring(input, rec, launcher) {
  const row = restoreFor(input.catalog, rec.ecosystem, launcher);
  return row ? [{ declaredAs: "restore:implied", purpose: "restore", implied: true, text: row.argv.join(" "), argv: row.argv, safe: true, runner: row.requires, why: null, ...(launcher.lock ? { lock: launcher.lock } : {}) }] : [];
}

function impliedCommand(input, ecosystem, kind) {
  const row = impliedBy(input.catalog, ecosystem, kind);
  return row ? [{ declaredAs: row.purpose ?? kind, text: row.argv.join(" "), argv: row.argv, safe: true, runner: row.requires, why: null }] : [];
}
