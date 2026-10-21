// The QA plan's closed vocabularies, as DATA -- the same shape dsl/verbs.mjs
// uses, and for the same reason.
//
// A technique, a mutation kind, a repeat shape and a runner status are all words
// a rule wants to branch on, and a rule that spells the words out is a second
// list that falls behind the first. Here each word is a ROW with columns, and a
// rule asks a COLUMN: `techniquesWhere("asks")`, `runState(status).verifies`.
// Adding "a permission scenario must state a denial" is then a column value, not
// an `if (technique === "permission")` somewhere.
//
// asks:      the block this technique OBLIGES the scenario to carry. The whole
//            permission and idempotency argument reduces to this column: a
//            technique that asks for `denial` cannot be satisfied by an identity
//            declaration, and one that asks for `repeat` cannot be satisfied by
//            a guard that stops the second attempt from happening.
// writes:    this mutation kind changes stored state, so it owes a before/after,
//            a data lifecycle and a witness below the screen. NOT limited to
//            `create`: an update that overwrites the wrong row is the same bug.
// again:     this repeat shape actually performs the action a second time.
// parallel:  ...and does so at the same time, which a sequence never is.
// proves:    a layer disposition that counts as verification asked for.
// gap:       a disposition that records a CAPABILITY GAP rather than a decision.
// verifies:  a runner status that may raise verified coverage. Exactly one does.
// owedBy:    which SIGNALS in a plan oblige this technique. A plan that declares
//            roles, an owner or a write has an attack surface whether or not
//            anybody thought about it, and rules/security.mjs asks. Here rather
//            than in the rule so a new security technique is a row.

export const TECHNIQUES = [
  { name: "crud", doc: "create, read back after a reload, edit, delete, re-create with the same name" },
  { name: "boundary", doc: "one valid and one invalid per rule, then the edges: empty, max, 0, 1, duplicate" },
  { name: "decision-table", doc: "one row per combination that behaves differently — where scoping bugs live" },
  { name: "state-transition", doc: "the legal moves, and one illegal move that must be refused" },
  { name: "negative", doc: "wrong role, missing required field, duplicate, stale data" },
  { name: "permission", asks: "denial", owedBy: ["roles", "writes"], doc: "an actor without the right must be refused — and the refusal has to be observed" },
  { name: "scoping", asks: "denial", owedBy: ["ownership"], doc: "another owner's or tenant's record must not be readable or writable" },
  { name: "idempotency", asks: "repeat", doc: "the action happens a SECOND time, and the contract says what that must produce" },
  { name: "concurrency", asks: "repeat", doc: "two attempts at once — never a sequence described as one" },
  { name: "exploratory", doc: "a charter rather than a script; it earns findings, not a verdict" },
];

export const MUTATIONS = [
  { name: "none", writes: false, doc: "reads only" },
  { name: "create", writes: true, doc: "a new record" },
  { name: "update", writes: true, doc: "an existing record changes" },
  { name: "delete", writes: true, doc: "a record goes away" },
  { name: "transition", writes: true, doc: "a status or lifecycle move" },
  { name: "side-effect", writes: true, doc: "something else changes — a file, a message, a schedule" },
];

export const REPEATS = [
  { name: "none", again: false, doc: "the action happens once" },
  { name: "resubmit", again: true, doc: "the same data submitted again" },
  { name: "retry", again: true, doc: "submitted again after a timeout, outcome unknown to the caller" },
  { name: "double-click", again: true, doc: "two submits before the first answered" },
  { name: "concurrent", again: true, parallel: true, doc: "two sessions at the same moment" },
];

export const NEEDS = [
  { name: "required", proves: true, doc: "this layer must rule on it" },
  { name: "n-a", proves: false, doc: "the layer does not apply to this scenario — say why" },
  { name: "unverifiable", proves: false, gap: true, doc: "it applies and nothing here can check it — a capability gap, not a lowered bar" },
];

export const READINESS = [
  { name: "draft", ready: false, doc: "still being designed" },
  { name: "ready", ready: true, doc: "enough is known to write the case or do the check" },
  { name: "blocked", ready: false, doc: "something named in blockers stops it" },
  { name: "deferred", ready: false, excluded: true, doc: "deliberately out of this round — with a reason" },
];

// How far a case link has got. Kept apart from readiness and from the run
// status on purpose: one field holding design, implementation and result is the
// field that reports a case as "done" because somebody wrote it.
export const LINK_STATES = [
  { name: "planned", written: false, doc: "no file yet" },
  { name: "written", written: true, doc: "the JSON exists" },
  { name: "validated", written: true, validated: true, doc: "the file exists and `query check` is clean about it" },
  { name: "dry-run", written: true, validated: true, dry: true, doc: "...and every step resolved with --dry. Still not a live verification" },
];

