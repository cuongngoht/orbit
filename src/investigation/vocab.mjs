// The words an INVESTIGATION speaks, as tables with the columns a rule asks.
//
// Three things are kept apart on purpose, because conflating any two of them is
// how an exploration ends up reporting a PASS nobody earned:
//
//   execution   did the action happen -- an ACTION_STATE, never a runner status
//   finding     what the evidence says about the PRODUCT -- an OUTCOME
//   confidence  how much the evidence supports that -- high or low, a column
//
// None of these is a run-case status. PASS still means exactly what
// src/run/status.mjs says it means, and an investigation never emits it.

// Execution modes. A mode that `mutates` or `crossIdentity` needs a PERSON's
// approval for the environment it runs in (settings `environments[].modes`),
// and `production: false` means no approval can buy it on a production build.
export const MODES = [
  { id: "observe", mutates: false, crossIdentity: false, production: true, say: "read-only: navigate, look, listen to the network, run read-only checks" },
  { id: "explore-write", mutates: true, crossIdentity: false, production: false, say: "controlled creation and change of synthetic TC- data; a destructive control is still never touched" },
  { id: "security-test", mutates: false, crossIdentity: true, production: false, say: "an authorised tenant-isolation matrix over approved identities and resources" },
  { id: "regression", mutates: false, crossIdentity: false, production: true, say: "run already-accepted cases through run-case; nothing exploratory is asserted" },
];

export const MODE_IDS = MODES.map((m) => m.id);
export const modeOf = (id) => MODES.find((m) => m.id === id) ?? null;
// Observe is the only mode that needs no approval beyond the environment itself.
export const needsApproval = (id) => id !== "observe";

// What an environment IS, as a person declared it. A development build changes
// how a duplicate reads (src/network/duplicates.mjs DEVELOPMENT), and so does a
// sandbox: a task's own environment, projected at run time from the runtime and
// never declared (settings.mjs refuses one).
export const ENVIRONMENT_KINDS = ["test", "staging", "development", "sandbox", "production"];

// The layers an action can be witnessed on. `security` is the tenant matrix's.
export const LAYERS = ["ui", "console", "network", "api", "data", "security"];

// What one layer SAID about one action. The distinction a report must keep:
// "looked and nothing was there" (empty) is evidence, "did not look"
// (not-observed) is not, and neither is "could not look" -- which is the TOOL's
// limit (unavailable) or the MACHINE's (blocked), never the product's.
export const STATES = [
  { id: "observed", evidence: true, say: "looked, and saw something" },
  { id: "empty", evidence: true, say: "looked, and there was nothing" },
  { id: "not-observed", evidence: false, say: "not looked at" },
  { id: "unavailable", evidence: false, say: "this tool cannot show it" },
  { id: "blocked", evidence: false, say: "could not be read on this machine" },
];

export const STATE_IDS = STATES.map((s) => s.id);
export const isEvidence = (state) => STATES.find((s) => s.id === state)?.evidence === true;

// What an action came to. `refused` is the policy saying no; `blocked` the
// machine; `failed` the browser command itself. None says anything about the
// product.
export const ACTION_STATES = ["done", "refused", "blocked", "failed"];

// Investigation-level findings. `defect` is whether the row accuses the
// product; `rank` orders a report. These never replace a runner status and a
// runner status never becomes one.
export const OUTCOMES = [
  { id: "CONFIRMED_DEFECT", defect: true, rank: 0, say: "a violated contract or an observable contradiction, with evidence" },
  { id: "SUSPECTED_DEFECT", defect: true, rank: 1, say: "suspicious, and not yet proved" },
  { id: "REQUIRES_REQUIREMENT", defect: false, rank: 2, say: "what happened is clear; whether it is right is not written anywhere" },
  { id: "INCONCLUSIVE", defect: false, rank: 3, say: "the evidence does not decide it" },
  { id: "BLOCKED", defect: false, rank: 4, say: "could not be checked here — nothing about the product" },
  { id: "OBSERVED_EXPECTED_BEHAVIOR", defect: false, rank: 5, say: "observed, and it is what the contract says" },
];

