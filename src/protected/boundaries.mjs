// THE PROTECTED BOUNDARIES: the five places autonomous work stops for a person -- as rows, and nothing else.
//
// Orbit is AUTONOMOUS BY DEFAULT. Reading, planning, a task's own workspace, building, testing, QA, a local commit,
// a task's own sandbox, its containers and local databases, ordinary integrations: all of it runs without anybody.
// A person is asked only where an action would leave that boundary -- the five rows below. An ACTION is the structured
// intent an executor describes about itself (`{ kind, …fields }`, never a command line), and the first row whose
// `when` holds decides it. No row holding means AUTO, an unknown kind included: there is no allow-list to keep up.
//
//   decision     auto · deny · approve_once · approve_once_destructive
//   person       a DENY that a person's OWN act may cross, once -- only through Orbit Control's door
//                (authorize.mjs `crossing`). Never an agent's flag, a terminal, a setting or a standing permission
//   fingerprint  the fields an approval is bound to: change one and it is another action, which asks again
//   shows        what a person reads before deciding, scrubbed -- never a secret, never a whole payload
//
// The rows are the only definition of what is protected; executors, Orbit Control, Live, the docs and the tests read
// them here, and a test refuses a second definition anywhere else.
import { isProduction } from "./environments.mjs";

export const DECISIONS = Object.freeze({ AUTO: "auto", DENY: "deny", APPROVE_ONCE: "approve_once", APPROVE_ONCE_DESTRUCTIVE: "approve_once_destructive" });

// Whose files a write lands in: a task's own workspace, the machine store, or the developer's own checkout.
export const HOMES = Object.freeze({ TASK_WORKSPACE: "task-workspace", STORE: "store", PRIMARY_CHECKOUT: "primary-checkout" });

// The kinds an executor says an action IS. Open: a kind not named here is still an action, and AUTO.
export const ACTION = Object.freeze({ WRITE: "repository.write", PUSH: "repository.push", DEPLOY: "deployment", MIGRATE: "database.migrate", DATA_MUTATE: "data.mutate", DATA_WRITE: "data.write", DATA_READ: "data.read" });

// The irreversible data operations, each a kind of its own: `database.<operation>`.
export const DESTRUCTIVE_OPERATIONS = Object.freeze(["delete", "truncate", "drop", "purge", "reset"]);

export const destructiveKind = (operation) => `database.${operation}`;

// A write nobody declared the meaning of is `mutate`: on production it is read as the strictest data boundary.
const operationOf = (a) => DESTRUCTIVE_OPERATIONS.find((op) => a.kind === destructiveKind(op)) ?? (a.kind === ACTION.DATA_MUTATE ? "mutate" : null);

// Every kind a PRODUCTION row can name -- the only boundaries a capability or a tool call crosses: what a task's action
// type may be once one of them was approved and spent.
export const PRODUCTION_KINDS = Object.freeze(["deployment.production", "database.production.migrate", ...[...DESTRUCTIVE_OPERATIONS, "mutate"].map((op) => `database.production.${op}`)]);

const sha12 = (sha) => String(sha ?? "?").slice(0, 12);

const where = (a) => (a.at ? `${a.remote} (${a.at})` : a.remote);

const through = (a) => (a.target ? ` through ${a.target}` : "");

const named = (a, fallback) => a.artifact ?? a.service ?? a.capability ?? a.tool ?? fallback;

const pushRisk = (a) => (a.force === true ? `FORCE push: replaces ${a.ref} on ${where(a)} with commit ${sha12(a.commit)} — whatever the remote held there that this commit lacks is lost` : `publishes commit ${sha12(a.commit)} to ${a.ref} on ${where(a)}`);

