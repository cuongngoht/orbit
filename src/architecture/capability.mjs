// Can this project do the thing the task needs -- and if not, where would it go?
//
// The engine holds NO list of capability names. A name arrives as tokens off the
// task (`src/architecture/tokens.mjs`) and is searched for; a row here spelling
// one would be this engine learning a product, which is the line the whole
// repository is organised around.
//
// A token search over a repository will always find SOMETHING, so the answer is
// graded and the grade is the honest part:
//
//   certain  the token is a declared dependency NAME. A manifest entry is a
//            commitment, not a coincidence.
//   possible the token appears in a tracked path or in this project's own
//            config. Worth reporting with the path; not worth calling "present".
//   unknown  nothing matched -- and the answer then has to say WHERE IT LOOKED,
//            or "missing" is a claim nobody can check.
//
// The last one is the point of the module. "No Acme Vault adapter is recorded"
// is only useful beside "I read the manifests, the config and every tracked
// path", because those three are what makes it falsifiable.
import { declared } from "./analyzers/manifests.mjs";

export function look(wanted, input) {
  const world = surveyed(input);
  return { facts: wanted.map((t) => verdict(t, world, input)), unknowns: world.manifests.length ? [] : [NO_MANIFEST] };
}

const NO_MANIFEST = "what this project depends on — no manifest shape this engine reads was found, so a dependency name could not be matched against anything";

function surveyed(input) {
  const manifests = declared(input);
  const deps = new Set(manifests.flatMap((m) => m.deps).map((d) => d.toLowerCase()));
  return { manifests, deps, depTokens: tokenised(deps), paths: input.files, config: values(input.config), configPath: input.configPath ?? "ui-tests/project.json" };
}

// `@scope/name` and `Some.Vendor.Package` both carry their name in parts, so a
// one-word token can match a dependency without the whole string matching.
function tokenised(deps) {
  const out = new Map();
  for (const d of deps) for (const part of d.split(/[^a-z0-9]+/).filter(Boolean)) out.set(part, d);
  return out;
}

const values = (config) => JSON.stringify(config ?? {}).toLowerCase();

// Ordered, first match wins, and the last row always matches -- the same shape
// the decision table has, for the same reason.
const GRADES = [
  {
    confidence: "certain",
    present: true,
    hit: (t, w) => (w.deps.has(t) ? t : w.depTokens.get(t) ?? null),
    say: (t, at) => `${t} is a declared dependency of this project (${at})`,
    why: () => "a manifest entry is a commitment, not a coincidence",
  },
  {
    confidence: "possible",
    present: true,
    hit: (t, w) => w.paths.find((p) => p.toLowerCase().split(/[^a-z0-9]+/).includes(t)),
    say: (t, at) => `${t} names part of a tracked path (${at})`,
    why: () => "a path carrying the word is not the same as an integration — open it before relying on this",
  },
  {
    confidence: "possible",
    present: true,
    hit: (t, w) => (w.config.includes(t) ? w.configPath : null),
    say: (t) => `${t} appears in this project's own configuration`,
    why: () => "the project declared something by that name; what it does is not readable from here",
  },
  {
    confidence: "unknown",
    present: false,
    // Always matches, the property every ordered table in this engine holds to.
    // It was `() => null` for one run, which made `find` return undefined and
    // turned "nothing provides that" into a TypeError.
    hit: () => true,
    say: (t, _at, w) => `nothing here provides ${t} — searched ${w.manifests.length} manifest(s), this project's config, and ${w.paths.length} tracked path(s)`,
    why: () => "absence found by looking, so it is only as good as where it looked — the places are listed above",
  },
];

function verdict(token, world, input) {
  const row = GRADES.find((g) => g.hit(token, world));
  const at = row.hit(token, world);
  return fact(token, row, at, world, input);
}

function fact(token, row, at, world, input) {
  const where = [...world.manifests.map((m) => m.path), ...(row.present && typeof at === "string" ? [at] : [])];
  const scope = [...new Set([...(where.length ? where : ["."]), ...(input.configPath ? [input.configPath] : [])])];
  return { kind: "capability", key: token, capability: token, statement: row.say(token, at, world), scope, evidence: scope, source: "repository", confidence: row.confidence, because: row.why(), ...extra(row, at, input) };
}

// A capability that is NOT here is the useful half, so it carries what a person
// would need to add one: the closest thing already in this tree that does the
// same job, and the boundary it sits behind. A recommendation read off what
// exists -- never generated code, and never a decision to write any.
function extra(row, at, input) {
  if (row.present) return { providedBy: String(at), optional: true, unknowns: [PRESENT_UNKNOWN] };
  return { unknowns: [ABSENT_UNKNOWN, ...pattern(input)] };
}

const PRESENT_UNKNOWN = "whether it is actually used for this purpose — being present and being wired up are different questions";

const ABSENT_UNKNOWN = "whether it exists somewhere this search cannot see: an untracked file, another repository, or a service with no code here";

// The extension point with the most members is the pattern a new one should
// follow. Read off the shape facts the scan already derived, so it says what
// this project does rather than what this engine would prefer.
function pattern(input) {
  const points = (input.facts ?? []).filter((f) => f.kind === "extension-point").sort((a, b) => (b.scope?.length ?? 0) - (a.scope?.length ?? 0));
  if (!points.length) return [];
  return [`if it is added, the closest thing this project already does is ${points[0].pattern} — ${points[0].scope.length} siblings follow it`];
}

// What the ENGINE can verify, as opposed to what the project depends on: the
// layers with a verb, and whether this project declared the tool each needs.
// Computed by the caller through src/qa/capability.mjs and handed in as data, so
// nothing in here imports the plan vocabulary.
export function layerFacts(layerTools, configPath) {
  const rows = Object.entries(layerTools ?? {});
  return rows.map(([layer, state]) => layerFact(layer, state, configPath));
}

const layerFact = (layer, state, configPath) => ({ kind: "capability", key: `layer:${layer}`, capability: layer, optional: !state.can, statement: state.can ? `this project can have a verdict ruled on the ${layer} layer` : `nothing here can read the ${layer} layer`, scope: [configPath], evidence: [configPath], source: "project-config", confidence: "certain", because: state.because || "the engine has a verb for it and this project declared what it needs", unknowns: [LAYER_UNKNOWN] });

const LAYER_UNKNOWN = "whether the tool it needs is installed on THIS machine — `query doctor` is the command that asks";
