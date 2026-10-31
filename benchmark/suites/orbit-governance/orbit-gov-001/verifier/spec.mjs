// THE SPEC of ORBIT-GOV-001: autonomous by default. authorize(action) answers AUTO unless the action crosses one of the
// five protected boundaries, and then names exactly that boundary -- its decision, its id, the protected kind an
// approval of it would be bound to, whether only a person's own act may cross it, and whether it is marked destructive.
// Written from the contract (AGENTS.md "Autonomous by default", the header of src/protected/boundaries.mjs and what its
// rows say), kept beside the probe and handed to no runner; it never imports the subject. Both directions are checked
// -- what must stop for a person and what must run without anybody -- so an authorize that holds everything fails as
// surely as one that holds nothing.
//
// The fixed rows are one per sentence of the contract, their answers written by hand; the seeded rows are actions of
// every kind, home and environment at random, answered by the reference model, which selfTest holds to every answer
// written by hand.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to the rows written by hand from the contract
export const CASE = "ORBIT-GOV-001";

export const GROUPS = {
  "ordinary-work": "ordinary development -- reading, a workspace, a branch, a local commit, a build, a test, QA, a sandbox, a tool, a sign-in -- is AUTO",
  "unknown-kind": "an action kind nobody has seen before is AUTO, on production too: there is no allow-list",
  "nothing-described": "nothing described -- no action, null, an empty action, a command string, a list -- is nothing protected: AUTO",
  "primary-checkout-write": "a write into the developer's own checkout is a person's DENY at PRIMARY_CHECKOUT_WRITE, wherever it is said to land",
  "workspace-write": "a write into a task's own workspace or the store is AUTO: the home decides",
  "git-push": "every push is APPROVE_ONCE at GIT_PUSH, forced or not, wherever it goes",
  "production-deploy": "a deployment to a target declared production is APPROVE_ONCE at PRODUCTION_DEPLOY",
  "other-deploy": "a deployment anywhere not declared production -- staging, preview, development, test, local, a word nobody listed -- is AUTO",
  "production-migration": "a schema migration on a database declared production is APPROVE_ONCE at PRODUCTION_DB_MIGRATION",
  "other-migration": "a migration anywhere not declared production is AUTO",
  "production-destructive": "deleting, truncating, dropping, purging or resetting production data is APPROVE_ONCE_DESTRUCTIVE at PRODUCTION_DESTRUCTIVE_DATA, marked destructive",
  "production-undeclared-write": "a production write nobody declared the meaning of (data.mutate) is held as destructive production data: APPROVE_ONCE_DESTRUCTIVE, marked destructive",
  "production-declared-data": "a declared additive write (data.write) or a read (data.read) on production is AUTO",
  "other-data": "a destructive operation or an undeclared write anywhere not declared production is AUTO",
  "identity-grants-nothing": "an identity, a mode or an approval word riding on an action changes no verdict, in either direction",
  "seeded-action": "actions of every kind, home and environment at random: exactly the boundary the contract names, or AUTO",
};

// ---- the reference model: the five boundaries, as the contract states them ----------------------------------------

const DESTRUCTIVE = ["delete", "truncate", "drop", "purge", "reset"];

// What is production is what something that knows DECLARED: the one word, however it is written.
const declaredProduction = (word) => String(word ?? "").trim().toLowerCase() === "production";

// The operation a data action names: a destructive one, or `mutate` for a write nobody declared the meaning of.
const operationOf = (a) => DESTRUCTIVE.find((op) => a.kind === `database.${op}`) ?? (a.kind === "data.mutate" ? "mutate" : null);

const ROWS = [
  { id: "PRIMARY_CHECKOUT_WRITE", decision: "deny", person: true, kind: () => "repository.primary_checkout.write", holds: (a) => a.kind === "repository.write" && a.home === "primary-checkout" },
  { id: "GIT_PUSH", decision: "approve_once", kind: () => "repository.push", holds: (a) => a.kind === "repository.push" },
  { id: "PRODUCTION_DEPLOY", decision: "approve_once", kind: () => "deployment.production", holds: (a) => a.kind === "deployment" && declaredProduction(a.environment) },
  { id: "PRODUCTION_DB_MIGRATION", decision: "approve_once", kind: () => "database.production.migrate", holds: (a) => a.kind === "database.migrate" && declaredProduction(a.environment) },
  { id: "PRODUCTION_DESTRUCTIVE_DATA", decision: "approve_once_destructive", destructive: true, kind: (a) => `database.production.${operationOf(a)}`, holds: (a) => operationOf(a) !== null && declaredProduction(a.environment) },
];

