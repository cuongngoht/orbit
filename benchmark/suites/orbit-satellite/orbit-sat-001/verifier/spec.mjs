// THE SPEC of ORBIT-SAT-001: what Satellite's policy check must answer, written from its contract and never from its
// code. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy of it, and it never imports
// the subject. One action is judged on five things at once -- the profile it acts under, the operation kind it carries,
// the mode it works in, the provider it goes through and what was granted -- by ONE ordered table whose first failing
// row is the answer. Every check expects exactly the verdict and the rule, so a policy that allows everything, one that
// refuses everything and one that answers with the wrong row all fail.
//
// The vocabulary below is the contract's own (orbit.satellite.modes/v1, the operation kinds with their effects and the
// one owner a write names, the profiles), restated as data. Seeded actions are drawn over all of it, over the actions
// every table carries, and over the writes that name an owner, with the seed the run records.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-SAT-001";

export const GROUPS = {
  "owner-write-allowed": "a write kind (source.patch, check.run, sandbox.test.run) through an engineering task, in a mode and under a profile that carry it, granted, is allowed",
  "owner-required": "the same write through any provider but an engineering task is denied OWNER_REQUIRED, granted or not",
  "write-in-read-mode": "a store or write kind in a reading mode is denied WRITE_IN_READ_MODE, whatever the profile",
  "write-on-read-profile": "a store or write kind under READ_ONLY, in a mode that is not a reading mode, is denied WRITE_ON_READ_PROFILE",
  "read-allowed": "a read kind under a profile and in a mode that carry it, granted, is allowed through any provider",
  "store-allowed": "a store kind under a profile and in a mode that carry it, granted, is allowed",
  "not-granted": "an action every table carries, through its owner, that the grants do not hold is denied NOT_GRANTED",
  "mode-forbids": "a mode that does not carry the operation kind denies MODE_FORBIDS",
  "profile-mode": "a profile that does not work in the mode denies PROFILE_MODE",
  "profile-forbids": "a profile that does not carry the operation kind, in a mode that does, denies PROFILE_FORBIDS",
  "unknown-word": "an operation kind, a mode or a profile Satellite does not know is denied UNKNOWN_KIND, UNKNOWN_MODE or UNKNOWN_PROFILE, in that order",
  "seeded-owned-write": "seeded writes that name an owner, through seeded providers and grants: allowed only through an engineering task and only when granted",
  "seeded-carried": "seeded actions every table carries, through seeded providers and grants: exactly the row the ordered table comes to",
  "seeded-matrix": "seeded profiles, operation kinds, modes, providers and grants over the whole vocabulary: exactly the first row that fails",
};

// ---- the vocabulary, as the contract states it ------------------------------------------------------------------------

const READS = ["repository.read", "logs.read", "logs.analyze", "store.read", "evidence.read", "context.gather", "knowledge.recall", "schema.validate", "provider.invoke", "agent.dispatch"];

const STORES = ["plan.revise", "definition.register", "skill.draft", "artifact.publish"];

const WRITES = ["source.patch", "check.run", "sandbox.test.run"];

const KINDS = [...READS, ...STORES, ...WRITES];

// The only owner each write kind may happen through.
const OWNERS = { "source.patch": ["engineering"], "check.run": ["engineering"], "sandbox.test.run": ["engineering"] };

const PROVIDERS = ["engine", "host-agent", "engineering", "context", "knowledge", "capability"];

const PROFILES = {
  READ_ONLY: [...READS],
  DESIGN: [...READS, "artifact.publish"],
  IMPLEMENT: [...READS, "artifact.publish", "source.patch", "check.run"],
  VERIFY: [...READS, "artifact.publish", "check.run", "sandbox.test.run"],
  ORCHESTRATOR: [...READS, "plan.revise", "definition.register", "skill.draft", "artifact.publish"],
};

const AGENTS = ["READ_ONLY", "DESIGN", "IMPLEMENT", "VERIFY"];

const ENGINE = ["ORCHESTRATOR"];

const mode = (reads, kinds, profiles) => ({ reads, kinds, profiles });

