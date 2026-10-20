// INTEGRATION facts: an external system and ONE operation on it, and which
// technology this project does that operation with. Derived from the usage
// facts, reading nothing.
//
// The subject is (system, operation), never the system alone, and that is the
// whole point of the stage. A project that reaches the same system through two
// clients -- one for its files, another for its lists -- has two integration
// facts, each naming its own technology. A rule of the shape "system X means
// client Y" cannot be written from these, in either direction, because nothing
// here is keyed by the system alone.
//
// Two technologies doing the SAME operation is kept, not resolved: it is a
// finding for a person, and which one new code should follow is the project's
// decision. The fact says so and its confidence drops to possible.
import { groupBy, sortedUnique } from "../group.mjs";

export const MAX_EVIDENCE = 8;

export function integrationFacts(facts) {
  const usages = facts.filter((f) => f.kind === "usage" && f.integration);
  return [...groupBy(usages, (u) => [u.root, u.integration, u.operation ?? ""].join("|"))].map(([, group]) => integrationFact(group));
}

// A usage whose technology IS the system -- the database's own client, next to
// the ORM that reaches it -- names the system, not a second way of reaching it.
// It counts as the way only when nothing else is.
function waysOf(group, integration) {
  const all = sortedUnique(group.map((u) => u.technology));
  const through = all.filter((t) => t !== integration);
  return through.length ? through : all;
}

function integrationFact(group) {
  const { root, integration, operation } = group[0];
  const technologies = waysOf(group, integration);
  const roles = sortedUnique(group.map((u) => u.role).filter(Boolean));
  return { kind: "integration", key: `${root === "." ? "" : `${root}::`}${integration}:${operation ?? "?"}`, root, integration, ...(operation ? { operation } : {}), technologies, ...(roles.length ? { roles } : {}), statement: says(root, integration, operation, technologies), scope: sortedUnique(group.flatMap((u) => u.scope)), evidence: sortedUnique(group.flatMap((u) => u.evidence)).slice(0, MAX_EVIDENCE), source: "repository", confidence: technologies.length === 1 && group.every((u) => u.confidence === "certain") ? "certain" : "possible", because: `${group.length} usage fact(s) across ${sortedUnique(group.flatMap((u) => u.scope)).length} directory(ies)`, unknowns: [...(technologies.length > 1 ? [TWO_WAYS] : []), ...(operation ? [] : [NO_OPERATION])] };
}

const says = (root, integration, operation, technologies) => `${root === "." ? "" : `${root}: `}${integration} ${operation ?? "(an operation the code does not name)"} is done with ${technologies.join(" and ")}`;

const TWO_WAYS = "which of these new code should follow — this project does the same operation in more than one way, and choosing is the project's decision, not this tool's";

const NO_OPERATION = "what is done with it — the code reaches the system without saying which operation";
