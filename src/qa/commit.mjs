// What a scenario has COMMITTED to prove, as layers.
//
// One derivation, used by three readers: the rule that holds a case link to it,
// the coverage report, and the selection view. Spelling it three times is how a
// plan ends up "covered" in one view and "not verifiable" in another.
//
// A commitment is any layer the scenario marked `required`, plus the backend
// half of a denial -- because "the server must refuse it" is a statement about
// the call the UI made, and the call is what the api verb rules on.
import { LAYERS, SCREEN_LAYER } from "../dsl/verbs.mjs";
import { NEED } from "./vocab.mjs";

// A key that is not a layer is rules/expect.mjs's finding, once. Filtered here
// so it does not become a second finding about a case that cannot prove it --
// there is no verb that could.
const LAYER_SET = new Set(LAYERS);

// The layers that witness a change from BELOW the screen, derived the same way
// the case rule derives them: a screen can show a write that never happened.
export const WITNESSES = LAYERS.filter((l) => l !== SCREEN_LAYER);

// The backend of a refusal is observed as the call the UI made. Named once, here.
const BACKEND_LAYER = WITNESSES[0] ?? SCREEN_LAYER;

export const needOf = (e) => NEED.get(e?.need) ?? null;

export const isRequired = (e) => needOf(e)?.proves === true;

export const isGap = (e) => needOf(e)?.gap === true;

export function commitments(s) {
  const declared = Object.entries(s?.expect ?? {}).filter(([l, e]) => LAYER_SET.has(l) && isRequired(e)).map(([layer, e]) => ({ layer, says: e.says ?? "", from: `expect.${layer}` }));
  return [...declared, ...denialCommitment(s)];
}

const denialCommitment = (s) => (isRequired(s?.denial?.backend) ? [{ layer: BACKEND_LAYER, says: s.denial.backend.says ?? "", from: "denial.backend" }] : []);

// Every layer the scenario said it cannot check, with the reason -- the
// capability gaps a coverage report has to show rather than quietly net off.
export function gaps(s) {
  const declared = Object.entries(s?.expect ?? {}).filter(([l, e]) => LAYER_SET.has(l) && isGap(e)).map(([layer, e]) => ({ layer, because: e.because ?? "", from: `expect.${layer}` }));
  return [...declared, ...denialGap(s)];
}

const denialGap = (s) => (isGap(s?.denial?.backend) ? [{ layer: BACKEND_LAYER, because: s.denial.backend.because ?? "", from: "denial.backend" }] : []);

// Which layers a CASE is able to rule on, read off its steps through the verb
// table -- never from the case's name and never from a list of verbs here.
export const provenBy = (steps, provedBy) => new Set((steps ?? []).map(provedBy).filter(Boolean));
