// What this project DECLARES: its dependencies, and the gates it runs on itself.
//
// The rows below name manifest SHAPES, not products. That distinction is the
// one this repo cares about, and it is worth being precise: "a file called
// package.json lists dependencies under a `dependencies` key" is a fact about a
// file format, the same kind of thing src/tools/index.mjs knows when it looks
// for a `.cmd` shim. "This project talks to a queue" would be a fact about a
// product, and that belongs in the consuming repo.
//
// WHICH shapes, and how each is read, is no longer this file's business: an
// ecosystem adapter owns a format (src/ecosystems/), and this asks the registry
// of them. What stays here is the architectural READING of a manifest -- one
// stack fact per unit, one invariant per gate -- over the canonical record every
// adapter returns. A project on a stack no adapter recognises still gets an
// `unknown` saying so and pointing at `record`.
//
// Only UNITS count, and only a dependency whose relationship DECLARES one: a
// shared build file is inherited by units rather than being one, and a centrally
// managed version is available rather than used. A reference somebody commented
// out is no longer counted, and neither is attribute order a reason to miss one
// -- the two places the old one-regex reading of a project file was wrong.
import { builtinEcosystems } from "../../ecosystems/builtin.mjs";
import { declares } from "../../ecosystems/contract.mjs";
import { quote } from "../../quote.mjs";

const ECOSYSTEMS = builtinEcosystems();

// Shared with the capability search, which needs the dependency NAMES rather
// than a fact about how many there are. One reading of a manifest, two readers.
// A name, never a version: a version tells a capability question nothing and
// churns the fingerprint.
export const declared = (input, ecosystems = ECOSYSTEMS) => input.files.map((p) => ecosystems.read(p, input.read)).filter((m) => m && m.unit && !m.unreadable).map(manifestView);

const manifestView = (m) => ({ path: m.path, deps: m.dependencies.filter((d) => declares(d.relationship)).map((d) => d.name), scripts: m.commands, engines: m.requires });

export function manifests(input) {
  const found = declared(input);
  if (!found.length) return { facts: [], unknowns: [NO_SHAPE] };
  return { facts: [...found.flatMap(stackFacts), ...found.flatMap(gateFacts), ...ciFacts(input)], unknowns: [] };
}

const NO_SHAPE = "what this project depends on — no manifest shape this engine reads was found. `architecture record` is how to state it, with the file that shows it";

// One fact per manifest rather than one per dependency: a hundred facts saying
// "this depends on X" is a histogram nobody reads, and the capability search
// wants the NAMES, which `evidence` and `key` already carry.
const stackFacts = (m) => (m.deps.length || Object.keys(m.engines).length ? [{ kind: "stack", key: m.path, statement: `${m.path} declares ${m.deps.length} dependency(ies)${engineText(m)}`, scope: [m.path], evidence: [m.path], source: "package-manifest", confidence: "certain", unknowns: [DECLARED_IS_NOT_USED] }] : []);

const engineText = (m) => (Object.keys(m.engines).length ? `, and requires ${Object.entries(m.engines).map(([k, v]) => `${k} ${v}`).join(", ")}` : "");

const DECLARED_IS_NOT_USED = "whether each declared dependency is actually imported anywhere — a manifest says what is allowed, not what is used";

// A script in a manifest is a gate this project runs on ITSELF, which is the
// most useful kind of invariant to know about: it is the thing that will reject
// a change, and it can be run.
const gateFacts = (m) => m.scripts.filter(([name]) => GATE.test(name)).map(([name, cmd]) => ({ kind: "invariant", key: `${m.path}#${name}`, statement: `this project runs its own ${name} gate`, scope: [m.path], evidence: [m.path], source: "package-manifest", confidence: "certain", because: `declared as \`${quote(cmd, 120)}\``, unknowns: [GATE_UNKNOWN] }));

const GATE = /^(test|lint|check|build|typecheck|verify|schema|ci)/i;

const GATE_UNKNOWN = "whether the gate passes right now — this read the declaration, and ran nothing";

// A pipeline definition is the other place a project states what it enforces.
// Matched by directory shape, which is the same kind of general knowledge as a
// manifest key, and named as a path rather than as a vendor.
const CI_DIR = /^\.github\/workflows\/.+\.ya?ml$/;

const ciFacts = (input) => onlyIf(input.files.filter((p) => CI_DIR.test(p)));

const onlyIf = (hits) => (hits.length ? [{ kind: "invariant", key: "ci", statement: `${hits.length} pipeline definition(s) run on this project automatically`, scope: hits, evidence: hits, source: "repository", confidence: "certain", unknowns: ["what each pipeline actually runs, and whether it is green — this read the file names"] }] : []);
