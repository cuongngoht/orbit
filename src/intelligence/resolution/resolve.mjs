// The CAPABILITY RESOLVER: given an intent, should an executable capability be
// REUSED, BUILT -- or is the honest answer UNKNOWN, or BLOCKED?
//
// It decides, and it never acts. It generates no code, registers nothing and
// writes nothing; `build` is a verdict with its evidence, for a builder to
// pick up later (the orbit-qc-builder playbook today). And a technology
// being present never makes a capability executable: those are two questions,
// and the answer to one is only ever evidence for the other.
//
// Two ordered tables, each first-match-wins with a last row that always
// matches -- the Chain of Responsibility the precedence asks for:
//
//   WHICH TECHNOLOGY, most specific evidence first:
//     1 an IMPLEMENTATION -- this project already does exactly this operation
//       on this system, with one technology
//     2 a CONVENTION a person adopted or a gate enforces, naming one
//     4 a TECHNOLOGY this project declares that can serve the system
//     5 DESCRIPTOR knowledge -- a technology that could, which nobody declared
//   and WHAT TO DO:
//     3 an existing registered capability for it  -> reuse
//     6 no capability, technology settled         -> build
//     7 anything else                             -> unknown, and why
//
// Nothing below names a system, a technology or an operation. "Files through
// one client, lists through another" is not a rule here; it is whatever the
// integration facts say, operation by operation.
import { capabilityWords, parseIntent, stem } from "./intent.mjs";
import { sortedUnique } from "../group.mjs";
import { tokens } from "../../tokens.mjs";

export const MAX_EVIDENCE = 8;

// Each step answers settled (one technology), ambiguous (more than one), or
// passes. `says` is always filled, so every step's verdict is printed.
export const STEPS = [
  { name: "implementation", settle: (i, w) => implemented(i, w) },
  { name: "convention", settle: (i, w) => conventional(i, w) },
  { name: "technology", settle: (i, w) => declared(i, w) },
  { name: "descriptor", settle: (i, w) => described(i, w) },
];

export const DECISIONS = [
  { name: "blocked", when: (r) => !r.world.snapshot, reason: () => "nothing has read this project's technologies yet — `intelligence ensure` builds the snapshot this needs" },
  { name: "unknown", when: (r) => !r.intent.integration && !r.intent.hint, reason: (r) => `the intent names no system anything here knows — asked about ${r.intent.asked.join(", ") || "nothing"}` },
  { name: "reuse", when: (r) => r.capabilities.length > 0, reason: (r) => `an executable capability already exists: ${r.capabilities.map((c) => c.id).join(", ")}` },
  { name: "unknown", when: (r) => r.selection.status === "ambiguous", reason: (r) => r.selection.says },
  { name: "build", when: (r) => r.selection.status === "settled", reason: (r) => `required execution capability is missing — ${r.selection.says}` },
  { name: "unknown", when: (r) => r.selection.status === "knowledge", reason: (r) => `${r.selection.says} — choosing one is this project's decision, not this tool's` },
  { name: "unknown", when: () => true, reason: () => "nothing here settles which technology would do this, and no capability exists for it" },
];

export function resolve(text, world) {
  const intent = parseIntent(text, world);
  const trail = walk(intent, world);
  const found = matchingCapabilities(intent, world, trail.selection);
  const row = DECISIONS.find((d) => d.when({ intent, world, capabilities: found, selection: trail.selection }));
  return answer(row, intent, trail, found);
}

function walk(intent, world) {
  const considered = [];
  const selection = STEPS.reduce((done, step) => done ?? taken(considered, step, intent, world), null) ?? { status: "none", says: "no step could name a technology" };
  return { selection, considered };
}

function taken(considered, step, intent, world) {
  const verdict = step.settle(intent, world);
  considered.push({ step: step.name, verdict: verdict.status, says: verdict.says });
  return verdict.status === "pass" ? null : verdict;
}

function answer(row, intent, trail, found) {
  const s = trail.selection;
  const technology = s.status === "settled" ? s.technology : null;
  return { intent: intent.text, decision: row.name, ...(found.length ? { capability: found[0].id } : {}), ...(technology ? { technology } : {}), ...(intent.integration ? { integration: intent.integration } : {}), ...(intent.operation ? { operation: intent.operation } : {}), reason: row.reason({ intent, capabilities: found, selection: s }), evidence: sortedUnique([...(s.evidence ?? []), ...found.map((c) => `capability ${c.id} (${c.from})`)]).slice(0, MAX_EVIDENCE), considered: trail.considered, ...(s.options ? { options: s.options } : {}), unknowns: unknownsOf(row, s, found), next: NEXT[row.name] };
}

const NEXT = {
  reuse: "call it from a case with {\"do\":\"call\"} — `query capability <id>` prints its contract",
  build: "the orbit-qc-builder playbook builds the smallest capability this needs, on the technology above. Nothing was generated or registered",
  unknown: "settle what is listed as unknown first — a person, `intelligence why`, or the architecture scanner on one bounded question",
  blocked: "run `intelligence ensure`, then ask again",
};

