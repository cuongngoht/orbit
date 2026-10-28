// What each field a task op TAKES may be -- declared once, as JSON-Schema fragments, and
// enforced from the declaration by src/constraints.mjs (the way src/dsl/fields.mjs and
// src/project/config.mjs are). An op may narrow one field for itself (`specs` on its row in
// src/task/ops.mjs): an attempt's outcome is one of three words, a receipt's is whatever word
// its own domain uses.
//
// `text: true` marks free text: refused above TEXT_LIMIT, kept as one printable line, scrubbed.
// Nothing here can carry a path outside a checkout, a command line, a credential or an
// environment value: there is no field for any of them.
import { ATTEMPT_CAUSES, CHANGES, NEEDS, OUTCOMES, RECEIPT_DOMAINS, STAGE_NAMES, VERIFICATION_STATES, WRITABLE_STOPS } from "./vocab.mjs";

// A reference to something another domain owns: an id, never a path or a URL.
const REF = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$";

// An action's type or a next action: `database.migrate`, `inspect-refund-validation`.
const SLUG = "^[a-z][a-z0-9.-]{0,63}$";

// A word a domain answers with -- READY, PASS, OBSERVED_EXPECTED_BEHAVIOR -- kept as it is said.
const WORD = "^[A-Za-z][A-Za-z0-9_-]{0,39}$";

const ISO = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,3})?)?(Z|[+-]\\d{2}:\\d{2})$";

const text = { type: "string", text: true };
const count = { type: "integer", minimum: 0 };
const limit = { type: "integer", minimum: 1 };

export const FIELDS = {
  project: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" },
  checkout: { type: "string", pattern: "^[a-f0-9]{16,64}$" },
  objective: text,
  work: { type: "string", pattern: "^w-[0-9a-f]{12}$" },
  parent: { type: "string", pattern: "^tsk-[a-f0-9]{12}$", says: { pattern: "parent is the id of the coordinated workflow (tsk-…) that started this task" } },
  root: { type: "string", pattern: "^req-[0-9a-f]{12}$" },
  snapshot: { type: "string", pattern: "^rs-[0-9a-f]{12}$" },
  snapshotDigest: { type: "string", pattern: "^[0-9a-f]{8,64}$" },
  baseRevision: { type: "string", pattern: "^[0-9a-f]{7,64}$" },
  workspace: { type: "string", pattern: REF },
  provider: { type: "string", pattern: "^[a-z][a-z0-9-]{0,39}$" },
  actor: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$" },
  attempts: limit,
  actions: limit,
  minutes: limit,
  stage: { type: "string", enum: STAGE_NAMES },
  because: text,
  cause: { type: "string", enum: ATTEMPT_CAUSES },
  outcome: { type: "string", pattern: WORD },
  failureSignature: { type: "string", pattern: "^[a-f0-9]{12}$", says: { pattern: "failureSignature is a 12-character hex hash of the failure, computed by whoever saw it -- never its text" } },
  observed: text,
  hypothesis: text,
  nextAction: { type: "string", pattern: SLUG },
  evidence: { type: "array", items: { type: "string" } },
  reason: text,
  type: { type: "string", pattern: SLUG },
  tool: { type: "string", pattern: SLUG },
  label: text,
  mutates: { type: "boolean" },
  approval: { type: "string", pattern: "^apr-[0-9]{1,6}$" },
  environment: { type: "string", pattern: WORD },
  sourceTree: { type: "string", pattern: "^[0-9a-f]{7,64}$", says: { pattern: "sourceTree is the hex id of the source tree a piece of evidence was taken from -- never a path" } },
  pin: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{1,47}:\\d+\\.\\d+\\.\\d+:[0-9a-f]{8}$", says: { pattern: "pin is a playbook version as <id>:<version>:<digest8>" } },
  providerKey: { type: "string", pattern: REF, says: { pattern: "providerKey is the registry key of the provider a call was asked through (managed:docs, project:rows) -- never a URL" } },
  queryDigest: { type: "string", pattern: "^[0-9a-f]{64}$", says: { pattern: "queryDigest is the sha-256 of what was asked -- never the question" } },
  resultDigest: { type: "string", pattern: "^[0-9a-f]{64}$", says: { pattern: "resultDigest is the sha-256 of what came back -- never the answer" } },
  operation: { type: "string", enum: ["read", "write"] },
  params: { type: "object" },
  action: { type: "string", pattern: "^act-[0-9]{1,6}$" },
  receipt: { type: "string", pattern: REF },
  summary: text,
  path: { type: "string" },
  change: { type: "string", enum: CHANGES },
  added: count,
  removed: count,
  domain: { type: "string", enum: RECEIPT_DOMAINS },
  ref: { type: "string", pattern: REF },
  subject: { type: "string", pattern: REF },
  obligation: text,
  state: { type: "string", enum: VERIFICATION_STATES },
  risk: text,
  boundary: { type: "string", pattern: "^[A-Z][A-Z_]{2,39}$", says: { pattern: "boundary is the id of a protected boundary (src/protected/boundaries.mjs), e.g. GIT_PUSH" } },
  destructive: { type: "boolean" },
  shows: { type: "object" },
  expires: { type: "string", pattern: ISO },
  stop: { type: "string", enum: WRITABLE_STOPS, says: { enum: `stop must be one a task may record: ${WRITABLE_STOPS.join(", ")} -- HUMAN_APPROVAL_REQUIRED and CANCELLED_BY_HUMAN are derived, never written` } },
  needs: { type: "string", enum: NEEDS },
  expected: count,
  human: { type: "boolean" },
};

// The narrower words some ops take for a field FIELDS keeps broad.
export const ATTEMPT_OUTCOME = { type: "string", enum: OUTCOMES };

// A verification cites ONE receipt, where a decision may cite several things.
export const RECEIPT_REF = { type: "string", pattern: REF };

export const TEXT_FIELDS = Object.keys(FIELDS).filter((k) => FIELDS[k].text === true);