// An action is a structured object; anything else describes nothing.
const described = (action) => (action && typeof action === "object" && !Array.isArray(action) ? action : {});

const rowIds = (row, a) => [row.decision, row.id, `kind:${row.kind(a)}`, ...(row.person ? ["person"] : []), ...(row.destructive ? ["destructive"] : [])];

// The ids a verdict comes to: AUTO, or the boundary's decision, id and protected kind, with its two marks.
export const verdictIds = (action) => ((a) => ((row) => (row ? rowIds(row, a) : ["auto"]))(ROWS.find((r) => r.holds(a))))(described(action));

// ---- what the inputs are made of ----------------------------------------------------------------------------------

const asked = (group, action, expect) => ({ group, input: action === undefined ? { call: "authorize" } : { call: "authorize", action }, expect });

const AUTO = { exactly: ["auto"] };
const DENIED = { exactly: ["deny", "PRIMARY_CHECKOUT_WRITE", "kind:repository.primary_checkout.write", "person"] };
const PUSHED = { exactly: ["approve_once", "GIT_PUSH", "kind:repository.push"] };
const DEPLOYED = { exactly: ["approve_once", "PRODUCTION_DEPLOY", "kind:deployment.production"] };
const MIGRATED = { exactly: ["approve_once", "PRODUCTION_DB_MIGRATION", "kind:database.production.migrate"] };
const destroyed = (op) => ({ exactly: ["approve_once_destructive", "PRODUCTION_DESTRUCTIVE_DATA", `kind:database.production.${op}`, "destructive"] });

const PUSH = { kind: "repository.push", repository: "orbit", remote: "origin", url: "a".repeat(64), at: "git.example.invalid/acme/orbit.git", ref: "refs/heads/feature/protected", commit: "abc123".padEnd(40, "0"), force: false };

const RIDERS = { agentRunId: "arn-1", run: "msn-0123456789ab/arn-1", hostAgent: "claude:00000000000000aa", attribution: "RUNTIME_BOUND", mode: "VERIFYING", role: "ReleaseApprover", by: "host", approved: true, door: "control", human: true };

const ridden = (action) => ({ ...RIDERS, ...action });

const ORDINARY = ["repository.read", "workspace.prepare", "repository.branch", "repository.commit", "check", "build", "lint", "test", "qa.generated", "sandbox.prepare", "sandbox.start", "sandbox.stop", "tool.acquire", "auth.token", "auth.login"];

const ELSEWHERE = ["staging", "preview", "development", "shared-development", "test", "local", "sandbox", "task-isolated", "a-remote-nobody-classified", "prod", "live", ""];

const AROUND = [
  asked("unknown-kind", { kind: "an.action.nobody.has.seen.before" }, AUTO),
  asked("unknown-kind", { kind: "report.render" }, AUTO),
  asked("unknown-kind", { kind: "cache.flush", environment: "production" }, AUTO),
  asked("unknown-kind", { kind: "notes.append", environment: "production", target: "notes-prod" }, AUTO),
  asked("nothing-described", undefined, AUTO),
  asked("nothing-described", null, AUTO),
  asked("nothing-described", {}, AUTO),
  asked("nothing-described", "git push --force origin main", AUTO),
  asked("nothing-described", ["repository.push"], AUTO),
];

