// Which LAYER a role lives in, when every member of it lives in one place.
//
// Built on the pattern families (src/engineering/analyzers/pattern.mjs): if all
// of a project's repositories sit under `src/Infrastructure`, that is a claim
// about ownership -- persistence access belongs to that layer -- demonstrated by
// every example there is. Architecture's `boundary` is an import graph, "what
// may know what"; this is "where a thing of this kind goes", a different
// question answered from different evidence.
//
// Three members at least: two files in one directory is a coincidence, three
// with no exception is a placement. A family split across layers says nothing
// here -- a split is not a boundary.
import { families, MAX_EVIDENCE, touches } from "./pattern.mjs";

export const MIN_PLACED = 3;

// The unit a layer is measured in: the first two directories, the depth
// src/architecture/analyzers/shape.mjs already calls a module.
export const layerOf = (path) => path.split("/").slice(0, -1).slice(0, 2).join("/");

export function boundary(input) {
  const placed = [...families(input.files)].filter(([, members]) => members.length >= MIN_PLACED && touches(members, input.scopes) && oneLayer(members));
  return { candidates: placed.map(([role, members]) => candidate(role, members)), unknowns: [] };
}

const oneLayer = (members) => Boolean(layerOf(members[0])) && members.every((m) => layerOf(m) === layerOf(members[0]));

const candidate = (role, members) => ({
  kind: "boundary",
  key: `${role}-layer`,
  statement: `every ${role} in this project lives under ${layerOf(members[0])}`,
  scope: [layerOf(members[0])],
  evidence: members.slice(0, MAX_EVIDENCE),
  source: "repository",
  strength: "observed",
  because: `all ${members.length} of them, with no exception anywhere else in the tree`,
  unknowns: ["whether the layer is REQUIRED to own them, or has merely always done so", "whether anything outside it reaches around the layer — that is an import question, architecture's"],
});