export const OUTCOME_IDS = OUTCOMES.map((o) => o.id);
export const outcomeRank = (id) => OUTCOMES.find((o) => o.id === id)?.rank ?? 9;

// Where a claim about the expected behaviour came from. Only the first three
// may CONFIRM anything; an observation never becomes a requirement by being
// repeated.
export const ORACLES = [
  { id: "contract", confirms: true, say: "an accepted contract a person declared" },
  { id: "contradiction", confirms: true, say: "the product contradicted itself (a 2xx over data that is not there)" },
  { id: "map", confirms: true, say: "the UI map's recorded effect for this control" },
  { id: "observation", confirms: false, say: "only what was seen" },
  { id: "none", confirms: false, say: "nothing says what should happen" },
];

export const confirms = (oracle) => ORACLES.find((o) => o.id === oracle)?.confirms === true;

// Every record kind the journal accepts, with the ONLY fields it may keep. A
// field nobody declared never reaches the disk -- the trail's rule
// (src/trace/events.mjs), for the same reason: a list of what to hide falls
// behind, a list of what to keep cannot.
export const KINDS = {
  created: ["id", "objective", "scope", "mode", "environment", "identity", "revision", "salt", "budget", "by", "schema", "inputMode", "runtime", "task"],
  input: ["id", "type", "ref", "revision", "digest", "authority", "screen", "read", "state", "why"],
  plan: ["goals", "surfaces", "actions", "layers", "blockers", "unknowns", "known", "budget", "stops", "history"],
  action: ["id", "do", "on", "surface", "target", "identity", "reproduces", "boundary", "url", "synthetic", "state", "why", "ms", "screenshot"],
  observation: ["id", "action", "layer", "state", "why", "data"],
  check: ["id", "action", "layer", "state", "why", "query", "tables", "provenance", "expect", "rows", "attempts", "ms", "within", "via", "input"],
  security: ["id", "row", "identity", "resource", "operation", "expect", "channel", "state", "why", "status", "leaked", "changed", "claims"],
  finding: ["id", "key", "family", "outcome", "confidence", "action", "evidence", "say", "expected", "actual", "oracle", "alternatives", "needs", "missing", "source", "reproduced", "supersedes", "occurrences", "pattern"],
  analysis: ["id", "keys"],
  reproduction: ["id", "finding", "action", "reproduced", "why"],
  run: ["id", "case", "status", "proved", "cause", "confidence", "evidence", "case_digest", "authority", "version", "execution", "attempt"],
  draft: ["id", "finding", "case", "oracle", "why"],
  cancelled: ["why", "by"],
  decision: ["id", "revision", "target", "action", "evidence", "hypothesis", "reason", "mutates"],
  settled: ["id", "decision", "state", "refs", "why", "progress", "snapshot"],
  question: ["id", "obligation", "decision", "asks"],
  answer: ["id", "question", "says", "by"],
  resumed: ["id", "by", "why"],
  completed: ["id", "reason", "lifecycle", "by", "why", "snapshot", "next"],
  receipt: ["id", "key", "obligation", "type", "subject", "layer", "oracle", "outcome", "why", "evidence", "scope", "fingerprints", "context", "seen", "engine", "supersedes"],
  checkpoint: ["id", "upto", "receipts", "projected", "memory", "why", "snapshot"],
  // ── a generated test's lifecycle (0.1.0, ADR 0032) ─────────────────────────
  // One kind per milestone a test reaches, each carrying the `eventId` it is folded once by
  // (store.mjs appendOnce) and, where a test can be tried again, its `attempt`. They are the
  // investigation's own record of a test: no state.json beside the journal, and nothing a
  // broker's retry or a scheduler's wait adds a kind for -- those are observations inside
  // TEST_RUNNING, in the progress sidecar (PROGRESS_KINDS below).
  binding: ["id", "eventId", "binding", "type", "ref", "revision", "digest", "authority", "acceptance", "state"],
  discovery: ["id", "eventId", "state", "count", "graph", "unknowns"],
  obligation: ["id", "eventId", "obligation", "revision", "digest", "shape", "target", "bindings", "applicability", "authority", "method", "missing", "conflict"],
  designed: ["id", "eventId", "attempt", "obligation", "design", "digest", "state", "why"],
  version: ["id", "eventId", "design", "case", "version", "digest"],
  validated: ["id", "eventId", "attempt", "version", "state", "validator", "findings", "repair"],
  authorized: ["id", "eventId", "attempt", "version", "state", "policy", "grant", "why"],
  prepared: ["id", "eventId", "attempt", "version", "state", "sandbox", "tree", "bindings"],
  started: ["id", "eventId", "attempt", "version", "execution", "intent"],
  observed: ["id", "eventId", "attempt", "execution", "completeness", "gaps", "through", "late", "evidence"],
  evaluated: ["id", "eventId", "attempt", "execution", "obligation", "result", "digest", "outcome", "runner", "cause", "boundary"],
  assessed: ["id", "eventId", "assessment", "digest", "scope", "results", "supersedes"],
  published: ["id", "eventId", "report", "assessment", "digest", "state"],
  cleanup: ["id", "eventId", "attempt", "execution", "state", "receipts", "pending"],
  applicability: ["id", "eventId", "control", "state", "why", "by"],
};

