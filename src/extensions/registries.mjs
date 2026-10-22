// A context with nothing real in it: every registry the loader registers into,
// each one empty.
//
// The builder's verification (src/extensions/lifecycle.mjs) and the capability
// listing (src/extensions/capabilities.mjs) both load extensions into one of
// these and throw it away, so neither can leave a half-registered tool behind.
// Built in ONE place so no throwaway can forget a registry: the loader refuses
// a context without a knowledge registry loudly, because an optional call would
// skip its own arguments -- and with them, the validation.
import { createAdapterRegistry } from "../adapters/registry.mjs";
import { catalogLayer as semanticsCatalog, mergeSemantics } from "../adapters/semantics.mjs";
import { createCapabilityRegistry } from "../capability/registry.mjs";
import { realIo } from "../store/io.mjs";
import { pluginRoot } from "../version.mjs";
import { createDslRegistry } from "../dsl/registry.mjs";
import { createValidatorRegistry } from "../dsl/validators.mjs";
import { coreExecutors } from "../run/verbs/core.mjs";
import { createKnowledgeParts } from "./knowledge-parts.mjs";
import { createReportingParts } from "./reporting-parts.mjs";

export function emptyRegistries() {
  const dsl = createDslRegistry();
  return { dsl, executors: coreExecutors(dsl), capabilities: createCapabilityRegistry(), adapters: emptyAdapters(), helpers: INERT_LAUNCHER, validators: createValidatorRegistry(), knowledge: createKnowledgeParts(), reporting: createReportingParts() };
}

// A throwaway LOADS what it judges and runs none of it: a candidate being verified names no home
// in the launcher of the context it was judged beside, and nothing it declares can be started.
const INERT_LAUNCHER = Object.freeze({ launch: () => ({ why: "a context that only judges what it loads launches nothing" }), home: () => {} });

// A throwaway judges an adapter against the plugin's own semantics vocabulary, exactly as a
// registered one is judged (ADR 0035).
export const emptyAdapters = () => createAdapterRegistry(() => mergeSemantics([semanticsCatalog(pluginRoot(), realIo())]));