const MODES = {
  ANALYZING: mode(true, ["schema.validate", "store.read"], ENGINE),
  RECALLING: mode(true, ["knowledge.recall", "context.gather", "store.read"], [...ENGINE, ...AGENTS]),
  EXPLORING: mode(true, ["repository.read", "logs.read", "logs.analyze", "evidence.read", "store.read", "provider.invoke"], AGENTS),
  PLANNING: mode(false, ["plan.revise", "schema.validate", "store.read"], ENGINE),
  ROLE_GENERATING: mode(false, ["definition.register", "schema.validate"], ENGINE),
  AGENT_GENERATING: mode(false, ["definition.register", "schema.validate"], ENGINE),
  SKILL_GENERATING: mode(false, ["skill.draft", "definition.register", "schema.validate", "store.read"], ENGINE),
  SKILL_VALIDATING: mode(true, ["schema.validate", "store.read"], ENGINE),
  REUSING: mode(false, ["store.read", "definition.register", "schema.validate"], ENGINE),
  DESIGNING: mode(false, ["repository.read", "store.read", "evidence.read", "artifact.publish", "definition.register", "schema.validate"], [...ENGINE, "DESIGN", "IMPLEMENT", "VERIFY"]),
  IMPLEMENTING: mode(false, ["source.patch", "repository.read"], ["IMPLEMENT"]),
  BUILDING: mode(false, ["check.run", "repository.read"], ["IMPLEMENT", "VERIFY"]),
  TESTING: mode(false, ["check.run", "sandbox.test.run", "evidence.read"], ["VERIFY"]),
  DIAGNOSING: mode(true, ["logs.read", "logs.analyze", "evidence.read", "repository.read"], AGENTS),
  REVIEWING: mode(true, ["repository.read", "evidence.read", "store.read"], AGENTS),
  VERIFYING: mode(true, ["evidence.read", "store.read"], AGENTS),
  DISPATCHING: mode(true, ["agent.dispatch", "provider.invoke"], ENGINE),
  HANDOFF: mode(false, ["artifact.publish", "store.read"], [...ENGINE, "DESIGN", "IMPLEMENT", "VERIFY"]),
  RECOVERING: mode(false, ["store.read", "evidence.read", "artifact.publish"], ENGINE),
};

const MODE_NAMES = Object.keys(MODES);

const PROFILE_IDS = Object.keys(PROFILES);

const writes = (kind) => !READS.includes(kind);

// ---- the reference model: the ordered table, as the contract words it --------------------------------------------------

const RULES = [
  ["UNKNOWN_KIND", (c) => !KINDS.includes(c.operationKind)],
  ["UNKNOWN_MODE", (c) => !Object.hasOwn(MODES, c.mode)],
  ["UNKNOWN_PROFILE", (c) => !Object.hasOwn(PROFILES, c.profile)],
  ["WRITE_IN_READ_MODE", (c) => MODES[c.mode].reads && writes(c.operationKind)],
  ["WRITE_ON_READ_PROFILE", (c) => c.profile === "READ_ONLY" && writes(c.operationKind)],
  ["MODE_FORBIDS", (c) => !MODES[c.mode].kinds.includes(c.operationKind)],
  ["PROFILE_MODE", (c) => !MODES[c.mode].profiles.includes(c.profile)],
  ["PROFILE_FORBIDS", (c) => !PROFILES[c.profile].includes(c.operationKind)],
  ["OWNER_REQUIRED", (c) => Object.hasOwn(OWNERS, c.operationKind) && !OWNERS[c.operationKind].includes(c.provider)],
  ["NOT_GRANTED", (c) => !c.grants.includes(c.operationKind)],
];

// The first row that fails, or ALLOW when none does.
export const ruleOf = (c) => RULES.find(([, fails]) => fails(c))?.[0] ?? "ALLOW";

const judged = (c) => ((rule) => ({ exactly: [rule === "ALLOW" ? "allow" : "deny", rule] }))(ruleOf(c));

