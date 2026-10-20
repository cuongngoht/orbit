// What the scenario says must be TRUE, layer by layer.
//
// The rule that matters is not "state an expectation" -- it is that silence
// about a layer is not an answer. A scenario that mentions the screen and says
// nothing about the row underneath reads, in every later report, exactly like
// one that decided the row does not apply. So each layer is `required`, `n-a` or
// `unverifiable`, and the last two owe a reason.
//
// The layers come from the VERB table. A plan cannot commit to a layer this
// engine has no verb for, and nothing here spells the three names out.
import { LAYERS } from "../../dsl/verbs.mjs";
import { commitments, needOf } from "../commit.mjs";
import { advice, error } from "../finding.mjs";
import { designOf } from "../states.mjs";
import { at, checksOf, filled, scenariosOf } from "./common.mjs";

const LAYER_SET = new Set(LAYERS);

export const expectFindings = (p) => scenariosOf(p).flatMap((s) => oneScenario(p, s));

const oneScenario = (p, s) => [...keyFindings(p, s), ...entryFindings(p, s), ...silenceFindings(p, s)];

function keyFindings(p, s) {
  const keys = Object.keys(s.expect ?? {});
  const wrong = keys.filter((k) => !LAYER_SET.has(k));
  return wrong.map((k) => error(at(p, s), `expect.${k} is not a layer this engine can rule on — ${LAYERS.join(", ")}`));
}

const entryFindings = (p, s) => Object.entries(s.expect ?? {}).flatMap(([layer, e]) => oneEntry(p, s, layer, e));

function oneEntry(p, s, layer, e) {
  const need = needOf(e);
  if (!need) return [];
  return need.proves ? saysFindings(p, s, layer, e) : becauseFindings(p, s, layer, e);
}

const saysFindings = (p, s, layer, e) => (filled(e.says) ? [] : [error(at(p, s), `expect.${layer} is required but says nothing — what must be true on that layer?`)]);

// "not applicable" and "we cannot check it" are different claims, and both are
// worthless without the sentence that says why. The second one is a capability
// gap the coverage report has to show; an empty one shows as nothing.
const becauseFindings = (p, s, layer, e) => (filled(e.because) ? [] : [error(at(p, s), `expect.${layer} is "${e.need}" with no reason — say what does not apply, or what is missing`)]);

// A scenario has to be checkable by SOMETHING: a layer it commits to, or a
// manual check that carries the expected result instead. A draft is allowed to
// be incomplete, which is what draft means -- so it is told, not failed.
function silenceFindings(p, s) {
  if (commitments(s).length || handedOver(p, s)) return [];
  const say = "states no expected result — no layer is required and no manual check carries one";
  return designOf(s).ready ? [error(at(p, s), say)] : [advice(at(p, s), `${say} (still ${s.readiness})`)];
}

function handedOver(p, s) {
  const ids = new Set((s.checks ?? []).filter((v) => typeof v === "string"));
  return checksOf(p).some((m) => ids.has(m.id) && filled(m.expect));
}
