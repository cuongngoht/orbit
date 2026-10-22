// TEST OBLIGATIONS, derived where three things meet (doc §4.1 step 2; ADR 0031): what an ACCEPTED
// criterion states -- its structured expectations and the kinds of property it names
// (`obligations`) -- the system graph node it is about (`about`), and the SHAPE of each kind. Derived,
// never proposed, and nothing is guessed: a criterion that names no kind is a QUESTION for a person,
// a shape nobody declared is refused, and a node the graph does not hold leaves the obligation's
// applicability UNKNOWN with what would settle it -- never not-applicable.
//
// Applicability is read off the graph: a shape applies where the node it is about takes part in a
// relation of a role the shape is about; one that takes part in none of them is unknown until the
// graph says more. Ids are stamped from what an obligation is made of, so the same plan and graph
// derive the same obligations every time.
import { canonicalJson, sha } from "../../hash.mjs";
import { EXPECT_OP } from "../vocab.mjs";
import { shapeOf } from "./shapes.mjs";

const aliasOf = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

// in: { plan: an accepted plan, binding: { id, authority }, graph: graphOf(...) }
export function derivedObligations({ plan, binding, graph }) {
  const criteria = (plan?.criteria ?? []).filter((c) => (c.expects ?? []).length);
  return { obligations: criteria.flatMap((c) => (c.obligations ?? []).flatMap((id) => obligationOf(plan, binding, graph, c, id))), questions: criteria.filter((c) => !(c.obligations ?? []).length).map((c) => questionOf(c)), refused: criteria.flatMap((c) => (c.obligations ?? []).filter((id) => !shapeOf(id)).map((id) => `${c.id}: "${id}" is not an obligation shape this engine knows`)) };
}

const questionOf = (c) => ({ criterion: c.id, asks: `${c.id} states expectations and names no kind of property — which obligation is it (and which part of the system is it about)?` });

function obligationOf(plan, binding, graph, c, id) {
  const shape = shapeOf(id);
  return shape ? [stamped(plan, c, shape, recordOf(plan, binding, graph, c, shape))] : [];
}

const stamped = (plan, c, shape, record) => ({ obligation: `tob-${sha(`${plan.id}|${c.id}|${shape.id}`).slice(0, 12)}`, digest: sha(canonicalJson(record)), ...record });

// The slots this obligation is ABOUT: the criterion's expectations its shape rules with. A criterion that names
// several kinds of property states each one's slots; one that states none a shape rules with leaves it missing.
const ownSlots = (c, shape) => c.expects.filter((e) => shape.templates.includes(EXPECT_OP.get(e.op)?.template)).map((e) => `${c.id}/${e.id}`);

function recordOf(plan, binding, graph, c, shape) {
  const target = (graph?.nodes ?? []).find((n) => aliasOf(n.name) === c.about) ?? null;
  const expected = ownSlots(c, shape);
  return { statement: String(c.says ?? "").slice(0, 300), shape: shape.id, target: target?.key ?? c.about ?? null, bindings: [binding?.id ?? plan.id], expected, ...(expected.length ? {} : { missing: [`${c.id} states nothing the ${shape.id} obligation rules with (${shape.templates.join(", ")})`] }), method: shape.contractOnly ? "manual" : "runtime-test", applicability: applicabilityOf(shape, target, graph, c), authority: binding?.authority ?? "draft", boundary: shape.boundary, revision: String(plan.revision ?? "unknown") };
}

// Where the node it is about takes part in a relation of a role the shape is about.
function applicabilityOf(shape, target, graph, c) {
  if (!target) return { state: "unknown", why: c.about ? `the system graph holds no ${c.about}` : "the criterion names nothing it is about", settles: "reverse engineering records the node, or a person names it" };
  const roles = (graph.relations ?? []).filter((r) => r.from === target.key || r.to === target.key).map((r) => r.role);
  const hit = shape.relations.filter((role) => roles.includes(role));
  return hit.length ? { state: "applicable", why: `${target.key} takes part in ${hit.join(", ")}`, refs: [target.key] } : { state: "unknown", why: `${target.key} takes part in none of ${shape.relations.join(", ")} in the graph as it stands`, settles: "a relation the graph records about it" };
}