// ---- the checks written by hand: profile, operation kind, mode, provider, grants -> the row ----------------------------

const action = (profile, operationKind, modeName, provider, grants = KINDS) => ({ call: "evaluate", profile, operationKind, mode: modeName, provider, grants: [...grants] });

const without = (kind) => KINDS.filter((k) => k !== kind);

const HAND = [
  ["owner-write-allowed", action("IMPLEMENT", "source.patch", "IMPLEMENTING", "engineering"), "ALLOW"],
  ["owner-write-allowed", action("IMPLEMENT", "check.run", "BUILDING", "engineering"), "ALLOW"],
  ["owner-write-allowed", action("VERIFY", "check.run", "BUILDING", "engineering"), "ALLOW"],
  ["owner-write-allowed", action("VERIFY", "check.run", "TESTING", "engineering"), "ALLOW"],
  ["owner-write-allowed", action("VERIFY", "sandbox.test.run", "TESTING", "engineering", ["sandbox.test.run"]), "ALLOW"],
  ["owner-required", action("IMPLEMENT", "source.patch", "IMPLEMENTING", "host-agent"), "OWNER_REQUIRED"],
  ["owner-required", action("IMPLEMENT", "source.patch", "IMPLEMENTING", "engine"), "OWNER_REQUIRED"],
  ["owner-required", action("IMPLEMENT", "source.patch", "IMPLEMENTING", "capability"), "OWNER_REQUIRED"],
  ["owner-required", action("IMPLEMENT", "check.run", "BUILDING", "host-agent"), "OWNER_REQUIRED"],
  ["owner-required", action("VERIFY", "check.run", "TESTING", "context"), "OWNER_REQUIRED"],
  ["owner-required", action("VERIFY", "sandbox.test.run", "TESTING", "host-agent"), "OWNER_REQUIRED"],
  ["owner-required", action("VERIFY", "sandbox.test.run", "TESTING", "knowledge"), "OWNER_REQUIRED"],
  ["owner-required", action("VERIFY", "check.run", "BUILDING", "engine", without("check.run")), "OWNER_REQUIRED"],
  ["write-in-read-mode", action("IMPLEMENT", "source.patch", "EXPLORING", "engineering"), "WRITE_IN_READ_MODE"],
  ["write-in-read-mode", action("IMPLEMENT", "source.patch", "REVIEWING", "engineering"), "WRITE_IN_READ_MODE"],
  ["write-in-read-mode", action("VERIFY", "check.run", "VERIFYING", "engineering"), "WRITE_IN_READ_MODE"],
  ["write-in-read-mode", action("VERIFY", "sandbox.test.run", "DIAGNOSING", "engineering"), "WRITE_IN_READ_MODE"],
  ["write-in-read-mode", action("ORCHESTRATOR", "plan.revise", "ANALYZING", "engine"), "WRITE_IN_READ_MODE"],
  ["write-in-read-mode", action("DESIGN", "artifact.publish", "RECALLING", "host-agent"), "WRITE_IN_READ_MODE"],
  ["write-in-read-mode", action("ORCHESTRATOR", "definition.register", "SKILL_VALIDATING", "engine"), "WRITE_IN_READ_MODE"],
  ["write-in-read-mode", action("READ_ONLY", "source.patch", "EXPLORING", "engineering"), "WRITE_IN_READ_MODE"],
  ["write-on-read-profile", action("READ_ONLY", "source.patch", "IMPLEMENTING", "engineering"), "WRITE_ON_READ_PROFILE"],
  ["write-on-read-profile", action("READ_ONLY", "check.run", "TESTING", "engineering"), "WRITE_ON_READ_PROFILE"],
  ["write-on-read-profile", action("READ_ONLY", "artifact.publish", "HANDOFF", "engine"), "WRITE_ON_READ_PROFILE"],
  ["write-on-read-profile", action("READ_ONLY", "definition.register", "DESIGNING", "engine"), "WRITE_ON_READ_PROFILE"],
  ["read-allowed", action("READ_ONLY", "repository.read", "EXPLORING", "host-agent"), "ALLOW"],
  ["read-allowed", action("READ_ONLY", "repository.read", "REVIEWING", "host-agent"), "ALLOW"],
  ["read-allowed", action("VERIFY", "evidence.read", "VERIFYING", "host-agent"), "ALLOW"],
  ["read-allowed", action("DESIGN", "logs.analyze", "DIAGNOSING", "host-agent"), "ALLOW"],
  ["read-allowed", action("IMPLEMENT", "repository.read", "IMPLEMENTING", "engineering"), "ALLOW"],
  ["read-allowed", action("READ_ONLY", "provider.invoke", "EXPLORING", "capability", ["provider.invoke"]), "ALLOW"],
  ["read-allowed", action("ORCHESTRATOR", "knowledge.recall", "RECALLING", "knowledge"), "ALLOW"],
  ["read-allowed", action("ORCHESTRATOR", "agent.dispatch", "DISPATCHING", "engine"), "ALLOW"],
  ["store-allowed", action("ORCHESTRATOR", "plan.revise", "PLANNING", "engine"), "ALLOW"],
  ["store-allowed", action("ORCHESTRATOR", "definition.register", "ROLE_GENERATING", "engine"), "ALLOW"],
  ["store-allowed", action("ORCHESTRATOR", "skill.draft", "SKILL_GENERATING", "engine"), "ALLOW"],
  ["store-allowed", action("DESIGN", "artifact.publish", "HANDOFF", "host-agent"), "ALLOW"],
  ["store-allowed", action("VERIFY", "artifact.publish", "DESIGNING", "host-agent"), "ALLOW"],
  ["store-allowed", action("ORCHESTRATOR", "artifact.publish", "RECOVERING", "engine"), "ALLOW"],
  ["not-granted", action("READ_ONLY", "repository.read", "EXPLORING", "host-agent", []), "NOT_GRANTED"],
  ["not-granted", action("IMPLEMENT", "source.patch", "IMPLEMENTING", "engineering", ["repository.read"]), "NOT_GRANTED"],
  ["not-granted", action("ORCHESTRATOR", "plan.revise", "PLANNING", "engine", READS), "NOT_GRANTED"],
  ["not-granted", action("VERIFY", "sandbox.test.run", "TESTING", "engineering", ["check.run", "evidence.read"]), "NOT_GRANTED"],
  ["mode-forbids", action("IMPLEMENT", "source.patch", "BUILDING", "engineering"), "MODE_FORBIDS"],
  ["mode-forbids", action("VERIFY", "sandbox.test.run", "BUILDING", "engineering"), "MODE_FORBIDS"],
  ["mode-forbids", action("READ_ONLY", "logs.read", "REVIEWING", "host-agent"), "MODE_FORBIDS"],
  ["mode-forbids", action("ORCHESTRATOR", "agent.dispatch", "PLANNING", "engine"), "MODE_FORBIDS"],
  ["mode-forbids", action("IMPLEMENT", "check.run", "IMPLEMENTING", "engineering"), "MODE_FORBIDS"],
  ["profile-mode", action("DESIGN", "check.run", "BUILDING", "engineering"), "PROFILE_MODE"],
  ["profile-mode", action("VERIFY", "definition.register", "ROLE_GENERATING", "engine"), "PROFILE_MODE"],
  ["profile-mode", action("IMPLEMENT", "plan.revise", "PLANNING", "engine"), "PROFILE_MODE"],
  ["profile-mode", action("ORCHESTRATOR", "source.patch", "IMPLEMENTING", "engineering"), "PROFILE_MODE"],
  ["profile-mode", action("READ_ONLY", "schema.validate", "ANALYZING", "engine"), "PROFILE_MODE"],
  ["profile-mode", action("READ_ONLY", "evidence.read", "TESTING", "engineering"), "PROFILE_MODE"],
  ["profile-forbids", action("DESIGN", "definition.register", "DESIGNING", "engine"), "PROFILE_FORBIDS"],
  ["profile-forbids", action("IMPLEMENT", "definition.register", "DESIGNING", "engine"), "PROFILE_FORBIDS"],
  ["profile-forbids", action("VERIFY", "definition.register", "DESIGNING", "engine"), "PROFILE_FORBIDS"],
  ["unknown-word", action("READ_ONLY", "shell.run", "EXPLORING", "host-agent"), "UNKNOWN_KIND"],
  ["unknown-word", action("IMPLEMENT", "git.push", "IMPLEMENTING", "engineering"), "UNKNOWN_KIND"],
  ["unknown-word", action("READ_ONLY", "repository.read", "SLEEPING", "host-agent"), "UNKNOWN_MODE"],
  ["unknown-word", action("ADMINISTRATOR", "repository.read", "EXPLORING", "host-agent"), "UNKNOWN_PROFILE"],
  ["unknown-word", action("ADMINISTRATOR", "secret.read", "SLEEPING", "host-agent"), "UNKNOWN_KIND"],
  ["unknown-word", action("ADMINISTRATOR", "repository.read", "SLEEPING", "host-agent"), "UNKNOWN_MODE"],
  ["unknown-word", action("implement", "source.patch", "IMPLEMENTING", "engineering"), "UNKNOWN_PROFILE"],
];

