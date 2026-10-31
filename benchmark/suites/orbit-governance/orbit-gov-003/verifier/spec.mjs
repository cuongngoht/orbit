// THE SPEC of ORBIT-GOV-003: a person's DENY is crossed only through Orbit Control's door, and an approval binds one
// action. crossing() lets AUTO through for anybody, a person's DENY only for an actor at Orbit Control's door, and an
// approve-once never; and two actions share the fingerprint an approval is bound to exactly when they are one action.
// Written from the contract (AGENTS.md "An approve-once is the existing task approval ... no approval is a standing
// permission", the header of src/protected/authorize.mjs, what each boundary row says it binds), kept beside the probe
// and handed to no runner; it never imports the subject. Both directions are checked: a crossing that lets everything
// through, or a fingerprint every action shares, fails as surely as one that refuses everything or never matches.
//
// The fixed rows carry answers written by hand; the seeded rows -- actions crossed by actors at random, protected
// actions changed at random -- are answered by the reference model, which selfTest holds to every answer written by
// hand.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to the rows written by hand from the contract
export const CASE = "ORBIT-GOV-003";

export const GROUPS = {
  "auto-crosses": "an AUTO action crosses for anybody, an absent actor included, and nobody is asked: AUTO",
  "control-door": "a person's DENY crosses for an actor at Orbit Control's door, which alone proves a person: CONTROL",
  "no-other-door": "no terminal, typed-back id, flag, claimed role, other door or absent actor crosses a person's DENY: DENIED",
  "approval-not-a-door": "an approve-once action is never crossed by a door, Orbit Control's included -- only a task's approval of exactly it: APPROVAL",
  "seeded-crossing": "actions and actors at random: AUTO always crosses, a person's DENY only through Orbit Control's door, an approve-once never here",
  "bound-field-changed": "a change to any field a boundary binds an approval to is another action: DIFFERENT",
  "shown-only-changed": "what is only shown, an identity riding along or a note is not what is approved: the SAME action",
  "same-action": "the same action, its fields in any order, asked through the same tool, has one fingerprint: SAME",
  "another-boundary": "actions at different boundaries, or of different destructive operations, never share a fingerprint: DIFFERENT",
  "another-tool": "the same action asked for through another tool is another request: DIFFERENT",
  "seeded-fingerprint": "protected actions changed at random: DIFFERENT exactly when a bound field, the boundary or the operation changed",
};

// ---- the reference model: the boundaries, who may cross them, and what an approval is bound to ----------------------

const DESTRUCTIVE = ["delete", "truncate", "drop", "purge", "reset"];

const declaredProduction = (word) => String(word ?? "").trim().toLowerCase() === "production";

const operationOf = (a) => DESTRUCTIVE.find((op) => a.kind === `database.${op}`) ?? (a.kind === "data.mutate" ? "mutate" : null);

// Each boundary, and the fields the contract says an approval of it is bound to (a DENY is never approved).
const ROWS = [
  { id: "PRIMARY_CHECKOUT_WRITE", decision: "deny", kind: () => "repository.primary_checkout.write", bound: [], holds: (a) => a.kind === "repository.write" && a.home === "primary-checkout" },
  { id: "GIT_PUSH", decision: "approve_once", kind: () => "repository.push", bound: ["repository", "remote", "url", "ref", "commit", "force"], holds: (a) => a.kind === "repository.push" },
  { id: "PRODUCTION_DEPLOY", decision: "approve_once", kind: () => "deployment.production", bound: ["environment", "artifact", "revision", "target", "input"], holds: (a) => a.kind === "deployment" && declaredProduction(a.environment) },
  { id: "PRODUCTION_DB_MIGRATION", decision: "approve_once", kind: () => "database.production.migrate", bound: ["environment", "database", "migration", "digest", "target", "input"], holds: (a) => a.kind === "database.migrate" && declaredProduction(a.environment) },
  { id: "PRODUCTION_DESTRUCTIVE_DATA", decision: "approve_once_destructive", kind: (a) => `database.production.${operationOf(a)}`, bound: ["environment", "database", "table", "scope", "target", "input"], holds: (a) => operationOf(a) !== null && declaredProduction(a.environment) },
];

const described = (action) => (action && typeof action === "object" && !Array.isArray(action) ? action : {});

const rowOf = (action) => ROWS.find((r) => r.holds(described(action))) ?? null;

// Who may cross what: AUTO anybody, an approve-once nobody here, a person's DENY only Orbit Control's door.
const CROSSINGS = [
  { when: (row) => !row, ids: ["AUTO", "ALLOWED"] },
  { when: (row) => row.decision !== "deny", ids: ["APPROVAL", "REFUSED"] },
  { when: (row, actor) => actor?.door === "control", ids: ["CONTROL", "ALLOWED"] },
  { when: () => true, ids: ["DENIED", "REFUSED"] },
];

