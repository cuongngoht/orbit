// Every manifest in the tree, read through whichever adapter claims it, and
// related to the units it reaches.
//
// The adapters say what each file STATES. What this adds is the one relation no
// single file can state about itself: which units a subtree manifest -- a
// shared build file, a central list -- actually reaches. The rule is generic
// and written once, in src/ecosystems/reach.mjs, because runtime understanding
// asks the same question of the same files.
import { reachedBy } from "../../ecosystems/reach.mjs";

export function discover(input, ecosystems) {
  const read = input.files.map((p) => ecosystems.read(p, input.read)).filter(Boolean);
  return read.map((m) => (m.reach === "subtree" ? { ...m, appliesTo: reachedBy(read, m) } : m));
}

// The manifest paths a listing holds, for the next decision to compare the
// snapshot against without reading one. An adapter's `detects` is a pure
// function of the path, so this costs the listing and nothing else.
export const manifestPaths = (files, ecosystems) => (files ?? []).filter((p) => ecosystems.forPath(p) !== null);
