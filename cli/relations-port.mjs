// THE RELATION PACK, BOUND (0.6.0): the committed tree a project's files are followed in, and the relation adapters
// (skills/orbit-develop/relations/) that read them -- bound ONCE, here, for every composition root that asks what goes
// with a file: the context package's relations (cli/context-grounding.mjs) and what a turn's edits still owe
// (cli/governed.mjs `owed`). Not an entry point, and it decides nothing: the walk and the tests that go with a file are
// src/context/relations.mjs's, and what a file imports or which tests go with it is each adapter's. Nothing is read
// until a port is asked; the tree is one `git ls-files` per root.
import { scanRoots } from "../src/architecture/context.mjs";
import { withStoredConfig } from "../src/architecture/source.mjs";
import { treeOf } from "../src/context/refs.mjs";
import { relatedOf, testsWith } from "../src/context/relations.mjs";
import { createSourceTree } from "../src/frontend/composite.mjs";
import { RELATION_ADAPTERS } from "../skills/orbit-develop/relations/index.mjs";

function quietly(fn, otherwise = null) {
  try { return fn() ?? otherwise; }
  catch { return otherwise; }
}

// The git-only source port over the project's roots (src/architecture/context.mjs `scanRoots`).
export const sourceOf = (project) => withStoredConfig(createSourceTree(scanRoots({ project, config: project.config })), project);

// The tracked listing, as src/context/refs.mjs reads one -- null when it could not be listed.
export const treeIn = (source) => treeOf(quietly(() => source.files()));

// The walk's ports over a source and its tree: a read or a search that throws could not run (null), never "nothing".
const portsOf = (source, tree) => ({ tree, adapters: RELATION_ADAPTERS, read: (path) => quietly(() => source.read(path)), search: (pattern) => quietly(() => source.search(pattern)) });

// One hop out and one hop in from the direct files (the context package's `relevant`).
export const relationsAround = (source, tree, direct, maxFiles) => relatedOf({ direct, ...portsOf(source, tree), maxFiles });

// The tracked tests the adapters link to the files, at most `maxFiles` (what a turn's edits owe, with no declared check).
export const testsLinked = (source, tree, direct, maxFiles) => testsWith({ direct, ...portsOf(source, tree), maxFiles });
