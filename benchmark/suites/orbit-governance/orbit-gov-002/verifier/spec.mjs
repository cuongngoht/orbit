// THE SPEC of ORBIT-GOV-002: production is DECLARED, never guessed. A word somebody that knows declared reads onto one
// tier however it is written, a word nobody listed is unknown and unknown is never production, the strictest of
// several declarations wins, and a capability lands where its declarations say -- so authorize asks a person exactly
// for what lands on production. Written from the contract (AGENTS.md "what is production is what a person or a project
// DECLARED, and unknown is never production", the headers of src/protected/environments.mjs and capability.mjs), kept
// beside the probe and handed to no runner; it never imports the subject. Both directions are checked: a tier reader
// that calls everything production fails as surely as one that calls nothing production.
//
// The fixed rows carry answers written by hand; the seeded rows -- several declarations at random, capabilities at
// random -- are answered by the reference model, which selfTest holds to every answer written by hand.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to the rows written by hand from the contract
export const CASE = "ORBIT-GOV-002";

export const GROUPS = {
  "declared-tier": "each word Orbit accepts reads onto its one tier: production, staging, preview, development and shared-development, test, and local, sandbox and task-isolated",
  "declared-as-written": "a declaration is read the way a person writes it: its letter case and the whitespace around it change nothing",
  "unlisted-word": "a word nobody listed -- prod, live, production-eu, an empty, blank or missing declaration, a number -- is unknown",
  "is-production": "isProduction is true exactly for a production declaration, however it is written, and never for anything else",
  "strictest-declaration": "of several declarations the strictest known tier wins -- production, staging, preview, development, test, local -- and unknown only when none is known",
  "capability-production": "a capability that declares production lands there: its deploy, migration, destructive operation or undeclared write asks a person; a read or a declared write does not",
  "capability-sandbox": "a capability bound to a task's sandbox lands in it, autonomous -- unless it declares production too, and then production wins",
  "capability-undeclared": "a capability that declares no environment, or one nobody listed, lands nowhere known and never on production: autonomous whatever it does",
  "capability-elsewhere": "a capability declared staging, preview, development, test or local is autonomous whatever it does",
  "seeded-strictest": "several declarations at random, written in every way: the strictest known tier, or unknown",
  "seeded-capability": "capabilities at random: what they do, where they land, and whether authorize asks a person",
};

// ---- the reference model: the tiers and what a capability declares, as the contract states them --------------------

// The words each tier is declared with, strictest first.
const TIERS = [["production", ["production"]], ["staging", ["staging"]], ["preview", ["preview"]], ["development", ["development", "shared-development"]], ["test", ["test"]], ["local", ["local", "sandbox", "task-isolated"]]];

const asWritten = (word) => String(word ?? "").trim().toLowerCase();

export const tierFor = (word) => TIERS.find(([, words]) => words.includes(asWritten(word)))?.[0] ?? "unknown";

export const strictestFor = (words) => ((tiers) => TIERS.find(([tier]) => tiers.includes(tier))?.[0] ?? "unknown")((words ?? []).map(tierFor));

const DESTRUCTIVE = ["delete", "truncate", "drop", "purge", "reset"];

// What a capability does is what its effects declare: a protected effect, else a read, a declared write, or a write
// nobody described.
const PROTECTED = [["deploy", "deployment"], ["migrate", "database.migrate"], ...DESTRUCTIVE.map((op) => [op, `database.${op}`])];

const effectsOf = (cap) => (Array.isArray(cap?.effects) ? cap.effects : []);

const unprotectedKind = (cap) => (cap?.mutates !== true ? "data.read" : effectsOf(cap).some((e) => !["none", "read"].includes(e)) ? "data.write" : "data.mutate");

export const kindFor = (cap) => PROTECTED.find(([effect]) => effectsOf(cap).includes(effect))?.[1] ?? unprotectedKind(cap);

const boundToSandbox = (cap) => Object.values(cap?.inputSchema ?? {}).some((row) => Boolean(row?.bind));