const FIXED = HAND.map(([group, input, rule]) => ({ group, input, expect: { exactly: [rule === "ALLOW" ? "allow" : "deny", rule] } }));

// ---- a seeded generator, the same actions for the same seed ------------------------------------------------------------

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

// Every [profile, kind, mode] the vocabulary carries together: the mode carries the kind, the profile works in the mode
// and carries the kind, and no write rides a reading mode or a READ_ONLY profile.
const carriedIn = (name) => MODES[name].kinds.flatMap((kind) => MODES[name].profiles.filter((p) => PROFILES[p].includes(kind) && !(writes(kind) && (MODES[name].reads || p === "READ_ONLY"))).map((p) => [p, kind, name]));

export const CARRIED = MODE_NAMES.flatMap(carriedIn);

export const OWNED = CARRIED.filter(([, kind]) => Object.hasOwn(OWNERS, kind));

const granted = (r, kind, p) => (r() < p ? KINDS : without(kind));

const seeded = (group, input) => ({ group, input, expect: judged(input) });

const ownedWrite = (r) => ((t) => seeded("seeded-owned-write", action(t[0], t[1], t[2], pick(r, PROVIDERS), granted(r, t[1], 0.75))))(pick(r, OWNED));

const carried = (r) => ((t) => seeded("seeded-carried", action(t[0], t[1], t[2], pick(r, PROVIDERS), granted(r, t[1], 0.8))))(pick(r, CARRIED));

