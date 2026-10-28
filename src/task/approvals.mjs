// An APPROVAL: one person's yes or no to ONE action of ONE task -- never a permission.
//
// What is approved is a FINGERPRINT: a hash of the action's type, tool, environment and
// parameters. The parameters are hashed and never kept, so a migration to schema v82 is approved
// without its arguments being written anywhere, and a changed action -- another environment,
// another version, another tool -- has another fingerprint and cannot spend the approval.
//
//   asked      request-approval   one open request per exact action
//   decided    approve | reject   a person's, once; a second decision grants nothing
//   spent      act start --approval=apr-n
//                                 only granted, unexpired, unspent, and only for the fingerprint
//                                 it names -- written BEFORE the action it allows, in one locked
//                                 append, so a crash can leave "spent, no action" but never the
//                                 reverse
//   lapsed     expires <= now     refused, and never written by the refusal; `approval expire`
//                                 records it when the orchestrator wants the journal to say so
//
// Each list below is a set of rows in the shape of src/investigation/decision.mjs, read in
// order by src/task/ops.mjs, the first failing row refusing with its id and its code.
import { fingerprintOf } from "../protected/authorize.mjs";
import { approvalState } from "./model.mjs";
import { CODES } from "./vocab.mjs";

// One definition of "the exact action", shared with every executor that holds a call to it (src/protected/).
export { fingerprintOf };

const approvalIn = (w, id) => w.model.approvals.get(id) ?? null;

const stateIn = (w, id) => approvalState(approvalIn(w, id), w.now);

const UNKNOWN = { id: "APPROVAL_UNKNOWN", code: CODES.APPROVAL_UNKNOWN, fails: (g, w) => !approvalIn(w, g.approval), say: (g) => `${g.approval} is not an approval this task asked for` };

const EXPIRED = { id: "APPROVAL_EXPIRED", code: CODES.APPROVAL_EXPIRED, fails: (g, w) => stateIn(w, g.approval) === "expired", say: (g) => `${g.approval} expired before it was used — the task has to ask again` };

// approve, reject: only a request still waiting for a person.
export const DECIDING = [
  UNKNOWN,
  EXPIRED,
  { id: "APPROVAL_DECIDED", code: CODES.APPROVAL_DECIDED, fails: (g, w) => stateIn(w, g.approval) !== "pending", say: (g, w) => `${g.approval} is already ${stateIn(w, g.approval)} — an approval is decided once, and a second decision grants nothing` },
];

// act start --approval: spent on exactly the action it names, once.
export const CONSUMING = [
  UNKNOWN,
  EXPIRED,
  { id: "APPROVAL_NOT_GRANTED", code: CODES.APPROVAL_NOT_GRANTED, fails: (g, w) => stateIn(w, g.approval) !== "granted", say: (g, w) => `${g.approval} is ${stateIn(w, g.approval)} — only an approval a person granted, and nothing has used yet, lets an action start` },
  { id: "FINGERPRINT_MISMATCH", code: CODES.FINGERPRINT_MISMATCH, fails: (g, w) => fingerprintOf(g) !== approvalIn(w, g.approval).fingerprint, say: (g) => `this is not the action ${g.approval} approved — its type, tool, environment or parameters differ, so it needs an approval of its own` },
].map((rule) => ({ ...rule, fails: (g, w) => g.approval !== undefined && rule.fails(g, w) }));

const OPEN = ["pending", "granted"];

const askedFor = (w, fingerprint) => [...w.model.approvals.values()].find((a) => a.fingerprint === fingerprint && OPEN.includes(approvalState(a, w.now))) ?? null;

// request-approval: one open request per exact action.
export const ASKING = [
  { id: "ALREADY_ASKED", fails: (g, w) => askedFor(w, fingerprintOf(g)) !== null, say: (g, w) => `${askedFor(w, fingerprintOf(g)).id} already asks for exactly this action — use its answer, or wait for one` },
];

// What a LINE already ended: spent, refused, or recorded as expired. A request the clock alone
// says has lapsed is still open to be recorded as expired -- that is what the line is for.
const endedByLine = (a) => a.consumed !== null || a.expired !== null || a.decision?.kind === "approval-rejected";

// approval expire: only something no line has ended yet.
export const EXPIRING = [
  UNKNOWN,
  { id: "NOT_OPEN", fails: (g, w) => endedByLine(approvalIn(w, g.approval)), say: (g, w) => `${g.approval} is ${stateIn(w, g.approval)} — there is nothing left to expire` },
];