export const landingFor = (cap) => strictestFor([boundToSandbox(cap) ? "local" : null, cap?.environment]);

// What production asks of each kind of action; anything else, and anything off production, is AUTO.
const ON_PRODUCTION = [
  { holds: (k) => k === "deployment", ids: ["approve_once", "PRODUCTION_DEPLOY"] },
  { holds: (k) => k === "database.migrate", ids: ["approve_once", "PRODUCTION_DB_MIGRATION"] },
  { holds: (k) => k === "data.mutate" || DESTRUCTIVE.some((op) => k === `database.${op}`), ids: ["approve_once_destructive", "PRODUCTION_DESTRUCTIVE_DATA"] },
];

const decided = (kind, tier) => (tier === "production" ? ON_PRODUCTION.find((r) => r.holds(kind))?.ids : null) ?? ["auto"];

export const capabilityIds = (cap) => ((kind, tier) => [`kind:${kind}`, `env:${tier}`, ...decided(kind, tier)])(kindFor(cap), landingFor(cap));

// ---- the checks written by hand ------------------------------------------------------------------------------------

const worded = (call, word) => (word === undefined ? { call } : { call, word });

const tier = (group, word, want) => ({ group, input: worded("tier", word), expect: { exactly: [want] } });

const production = (word, want) => ({ group: "is-production", input: worded("production", word), expect: { exactly: [want ? "production" : "not-production"] } });

const strictest = (group, words, want) => ({ group, input: { call: "strictest", words }, expect: { exactly: [want] } });

const capability = (group, cap, want) => ({ group, input: { call: "capability", capability: cap, input: { artifact: "orders:2", table: "invoices" } }, expect: { exactly: want } });

const TIER_ROWS = [
  ...["production", "staging", "preview", "development", "test", "local"].map((word) => tier("declared-tier", word, word)),
  tier("declared-tier", "shared-development", "development"),
  tier("declared-tier", "sandbox", "local"),
  tier("declared-tier", "task-isolated", "local"),
  ...[["PRODUCTION", "production"], ["Production", "production"], [" production ", "production"], ["production\n", "production"], ["\tproduction", "production"], ["STAGING", "staging"], [" Local ", "local"], ["Shared-Development", "development"], ["TASK-ISOLATED", "local"], [" test", "test"], ["Preview ", "preview"]].map(([word, want]) => tier("declared-as-written", word, want)),
  ...["prod", "prd", "live", "production-eu", "pre-production", "non-production", "productions", "external-readonly", "remote", "shared development", "", "   ", null, undefined, 0, true].map((word) => tier("unlisted-word", word, "unknown")),
];

const PRODUCTION_ROWS = [production("production", true), production("PRODUCTION", true), production(" Production ", true), production("staging", false), production("local", false), production("prod", false), production("production-eu", false), production("", false), production(null, false), production(undefined, false)];

const STRICTEST_ROWS = [
  strictest("strictest-declaration", ["local", "production"], "production"),
  strictest("strictest-declaration", ["production", "local"], "production"),
  strictest("strictest-declaration", ["staging", "test"], "staging"),
  strictest("strictest-declaration", ["test", "preview"], "preview"),
  strictest("strictest-declaration", ["local", "development"], "development"),
  strictest("strictest-declaration", ["preview", "staging", "test"], "staging"),
  strictest("strictest-declaration", ["sandbox", "task-isolated"], "local"),
  strictest("strictest-declaration", ["development", "staging", "production", "local"], "production"),
  strictest("strictest-declaration", ["local", "prod"], "local"),
  strictest("strictest-declaration", [null, "PRODUCTION"], "production"),
  strictest("strictest-declaration", ["local", " Production "], "production"),
  strictest("strictest-declaration", ["test", "STAGING", "local"], "staging"),
  strictest("strictest-declaration", ["prod", "live"], "unknown"),
  strictest("strictest-declaration", [], "unknown"),
  strictest("strictest-declaration", null, "unknown"),
];