export const BOUNDARIES = Object.freeze([
  {
    id: "PRIMARY_CHECKOUT_WRITE",
    kind: () => "repository.primary_checkout.write",
    when: (a) => a.kind === ACTION.WRITE && a.home === HOMES.PRIMARY_CHECKOUT,
    decision: DECISIONS.DENY,
    person: true,
    destructive: false,
    fingerprint: ["repository", "checkout", "scope", "digest"],
    shows: ["repository", "scope"],
    title: "Primary checkout write",
    say: "writing the developer's own checkout: Orbit changes code only in a task's own workspace, so this is denied unless a person does it themselves, once",
    risk: (a) => `writes ${a.scope ?? "files"} into the developer's own checkout, outside any task's workspace`,
  },
  {
    id: "GIT_PUSH",
    kind: () => ACTION.PUSH,
    when: (a) => a.kind === ACTION.PUSH,
    decision: DECISIONS.APPROVE_ONCE,
    destructive: false,
    fingerprint: ["repository", "remote", "url", "ref", "commit", "force"],
    shows: ["remote", "at", "ref", "commit", "force"],
    title: "Git push",
    say: "publishing commits to a remote: one exact push — repository, remote, ref, commit and force — approved once in Orbit Control",
    risk: pushRisk,
  },
  {
    id: "PRODUCTION_DEPLOY",
    kind: () => "deployment.production",
    when: (a) => a.kind === ACTION.DEPLOY && isProduction(a.environment),
    decision: DECISIONS.APPROVE_ONCE,
    destructive: false,
    fingerprint: ["environment", "target", "service", "artifact", "revision", "capability", "server", "tool", "input"],
    shows: ["service", "environment", "artifact", "revision", "target"],
    title: "Production deployment",
    say: "a deployment to a target declared production: one exact artifact, revision and target, approved once; staging, preview, development and local deploys are autonomous",
    risk: (a) => `deploys ${named(a, "an artifact")}${a.revision ? ` at ${a.revision}` : ""} to production${through(a)}`,
  },
  {
    id: "PRODUCTION_DB_MIGRATION",
    kind: () => "database.production.migrate",
    when: (a) => a.kind === ACTION.MIGRATE && isProduction(a.environment),
    decision: DECISIONS.APPROVE_ONCE,
    destructive: false,
    fingerprint: ["environment", "target", "database", "migration", "digest", "capability", "server", "tool", "input"],
    shows: ["database", "environment", "migration", "target"],
    title: "Production database migration",
    say: "a schema migration on a database declared production: one exact migration set and digest, approved once; local, test and sandbox migrations are autonomous",
    risk: (a) => `migrates the production database ${a.database ?? named(a, "")}${a.migration ? ` with ${a.migration}` : ""}${through(a)}`,
  },
  {
    id: "PRODUCTION_DESTRUCTIVE_DATA",
    kind: (a) => `database.production.${operationOf(a)}`,
    when: (a) => operationOf(a) !== null && isProduction(a.environment),
    decision: DECISIONS.APPROVE_ONCE_DESTRUCTIVE,
    destructive: true,
    fingerprint: ["environment", "target", "database", "scope", "table", "capability", "server", "tool", "input"],
    shows: ["database", "table", "scope", "environment", "target"],
    title: "Destructive production data change",
    say: "deleting, truncating, dropping, purging or resetting production data — or a production write nobody declared the meaning of: approved once, marked destructive; the same on a local or test database is autonomous",
    risk: (a) => `DESTRUCTIVE — ${operationOf(a)} on production data${a.database ? ` in ${a.database}` : ""}${a.table ? `.${a.table}` : ""}${a.scope ? ` (${a.scope})` : ""}${through(a)}; it cannot be undone`,
  },
]);

export const BOUNDARY_IDS = Object.freeze(BOUNDARIES.map((b) => b.id));

// The kinds a DECLARATION may name for a tool or a capability (a catalog row's `protected` map, a capability's
// effects): what makes a call land on a boundary. Anything else a declaration says is not a protected kind.
export const DECLARED_KINDS = Object.freeze([ACTION.PUSH, ACTION.DEPLOY, ACTION.MIGRATE, ...DESTRUCTIVE_OPERATIONS.map(destructiveKind)]);

export const boundaryOf = (id) => BOUNDARIES.find((b) => b.id === id) ?? null;