// The milestone each lifecycle kind marks (doc §4.5), read off the record: a kind whose state
// says it did NOT get there marks the failure word, or none. The views are generated from this
// table, so a milestone is never spelled in a caller.
export const MILESTONES = [
  { kind: "obligation", word: "OBLIGATION_DISCOVERED" },
  { kind: "designed", word: "TEST_DESIGNED", states: { failed: "GENERATION_FAILED" } },
  { kind: "version", word: "DRAFT_CREATED" },
  { kind: "validated", word: "SCHEMA_VALIDATED", states: { invalid: null } },
  { kind: "authorized", word: "EXECUTION_AUTHORIZED", states: { blocked: null } },
  { kind: "prepared", word: "SANDBOX_PREPARED", states: { blocked: null } },
  { kind: "started", word: "TEST_RUNNING" },
  { kind: "observed", word: "OBSERVATIONS_CAPTURED" },
  { kind: "evaluated", word: "RESULT_EVALUATED" },
  { kind: "published", word: "REPORT_PUBLISHED", states: { failed: "REPORT_FAILED" } },
];

export const MILESTONE_WORDS = [...new Set(MILESTONES.flatMap((m) => [m.word, ...Object.values(m.states ?? {})]).filter(Boolean))];

const milestoneRow = (kind) => MILESTONES.find((m) => m.kind === kind) ?? null;

// -> the milestone word a record marks, or null (a kind with no milestone, or a state that did not reach it).
export function milestoneOf(record) {
  const row = milestoneRow(record?.kind);
  if (!row) return null;
  return row.states && record.state in row.states ? row.states[record.state] : row.word;
}

// What a RUNNING test's progress may say: observations inside TEST_RUNNING, written beside the
// journal in `investigations/<id>/activity/<execution>.jsonl` and never in it -- the journal's
// position is the revision every decision names, and a scheduler ticking must not make a
// person's decision stale. Every line also carries the envelope (v, seq, at, kind, authority:
// "observation"). Nothing reads a progress line to move an outcome (the ADR 0020 rule).
export const PROGRESS_SCHEMA = 1;
export const PROGRESS_AUTHORITY = "observation";
export const PROGRESS_KINDS = Object.freeze({
  "schedule.due": ["schedule", "occurrence", "scheduledFor"],
  "job.dispatched": ["job", "occurrence", "attempt"],
  "message.published": ["channel", "message", "outcome"],
  "delivery.observed": ["channel", "message", "attempt", "redelivered"],
  "consumer.attempt": ["workload", "message", "attempt", "state", "backoffMs"],
  "message.settled": ["message", "outcome", "reason"],
  "effect.observed": ["store", "key", "count"],
  "workload.settled": ["workload", "state", "inFlight"],
  "observer.armed": ["observer", "channel", "baseline"],
  "observation.closed": ["observer", "through", "completeness"],
});
export const PROGRESS_LIMITS = Object.freeze({ LINE_BYTES: 4096, EXECUTION_LINES: 2000, INVESTIGATION_BYTES: 16 * 1024 * 1024 });

