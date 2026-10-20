// A whole project-knowledge context in memory: a store over the fake
// filesystem, a source tree that behaves like the real port, the knowledge
// parts registry, and a REAL Effective Resource Registry composed from exactly
// the capabilities a test names -- so every verdict below comes from the
// engine's own requirement graph and resolver, never from a stub of them.
import { createKnowledgeParts } from "../../src/extensions/knowledge-parts.mjs";
import { trackedSet } from "../../src/engineering/record.mjs";
import { createKnowledge } from "../../src/knowledge/store.mjs";
import { offerLayers } from "../../src/knowledge/vocabulary.mjs";
import { PROVIDERS } from "../../src/resources/providers/index.mjs";
import { getEffectiveResources } from "../../src/resources/registry.mjs";
import { fakeIo } from "./io.mjs";
import { memorySource } from "./source.mjs";

export const NOW = "2026-09-24T10:00:00.000Z";

// capabilities: [{ id, doc, from?, tools? }] -- what a project's extensions registered.
export const registryOf = (capabilities = [], extra = {}) => getEffectiveResources({ env: {}, plugin: "orbit", components: () => [], builtins: () => ({}), capabilities: () => capabilities, tools: () => extra.tools ?? [], mcp: () => extra.mcp ?? [] }, PROVIDERS);

export function knowledgeWorld(opts = {}) {
  const clock = { now: opts.now ?? NOW };
  const io = opts.io ?? fakeIo({ host: opts.host ?? "laptop-a", now: () => clock.now });
  const source = opts.source ?? memorySource(opts.files ?? { "src/app/workspace.ts": "x", "src/app/group.ts": "y", "test/workspace.test.ts": "z" });
  const parts = opts.parts ?? createKnowledgeParts();
  for (const e of opts.extensions ?? []) parts.register(e.parts, e.id);
  const layers = offerLayers(parts, [{ layer: "project", from: "test vocabulary", rows: opts.relations ?? [] }]);
  return { io, source, parts, clock, vocabularyLayers: layers, know: createKnowledge("/store", io), store: { root: "/store", source: "test" }, notes: [], now: () => clock.now, tracked: () => trackedSet(source.files() ?? []), readable: () => true, gates: () => opts.gates ?? new Set(), declared: () => opts.declared ?? { claims: [], refused: [] }, hostMemory: () => opts.providers ?? [], near: () => opts.near ?? [], changed: () => opts.changed ?? [], demanded: () => opts.demanded ?? new Map(), effective: () => registryOf(opts.capabilities ?? [], opts.resources ?? {}), emit: opts.emit ?? (() => null), read: () => opts.input ?? "" };
}

// A candidate claim over the default files, with whatever a test overrides.
export const candidate = (over = {}) => ({ subject: "workspace.create", relation: "results-in", object: "group.created", evidence: ["src/app/workspace.ts"], source: "repository", strength: "observed", ...over });

export const seenBy = (host = "laptop-a", at = NOW, session) => ({ host, at, ...(session ? { session } : {}) });