// What each runner status means for coverage. Exactly one row verifies anything,
// and that is the whole point of the table: a session that reads SKIP, PARTIAL
// and REFUSED as "not failing" signs off a feature nobody tested.
export const RUN_STATES = [
  { name: "PASS", verifies: true, say: "the case ruled on the product and held" },
  { name: "SKIP", verifies: false, say: "the guard found the data already there — nothing was verified this time" },
  { name: "PARTIAL", verifies: false, say: "a slice only — the case as a whole is still unproven" },
  { name: "FAIL", verifies: false, say: "it did not hold — reproduce it before calling it a product bug" },
  { name: "REFUSED", verifies: false, say: "a precondition stopped the run — the PRODUCT refused nothing, so this is not a permission result" },
  { name: "BLOCKED", verifies: false, say: "it never reached a verdict (environment, database, deadline) — not a defect" },
  { name: "INCONCLUSIVE", verifies: false, say: "it ran and ruled on nothing" },
];

// Is the evidence about the thing in hand? `unknown` is a first-class answer:
// with no revision to compare against, "fresh" would be a claim nobody checked.
export const FRESHNESS = [
  { name: "fresh", counts: true, say: "recorded against this plan revision, this build and this environment" },
  { name: "stale", counts: false, say: "recorded against something the plan has moved past — history, not proof of the current revision" },
  { name: "unknown", counts: false, say: "not enough reference to tell — treated as unproven, never as fresh" },
];

// What a STRUCTURED criterion may say about an observed meaning (ADR 0031): each op names the
// assertion template it compiles to (src/qa/generation/compile.mjs), and `window` marks the two
// that can only ever be claimed within one -- an absence and a completion. A criterion that
// says it in prose still prepares a test; only one that says it like this can be MAPPED to an
// assertion without anybody's judgement.
export const EXPECT_OPS = [
  { name: "eq", template: "value-eq", doc: "the observed value equals the stated value" },
  { name: "present", template: "value-present", doc: "the observed value is there -- an id, a reference -- whatever it is" },
  { name: "in", template: "value-in", doc: "the observed value is one of the stated values" },
  { name: "excludes", template: "value-excludes", doc: "the observed value never contains the stated value -- a marker that must not appear" },
  { name: "count-eq", template: "count-eq", doc: "exactly this many durable effects" },
  { name: "count-at-most", template: "count-at-most", doc: "no more than this many" },
  { name: "conforms", template: "schema-valid", doc: "the observed value conforms to the stated, pinned schema" },
  { name: "ordered", template: "order-eq", doc: "the observed sequence is in the stated order" },
  { name: "complete-within", template: "complete", window: true, doc: "the business condition holds within the window" },
  { name: "absent-within", template: "absent-within", window: true, doc: "nothing matching appears within the window, on observation that stayed complete" },
];

export const PRIORITIES = ["P1", "P2", "P3"];
export const EXECUTIONS = ["auto", "manual", "mixed"];

const index = (rows) => new Map(rows.map((r) => [r.name, r]));
const names = (rows) => rows.map((r) => r.name);

export const TECHNIQUE = index(TECHNIQUES);
export const MUTATION = index(MUTATIONS);
export const REPEAT = index(REPEATS);
export const NEED = index(NEEDS);
export const READY = index(READINESS);
export const LINK_STATE = index(LINK_STATES);
export const RUN_STATE = index(RUN_STATES);
export const FRESH = index(FRESHNESS);
export const EXPECT_OP = index(EXPECT_OPS);

export const TECHNIQUE_NAMES = names(TECHNIQUES);
export const MUTATION_NAMES = names(MUTATIONS);
export const REPEAT_NAMES = names(REPEATS);
export const NEED_NAMES = names(NEEDS);
export const READINESS_NAMES = names(READINESS);
export const LINK_STATE_NAMES = names(LINK_STATES);
export const RUN_STATE_NAMES = names(RUN_STATES);
export const EXPECT_OP_NAMES = names(EXPECT_OPS);
// The one way to ask "which rows do X", mirroring verbsWhere(). A caller
// computes its set once, at module scope, so a new row is covered by the row.
const rowsWhere = (rows, key, value = true) => new Set(rows.filter((r) => r[key] === value).map((r) => r.name));

export const needsWhere = (key, value = true) => rowsWhere(NEEDS, key, value);
export const techniquesWhere = (key, value = true) => rowsWhere(TECHNIQUES, key, value);
export const mutationsWhere = (key, value = true) => rowsWhere(MUTATIONS, key, value);
export const repeatsWhere = (key, value = true) => rowsWhere(REPEATS, key, value);

// A status the engine has never emitted is not "not verifying" -- it is a status
// this table has never heard of, and saying so beats silently counting it as 0.
export const verifies = (status) => RUN_STATE.get(status)?.verifies === true;
export const runSays = (status) => RUN_STATE.get(status)?.say ?? `${status} is not a status this engine emits`;

// Does evidence in this state still cover the thing in hand? Read off the row,
// so "unknown does not count" is a column rather than a string compare somebody
// can get the wrong way round.
export const counts = (state) => FRESH.get(state)?.counts === true;
export const freshSays = (state) => FRESH.get(state)?.say ?? "";
