// The CORE vocabulary of a step, defined ONCE.
//
// Every field a step may carry is a row here, with the JSON-Schema fragment an
// editor needs and the sentence a human needs. The validator, the schema
// generator (cli/schema.mjs) and the runner all read this table, so the three
// cannot disagree -- which they did when each kept its own list: the shipped
// schema.json knew no `as` verb and no `identities` block while the validator
// accepted both, and `query` was missing from the runner's interpolation list,
// so a sql step once asked `WHERE Name = '${NAME}'` literally and passed.
//
// A project may add step fields of its own through an extension; dsl/registry.mjs
// merges them with these and answers every question about the result. The three
// tables below that describe the case HEAD -- its identities, its resolve block,
// its params -- are deliberately NOT extensible: an extension adds ways to
// EXECUTE a step, and a case needing a new kind of head is a change to the
// engine's own contract, which is a version bump and not a project's business.

import { CORE_LAYERS } from "./verbs.mjs";

export const PARAM_NAME = /^[A-Z][A-Z0-9_]*$/;

export const CORE_STEP_FIELDS = {
  do: { type: "string", doc: "The verb. One of the names in verbs.mjs." },
  on: { type: "string", pattern: "^[^/]+/.+$", doc: "\"<screen>/<via>\" — the edge whose selector (and note, and effect) this step uses. One locator defined in one place; correcting the edge fixes every case through it." },
  selector: { type: "string", esc: "js", doc: "Literal Playwright locator. Only where no edge can name the control — typically when the label IS the parameter — and how you test a screen the map has never seen." },
  screen: { type: "string", doc: "goto: the screen whose url to open. Elsewhere: which screen this step belongs to, for grouping the output." },
  url: { type: "string", doc: "goto: a literal path, when no screen record exists." },
  value: { type: "string", doc: "fill: the text to type." },
  key: { type: "string", doc: "press: the key, e.g. Escape, Enter." },
  js: { type: "string", esc: "js", doc: "wait/assert/skip-if/report: a JS expression evaluated in the page." },
  file: { type: "string", pattern: "^[\\w.-]+\\.png$", doc: "screenshot: a .png file name inside the evidence directory — a name, never a path, so a case cannot write outside it." },
  expect: { type: "string", esc: "js", doc: "report/sql: the case's own pass/fail over the value just produced, bound to `it`. Evaluated in Node over the recorded value, not in the page." },
  match: { type: "string", esc: "regex", doc: "api: regex matched against the request url. The LAST match wins, because the step asks about the call its own click just caused." },
  method: { enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"], doc: "api: narrow the match to one HTTP method." },
  status: { type: "integer", minimum: 100, maximum: 599, doc: "api: the exact status required. Omit to accept any 2xx." },
  query: { type: "string", esc: "sql", doc: "sql: a read-only SELECT. `it` is the rows; every value is a STRING because it was parsed out of text — Number(it[0].n) === 1, never it[0].n === 1." },
  identity: { type: "string", doc: "as: the identity (a key of `identities`) the remaining steps drive." },
  wait: { type: "string", esc: "js", doc: "A predicate polled AFTER this step — the honest alternative to a sleep. Test the thing you care about, not that the page painted." },
  tries: { type: "integer", minimum: 1, doc: "Poll budget in attempts (default 25). Not a duration: one attempt is one CLI round trip, ~0.5s here and several on a loaded machine." },
  timeout: { type: "integer", minimum: 1, doc: "Poll budget in SECONDS (default 120, ORBIT_STEP_TIMEOUT). The budget that travels between machines; whichever of tries/timeout runs out first stops the poll." },
  why: { type: "string", doc: "Why this step or its wait exists. Printed next to a failure — write it for whoever debugs at 2am." },
  times: { type: "integer", minimum: 1, doc: "Repeat this step and its wait N times." },
  capability: { type: "string", pattern: "^[a-z][a-z0-9]*(\\.[a-z][a-zA-Z0-9]*)+$", literal: true, doc: "call: the namespaced capability to ask, e.g. postgres.query. Two segments at least — a bare \"query\" is a word two providers would both claim." },
  input: { type: "object", literal: true, doc: "call: what to ask it, as an object the capability's own inputSchema describes. ${PARAM}s inside are filled by the capability's declared escaping, not the engine's — the capability knows which language each of its keys is read as, and the engine does not." },
  select: { type: "string", doc: "call: which part of the answer `into` binds — a dot path into the result, e.g. \"id\" or \"rows.0.id\"." },
  proves: { type: "string", enum: CORE_LAYERS, doc: "call: which layer this verdict rules on — the screen (ui), the call the screen made (api), or the data underneath (sql). Every other verb names its layer in its own row; call cannot, because the same capability can be either." },
  into: { type: "string", pattern: PARAM_NAME.source, doc: "report/sql: bind the value this step produced as ${NAME}, for LATER steps to use — the id of the thing just created, say. Bound once, when the step runs, and usable only after it: that is what keeps a case a sequence of facts rather than a program. The value is written to the shared ledger, so never bind a secret." },
};

// Fields every verb may carry.
export const CORE_COMMON_FIELDS = ["do", "on", "screen", "wait", "tries", "timeout", "why", "times"];

// Fields whose value is a NAME in some other table (a verb, an edge key, a
// screen id, an identity key). Everything else that is a string is a value a
// ${PARAM} may appear in, and is interpolated -- by exclusion, so a new value
// field can never be forgotten the way `query` was.
export const CORE_LITERAL_FIELDS = new Set(["do", "on", "screen", "identity", "into"]);

export const ROOT_FIELDS = {
  $schema: { type: "string", doc: "Path to the case schema, so the editor validates as you type." },
  id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$", doc: "Must equal the file name without .json." },
  name: { type: "string", doc: "One line a human reads in `query cases`." },
  start: { type: "string", doc: "Screen id the case begins on." },
  identity: { $ref: "#/definitions/identity", doc: "WHO the case runs as — a kind of user, never a profile name. See definitions/identity." },
  identities: { type: "object", minProperties: 2, says: { minProperties: "identities holds fewer than 2 entries — use identity for a single one, or add the other" }, additionalProperties: { $ref: "#/definitions/identity" }, doc: "Several identities the case switches between with {\"do\":\"as\"}. Each is a separate signed-in browser." },
  resolve: { type: "array", items: { $ref: "#/definitions/resolve" }, doc: "Read-only SQL run BEFORE the browser, filling params with what it finds. No row matched means BLOCKED (exit 3), never FAIL." },
  destructive: { type: "boolean", doc: "true means the runner refuses without --force-destructive." },
  creates: { type: "string", doc: "What real object this makes in a real environment. Declaring it makes a skip-if guard mandatory." },
  params: { type: "array", items: { $ref: "#/definitions/param" }, doc: "Values interpolated as ${NAME} anywhere in the steps." },
  steps: { type: "array", minItems: 1, items: { $ref: "#/definitions/step" }, doc: "The steps, in order." },
  seen: { enum: ["live", "src"], doc: "live = every step was driven in a browser and watched. src = written from source, never run. Claim live only in the turn you finished the run." },
  fe_commit: { type: "string", doc: "The frontend commit the live run was made against — the case's only expiry date." },
  note: { type: "string", doc: "What was verified, when, against which environment — and every trap that cost someone an afternoon." },
};
export const ROOT_REQUIRED = ["id", "name", "steps", "seen"];

export const IDENTITY_FIELDS = {
  as: { type: "string", doc: "Logical identity, e.g. \"admin\". Each machine maps it to a local profile in identities.json or ORBIT_IDENTITY_<AS>." },
  roles: { type: "array", items: { type: "string" }, doc: "Every one of these must be in the token's roles claim." },
  notRoles: { type: "array", items: { type: "string" }, doc: "None of these may be. An account that also holds the admin role passes a scoped test for the wrong reason." },
  upn: { type: "string", doc: "Pin the exact account. Usually unnecessary — roles are what authorization turns on." },
  desc: { type: "string", doc: "Why this identity, for the reader." },
};
export const RESOLVE_FIELDS = {
  as: { type: "string", pattern: PARAM_NAME.source, doc: "Param name this fills, usable as ${AS} in any step." },
  sql: { type: "string", doc: "A read-only SELECT. ${PARAM} is interpolated first." },
  col: { type: "string", doc: "Column to take from the first row. Default: the first column." },
  desc: { type: "string", doc: "Why this shape and not an id." },
};
export const PARAM_FIELDS = {
  n: { type: "string", pattern: PARAM_NAME.source, doc: "The name, used as ${N}." },
  required: { type: "boolean", doc: "The runner refuses without it." },
  default: { type: "string", doc: "Used when not given." },
  desc: { type: "string", doc: "What a good value looks like." },
};
