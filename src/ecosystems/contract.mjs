// What an ECOSYSTEM ADAPTER is, and what reading one manifest gives back -- as
// DATA, enforced from the declaration by src/constraints.mjs.
//
// An adapter is the only place a manifest FORMAT is known: which file names
// belong to it, and how a dependency is written inside one. Everything above it
// -- the architecture's stack facts, project intelligence, the resolver -- sees
// the canonical record below and nothing else, which is what makes a new
// ecosystem a registration rather than a branch:
//
//   { id, doc, detects(path), parseManifest(path, text) }
//
// A LEAF, and it has to be. The architecture's manifest analysis and project
// intelligence both read manifests; if either owned this, the other would need
// a lateral edge to reach it -- the reason src/freshness.mjs and src/hash.mjs sit
// at this level too.
//
// Nothing here names an ecosystem. The words are about RELATIONSHIPS a manifest
// can state, which every package format this engine has met states in some
// spelling: a unit naming a package for itself, a shared file injecting one into
// the units beneath it, a central list pinning a version nobody has asked for.

// How a dependency is related to the unit it was found for. `declares` is the
// column a technology question reads: only a relationship that DECLARES is
// evidence that a unit depends on something. A centrally managed version is not
// -- it says the version is available, never that anything uses it -- and
// getting that wrong is the false positive this table exists to prevent.
export const RELATIONSHIPS = [
  { name: "direct", declares: true, doc: "a unit's own manifest names it" },
  { name: "imported", declares: true, doc: "a shared build file injects it into every unit it reaches" },
  { name: "managed", declares: false, doc: "a central list makes a version available. Nothing here says any unit uses it" },
  { name: "transitive", declares: false, doc: "pulled in by another dependency — a resolver's decision, never this project's" },
];

export const RELATIONSHIP_NAMES = RELATIONSHIPS.map((r) => r.name);

const BY_RELATIONSHIP = Object.fromEntries(RELATIONSHIPS.map((r) => [r.name, r]));

export const declares = (relationship) => BY_RELATIONSHIP[relationship]?.declares === true;

// Whether a manifest speaks for itself or for everything beneath its directory.
// `subtree` is the nearest-one-wins reading: a unit takes the closest shared
// file of that name above it, which is how every format with such files that
// this engine has met resolves them.
export const REACH = ["self", "subtree"];

export const ADAPTER_FIELDS = {
  id: { type: "string", pattern: "^[a-z][a-z0-9-]*$", doc: "The ecosystem's id — what every record read through this adapter carries as `ecosystem`." },
  doc: { type: "string", doc: "One line: what kind of manifest this adapter reads." },
};

export const ADAPTER_REQUIRED = ["id", "doc"];

export const ADAPTER_METHODS = ["detects", "parseManifest"];

// A unit this one names by PATH -- a project reference, a local package linked by its directory --
// relative to the manifest that names it, as the format writes it. Never a package name: a name is a
// dependency (above), and whether it is a unit of THIS checkout is a match on `name` the reader makes.
export const REFERENCE_FIELDS = {
  path: { type: "string", doc: "The referenced unit's manifest or directory, relative to the manifest that names it, as written." },
};

export const DEPENDENCY_FIELDS = {
  name: { type: "string", doc: "The package name, exactly as the manifest spells it. Never a version: a version tells no architectural question anything and churns every fingerprint." },
  relationship: { enum: RELATIONSHIP_NAMES, doc: "How it is related to the unit — only one that `declares` is evidence of a dependency." },
  role: { type: "string", pattern: "^[a-z][a-z0-9-]*$", doc: "What the manifest says it is for, where it says: runtime or development." },
  conditional: { type: "boolean", doc: "The manifest applies it only under a condition this read did not evaluate." },
};

// What `parseManifest` returns. Every key is optional: an adapter says what its
// format can say, and the rest defaults (see `normalized`).
export const MANIFEST_FIELDS = {
  unit: { type: "boolean", doc: "A buildable unit — a project, a package — rather than a file other units inherit from." },
  name: { type: "string", doc: "The name the unit gives itself, exactly as the manifest spells it. What another unit of the same checkout depends on when it names it as a dependency -- a reader matches the two, and this engine never guesses one from a directory." },
  dependencies: { type: "array", items: { type: "object" }, doc: "Every dependency the file states, each held to DEPENDENCY_FIELDS." },
  references: { type: "array", items: { type: "object" }, doc: "Every unit of the same checkout the file names by PATH, each held to REFERENCE_FIELDS. A reference that matches no unit read is UNRESOLVED, and said: what depends on what is then not known, never assumed absent." },
  requires: { type: "object", doc: "Runtime or toolchain ranges the manifest REQUIRES, name to range, as written. In a file that reaches a subtree it is a DEFAULT: a unit beneath it that states targets or requirements of its own is held to those, and only to those." },
  runtime: { type: "string", pattern: "^[a-z][a-z0-9-]*$", doc: "The runtime a unit targets, when the format says so." },
  targets: { type: "array", items: { type: "string" }, doc: "The concrete targets the unit builds for, as the format names them." },
  sdk: { type: "string", doc: "A toolchain version the file pins." },
  kinds: { type: "array", items: { type: "string" }, doc: "What kind of unit the format declares it to be. A declaration, never an inference about behaviour." },
  commands: { type: "array", items: { type: "array" }, doc: "[name, command] pairs the manifest declares it can run on itself -- and, as a third item, the ports that command listens on, when the manifest says so per command, and as a fourth how that command is told its port ({ kind: \"env\", name, format } or { kind: \"argv\", flag, format, after? }, `format` holding {port} once) when the project declares a way. Never a guess." },
  ports: { type: "array", items: { type: "integer" }, doc: "TCP ports the manifest says the unit listens on, as numbers. A declaration read -- never a port that was probed, and never one guessed from what a framework usually uses." },
  reach: { enum: REACH, doc: "Whether it speaks for itself, or for every unit beneath its directory that has no closer file of the same name." },
  unknowns: { type: "array", items: { type: "string" }, doc: "What this read could not settle. Always a list, even when empty." },
};

const DEFAULTS = { unit: false, dependencies: [], references: [], requires: {}, targets: [], kinds: [], commands: [], ports: [], reach: "self", unknowns: [] };

export const normalized = (out) => ({ ...DEFAULTS, ...out });