export const KIND_NAMES = Object.keys(KINDS);

// Which journal this engine writes, and the only one it reads (0.1.0: 3, the generated-test
// lifecycle kinds). A journal of any other schema -- an older one included -- is refused by the
// fold (src/investigation/model.mjs) and kept exactly as it is: never read with the records it
// does not know silently dropped, never migrated. A person starts a new investigation.
export const JOURNAL_SCHEMA = 3;

// Free text a record may carry: scrubbed on the way in (src/scrub.mjs), the
// same door every other store in this engine has.
export const FREE_TEXT = ["objective", "scope", "why", "say", "expected", "actual", "alternatives", "needs", "hypothesis", "reason", "asks", "says", "missing", "unknowns", "findings", "gaps", "intent"];

// ── The loop ────────────────────────────────────────────────────────────────
// What one piece of work the investigation still owes can come to. `pending`
// is the only state a decision may target; every other one is a disposition,
// and the report counts each with its denominator.
export const OBLIGATION_STATES = [
  { id: "pending", open: true, say: "nothing has settled it yet" },
  { id: "satisfied", open: false, say: "the evidence shows what the oracle says" },
  { id: "violated", open: false, say: "a confirmed finding shows it does not hold" },
  { id: "blocked", open: false, say: "this machine or this engine cannot check it here — never a finding about the product" },
  { id: "needs-approval", open: false, say: "a person has to approve the mode or the identity it needs" },
  { id: "needs-requirement", open: false, say: "whether the behaviour is right is not written anywhere a finding may cite" },
  { id: "not-applicable", open: false, say: "it does not apply here, and the reason is stated" },
];

export const OBLIGATION_STATE_IDS = OBLIGATION_STATES.map((s) => s.id);

// Where an investigation stands. Derived from the journal, never stored as a
// field somebody could set.
export const LIFECYCLE = ["active", "paused", "completed", "cancelled"];

// Why a loop stops. `lifecycle` is where finishing with that reason leaves the
// investigation: only a finished scope completes it, and everything else can be
// resumed once a person has done what the reason names.
export const STOP_REASONS = [
  { id: "cancelled", lifecycle: "cancelled", say: "a person cancelled it" },
  { id: "ambiguous-side-effect", lifecycle: "paused", say: "a writing step was started and never settled — read back what it did before anything writes again" },
  { id: "budget-exhausted", lifecycle: "paused", say: "a limit is spent (actions, decisions or minutes) — a person raises it, or the report is what there is" },
  { id: "environment-blocked", lifecycle: "paused", say: "everything still open is blocked by this machine (a browser, a database, a tool)" },
  { id: "needs-approval", lifecycle: "paused", say: "everything still open needs a mode or an identity a person has not approved" },
  { id: "needs-requirement", lifecycle: "paused", say: "everything still open waits on a person: an answer, a requirement nobody has written down, or a failure to triage" },
  { id: "no-eligible-capability", lifecycle: "paused", say: "nothing here can check what is still open — orbit-qc-builder, if a person agrees" },
  { id: "no-progress", lifecycle: "paused", say: "the last steps produced no new evidence and settled nothing" },
  { id: "stopped-early", lifecycle: "paused", say: "the agent stopped with work still open" },
  { id: "completed-scope", lifecycle: "completed", say: "every obligation in scope has a disposition" },
];

export const stopReason = (id) => STOP_REASONS.find((r) => r.id === id) ?? null;

// The decision a host sends, as data. A field it may not send is named, so the
// refusal can say why: a verdict, a confidence or an approval is the ENGINE's
// to derive, never a model's to assert.
export const DECISION_SCHEMA = 1;
export const DECISION_FIELDS = ["schemaVersion", "decisionId", "expectedRevision", "target", "action", "evidenceRefs", "hypothesis", "reason"];
export const DECISION_FORBIDDEN = ["verdict", "outcome", "confidence", "authority", "approved", "oracle", "status", "severity"];
export const TEXT_LIMIT = 240;