const WRITES = [
  asked("primary-checkout-write", { kind: "repository.write", home: "primary-checkout", repository: "orbit", checkout: "c0ffee", scope: ".devcontainer/devcontainer.json", digest: "ep-0123456789ab" }, DENIED),
  asked("primary-checkout-write", { kind: "repository.write", home: "primary-checkout" }, DENIED),
  asked("primary-checkout-write", { kind: "repository.write", home: "primary-checkout", environment: "local" }, DENIED),
  asked("primary-checkout-write", { kind: "repository.write", home: "primary-checkout", environment: "production", scope: "src/app.mjs" }, DENIED),
  asked("workspace-write", { kind: "repository.write", home: "task-workspace", scope: "src/app.mjs" }, AUTO),
  asked("workspace-write", { kind: "repository.write", home: "store" }, AUTO),
  asked("workspace-write", { kind: "repository.write", home: "task-workspace", environment: "production" }, AUTO),
  asked("git-push", PUSH, PUSHED),
  asked("git-push", { ...PUSH, force: true }, PUSHED),
  asked("git-push", { ...PUSH, environment: "local" }, PUSHED),
  asked("git-push", { ...PUSH, remote: "upstream", ref: "refs/heads/main" }, PUSHED),
  asked("git-push", { kind: "repository.push" }, PUSHED),
];

const RELEASES = [
  asked("production-deploy", { kind: "deployment", environment: "production", service: "orders-api", artifact: "orders-api:1.8.2", revision: "abc123", target: "prod-cluster" }, DEPLOYED),
  asked("production-deploy", { kind: "deployment", environment: "production" }, DEPLOYED),
  asked("production-deploy", { kind: "deployment", environment: "production", capability: "orders.deploy", input: { artifact: "orders-api:2" } }, DEPLOYED),
  ...ELSEWHERE.map((environment) => asked("other-deploy", { kind: "deployment", environment, artifact: "orders-api:2" }, AUTO)),
  asked("other-deploy", { kind: "deployment", artifact: "orders-api:2" }, AUTO),
  asked("production-migration", { kind: "database.migrate", environment: "production", database: "orders", migration: "20261028_add_invoice_index", digest: "d".repeat(64), target: "orders-prod" }, MIGRATED),
  asked("production-migration", { kind: "database.migrate", environment: "production" }, MIGRATED),
  ...["local", "test", "sandbox", "development", "staging", "prod"].map((environment) => asked("other-migration", { kind: "database.migrate", environment, database: "orders" }, AUTO)),
  asked("other-migration", { kind: "database.migrate", database: "orders" }, AUTO),
];

const DATA = [
  ...DESTRUCTIVE.map((op) => asked("production-destructive", { kind: `database.${op}`, environment: "production", database: "orders", table: "invoices" }, destroyed(op))),
  asked("production-destructive", { kind: "database.delete", environment: "production", database: "orders", table: "invoices", scope: "rows older than 2020" }, destroyed("delete")),
  asked("production-undeclared-write", { kind: "data.mutate", environment: "production" }, destroyed("mutate")),
  asked("production-undeclared-write", { kind: "data.mutate", environment: "production", target: "orders-prod", capability: "orders.fix", input: { id: 7 } }, destroyed("mutate")),
  asked("production-undeclared-write", { kind: "data.mutate", environment: "production", database: "orders", table: "invoices" }, destroyed("mutate")),
  asked("production-declared-data", { kind: "data.write", environment: "production" }, AUTO),
  asked("production-declared-data", { kind: "data.write", environment: "production", database: "orders", table: "invoices" }, AUTO),
  asked("production-declared-data", { kind: "data.read", environment: "production" }, AUTO),
  ...[["database.truncate", "local"], ["database.drop", "test"], ["database.delete", "staging"], ["database.reset", "task-isolated"], ["database.purge", "prod"], ["data.mutate", "staging"], ["data.mutate", "sandbox"]].map(([kind, environment]) => asked("other-data", { kind, environment }, AUTO)),
  asked("other-data", { kind: "data.mutate" }, AUTO),
];

const IDENTITY = [
  asked("identity-grants-nothing", ridden(PUSH), PUSHED),
  asked("identity-grants-nothing", ridden({ kind: "deployment", environment: "production", artifact: "orders-api:2" }), DEPLOYED),
  asked("identity-grants-nothing", ridden({ kind: "repository.write", home: "primary-checkout" }), DENIED),
  asked("identity-grants-nothing", ridden({ kind: "data.mutate", environment: "production" }), destroyed("mutate")),
  asked("identity-grants-nothing", ridden({ kind: "deployment", environment: "staging" }), AUTO),
  asked("identity-grants-nothing", ridden({ kind: "data.read", environment: "production" }), AUTO),
];

const FIXED = [...ORDINARY.map((kind) => asked("ordinary-work", { kind }, AUTO)), ...AROUND, ...WRITES, ...RELEASES, ...DATA, ...IDENTITY];

