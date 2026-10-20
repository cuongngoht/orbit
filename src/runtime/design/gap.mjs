// GAP ANALYSIS: what an environment already provides, set against what a checkout
// needs of it.
//
// The existing environment is INSPECTED, never trusted: a definition that was
// right a year ago says what it provides, and what it provides is compared with
// what the checkout's files ask for now. Each requirement comes out in exactly one
// of these states, and the state decides what a proposal may do about it:
//
//   satisfied   the definition provides it, at a version that meets the range
//   missing     nothing provides it, and the catalog knows a feature that does
//   outdated    a feature provides it, at a version below what is asked
//   unknown     it cannot be told: provided at a version that cannot be compared
//               (`latest`, an unreadable range), or provided by no feature while the
//               definition builds from something Orbit cannot look inside without
//               building it -- a Dockerfile, compose files, an image other than the
//               catalog's own base -- which may well install it. Left exactly as it
//               is, and said: a feature proposed for what the base already carries is
//               a second copy of a runtime, not a fix
//   impossible  no Linux container provides it, whatever the definition says
//   unplaced    nothing in the catalog says how a container provides it
//
// Pure: requirements and an inspected definition in, a row per requirement out.
import { judged } from "../ranges.mjs";
import { keyOf } from "./create.mjs";

const featureOf = (def, feature) => def?.summary.features.find((f) => f.id === feature.id) ?? null;

// -> [{ id, name, state, wanted, provided, feature }]. `knownBase` is the catalog's own base image:
// the one base whose contents are known.
export function analyse(requirements, definition, knownBase = null) {
  return requirements.environment.map((r) => ({ id: r.id, name: r.name, wanted: r.wanted, range: r.range, feature: r.feature, ...stateOf(r, definition, knownBase) }));
}

function stateOf(r, definition, knownBase) {
  if (r.container === false) return { state: "impossible", because: `${r.name} is not something a Linux dev container provides${r.doc ? ` — ${r.doc}` : ""}` };
  if (!r.feature) return { state: "unplaced", because: `nothing in the catalog says how a dev container provides ${r.name}${r.doc ? ` — ${r.doc}` : ""}` };
  const provided = featureOf(definition, r.feature);
  return provided ? versioned(r, provided) : absent(r, opaqueBase(definition, knownBase));
}

// What the definition is BUILT FROM, when Orbit cannot see inside it without building it -- or null.
function opaqueBase(definition, knownBase) {
  const s = definition?.summary;
  if (!s) return null;
  if (s.dockerFile) return `its Dockerfile (${s.dockerFile})`;
  return s.composeFiles.length ? "its compose files" : s.image && s.image !== knownBase ? `the image ${s.image}` : null;
}

const absent = (r, base) => (base ? { state: "unknown", because: `no feature of the definition provides ${r.name}, and it builds from ${base}, which may: Orbit cannot see inside without building it — if it does not, the ${keyOf(r.feature)} feature does`, provided: null } : { state: "missing", because: `nothing in the environment provides ${r.name} yet; the ${keyOf(r.feature)} feature does`, provided: null });

// A version the feature was asked for, as written: `22`, `22.1`, `8.0`. Only a
// plain version is compared; `latest`, `lts` and absence are left alone and said.
const PLAIN = /^\d+(?:\.\d+){0,2}$/;

function versioned(r, provided) {
  const said = { provided: provided.version ?? null };
  if (!PLAIN.test(provided.version ?? "") || !r.range) return { ...said, state: "unknown", because: `${r.name} is provided${provided.version ? ` as ${JSON.stringify(provided.version)}` : ", at whatever the feature defaults to"}, and which version that is cannot be compared with ${r.range ?? "what is asked"}` };
  return { ...said, ...compared(r, provided.version) };
}

// `22` names the 22 LINE: padded to 22.0.0 it fails a range that asks 22.5, and
// that is not the same as being too old -- the line may well reach it. When the
// provided version is only a prefix of what is wanted, the honest answer is that
// it cannot be told.
function compared(r, version) {
  const verdict = judged(version.split(".").concat(["0", "0"]).slice(0, 3).join("."), r.range);
  if (verdict.state === "unknown") return { state: "unknown", because: `${r.name} ${version} cannot be compared with ${r.range}` };
  if (verdict.state === "incompatible" && prefixOf(version, r.wanted)) return { state: "unknown", because: `${r.name} ${version} names a line, and whether it reaches ${r.wanted} is not known` };
  return { state: verdict.state === "compatible" ? "satisfied" : "outdated", because: `${r.name} ${version}: ${verdict.why}` };
}

const prefixOf = (version, wanted) => wanted !== null && wanted !== version && wanted.startsWith(`${version}.`);

// The ports a component listens on that the environment does not PUBLISH. `forwardPorts` is an
// editor's forwarding, which the Dev Containers CLI ignores: only `appPort` makes a port in the
// container reachable from this machine when Orbit brings the environment up.
export const portGaps = (requirements, definition) => requirements.ports.filter((p) => !(definition?.summary.appPort ?? []).includes(p));
