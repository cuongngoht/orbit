// The READERS, in the order they run: a static table, never a registry.
//
// Nothing registers a reader from outside. The ecosystem adapters are the one
// extension point for understanding a manifest FORMAT -- a project's own adapter
// registers into the ecosystem registry (src/ecosystems/registry.mjs) and reaches
// discovery through the first reader here with no change to this table. What is
// left for this table is evidence that is not a manifest: version files,
// container files, existing environment definitions, pipelines and script files.
//
// A reader is `{ name, claims(path, input), read(input) }`. `claims` says
// whether a tracked path is evidence the reader would read -- which is also what
// lets a path that APPEARS be noticed without reading anything -- and `read`
// gets `input.paths`, the claimed ones, and answers `{ observations, unknowns }`.
import { containersReader } from "./containers.mjs";
import { definitionsReader } from "./definitions.mjs";
import { ecosystemsReader } from "./ecosystems.mjs";
import { pipelinesReader } from "./pipelines.mjs";
import { scriptsReader } from "./scripts.mjs";
import { shellsReader } from "./shells.mjs";
import { versionsReader } from "./versions.mjs";

export const READERS = [ecosystemsReader, versionsReader, containersReader, definitionsReader, pipelinesReader, scriptsReader, shellsReader];

export const READER_NAMES = READERS.map((r) => r.name);

// The tracked paths ANY reader would read: what a checkout's runtime evidence
// is, as a sorted list. A path that is in it now and was not last time is new
// evidence; one that is gone has taken its facts with it.
// A checkout whose evidence is more files than this is not being understood, it is being listed: the
// rest are left out and said. The bound is part of what "the evidence" IS, so the read and the check
// for what moved agree about it -- a bound only one of them held would look like a file that appears
// and disappears, and read the checkout again on every look.
export const MAX_EVIDENCE_FILES = 1000;

const claimed = (files, input) => files.filter((p) => READERS.some((r) => r.claims(p, input))).sort();

export const evidenceOf = (files, input) => claimed(files, input).slice(0, MAX_EVIDENCE_FILES);

export const leftOut = (files, input) => Math.max(claimed(files, input).length - MAX_EVIDENCE_FILES, 0);

// One reader, isolated: a reader that throws costs its own observations and says
// so, and the others still run -- the rule src/architecture/analyzers/index.mjs
// `analyseWith` follows.
export function isolated(reader, input) {
  try {
    return reader.read({ ...input, paths: input.files.filter((p) => reader.claims(p, input) && (input.allowed?.has(p) ?? true)) });
  } catch (e) {
    const say = `the ${reader.name} reader failed (${String(e?.message ?? e).slice(0, 120)}), so what it reads is not known`;
    return { observations: [], unknowns: [say], gaps: [say] };
  }
}
