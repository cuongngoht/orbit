// The DERIVE step (doc §4.1 step 2; PBI 02): the test obligations an investigation's ACCEPTED plans
// imply, read against the system graph, kept as the journal's own lifecycle -- a `binding` per plan
// source it rests on, an `obligation` per kind each criterion names (src/qa/obligations/derive.mjs),
// and a `question` per criterion that names none. Written once each, by what it was made of, so
// deriving again on the same inputs adds nothing, and a plan that moved derives new revisions
// beside the old ones. Only an input the investigation READ is derived from; a draft plan derives
// obligations that carry its weaker authority, and never confirms anything.
import { sha } from "../hash.mjs";
import { derivedObligations } from "../qa/obligations/derive.mjs";
import { current, withJournal } from "./act.mjs";
import { nextId } from "./model.mjs";
import { eventIdOf } from "./store.mjs";

// reads: { planOf(ref) -> the plan, graph: graphOf(...) view }
export function derivedInto(w, reads) {
  const plans = current(w).inputs.filter((i) => i.type === "plan" && i.state === "read");
  return withJournal(w, () => plans.map((input) => derivedFrom(w, input, reads)).reduce(summed, { obligations: 0, questions: 0, refused: [] }));
}

const summed = (a, b) => ({ obligations: a.obligations + b.obligations, questions: a.questions + b.questions, refused: [...a.refused, ...b.refused] });

function derivedFrom(w, input, reads) {
  const plan = reads.planOf?.(input.ref);
  if (!plan) return { obligations: 0, questions: 0, refused: [`${input.ref}: the plan could not be read now`] };
  const binding = bindingKept(w, input);
  const out = derivedObligations({ plan, binding, graph: reads.graph });
  return { obligations: out.obligations.filter((o) => obligationKept(w, o)).length, questions: out.questions.filter((q) => questionKept(w, q)).length, refused: out.refused };
}

function bindingKept(w, input) {
  const id = `bnd-${sha(`${input.ref}|${input.digest}`).slice(0, 12)}`;
  w.store.appendOnce(w.id, "binding", { id: nextId(current(w), "binding"), eventId: eventIdOf("binding", id, 0, input.digest), binding: id, type: "plan", ref: input.ref, revision: input.revision, digest: input.digest, authority: input.authority, state: "fresh" });
  return { id, authority: input.authority };
}

const obligationKept = (w, o) => !w.store.appendOnce(w.id, "obligation", { id: nextId(current(w), "obligation"), eventId: eventIdOf("obligation", o.obligation, 0, o.digest), obligation: o.obligation, revision: o.revision, digest: o.digest, shape: o.shape, target: o.target, bindings: o.bindings, applicability: o.applicability, authority: o.authority, method: o.method }).duplicate;

// A question is put once: one already on the journal with the same words is that question.
function questionKept(w, q) {
  const asked = current(w).questions.some((x) => x.asks === q.asks);
  if (!asked) w.store.append(w.id, "question", { id: nextId(current(w), "question"), obligation: null, asks: q.asks });
  return !asked;
}
