// Running to the end is not the same as passing. A case with nothing that can
// return false reports PASS whatever the screen did -- it proves only that no
// step threw. Every case has to state its own right/wrong.
import { pagelessByVerbs } from "../page.mjs";
import { CORE, LAYERS, SCREEN_LAYER } from "../registry.mjs";

export function verdictFindings(c, dsl = CORE) {
  const steps = c.steps ?? [];
  if (!steps.length) return [];
  return [...endsWithReport(c, steps, dsl), ...hasVerdict(c, steps, dsl), ...witnessed(c, steps, dsl)];
}

// The screen is the one layer that can show a change which did not happen: an
// optimistic render, a stale list, a cached row. So a case that DECLARED it
// creates something has already said the run writes, and a verdict on the screen
// alone cannot settle whether it did. Every other layer the engine can rule on
// sits below the UI and is a real witness, so those are the ones it has to ask.
//
// Derived from the verb table through provedBy and SCREEN_LAYER, never a list of
// verbs or of layer names: a new verdict verb counts the day its row says which
// layer it proves.
const WITNESSES = LAYERS.filter((l) => l !== SCREEN_LAYER);

function witnessed(c, steps, dsl) {
  if (!c.creates) return [];
  const proved = new Set(steps.map((s) => dsl.provedBy(s)).filter(Boolean));
  const missing = WITNESSES.filter((l) => !proved.has(l));
  return missing.length ? [`${c.id}: creates something but rules on ${missing.join(" and ")} nowhere — a screen can show a write that never reached the database`] : [];
}

// The final `report` records where the SCREEN ended up. A case that asks no page
// anything (only sql and call steps, no wait, identity or start screen --
// src/dsl/page.mjs) has no screen to end on: its verdicts are its result.
const endsWithReport = (c, steps, dsl) => (steps[steps.length - 1].do !== "report" && !pagelessByVerbs(c, dsl) ? [`${c.id}: does not end with a report step (its result is then unobservable)`] : []);

const hasVerdict = (c, steps, dsl) => (steps.some((s) => dsl.isVerdict(s)) ? [] : [`${c.id}: no assert and no expect — this case reports PASS no matter what the screen did`]);
