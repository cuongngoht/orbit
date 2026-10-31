// THE SPEC of ORBIT-MEM-004: how far a project knowledge claim may be relied on, written from its contract and never
// from its code. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy of it, and it
// never imports the subject. Every check is a claim and an expectation over the one tier the subject reports for it.
//
// The contract (AGENTS.md -- "authority (rule · adopted · source · confirmed · host-memory · inference) is computed
// from what a claim already says, never stored", "a host's memory is a hint, never a truth ... never certain, never
// above host-memory" -- and the vocabulary of src/knowledge/vocab.mjs, whose every column is documented): the ladder
// reads, first match wins, an explicit rule (a gate in this repository enforces it -- named as enforced, confirmed by
// two independent sessions, and fresh as measured NOW -- or an organisation's own decision), then a person's decision
// (what no observer may claim: enforced or adopted), then what the current source shows (a verified source, fresh as
// measured now, reporting what it demonstrably does), then what independent sessions confirmed (certain, observed, and
// never from a host's memory), then a host's memory, then everything else. Freshness is MEASURED, never the status
// stamped when the claim was recorded: a moved scope must not keep a claim at `source`. A tier a claim carries is
// never read.
//
// Every claim stays inside the declared vocabulary: a source claims only the strengths its row allows, and a host's
// memory arrives as a session claim.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-MEM-004";

export const GROUPS = {
  "rule-by-gate": "a gate this repository runs, confirmed by two sessions and fresh as measured now, is a rule",
  "rule-by-organization": "an organisation's own decision is a rule, however sure or fresh",
  adopted: "a person's decision, or a gate not yet a rule, is adopted -- above anything an observer saw",
  source: "a verified source, fresh as measured now, reporting what it demonstrably does is source",
  "moved-scope-drops-source": "a scope that moved or cannot be measured drops a claim from source -- to confirmed when two sessions confirmed it, else to inference",
  "measured-not-stamped": "freshness is the one measured now, never the status stamped at recording",
  confirmed: "certain, observed, and not from a host's memory, but not shown by current source: confirmed",
  "host-memory-never-above": "a host's memory is host-memory, never above it, whatever it claims to be sure of",
  inference: "a suggestion, or an observation only one session saw from an unverified source, is an inference",
  "carried-tier-ignored": "a tier a claim carries is never read: authority is derived every time",
  seeded: "seeded claims across the vocabulary: exactly the tier the ladder derives",
};

// ---- the reference model: the contract, as data -------------------------------------------------------------------

const ALL = ["enforced", "adopted", "observed", "suggested"];

// What each source is, and the strengths a claim from it may carry -- the vocabulary's documented rows.
const SOURCES = {
  repository: { verified: true, strengths: ALL },
  "package-manifest": { verified: true, strengths: ALL },
  "project-config": { verified: true, strengths: ALL },
  "test-suite": { verified: true, strengths: ALL },
  "generated-schema": { verified: true, strengths: ALL },
  "human-declared-memory": { verified: false, strengths: ["adopted", "suggested"] },
  "host-memory": { verified: false, host: true, strengths: ["observed", "suggested"] },
  investigation: { verified: false, strengths: ["observed"] },
  "work-receipt": { verified: false, strengths: ["observed", "suggested"] },
};

// What no observer may claim: a gate, or a person's decision.
const PERSON_OR_GATE = ["enforced", "adopted"];

const gateRule = (c) => c.strength === "enforced" && c.confidence === "certain" && c.measured === "fresh";

const LADDER = [
  { tier: "rule", when: (c) => gateRule(c) || (c.layer === "organization" && PERSON_OR_GATE.includes(c.strength)) },
  { tier: "adopted", when: (c) => PERSON_OR_GATE.includes(c.strength) },
  { tier: "source", when: (c) => SOURCES[c.source]?.verified === true && c.measured === "fresh" && c.strength === "observed" },
  { tier: "confirmed", when: (c) => c.confidence === "certain" && c.strength === "observed" && SOURCES[c.source]?.host !== true },
  { tier: "host-memory", when: (c) => SOURCES[c.source]?.host === true },
  { tier: "inference", when: () => true },
];

export const tierOf = (claim) => LADDER.find((row) => row.when(claim)).tier;

export const owed = (input) => ({ exactly: [tierOf(input.claim)] });

// ---- what the inputs are made of ------------------------------------------------------------------------------------

// A claim as the knowledge store keeps it, with the freshness measured now beside the status stamped at recording.
const claim = (source, strength, confidence, measured, layer = "project", extra = {}) => ({ subject: "billing", relation: "uses", object: "ledger", context: {}, source, strength, confidence, status: "fresh", measured, layer, ...extra });

const row = (group, c, tier) => ({ group, input: { call: "authority", claim: c }, expect: { exactly: [tier] } });

// ---- the checks written by hand, each from a sentence of the contract ------------------------------------------------

