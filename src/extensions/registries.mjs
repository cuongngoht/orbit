// A context with nothing real in it: every registry the loader registers into,
// each one empty.
//
// The builder's verification (src/extensions/lifecycle.mjs) and the capability
// listing (src/extensions/capabilities.mjs) both load extensions into one of
// these and throw it away, so neither can leave a half-registered tool behind.
// Built in ONE place so no throwaway can forget a registry: the loader refuses
// a context without a knowledge registry loudly, because an optional call would
// skip its own arguments -- and with them, the validation.
import { createCapabilityRegistry } from "../capability/registry.mjs";
import { createDslRegistry } from "../dsl/registry.mjs";
import { createValidatorRegistry } from "../dsl/validators.mjs";
import { coreExecutors } from "../run/verbs/core.mjs";
import { createKnowledgeParts } from "./knowledge-parts.mjs";
import { createReportingParts } from "./reporting-parts.mjs";

export function emptyRegistries() {
  const dsl = createDslRegistry();
  return { dsl, executors: coreExecutors(dsl), capabilities: createCapabilityRegistry(), validators: createValidatorRegistry(), knowledge: createKnowledgeParts(), reporting: createReportingParts() };
}
