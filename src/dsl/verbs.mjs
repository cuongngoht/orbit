// The CORE registry's snapshot of the verb vocabulary.
//
// This file holds no table and derives nothing. core/verbs.mjs is the data and
// dsl/registry.mjs is the one derivation; what is here is the view of that
// derivation taken over CORE, for everything that reasons about the ENGINE's own
// vocabulary rather than one project's -- src/report/, src/qa/, src/query/.
//
// Anything that runs a CASE asks `ctx.dsl` instead, because a project's
// extensions are part of that project's vocabulary and not part of the engine's.
// The split is not stylistic: `query dsl` printing the engine's grammar and a run
// validating a case that uses a project's own field are two different questions,
// and answering both from one global is how one project's words leak into
// another's report.
import { CORE } from "./registry.mjs";

export { CORE, LAYERS, SCREEN_LAYER, noneProved } from "./registry.mjs";

export const VERBS = CORE.verbs();
export const VERB = new Map(VERBS.map((v) => [v.name, v]));
export const VERB_NAMES = CORE.verbNames();
export const ACTS = CORE.verbsWhere("kind", "act");

export const verbsWhere = (key, value = true) => CORE.verbsWhere(key, value);
export const ownersOf = (field) => CORE.ownersOf(field);
export const isVerdict = (step) => CORE.isVerdict(step);
export const provedBy = (step) => CORE.provedBy(step);
export const showsScreen = (step) => CORE.showsScreen(step);
