// The scripts a checkout keeps where a person runs them from, read for ONE thing: whether every one of
// them is written for one family of systems. A checkout whose only scripts are of one family is POSSIBLY
// run there -- and a mix says nothing. Evidence beside the operating-system matrix, never a requirement:
// a script's language runs elsewhere too, and a file name is not a runtime.
//
// Where scripts sit and what each kind is written for is catalog data (catalog/runtimes.json `shells`):
// nothing here names a shell.
import { shellOf } from "../../catalog.mjs";

export const shellsReader = {
  name: "shells",
  claims: (path, input) => shellOf(input.catalog, path) !== null,
  read: (input) => ({ observations: agreed(input), unknowns: [] }),
};

function agreed(input) {
  const kinds = input.paths.map((path) => ({ path, kind: shellOf(input.catalog, path) }));
  const families = new Set(kinds.map((k) => k.kind.os.join(",")));
  return families.size === 1 ? kinds.map(({ path, kind }) => observed(path, kind)) : [];
}

const observed = (path, kind) => ({ type: "os", dir: null, path, source: "script", confidence: "possible", os: kind.os, exclusive: false, because: `every script this checkout keeps where it is run from is one of its ${kind.name}; that says where it may be run, not where it cannot` });
