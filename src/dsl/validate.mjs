// The case validator: a composition of small rule families, one file each.
// run-case applies it before touching a browser; `query check` applies it to
// every file. Neither owns a private copy.
//
// rules/shape.mjs comes first and is a HARD STOP: the families below it walk
// containers, and none of them can say anything useful about a `steps` that
// turned out to be an object.
import { CORE } from "./registry.mjs";
import { NO_VALIDATORS, caseFindings, stepFindings as extensionStepFindings } from "./validators.mjs";
import { bindingsAt } from "./bindings.mjs";
import { bindingFindings } from "./rules/binding.mjs";
import { effectFindings } from "./rules/effect.mjs";
import { headFindings } from "./rules/head.mjs";
import { identityFindings } from "./rules/identity.mjs";
import { resolveFindings } from "./rules/resolve.mjs";
import { semanticFindings } from "./rules/semantic.mjs";
import { shapeFindings } from "./rules/shape.mjs";
import { stepFindings } from "./rules/step.mjs";
import { verdictFindings } from "./rules/verdict.mjs";

// `dsl` is the EFFECTIVE vocabulary this case is being judged against: core for
// the engine's own tools, core plus a project's extensions for a run. Defaulted
// rather than required, so the ~20 call sites that only ever mean the engine's
// own grammar say so by omission instead of by repeating it.
// The chain, in a fixed order: shape is a hard stop, then the core families, then
// whatever this project's extensions added, then the verdict rules. Extensions
// come after core and never before, because a rule that ran ahead of the shape
// check would be a rule walking a container that might turn out to be a string.
export function validate(c, graph, dsl = CORE, validators = NO_VALIDATORS) {
  const wrong = shapeFindings(c);
  if (wrong.length) return wrong;
  const binds = bindingsAt(c);
  const core = [...wholeCase(c, graph, dsl), ...perStep(c, c.steps ?? [], graph, binds, dsl)];
  return [...core, ...extra(validators, c, graph, dsl), ...verdictFindings(c, dsl)];
}

const extra = (validators, c, graph, dsl) =>
  [...caseFindings(validators, c, graph, dsl), ...extensionStepFindings(validators, c, c.steps ?? [], graph, dsl)];

const wholeCase = (c, graph, dsl) => [...headFindings(c, graph, dsl), ...identityFindings(c, dsl), ...resolveFindings(c), ...bindingFindings(c), ...effectFindings(c, graph, dsl)];

const perStep = (c, steps, graph, binds, dsl) =>
  steps.flatMap((st, i) => [...stepFindings(c, st, i, graph, binds, dsl), ...semanticFindings(c, st, i, steps[i + 1])]);