export const crossingIds = (action, actor) => ((row) => CROSSINGS.find((c) => c.when(row, actor)).ids)(rowOf(action));

// A value written one way: keys sorted at every depth, so the same fields in another order are one value.
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v ?? null));

const boundTo = (row, a) => canonical({ boundary: row.id, kind: row.kind(a), fields: Object.fromEntries(row.bound.map((f) => [f, a[f] ?? null])) });

// What one approval is bound to: the boundary, its protected kind, and every field the boundary binds.
export const approvalOf = (action) => ((row) => (row ? boundTo(row, described(action)) : null))(rowOf(action));

const sameBase = (x, y) => (x?.tool ?? null) === (y?.tool ?? null) && (x?.environment ?? null) === (y?.environment ?? null);

export const fingerprintIds = (i) => [approvalOf(i.a) !== null && approvalOf(i.a) === approvalOf(i.b) && (i.call === "action-fingerprint" || sameBase(i.baseA, i.baseB ?? i.baseA)) ? "SAME" : "DIFFERENT"];

// ---- what the inputs are made of ----------------------------------------------------------------------------------

const PRIMARY = { kind: "repository.write", home: "primary-checkout", repository: "orbit", checkout: "c0ffee", scope: ".devcontainer/devcontainer.json", digest: "ep-0123456789ab" };
const PUSH = { kind: "repository.push", repository: "orbit", remote: "origin", url: "a".repeat(64), at: "git.example.invalid/acme/orbit.git", ref: "refs/heads/feature/protected", commit: "abc123".padEnd(40, "0"), force: false };
const DEPLOY = { kind: "deployment", environment: "production", service: "orders-api", artifact: "orders-api:1.8.2", revision: "abc123", target: "prod-cluster", capability: "orders.deploy", input: { artifact: "orders-api:1.8.2" } };
const MIGRATE = { kind: "database.migrate", environment: "production", database: "orders", migration: "20261028_add_invoice_index", digest: "d".repeat(64), target: "orders-prod", input: {} };
const PURGE = { kind: "database.purge", environment: "production", database: "orders", table: "invoices", scope: "older than 2020", target: "orders-prod", input: { before: "2020-01-01" } };
const MUTATE = { kind: "data.mutate", environment: "production", target: "orders-prod", capability: "orders.fix", input: { id: 7 } };

const RIDERS = { agentRunId: "arn-1", run: "msn-0123456789ab/arn-1", hostAgent: "claude:00000000000000aa", attribution: "RUNTIME_BOUND", mode: "VERIFYING", role: "ReleaseApprover", by: "host" };

const ACTORS = {
  control: { door: "control" },
  controlBare: { door: "control", human: false, tty: false },
  typedBack: { door: "terminal", human: true, tty: true, confirmed: "ep-0123456789ab" },
  terminal: { door: "terminal", human: true, tty: false },
  ttyOnly: { human: true, tty: true },
  ttyBare: { tty: true },
  coordinator: { door: "coordinator", human: true },
  improvement: { door: "improvement" },
  nullDoor: { door: null },
  empty: {},
  claims: { door: "terminal", human: true, tty: true, confirmed: "ep-0123456789ab", approved: true, role: "ReleaseApprover", attribution: "RUNTIME_BOUND" },
};

const crossed = (group, action, actor, want) => ({ group, input: actor === undefined ? { call: "crossing", action } : { call: "crossing", action, actor }, expect: { exactly: want } });

const AUTO = ["AUTO", "ALLOWED"];
const CONTROL = ["CONTROL", "ALLOWED"];
const DENIED = ["DENIED", "REFUSED"];
const APPROVAL = ["APPROVAL", "REFUSED"];

const CROSSING_ROWS = [
  crossed("auto-crosses", { kind: "check" }, null, AUTO),
  crossed("auto-crosses", { kind: "check" }, undefined, AUTO),
  crossed("auto-crosses", { kind: "repository.write", home: "task-workspace" }, ACTORS.empty, AUTO),
  crossed("auto-crosses", { kind: "deployment", environment: "staging" }, ACTORS.typedBack, AUTO),
  crossed("auto-crosses", { kind: "data.mutate", environment: "test" }, ACTORS.control, AUTO),
  crossed("auto-crosses", { kind: "an.action.nobody.has.seen.before" }, ACTORS.coordinator, AUTO),
  crossed("control-door", PRIMARY, ACTORS.control, CONTROL),
  crossed("control-door", PRIMARY, ACTORS.controlBare, CONTROL),
  crossed("control-door", { kind: "repository.write", home: "primary-checkout" }, ACTORS.control, CONTROL),
  ...["typedBack", "terminal", "ttyOnly", "ttyBare", "coordinator", "improvement", "nullDoor", "empty", "claims"].map((name) => crossed("no-other-door", PRIMARY, ACTORS[name], DENIED)),
  crossed("no-other-door", PRIMARY, null, DENIED),
  crossed("no-other-door", PRIMARY, undefined, DENIED),
  ...[PUSH, { ...PUSH, force: true }, DEPLOY, MIGRATE, PURGE, MUTATE].map((action) => crossed("approval-not-a-door", action, ACTORS.control, APPROVAL)),
  crossed("approval-not-a-door", PUSH, ACTORS.typedBack, APPROVAL),
  crossed("approval-not-a-door", DEPLOY, ACTORS.ttyOnly, APPROVAL),
];