export const STRUCTURE = [
  row("rule-by-gate", claim("repository", "enforced", "certain", "fresh"), "rule"),
  row("rule-by-gate", claim("test-suite", "enforced", "certain", "fresh"), "rule"),
  row("rule-by-organization", claim("human-declared-memory", "adopted", "possible", "unknown", "organization"), "rule"),
  row("rule-by-organization", claim("repository", "enforced", "possible", "stale", "organization"), "rule"),
  row("adopted", claim("human-declared-memory", "adopted", "possible", "fresh"), "adopted"),
  row("adopted", claim("repository", "enforced", "possible", "fresh"), "adopted"),
  row("adopted", claim("repository", "enforced", "certain", "stale"), "adopted"),
  row("adopted", claim("human-declared-memory", "adopted", "certain", "stale"), "adopted"),
  row("source", claim("repository", "observed", "possible", "fresh"), "source"),
  row("source", claim("package-manifest", "observed", "unknown", "fresh"), "source"),
  row("source", claim("generated-schema", "observed", "certain", "fresh"), "source"),
  row("moved-scope-drops-source", claim("repository", "observed", "certain", "stale"), "confirmed"),
  row("moved-scope-drops-source", claim("repository", "observed", "possible", "stale"), "inference"),
  row("moved-scope-drops-source", claim("project-config", "observed", "possible", "unknown"), "inference"),
  row("moved-scope-drops-source", claim("test-suite", "observed", "certain", "unknown"), "confirmed"),
  row("measured-not-stamped", claim("repository", "observed", "possible", "stale", "project", { status: "fresh" }), "inference"),
  row("measured-not-stamped", claim("repository", "observed", "possible", "fresh", "project", { status: "stale" }), "source"),
  row("measured-not-stamped", claim("package-manifest", "observed", "certain", "unknown", "project", { status: "fresh" }), "confirmed"),
  row("confirmed", claim("investigation", "observed", "certain", "fresh"), "confirmed"),
  row("confirmed", claim("work-receipt", "observed", "certain", "stale"), "confirmed"),
  row("host-memory-never-above", claim("host-memory", "observed", "possible", "fresh", "session"), "host-memory"),
  row("host-memory-never-above", claim("host-memory", "observed", "certain", "fresh", "session"), "host-memory"),
  row("host-memory-never-above", claim("host-memory", "observed", "certain", "fresh", "organization"), "host-memory"),
  row("host-memory-never-above", claim("host-memory", "suggested", "certain", "fresh", "session"), "host-memory"),
  row("host-memory-never-above", claim("host-memory", "observed", "certain", "stale", "session"), "host-memory"),
  row("inference", claim("repository", "suggested", "certain", "fresh"), "inference"),
  row("inference", claim("investigation", "observed", "possible", "fresh"), "inference"),
  row("inference", claim("work-receipt", "suggested", "possible", "fresh"), "inference"),
  row("inference", claim("human-declared-memory", "suggested", "certain", "fresh"), "inference"),
  row("carried-tier-ignored", claim("repository", "suggested", "possible", "fresh", "project", { tier: "rule", authority: "rule", binding: true }), "inference"),
  row("carried-tier-ignored", claim("host-memory", "observed", "certain", "fresh", "session", { tier: "confirmed", authority: "source" }), "host-memory"),
];

// ---- a seeded generator, the same numbers for the same seed --------------------------------------------------------

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    const t = Math.imul(s ^ (s >>> 15), s | 1);
    const u = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];

const CONFIDENCES = ["certain", "possible", "unknown"];
const STATUSES = ["fresh", "stale", "unknown"];

// A host's memory arrives as a session claim; anything else is the project's, or now and then an organisation's.
const layerOf = (r, source) => (SOURCES[source].host ? "session" : r() < 0.2 ? "organization" : "project");

// Observed claims and fresh measurements weigh more: what current source shows is the narrowest tier to reach.
const strengthOf = (r, source) => pick(r, [...SOURCES[source].strengths, ...SOURCES[source].strengths.filter((s) => s === "observed")]);

const seededClaim = (r, source) => claim(source, strengthOf(r, source), pick(r, CONFIDENCES), pick(r, ["fresh", ...STATUSES]), layerOf(r, source), { status: pick(r, STATUSES) });

const seededRow = (r) => ((input) => ({ group: "seeded", input, expect: owed(input) }))({ call: "authority", claim: seededClaim(r, pick(r, Object.keys(SOURCES))) });

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...STRUCTURE, ...Array.from({ length: Math.max(8, samples) }, () => seededRow(r))]);
}

// ---- the reference model, held to the table written by hand ---------------------------------------------------------

const agrees = (c) => JSON.stringify(owed(c.input)) === JSON.stringify(c.expect);

export const selfTest = () => STRUCTURE.filter((c) => !agrees(c)).map((c) => `the reference model disagrees with the contract on a ${c.group} check: ${JSON.stringify(c.input.claim)}`);
