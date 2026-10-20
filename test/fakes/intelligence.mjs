// A whole project intelligence context in memory: an in-memory source tree
// that behaves like the real port, a store over the fake filesystem, and
// whatever registry the test composes -- so a test states WHICH ecosystems and
// packs exist, the way the composition root does, and nothing is implied.
import { createIntelligence } from "../../src/intelligence/store.mjs";
import { loadProjectDescriptors } from "../../src/intelligence/descriptors.mjs";
import { ensure } from "../../src/intelligence/views/ensure.mjs";
import { fakeIo } from "./io.mjs";
import { memorySource } from "./source.mjs";

export const NOW = "2026-09-23T00:00:00.000Z";

export function world(files, registry, opts = {}) {
  const source = opts.source ?? memorySource(files, opts);
  const io = opts.io ?? fakeIo();
  const intel = createIntelligence("/store", io);
  return { source, io, intel, registry, now: () => NOW, notes: [], descriptors: loadProjectDescriptors(intel, registry), ...(opts.extra ?? {}) };
}

// console.log, captured: the views print, and what they print is the contract.
export function captured(fn) {
  const lines = [];
  const was = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    fn();
  } finally {
    console.log = was;
  }
  return lines.join("\n");
}

// One `ensure`, quietly, returning what it printed.
export const ensured = (ctx, args = []) => captured(() => ensure(ctx, args));