// A capability declares what it does, never what it is built on -- so reusing
// one is always said beside the technology the project's own evidence names.
const unknownsOf = (row, s, found) => [...(s.unknowns ?? []), ...(row.name === "reuse" && s.status === "settled" ? [`whether ${found[0].id} is built on ${s.technology}, which is what this project's own evidence uses for it — a capability does not declare what it is built on`] : [])];

// ---- step 1: the project already DOES this operation on this system ----

function implemented(intent, world) {
  const hits = world.facts.filter((f) => f.kind === "integration" && f.integration === intent.integration && (!intent.operation || f.operation === intent.operation));
  if (!intent.integration || !hits.length) return { status: "pass", says: `no code here does ${describe(intent)} yet` };
  return settledBy(sortedUnique(hits.flatMap((f) => f.technologies)), hits, `this project already does ${describe(intent)}`);
}

function settledBy(technologies, facts, lead) {
  const evidence = sortedUnique(facts.flatMap((f) => f.evidence));
  if (technologies.length === 1) return { status: "settled", technology: technologies[0], evidence, says: `${lead} with ${technologies[0]}` };
  return { status: "ambiguous", technologies, evidence, says: `${lead} with ${technologies.join(" and ")} — which one new work should follow is this project's decision`, unknowns: ["which technology this intent should use — the project already does it more than one way"] };
}

const describe = (intent) => [intent.integration, intent.operation].filter(Boolean).join(" ") || intent.hint || "this";

// ---- step 2: a person adopted it, or a gate enforces it ----

function conventional(intent, world) {
  const rules = (world.conventions ?? []).filter((c) => mentions(c, intent));
  const named = sortedUnique(rules.flatMap((c) => technologiesNamed(c, world)));
  if (!rules.length || named.length !== 1) return { status: "pass", says: rules.length ? `${rules.length} binding convention(s) touch it, and they do not name exactly one technology` : "no adopted or enforced convention speaks to it" };
  return { status: "settled", technology: named[0], evidence: sortedUnique(rules.flatMap((c) => c.evidence ?? [])), says: `the project's own convention says ${named[0]} (${rules.map((c) => c.id).join(", ")})` };
}

const wordsOf = (c) => new Set(tokens(`${c.key ?? ""} ${c.statement ?? ""}`).map(stem));

const mentions = (c, intent) => Boolean(intent.integration) && tokens(intent.integration).every((t) => wordsOf(c).has(stem(t))) && (!intent.operation || wordsOf(c).has(stem(intent.operation)));

const technologiesNamed = (c, world) => world.descriptors.filter((d) => [d.id, ...(d.aliases ?? [])].some((n) => tokens(n).every((t) => wordsOf(c).has(stem(t))) && tokens(n).length)).map((d) => d.id);

// ---- step 4: a technology the project declares can serve it ----

function declared(intent, world) {
  const target = intent.integration;
  const techs = world.facts.filter((f) => f.kind === "technology" && (f.technology === intent.hint || (target && (f.technology === target || (f.domains ?? []).includes(target)))));
  if (!techs.length) return { status: "pass", says: `no declared technology here can serve ${describe(intent)}` };
  const settled = settledBy(sortedUnique(techs.map((f) => f.technology)), techs, `this project declares`);
  return { ...settled, unknowns: [...(settled.unknowns ?? []), `whether ${describe(intent)} already works with it — it is declared, and no code here was seen doing exactly this`] };
}

// ---- step 5: only the catalog knows ----

function described(intent, world) {
  const could = world.descriptors.filter((d) => (d.domains ?? []).includes(intent.integration));
  if (!intent.integration || !could.length) return { status: "pass", says: "no registered descriptor serves it either" };
  return { status: "knowledge", options: could.map((d) => d.id), says: `nothing declared here serves ${intent.integration}; ${could.map((d) => d.id).join(", ")} could`, unknowns: ["which technology to introduce — the catalog knows what could, never what this project should use"] };
}

// ---- the capability check (3) ----

// A capability matches when its id names the system -- or the settled
// technology, by id or alias -- and, when the intent names an operation, the
// operation too. Read off the id's own words; a capability that declares what
// it is built on is taken at its word.
function matchingCapabilities(intent, world, selection) {
  const systemWords = [...namesFor(intent.integration, world), ...namesFor(selection.technology ?? intent.hint, world)].map(stem);
  const fits = (c) => systemWords.some((w) => capabilityWords(c.id).has(w)) && (!intent.operation || capabilityWords(c.id).has(stem(intent.operation)));
  return systemWords.length ? (world.capabilities ?? []).filter(fits) : [];
}

// A subject's own words, plus the aliases of the descriptor that IS it -- the
// database whose id is also the system's name, the technology a step settled.
function namesFor(subject, world) {
  const d = world.descriptors.find((x) => x.id === subject);
  return subject ? sortedUnique([...tokens(subject), ...(d?.aliases ?? []).flatMap(tokens)]) : [];
}
