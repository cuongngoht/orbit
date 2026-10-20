// How far up the ladder each technology is, per checkout -- read off the facts,
// never off the technology's name.
//
// Every rung is its own kind of evidence (src/intelligence/vocab.mjs MATURITY),
// and this prints which were reached and which were NOT, with the reason a
// rung is missing. "Declared, never used" is one of the most useful things this
// can say about a project, and it is only sayable because declared and used are
// separate facts from separate stages.
import { MATURITY } from "../vocab.mjs";
import { sortedUnique } from "../group.mjs";
import { wiringLinks } from "../usage/links.mjs";

export function maturityOf(facts) {
  const links = wiringLinks(facts);
  const subjects = sortedUnique(facts.filter((f) => f.kind === "technology" || f.kind === "usage").map((f) => `${f.root}\u0000${f.technology}`));
  return subjects.map((s) => ladder(facts, links, ...s.split("\u0000")));
}

function ladder(facts, links, root, technology) {
  const mine = facts.filter((f) => f.root === root);
  const linked = new Map([[technology, (links.get(technology) ?? []).filter((w) => w.root === root)]]);
  const rungs = MATURITY.map((r) => ({ name: r.name, reached: r.reached(mine, technology, linked), doc: r.doc }));
  return { root, technology, rungs, usedFor: usedFor(mine, technology), wiring: linked.get(technology), evidence: evidenceOf(mine, technology, linked.get(technology)), unknowns: rungs.filter((r) => !r.reached).map((r) => missing(r.name)) };
}

const usedFor = (facts, t) => sortedUnique(facts.filter((f) => f.kind === "usage" && f.technology === t && f.operation).map((f) => `${f.integration ?? "?"}/${f.operation}${f.role ? ` (${f.role})` : ""}`));

const evidenceOf = (facts, t, wiring) => sortedUnique([...facts.filter((f) => (f.kind === "technology" || f.kind === "usage") && f.technology === t).flatMap((f) => f.evidence), ...wiring.flatMap((w) => w.evidence)]);

const MISSING = {
  declared: "no manifest here declares a package any descriptor maps to it — it is used through something this engine does not recognise, or not declared at all",
  used: "no code read here touches it — declared, and possibly never used",
  configured: "nothing registered with a composition root was traced to code that uses it",
  "used-for": "what it is used for — the code shows the client, never an operation",
  "architectural-pattern": "whether wrapping it behind this project's own abstractions is a pattern — fewer than two registrations do. Even two would be a candidate, never a rule",
};

const missing = (rung) => MISSING[rung] ?? `${rung} — not reached`;
