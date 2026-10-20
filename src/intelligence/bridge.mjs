// From what project intelligence OBSERVED to what engineering memory may be
// told -- as a CANDIDATE, and only ever through engineering's own door.
//
// Intelligence finds `IGraphDriveService -> GraphDriveService`, and that the
// class behind it is the one holding the client. Seen once, that is a fact about
// one registration. Seen for two different registrations it becomes a candidate
// for how this project builds things: external technologies go behind the
// project's own abstractions. That is a claim about ENGINEERING, and it is not
// intelligence's to record:
//
//   it is proposed as `observed` -- never adopted, never enforced -- and carries
//   no confidence and no id, which engineering derives for itself;
//   it is judged by engineering's candidate contract, untrusted, exactly as the
//   observer's own candidates are, and a proposal claiming more is refused there;
//   it is RECONCILED there, so one session is never more than possible however
//   often it runs, and a person's adopted fact is never demoted by it.
//
// Pure: facts in, candidates out. The caller hands them to engineering; nothing
// under src/intelligence/ imports engineering, so no lateral edge exists.
import { groupBy, sortedUnique } from "./group.mjs";
import { wiringLinks } from "./usage/links.mjs";

export const MIN_WRAPPED = 2;
export const MAX_EVIDENCE = 6;

export function proposals(facts) {
  const wrapped = wrappedBy(facts);
  const byRoot = [...groupBy(wrapped, (x) => x.w.root)].filter(([, list]) => list.length >= MIN_WRAPPED);
  return { candidates: byRoot.map(([root, list]) => candidate(root, list, facts)), unknowns: byRoot.length ? [] : [TOO_FEW] };
}

const TOO_FEW = `no checkout registers ${MIN_WRAPPED} or more technologies behind its own abstractions, so there is no pattern to propose — one registration is a fact, not a habit`;

// Every registration whose implementation is not its own abstraction and is
// traced to code using a technology -- once per registration, whichever
// technology it reaches.
function wrappedBy(facts) {
  const seen = new Map();
  for (const [technology, wirings] of wiringLinks(facts)) for (const w of wirings) if (w.implementation && w.implementation !== w.abstraction) seen.set(w.id, { w, technologies: [...(seen.get(w.id)?.technologies ?? []), technology] });
  return [...seen.values()];
}

function candidate(root, list, facts) {
  const technologies = sortedUnique(list.flatMap((x) => x.technologies));
  const usages = facts.filter((f) => f.kind === "usage" && f.root === root && technologies.includes(f.technology));
  return {
    kind: "pattern",
    key: `technology-behind-abstraction${root === "." ? "" : `#${root}`}`,
    statement: `${list.length} registration(s) put a technology behind one of this project's own abstractions (${technologies.join(", ")})`,
    scope: sortedUnique([...list.flatMap((x) => x.w.scope), ...usages.flatMap((u) => u.scope)]),
    evidence: sortedUnique([...list.flatMap((x) => x.w.evidence), ...usages.flatMap((u) => u.evidence)]).slice(0, MAX_EVIDENCE),
    source: "repository",
    strength: "observed",
    because: `${list.map((x) => `${x.w.abstraction} -> ${x.w.implementation}`).join(", ")} — each implementation is a class the code shows using the technology`,
    unknowns: ["whether a new integration MUST follow it — repeated is not adopted, and only a person can adopt it", "whether every client here goes through an abstraction — this counted the registrations it could trace"],
  };
}
