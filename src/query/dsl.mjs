// `query dsl` · `query verb <name>` · `query field <name>`: the DSL, introspected.
//
// An agent authoring or repairing a case has to know what the vocabulary means
// RIGHT NOW. Two ways of answering that were already wrong before this file
// existed: reading `src/dsl/*.mjs` means reading the engine in order to write a
// test, and a hand-written cheatsheet in a playbook becomes a second definition
// of the vocabulary that drifts the day a verb changes.
//
// So this is a VIEW over the tables that already own the information -- the same
// rows `caseSchema()` is generated from and `validate()` consumes. Nothing here
// names a verb, lists a field, or knows a column: even the column list is the
// union of the keys the rows actually carry, so a new column on a verb row
// becomes queryable without this file changing. That is the whole contract, and
// `test/query-dsl.test.mjs` asserts it against the tables rather than against
// expected prose.
import { COMMON_FIELDS, IDENTITY_FIELDS, PARAM_FIELDS, RESOLVE_FIELDS, ROOT_FIELDS, ROOT_REQUIRED, STEP_FIELDS } from "../dsl/fields.mjs";
import { LAYERS, VERB, VERBS, ownersOf } from "../dsl/verbs.mjs";
import { out } from "./format.mjs";

// Every table a field name can live in, so "where is this field allowed" is
// answered from the vocabulary and not from a list somebody maintained. A new
// sub-table is a row here.
const TABLES = [
  ["a step", STEP_FIELDS],
  ["case root", ROOT_FIELDS],
  ["identity", IDENTITY_FIELDS],
  ["resolve row", RESOLVE_FIELDS],
  ["param row", PARAM_FIELDS],
];

// The union of the keys the rows carry, not a list of the columns we know about:
// a column added to verbs.mjs shows up here by itself. FIRST is presentation
// only -- the order a reader asks in, with the sentence last. A column missing
// from it is still printed, which is the property that matters.
const FIRST = ["kind", "needs", "fields", "changes", "navigates", "requests", "verdict", "proves"];

const COLUMNS = ordered([...new Set(VERBS.flatMap((v) => Object.keys(v)))].filter((k) => k !== "name"));

function ordered(keys) {
  const known = FIRST.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !FIRST.includes(k) && k !== "doc");
  return [...known, ...rest, ...(keys.includes("doc") ? ["doc"] : [])];
}

// The keywords a field row may carry, in the order a reader wants them.
const SHAPE = ["type", "enum", "pattern", "minimum", "maximum", "minItems", "minProperties"];

const PAD = 12;
const pair = (k, v) => out(`  ${k.padEnd(Math.max(PAD, k.length + 1))}: ${v}`);

// ── query dsl ──────────────────────────────────────────────────────────────
// Deliberately a SUMMARY. The detail is one command away, and printing all of
// it here trains a reader to skim the thing they came to look up.
export function showDsl() {
  out(`\nVERBS  (src/dsl/verbs.mjs — one row there and one file in src/run/verbs/ IS the vocabulary)\n`);
  for (const v of VERBS) out(`  ${v.name.padEnd(11)} ${v.kind.padEnd(8)} needs ${needsOf(v).padEnd(20)} ${v.doc}`);
  fieldIndex();
  out(`\nA verdict rules on exactly one layer: ${LAYERS.join(" · ")}.`);
  out(`Ask for detail: query.mjs verb <name> · query.mjs field <name>`);
}

function fieldIndex() {
  out(`\nFIELDS  (src/dsl/fields.mjs — each defined once; schema, validator and runner read the same row)\n`);
  pair("any verb", COMMON_FIELDS.join(", "));
  for (const [where, table] of TABLES.slice(1)) pair(where, Object.keys(table).join(", "));
  pair("required", ROOT_REQUIRED.join(", "));
}

// ── query verb <name> ──────────────────────────────────────────────────────
export function showVerb(ctx, args) {
  const v = VERB.get(args?.[0]);
  if (!v) return unknown("verb", args?.[0], VERBS.map((x) => x.name));
  out(`\n${v.name}`);
  for (const k of COLUMNS) pair(k, column(v, k));
  fieldsOf(v);
}

// A column this verb does not carry prints "none" rather than vanishing: an
// absent line reads as "not applicable here", which is the opposite of the truth
// for `proves` on an act.
const column = (v, k) => RENDER[k]?.(v) ?? v[k] ?? "none";

const RENDER = {
  needs: (v) => needsOf(v),
  fields: (v) => (v.fields.length ? v.fields.join(", ") : "none of its own"),
  changes: (v) => yesNo(v.changes),
  navigates: (v) => yesNo(v.navigates),
};

const yesNo = (x) => (x ? "yes" : "no");

// An inner array in `needs` means "one of these" -- which is why it is an array
// and not a second column, and why flattening it here would turn an alternative
// into a requirement.
const needsOf = (v) => v.needs.map((n) => (Array.isArray(n) ? n.join(" | ") : n)).join(", ") || "nothing";

function fieldsOf(v) {
  out(`\n  every field this verb may carry:\n`);
  for (const f of [...COMMON_FIELDS, ...v.fields]) out(`    ${f.padEnd(11)} ${shapeOf(STEP_FIELDS[f])}${escOf(STEP_FIELDS[f])}`);
  out(`\n  query.mjs field <name> for what each one means.`);
}

// ── query field <name> ─────────────────────────────────────────────────────
export function showField(ctx, args) {
  const name = args?.[0];
  const found = TABLES.filter(([, table]) => table[name]);
  if (!found.length) return unknown("field", name, everyFieldName());
  out(`\n${name}`);
  for (const [where, table] of found) describe(where, table[name], name, found.length);
}

// A name can live in more than one table -- `identity` is a step field AND a
// root block -- so each place it is allowed gets its own block.
function describe(where, row, name, several) {
  if (several > 1) out("");
  pair("on", where === "a step" ? stepOwners(name) : where);
  pair("type", shapeOf(row) || "—");
  pair("read as", row.esc ?? "text — passed through untouched");
  pair("meaning", row.doc ?? "(no doc on the row)");
}

// A common field is allowed everywhere; anything else is allowed exactly where
// `ownersOf` says, which is derived from the verbs' own `fields` lists.
function stepOwners(name) {
  if (COMMON_FIELDS.includes(name)) return "any verb (a common field)";
  const owners = ownersOf(name);
  return owners.length ? `only ${owners.join(", ")}` : "a step, though no verb lists it — this is a bug in the tables";
}

const everyFieldName = () => [...new Set(TABLES.flatMap(([, t]) => Object.keys(t)))].sort();

// Unknown is an ANSWER, not an error: a mistyped lookup is how somebody finds
// out the thing they were about to write does not exist.
function unknown(kind, name, every) {
  out(`\nno ${kind} "${name ?? ""}" in this engine's vocabulary.`);
  out(`\nthe whole set:\n  ${every.join(", ")}`);
  out(`\nA ${kind} the vocabulary does not have is a capability gap to report — never a key to invent.`);
}

const shapeOf = (row) => (row ? SHAPE.filter((k) => row[k] !== undefined).map((k) => keyword(k, row[k])).join(" ") || refOf(row) : "");

const keyword = (k, v) => (k === "type" ? String(v) : `${k}=${Array.isArray(v) ? v.join("|") : v}`);

const refOf = (row) => (row.$ref ? `→ see ${row.$ref.split("/").pop()}` : "");

const escOf = (row) => (row?.esc ? `  · read as ${row.esc}` : "");