const matrix = (r) => seeded("seeded-matrix", action(pick(r, [...PROFILE_IDS, "ADMINISTRATOR"]), pick(r, [...KINDS, "shell.run"]), pick(r, [...MODE_NAMES, "IDLE"]), pick(r, PROVIDERS), KINDS.filter(() => r() < 0.85)));

const many = (r, n, make) => Array.from({ length: n }, () => make(r));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  const third = Math.max(8, Math.floor(samples / 3));
  return numbered([...FIXED, ...many(r, third, ownedWrite), ...many(r, third, carried), ...many(r, Math.max(16, Math.floor(samples / 2)), matrix)]);
}

// ---- the reference model, held to what the contract says in words ------------------------------------------------------

const VOCABULARY = [
  ["nineteen modes", MODE_NAMES.length === 19],
  ["seventeen operation kinds", KINDS.length === 17],
  ["four profiles a role may request, and the engine's own", PROFILE_IDS.length === 5],
  ["a write that names an owner is carried somewhere", OWNED.length > 0],
];

export const selfTest = () => [...HAND.filter(([, input, rule]) => ruleOf(input) !== rule).map(([group, input]) => `the reference model disagrees with the contract on ${group}: ${input.profile} ${input.operationKind} ${input.mode} through ${input.provider}`), ...VOCABULARY.filter(([, holds]) => !holds).map(([say]) => `the vocabulary is not the contract's: ${say}`)];