const BOUND = { endpoint: { bind: "endpoint" } };

const DEPLOY = ["kind:deployment", "env:production", "approve_once", "PRODUCTION_DEPLOY"];
const MIGRATE = ["kind:database.migrate", "env:production", "approve_once", "PRODUCTION_DB_MIGRATION"];
const held = (kind) => [`kind:${kind}`, "env:production", "approve_once_destructive", "PRODUCTION_DESTRUCTIVE_DATA"];
const free = (kind, env) => [`kind:${kind}`, `env:${env}`, "auto"];

const CAPABILITY_ROWS = [
  capability("capability-production", { id: "orders.deploy", mutates: true, effects: ["deploy"], environment: "production" }, DEPLOY),
  capability("capability-production", { id: "orders.migrate", mutates: true, effects: ["migrate"], environment: "production" }, MIGRATE),
  capability("capability-production", { id: "orders.empty", mutates: true, effects: ["truncate"], environment: "production" }, held("database.truncate")),
  capability("capability-production", { id: "orders.fix", mutates: true, environment: "production" }, held("data.mutate")),
  capability("capability-production", { id: "orders.deploy", mutates: true, effects: ["deploy"], environment: "PRODUCTION" }, DEPLOY),
  capability("capability-production", { id: "orders.migrate", mutates: true, effects: ["migrate"], environment: " production " }, MIGRATE),
  capability("capability-production", { id: "orders.wipe", mutates: true, effects: ["delete"], environment: "Production" }, held("database.delete")),
  capability("capability-production", { id: "orders.read", mutates: false, effects: ["read"], environment: "production" }, free("data.read", "production")),
  capability("capability-production", { id: "orders.seed", mutates: true, effects: ["write", "publish"], environment: "production" }, free("data.write", "production")),
  capability("capability-sandbox", { id: "box.empty", mutates: true, effects: ["truncate"], inputSchema: BOUND }, free("database.truncate", "local")),
  capability("capability-sandbox", { id: "box.empty", mutates: true, effects: ["truncate"], environment: "production", inputSchema: BOUND }, held("database.truncate")),
  capability("capability-sandbox", { id: "box.deploy", mutates: true, effects: ["deploy"], environment: "PRODUCTION", inputSchema: BOUND }, DEPLOY),
  capability("capability-sandbox", { id: "box.fix", mutates: true, environment: "staging", inputSchema: BOUND }, free("data.mutate", "staging")),
  capability("capability-sandbox", { id: "box.seed", mutates: true, effects: ["write"], inputSchema: { ...BOUND, rows: { type: "array" } } }, free("data.write", "local")),
  capability("capability-sandbox", { id: "box.migrate", mutates: true, effects: ["migrate"], environment: "test", inputSchema: { db: { bind: "connection" } } }, free("database.migrate", "test")),
  capability("capability-undeclared", { id: "any.deploy", mutates: true, effects: ["deploy"] }, free("deployment", "unknown")),
  capability("capability-undeclared", { id: "any.migrate", mutates: true, effects: ["migrate"], environment: "prod" }, free("database.migrate", "unknown")),
  capability("capability-undeclared", { id: "any.empty", mutates: true, effects: ["truncate"], environment: "" }, free("database.truncate", "unknown")),
  capability("capability-undeclared", { id: "any.fix", mutates: true, environment: "live" }, free("data.mutate", "unknown")),
  capability("capability-undeclared", { id: "any.drop", mutates: true, effects: ["drop"], environment: null }, free("database.drop", "unknown")),
  capability("capability-undeclared", { id: "any.deploy", mutates: true, effects: ["deploy"], environment: "production-eu" }, free("deployment", "unknown")),
  capability("capability-elsewhere", { id: "rel.deploy", mutates: true, effects: ["deploy"], environment: "staging" }, free("deployment", "staging")),
  capability("capability-elsewhere", { id: "rel.migrate", mutates: true, effects: ["migrate"], environment: "test" }, free("database.migrate", "test")),
  capability("capability-elsewhere", { id: "rel.drop", mutates: true, effects: ["drop"], environment: "development" }, free("database.drop", "development")),
  capability("capability-elsewhere", { id: "rel.fix", mutates: true, environment: "local" }, free("data.mutate", "local")),
  capability("capability-elsewhere", { id: "rel.purge", mutates: true, effects: ["purge"], environment: "preview" }, free("database.purge", "preview")),
  capability("capability-elsewhere", { id: "rel.reset", mutates: true, effects: ["reset"], environment: "shared-development" }, free("database.reset", "development")),
];