const compared = (group, call, a, b, want, bases = {}) => ({ group, input: { call, a, b, ...bases }, expect: { exactly: [want] } });

// One pair, through both fingerprints: what a task asks a person for, and what the call that spends it carries.
const both = (group, a, b, want) => [compared(group, "request-fingerprint", a, b, want, { baseA: { tool: "executor" } }), compared(group, "action-fingerprint", a, b, want)];

const reversed = (o) => Object.fromEntries(Object.entries(o).reverse());

const CHANGED = [
  ...[{ commit: "def456".padEnd(40, "0") }, { remote: "upstream" }, { url: "b".repeat(64) }, { ref: "refs/heads/main" }, { force: true }, { repository: "orders" }].map((change) => [PUSH, { ...PUSH, ...change }]),
  [{ ...PUSH, force: true }, PUSH],
  ...[{ artifact: "orders-api:1.8.3" }, { revision: "def456" }, { target: "prod-eu" }, { input: { artifact: "orders-api:1.8.3" } }].map((change) => [DEPLOY, { ...DEPLOY, ...change }]),
  ...[{ digest: "e".repeat(64) }, { migration: "20261029_drop_legacy_column" }, { database: "billing" }].map((change) => [MIGRATE, { ...MIGRATE, ...change }]),
  ...[{ table: "users" }, { database: "billing" }, { scope: "every row" }, { input: { before: "2026-01-01" } }].map((change) => [PURGE, { ...PURGE, ...change }]),
];

const FINGERPRINT_ROWS = [
  ...CHANGED.flatMap(([a, b]) => both("bound-field-changed", a, b, "DIFFERENT")),
  ...both("shown-only-changed", PUSH, { ...PUSH, at: "shown somewhere else" }, "SAME"),
  ...both("shown-only-changed", PUSH, { ...RIDERS, ...PUSH }, "SAME"),
  ...both("shown-only-changed", DEPLOY, { ...RIDERS, ...DEPLOY }, "SAME"),
  ...both("shown-only-changed", DEPLOY, { ...DEPLOY, note: "for the release train" }, "SAME"),
  ...both("shown-only-changed", PURGE, { ...RIDERS, ...PURGE, note: "the quarterly clean-up" }, "SAME"),
  ...both("same-action", PUSH, reversed(PUSH), "SAME"),
  ...both("same-action", MIGRATE, { ...MIGRATE }, "SAME"),
  ...both("same-action", { ...DEPLOY, input: { artifact: "orders-api:2", region: "eu" } }, { ...DEPLOY, input: { region: "eu", artifact: "orders-api:2" } }, "SAME"),
  ...both("another-boundary", PUSH, DEPLOY, "DIFFERENT"),
  ...both("another-boundary", DEPLOY, { ...DEPLOY, kind: "database.migrate" }, "DIFFERENT"),
  ...both("another-boundary", PURGE, { ...PURGE, kind: "database.truncate" }, "DIFFERENT"),
  ...both("another-boundary", PURGE, { ...PURGE, kind: "data.mutate" }, "DIFFERENT"),
  compared("another-tool", "request-fingerprint", PUSH, PUSH, "DIFFERENT", { baseA: { tool: "origin", environment: "origin" }, baseB: { tool: "upstream", environment: "origin" } }),
  compared("another-tool", "request-fingerprint", DEPLOY, DEPLOY, "DIFFERENT", { baseA: { tool: "orders.deploy" }, baseB: { tool: "orders.rollout" } }),
  compared("same-action", "request-fingerprint", PUSH, { ...PUSH }, "SAME", { baseA: { tool: "origin", environment: "origin" }, baseB: { tool: "origin", environment: "origin" } }),
];

const FIXED = [...CROSSING_ROWS, ...FINGERPRINT_ROWS];

// ---- a seeded generator, the same actions and actors for the same seed -----------------------------------------------

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

const CROSSING_ACTIONS = [PRIMARY, PRIMARY, PRIMARY, { kind: "repository.write", home: "primary-checkout", scope: "src/app.mjs" }, { kind: "repository.write", home: "primary-checkout", environment: "local" }, PUSH, DEPLOY, MIGRATE, PURGE, MUTATE, { kind: "build" }, { kind: "repository.write", home: "store" }, { kind: "database.drop", environment: "local" }];

