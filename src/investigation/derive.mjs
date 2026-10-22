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
import { freezeGraph } from "./graphs.mjs";
import { planDigestOf } from "./input.mjs";
import { nextId } from "./model.mjs";
import { eventIdOf } from "./store.mjs";

// reads: { planOf(ref) -> the plan, graph: graphOf(...) view }. The graph is FROZEN first, as it
// was projected (graphs.mjs), and bound by its digest: what every obligation below rests on is then
// read back as it was, however the system graph moves after.
export function derivedInto(w, reads) {
  const plans = current(w).inputs.filter((i) => i.type === "plan" && i.state === "read");
  const graph = reads.graph ? freezeGraph(w, reads.graph) : null;
  return withJournal(w, () => ({ ...plans.map((input) => derivedFrom(w, input, reads)).reduce(summed, { obligations: 0, questions: 0, refused: [] }), graph: graph ? graphBound(w, graph) : null }));
}

const summed = (a, b) => ({ obligations: a.obligations + b.obligations, questions: a.questions + b.questions, refused: [...a.refused, ...b.refused] });

// A plan is derived from only as the investigation read it: one that moved since is a plan nobody
// here read, and a new investigation reads it.
function derivedFrom(w, input, reads) {
  const plan = reads.planOf?.(input.ref);
  if (!plan) return nothingFrom(`${input.ref}: the plan could not be read now`);
  if (planDigestOf(plan) !== input.digest) return nothingFrom(`${input.ref}: the plan changed since this investigation read it — begin a new one to derive from what it says now`);
  return keptFrom(w, input, derivedObligations({ plan, binding: bindingKept(w, input), graph: reads.graph }));
}

const nothingFrom = (why) => ({ obligations: 0, questions: 0, refused: [why] });

// In order, each against the journal as the one before it left it: `null` is one the budget had no room for.
function keptFrom(w, input, out) {
  const each = out.obligations.map((o) => ({ o, kept: fits(w, o) ? obligationKept(w, o) : null }));
  return { obligations: each.filter((x) => x.kept === true).length, questions: out.questions.filter((q) => questionKept(w, q)).length, refused: [...out.refused, ...each.filter((x) => x.kept === null).map((x) => `${x.o.obligation}: the obligation budget is spent (settings limits.obligations ${budgetOf(w)})`)] };
}

// An obligation the journal already holds takes a new revision whatever the budget; a NEW one
// only while fewer than the budget are held (doc §6.4).
const budgetOf = (w) => w.settings?.limits?.obligations ?? 20;
const fits = (w, o) => current(w).obligations.some((x) => x.obligation === o.obligation) || new Set(current(w).obligations.map((x) => x.obligation)).size < budgetOf(w);

function bindingKept(w, input) {
  const id = `bnd-${sha(`${input.ref}|${input.digest}`).slice(0, 12)}`;
  w.store.appendOnce(w.id, "binding", { id: nextId(current(w), "binding"), eventId: eventIdOf("binding", id, 0, input.digest), binding: id, type: "plan", ref: input.ref, revision: input.revision, digest: input.digest, authority: input.authority, state: "fresh" });
  return { id, authority: input.authority };
}

// The graph, as a binding of its own: what is IMPLEMENTED, never what is required (ADR 0031).
function graphBound(w, frozen) {
  const id = `bnd-${frozen.graph.slice(0, 12)}`;
  w.store.appendOnce(w.id, "binding", { id: nextId(current(w), "binding"), eventId: eventIdOf("binding", id, 0, frozen.digest), binding: id, type: "graph", ref: "system-graph", revision: frozen.graph.slice(0, 16), digest: frozen.digest, authority: "implementation", state: "fresh" });
  return { binding: id, digest: frozen.digest };
}

const obligationKept = (w, o) => !w.store.appendOnce(w.id, "obligation", { id: nextId(current(w), "obligation"), eventId: eventIdOf("obligation", o.obligation, 0, o.digest), obligation: o.obligation, revision: o.revision, digest: o.digest, shape: o.shape, target: o.target, bindings: o.bindings, expected: o.expected, ...(o.missing ? { missing: o.missing } : {}), applicability: o.applicability, authority: o.authority, method: o.method }).duplicate;

// A question is put once: one already on the journal with the same words is that question.
function questionKept(w, q) {
  const asked = current(w).questions.some((x) => x.asks === q.asks);
  if (!asked) w.store.append(w.id, "question", { id: nextId(current(w), "question"), obligation: null, asks: q.asks });
  return !asked;
}