const FIXED = [...TIER_ROWS, ...PRODUCTION_ROWS, ...STRICTEST_ROWS, ...CAPABILITY_ROWS];

// ---- a seeded generator, the same declarations for the same seed ------------------------------------------------------

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

// Declarations as people write them: listed words, the same words in another case or with whitespace, and words
// nobody listed.
const WORDS = ["production", "PRODUCTION", " production ", "Production\t", "staging", "STAGING", "preview", "development", "shared-development", "test", "Test", "local", " Local", "sandbox", "task-isolated", "prod", "live", "production-eu", "", null];

const seededWords = (r) => Array.from({ length: Math.floor(r() * 5) }, () => pick(r, WORDS));

const seededStrictest = (r) => ((words) => strictest("seeded-strictest", words, strictestFor(words)))(seededWords(r));

const WRITES = ["write", "publish", "enqueue", "trigger", "settle"];

// What a capability may declare it does: one protected effect, a declared write, a write nobody described, or a read.
const SHAPES = [
  (r) => ({ mutates: true, effects: [pick(r, PROTECTED)[0]] }),
  (r) => ({ mutates: true, effects: [pick(r, WRITES)] }),
  () => ({ mutates: true }),
  (r) => ({ mutates: false, effects: [pick(r, ["read", "none"])] }),
];

const present = (key, value) => (value === undefined ? {} : { [key]: value });

const seededCapability = (r) => ({ id: `cap.${Math.floor(r() * 1000)}`, ...pick(r, SHAPES)(r), ...present("environment", pick(r, [...WORDS, undefined, "production"])), ...(r() < 0.3 ? { inputSchema: BOUND } : {}) });

const seededCall = (r) => ((cap) => capability("seeded-capability", cap, capabilityIds(cap)))(seededCapability(r));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  const n = Math.max(8, Math.floor(samples / 2));
  return numbered([...FIXED, ...Array.from({ length: n }, () => seededStrictest(r)), ...Array.from({ length: n }, () => seededCall(r))]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const HAND_TIERS = [["production", "production"], ["PRODUCTION", "production"], [" staging ", "staging"], ["shared-development", "development"], ["task-isolated", "local"], ["prod", "unknown"], [null, "unknown"], ["", "unknown"]];

const HAND_STRICTEST = [[["local", "production"], "production"], [["test", "staging"], "staging"], [["local", "prod"], "local"], [[], "unknown"]];

const answerOf = (input) => ({ tier: () => [tierFor(input.word)], production: () => [tierFor(input.word) === "production" ? "production" : "not-production"], strictest: () => [strictestFor(input.words)], capability: () => capabilityIds(input.capability) })[input.call]();

const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const handFindings = () => [...HAND_TIERS.filter(([word, want]) => tierFor(word) !== want).map(([word]) => `the reference model reads ${JSON.stringify(word)} onto the wrong tier`), ...HAND_STRICTEST.filter(([words, want]) => strictestFor(words) !== want).map(([words]) => `the reference model picks the wrong tier of ${JSON.stringify(words)}`)];

const fixedFindings = () => FIXED.filter((c) => !sameIds(answerOf(c.input), c.expect.exactly)).map((c) => `the reference model disagrees with a row written by hand in ${c.group}: ${JSON.stringify(c.input)}`);

export const selfTest = () => [...handFindings(), ...fixedFindings()];