const seededCrossing = (r) => ((action, actor) => crossed("seeded-crossing", action, actor, crossingIds(action, actor)))(pick(r, CROSSING_ACTIONS), pick(r, [...Object.values(ACTORS), ACTORS.control, ACTORS.controlBare, null, undefined]));

// The values a field may take instead -- often a different one, sometimes the same.
const ALTERNATIVES = {
  repository: ["orbit", "orders"], remote: ["origin", "upstream"], url: ["a".repeat(64), "c".repeat(64)], ref: ["refs/heads/feature/protected", "refs/tags/v2"], commit: ["abc123".padEnd(40, "0"), "fed987".padEnd(40, "0")], force: [true, false],
  artifact: ["orders-api:1.8.2", "orders-api:2"], revision: ["abc123", "0ff1ce"], target: ["prod-cluster", "orders-prod", "prod-eu"], input: [{}, { artifact: "orders-api:2" }, { before: "2020-01-01" }],
  database: ["orders", "billing"], migration: ["20261028_add_invoice_index", "20261030_index_users"], digest: ["d".repeat(64), "f".repeat(64)], table: ["invoices", "payments"], scope: ["older than 2020", "one tenant"],
  at: ["git.example.invalid/acme/orbit.git", "mirror.example.invalid/orbit.git"], note: ["for the release train", "asked twice"],
};

const changeable = (row) => [...row.bound.filter((f) => f !== "environment"), "at", "note"];

const changed = (r, a) => ((field) => ({ ...a, [field]: pick(r, ALTERNATIVES[field]) }))(pick(r, changeable(rowOf(a))));

const TEMPLATES = [PUSH, DEPLOY, MIGRATE, PURGE, MUTATE];

const opChanged = (r, a) => (operationOf(a) !== null && r() < 0.2 ? { ...a, kind: pick(r, [...DESTRUCTIVE.map((op) => `database.${op}`), "data.mutate"]) } : a);

const ridden = (r, a) => (r() < 0.3 ? { ...RIDERS, ...a } : a);

const seededPair = (r) => ((a) => [a, ridden(r, opChanged(r, Array.from({ length: 1 + Math.floor(r() * 2) }).reduce((b) => changed(r, b), a)))])(pick(r, TEMPLATES));

const seededFingerprint = (r, i) => ((call, [a, b]) => ((input) => ({ group: "seeded-fingerprint", input, expect: { exactly: fingerprintIds(input) } }))({ call, a, b, ...(call === "request-fingerprint" ? { baseA: { tool: "executor" } } : {}) }))(i % 2 ? "action-fingerprint" : "request-fingerprint", seededPair(r));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  const n = Math.max(8, Math.floor(samples / 2));
  return numbered([...FIXED, ...Array.from({ length: n }, () => seededCrossing(r)), ...Array.from({ length: n }, (_, i) => seededFingerprint(r, i))]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const HAND = [
  ["AUTO crosses for nobody at all", crossingIds({ kind: "test" }, null), AUTO],
  ["Orbit Control's door crosses a person's DENY", crossingIds(PRIMARY, { door: "control" }), CONTROL],
  ["a person typing the id back at a terminal does not", crossingIds(PRIMARY, ACTORS.typedBack), DENIED],
  ["Orbit Control's door does not cross a push", crossingIds(PUSH, { door: "control" }), APPROVAL],
  ["a forced push is another push", fingerprintIds({ call: "action-fingerprint", a: PUSH, b: { ...PUSH, force: true } }), ["DIFFERENT"]],
  ["a push shown elsewhere is the same push", fingerprintIds({ call: "action-fingerprint", a: PUSH, b: { ...PUSH, at: "elsewhere" } }), ["SAME"]],
  ["another artifact is another deployment", fingerprintIds({ call: "action-fingerprint", a: DEPLOY, b: { ...DEPLOY, artifact: "x" } }), ["DIFFERENT"]],
  ["another tool is another request", fingerprintIds({ call: "request-fingerprint", a: PUSH, b: PUSH, baseA: { tool: "a" }, baseB: { tool: "b" } }), ["DIFFERENT"]],
];

const answerOf = (input) => (input.call === "crossing" ? crossingIds(input.action, input.actor) : fingerprintIds(input));

const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const handFindings = () => HAND.filter(([, got, want]) => !sameIds(got, want)).map(([say]) => `the reference model disagrees with the contract on: ${say}`);

const fixedFindings = () => FIXED.filter((c) => !sameIds(answerOf(c.input), c.expect.exactly)).map((c) => `the reference model disagrees with a row written by hand in ${c.group}: ${JSON.stringify(c.input).slice(0, 200)}`);

export const selfTest = () => [...handFindings(), ...fixedFindings()];
