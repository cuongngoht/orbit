// A plan works out its own security obligations, instead of waiting to be told.
//
// `permission` and `scoping` have been in the vocabulary from the start, and a
// scenario that uses one is held to a denial block by rules/permission.mjs.
// What nothing ever did was ASK. A plan about a role-gated feature, written by
// somebody who simply did not think of it, said nothing about permission and no
// rule noticed -- so the test most likely to be missing was the one nothing was
// looking for. "Derive scenarios with a technique" only works for the
// techniques somebody remembered.
//
// The obligation is therefore DERIVED, from what the plan already declares
// about itself: an actor with roles means the feature is gated, an owner or a
// tenant means the data belongs to somebody, a write means there is something
// worth doing without permission. Each technique says which signals it answers
// (`owedBy` in vocab.mjs), so a new security technique is a row there and not
// an edit here, and no signal name is spelled out in a caller.
//
// ADVICE, never an error, and that is not timidity. This can demonstrate that
// nobody considered the question; it cannot demonstrate they were wrong not to,
// and src/qa/ may only fail a build on what it can demonstrate. A team that has
// decided says so in `exclusions`, and coverage shows the exclusion.
import { advice } from "../finding.mjs";
import { MUTATION, TECHNIQUES } from "../vocab.mjs";
import { at, filled, listed, scenariosOf } from "./common.mjs";

const SIGNALS = [
  { name: "roles", because: "scenarios here name roles", seen: (s) => listed(s.actor?.roles) || listed(s.actor?.notRoles) },
  { name: "ownership", because: "scenarios here name an owner or a tenant", seen: (s) => filled(s.actor?.owner) || filled(s.actor?.tenant) },
  { name: "writes", because: "scenarios here write", seen: (s) => MUTATION.get(s.mutation?.kind)?.writes === true },
];

const answering = (signal) => TECHNIQUES.filter((t) => (t.owedBy ?? []).includes(signal)).map((t) => t.name);

export function securityFindings(p) {
  const all = scenariosOf(p);
  const used = new Set(all.map((s) => s.technique));
  return SIGNALS.filter((sig) => owed(sig, all, used)).map((sig) => unmet(p, sig, all));
}

// A signal nothing answers is not an obligation -- it is a row somebody added
// without a technique to discharge it, and nagging about that helps nobody.
function owed(sig, all, used) {
  const answers = answering(sig.name);
  if (!answers.length) return false;
  return all.some(sig.seen) && !answers.some((t) => used.has(t));
}

function unmet(p, sig, all) {
  const says = `${sig.because}, and no scenario is a ${answering(sig.name).join(" or ")} one`;
  return advice(at(p, all.find(sig.seen)), `${says} — derive it with that technique, or put it in exclusions with a reason`);
}
