// What a RUNTIME fact may SAY, as tables -- the same discipline as
// src/architecture/vocab.mjs and for the same reason: closed word lists with the
// columns a rule asks of them, so no module below tests a name.
//
// The subject is what a CHECKOUT needs in order to run: which components it has,
// what each requires, how each is built, started and tested, where each listens,
// which servers it depends on, and how an environment for it is already defined.
// It is checkout-scoped on purpose. Architecture, intelligence and knowledge are
// project-scoped, and nothing they hold can differ between two branches; a
// manifest, a port and a dev container definition can, so they live here, in a
// room keyed by the checkout.
//
// Nothing in this file names a runtime, a package manager, a framework, a
// product or a vendor. A requirement's id arrives from an ecosystem adapter
// (src/ecosystems/) and what it MEANS on a machine is a row of
// catalog/runtimes.json. The words below are about KINDS of evidence and KINDS of
// component, which every stack has in some spelling.

// What kind of thing a fact is. `fields` lists the extra fields that kind may
// carry, the way a verb's row lists its own.
export const KINDS = [
  { name: "component", fields: ["name", "dir", "componentKind", "ecosystem"], doc: "something this checkout builds or runs: a unit its manifests declare, or the directory a script file belongs to" },
  { name: "requirement", fields: ["component", "requirement", "range", "stage"], doc: "what a component needs, under the id its ecosystem reports it by. With no component, it applies to the whole checkout. `stage` says what for: to RUN, or only to develop and test it" },
  { name: "command", fields: ["component", "purpose", "declaredAs", "text", "argv", "cwd", "runner", "safe", "ports", "portOverride", "implied"], doc: "a way to build, start or test, as the project declares it. Never one guessed from what an ecosystem usually does" },
  { name: "dependency", fields: ["component", "dependsOn", "reference", "via"], doc: "that one component DEPENDS on another of the same checkout, or inherits a shared file: a manifest names a unit by path or by its own name, or a shared build file reaches it. `dependsOn` is absent when the reference matched no unit read -- then what depends on what is UNKNOWN, and said" },
  { name: "port", fields: ["component", "port"], doc: "a TCP port a file says something listens on" },
  { name: "service", fields: ["service", "image", "port", "name"], doc: "a server the project is defined with -- a database, a cache, a queue -- as a container file declares it" },
  { name: "readiness-signal", fields: ["component", "probe", "target"], doc: "how a file says to tell that something is up. Never one invented for a stack" },
  { name: "environment-definition", fields: ["mechanism", "definition"], doc: "an existing environment definition, summarised: what it provides, never what it runs" },
  { name: "os-constraint", fields: ["component", "os", "exclusive"], doc: "the operating systems a file evidences the project runs on. `exclusive` is false unless a file says nothing else will do" },
];

// WHERE a fact came from, and whether that place counts as evidence read from the
// checkout. `inference` is what an agent concluded from prose, written down with
// its reasons through `runtime record`; it is never verified and never certain.
// Two facts that disagree about one subject are both kept and both held against a
// machine: a requirement a manifest states and one a version file pins must BOTH be
// met, so nothing here ranks one source above another.
export const SOURCES = [
  { name: "manifest", verified: true, doc: "a manifest an ecosystem adapter read" },
  { name: "version-file", verified: true, doc: "a file whose whole job is to pin a version" },
  { name: "script", verified: true, doc: "a build or task file: a Makefile, a task runner's file" },
  { name: "container-file", verified: true, doc: "a container build or compose file, or a dev container definition" },
  { name: "ci", verified: true, doc: "a pipeline definition: what it says it runs on" },
  { name: "inference", verified: false, doc: "what an agent concluded from prose. A hypothesis with its reasons, never a fact" },
];

export const CONFIDENCE = [
  { name: "certain", routes: true, doc: "a file declares it, and the declaration was read" },
  { name: "possible", routes: false, doc: "a heuristic over shape, or an inference. Worth showing, never worth acting on alone" },
  { name: "unknown", routes: false, doc: "nothing here could determine it" },
];

// Whether the evidence has moved since the fact was recorded. The words are the
// plan checker's and architecture's, because they mean the same thing: `stale`
// is NEEDS A RE-READ and never means false.
export const STATUS = [
  { name: "fresh", counts: true, doc: "the scope's fingerprint is what it was when this was recorded" },
  { name: "stale", counts: false, doc: "the scope moved. Re-read it" },
  { name: "unknown", counts: false, doc: "the scope could not be fingerprinted: it is gone, has uncommitted edits, or there is no checkout to ask" },
];

// What kind of component something is. `live` says how a running one is LOOKED AT when a change to
// it is verified live -- through a browser, over HTTP, by the messages it handles -- a word for a
// strategy, never a tool; null for one that is never run on its own. `starts` says whether it is something to
// START: a library is built, a command-line tool runs and exits, a database is a
// service somebody else runs. A component that does not start never blocks a
// project from being ready, and never needs a start command.
export const COMPONENT_KINDS = [
  { name: "web", starts: true, live: "browser", doc: "a site or web application" },
  { name: "api", starts: true, live: "http", doc: "a service other programs call" },
  { name: "worker", starts: true, live: "messages", doc: "a background process" },
  { name: "scheduler", starts: true, live: "schedule", doc: "something that runs on a timetable" },
  { name: "desktop", starts: true, live: "window", doc: "a program with a window" },
  { name: "custom-service", starts: true, live: "process", doc: "something with a way to start that nothing says more about" },
  { name: "cli", starts: false, live: null, doc: "a command-line tool: it runs and exits" },
  { name: "library", starts: false, live: null, doc: "code other components use" },
  { name: "test-harness", starts: false, live: null, doc: "tests, and whatever they need to run" },
  { name: "database", starts: false, live: null, doc: "a data store a project depends on" },
  { name: "cache", starts: false, live: null, doc: "a cache a project depends on" },
  { name: "queue", starts: false, live: null, doc: "a message queue a project depends on" },
];