// ---- a seeded generator, the same actions for the same seed ---------------------------------------------------------

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

const SEED_KINDS = ["repository.write", "repository.write", "repository.push", "repository.push", "deployment", "deployment", "database.migrate", "database.migrate", "data.mutate", "data.mutate", "data.write", "data.read", ...DESTRUCTIVE.map((op) => `database.${op}`), "repository.commit", "build", "sandbox.start", "cache.flush"];

const SEED_ENVIRONMENTS = ["production", "production", "production", "production", "production", "production", "staging", "preview", "development", "shared-development", "test", "local", "sandbox", "task-isolated", "prod", "live", "production-eu", "", null, undefined];

const SEED_HOMES = ["primary-checkout", "primary-checkout", "task-workspace", "store", undefined];

const DETAILS = [
  ["repository", ["orbit", "orders"]], ["remote", ["origin", "upstream"]], ["ref", ["refs/heads/main", "refs/heads/feature/x"]], ["commit", ["abc123".padEnd(40, "0"), "def456".padEnd(40, "0")]], ["force", [true, false]],
  ["database", ["orders", "billing"]], ["table", ["invoices", "users"]], ["artifact", ["orders-api:2", "orders-api:3"]], ["revision", ["abc123", "def456"]], ["target", ["prod-cluster", "eu-cluster"]], ["scope", ["src/app.mjs", "rows of one tenant"]],
];

const present = (key, value) => (value === undefined ? {} : { [key]: value });

const details = (r) => Object.fromEntries(DETAILS.filter(() => r() < 0.25).map(([key, values]) => [key, pick(r, values)]));

const seededAction = (r) => ({ kind: pick(r, SEED_KINDS), ...present("environment", pick(r, SEED_ENVIRONMENTS)), ...present("home", pick(r, SEED_HOMES)), ...details(r) });

const seeded = (r) => ((action) => asked("seeded-action", action, { exactly: verdictIds(action) }))(seededAction(r));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(16, samples) }, () => seeded(r))]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const HAND = [
  ["a read is autonomous", { kind: "repository.read" }, ["auto"]],
  ["a write into the developer's own checkout is a person's DENY", { kind: "repository.write", home: "primary-checkout" }, ["deny", "PRIMARY_CHECKOUT_WRITE", "kind:repository.primary_checkout.write", "person"]],
  ["a write into a task's workspace is autonomous", { kind: "repository.write", home: "task-workspace" }, ["auto"]],
  ["a forced push asks once", { kind: "repository.push", force: true }, ["approve_once", "GIT_PUSH", "kind:repository.push"]],
  ["a production deployment asks once", { kind: "deployment", environment: "production" }, ["approve_once", "PRODUCTION_DEPLOY", "kind:deployment.production"]],
  ["a staging deployment is autonomous", { kind: "deployment", environment: "staging" }, ["auto"]],
  ["a production migration asks once", { kind: "database.migrate", environment: "production" }, ["approve_once", "PRODUCTION_DB_MIGRATION", "kind:database.production.migrate"]],
  ["a production truncate is destructive", { kind: "database.truncate", environment: "production" }, ["approve_once_destructive", "PRODUCTION_DESTRUCTIVE_DATA", "kind:database.production.truncate", "destructive"]],
  ["an undeclared production write is destructive", { kind: "data.mutate", environment: "production" }, ["approve_once_destructive", "PRODUCTION_DESTRUCTIVE_DATA", "kind:database.production.mutate", "destructive"]],
  ["a declared production write is autonomous", { kind: "data.write", environment: "production" }, ["auto"]],
  ["a word nobody listed is not production", { kind: "database.drop", environment: "prod" }, ["auto"]],
  ["nothing described is nothing protected", undefined, ["auto"]],
];

const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const handFindings = () => HAND.filter(([, action, want]) => !sameIds(verdictIds(action), want)).map(([say]) => `the reference model disagrees with the contract on: ${say}`);

const fixedFindings = () => FIXED.filter((c) => !sameIds(verdictIds(c.input.action), c.expect.exactly)).map((c) => `the reference model disagrees with a row written by hand in ${c.group}: ${JSON.stringify(c.input.action)}`);

export const selfTest = () => [...handFindings(), ...fixedFindings()];