// What a command is FOR, read off the name its project gave it -- never off what
// the command does. `start:https`, `dev` and `serve` are names a project chose;
// a name this table does not know is `other`, and no command is ever promoted to
// a purpose by guessing. `prefer` orders the commands that can start a
// component, because a project that declares both `dev` and `start` has to be
// asked which, and the default must be one anybody can see.
export const PURPOSES = [
  { name: "start", match: /^(start|serve|dev|run|watch|up)$/i, prefer: ["dev", "start", "serve", "run", "watch", "up"], doc: "brings the component up" },
  { name: "build", match: /^(build|compile|bundle|package)$/i, doc: "produces what is run" },
  { name: "test", match: /^(test|tests|spec|e2e|integration)$/i, doc: "runs the project's tests" },
  { name: "verify", match: /^(lint|typecheck|validate|verify)$/i, doc: "checks what is there without running it: a linter, a type checker, a configuration's own validation" },
  { name: "restore", match: /^restore$/i, doc: "fetches what a unit's manifests pin so it can build. It runs only in a sandbox, under a person's standing trust, and only the one a catalog row implies" },
];

// How readiness can be asked. `process` is the only one that needs nothing
// declared: it says the process is alive, which is RUNNING and not READY.
//
// There is no `command` probe, on purpose. A readiness check runs on every read of a runtime's
// status, a setting is a person's preference and never a command, and a command a FILE declared
// is a way to build, start or test and not a way to ask whether something answers: so asking is a
// port or a URL, on this machine, and nothing that runs a program.
export const PROBES = [
  { name: "process", needsTarget: false, doc: "the process is alive" },
  { name: "tcp", needsTarget: true, doc: "a TCP port accepts a connection on this machine" },
  { name: "http", needsTarget: true, doc: "a URL on this machine answers with the expected status" },
];

// How one component is known to depend on another: its own manifest names it (by path or by name), or
// a shared file every unit beneath it inherits reaches it. Evidence a file states, never an import
// nothing declared.
export const DEPENDENCY_VIA = ["manifest", "shared"];

// What a requirement is NEEDED FOR. A component that is started needs what it
// needs to RUN; the tools a person needs to develop and test it -- a browser
// driver listed under development dependencies -- are not held against starting
// it, and ARE held against an environment built to develop in and against a
// test run. Absent means `run`.
export const STAGES = ["run", "development"];

// What can be understood of a checkout, as one word (src/runtime/ensure.mjs).
export const UNDERSTANDING = ["NOT_DISCOVERED", "CURRENT", "STALE", "PARTIAL", "UNKNOWN"];

const index = (rows) => Object.fromEntries(rows.map((r) => [r.name, r]));

export const names = (rows) => rows.map((r) => r.name);

export const KIND_NAMES = names(KINDS);
export const SOURCE_NAMES = names(SOURCES);
export const CONFIDENCE_NAMES = names(CONFIDENCE);
export const STATUS_NAMES = names(STATUS);
export const COMPONENT_KIND_NAMES = names(COMPONENT_KINDS);
export const PURPOSE_NAMES = [...names(PURPOSES), "other"];
export const PROBE_NAMES = names(PROBES);

const BY_KIND = index(KINDS);
const BY_SOURCE = index(SOURCES);
const BY_COMPONENT = index(COMPONENT_KINDS);
const BY_CONFIDENCE = index(CONFIDENCE);

export const fieldsOf = (kind) => BY_KIND[kind]?.fields ?? [];

export const kindsWith = (field) => KINDS.filter((k) => (k.fields ?? []).includes(field)).map((k) => k.name);

// Asked of the TABLE, so a fact cannot answer it about itself.
export const verifiedBy = (source) => BY_SOURCE[source]?.verified === true;

export const routes = (confidence) => BY_CONFIDENCE[confidence]?.routes === true;

// A kind this table does not know is treated as something to START: a component
// nobody could classify must not be silently excused from needing a command.
export const startsKind = (kind) => BY_COMPONENT[kind]?.starts !== false;

// The purpose a declared name says: `start:https` is `start`, `test:unit` is
// `test`, `lint` is `other`.
export function purposeOf(declaredAs) {
  const head = String(declaredAs ?? "").split(/[:/]/)[0];
  return PURPOSES.find((p) => p.match.test(head))?.name ?? "other";
}

// How early a start-purpose name is preferred as the default; later names, and
// names this table does not rank, come after.
export function preferenceOf(declaredAs) {
  const head = String(declaredAs ?? "").split(/[:/]/)[0].toLowerCase();
  const order = PURPOSES.find((p) => p.name === "start").prefer;
  const at = order.indexOf(head);
  return at < 0 ? order.length : at;
}

// How a running component of this kind is looked at, when a change to it is verified live; null when never.
export const liveOf = (kind) => BY_COMPONENT[kind]?.live ?? null;
