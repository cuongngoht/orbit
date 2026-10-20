import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { COMMON_FIELDS, IDENTITY_FIELDS, PARAM_FIELDS, RESOLVE_FIELDS, ROOT_FIELDS, STEP_FIELDS } from "../src/dsl/fields.mjs";
import { VERBS, VERB_NAMES, ownersOf } from "../src/dsl/verbs.mjs";
import { UI_TESTS } from "./fakes/context.mjs";
import { sealed } from "./home.mjs";

// The introspection view exists so that no playbook, prompt or cheatsheet has
// to carry a copy of the vocabulary. That only holds if the view DERIVES
// everything, so every assertion below is taken from the tables rather than
// from expected prose -- a new verb, field or column has to appear here without
// this file or the view changing, and the last two tests are the ones that
// actually pin that down.
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli");
const VIEW = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "query", "dsl.mjs");

const ask = (...args) =>
  spawnSync(process.execPath, [join(CLI, "query.mjs"), ...args], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: UI_TESTS }) });

// The block `query verb` prints under "every field this verb may carry".
function fieldsShown(stdout) {
  const block = stdout.split("every field this verb may carry:")[1] ?? "";
  return [...block.matchAll(/^ {4}(\S+)/gm)].map((m) => m[1]);
}

const labels = (stdout) => [...stdout.matchAll(/^ {2}(\S+)\s+:/gm)].map((m) => m[1]);

test("every verb in the table can be queried, and answers with its own row", () => {
  for (const v of VERBS) {
    const r = ask("verb", v.name);
    assert.equal(r.status, 0, `${v.name}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, new RegExp(`^${v.name}$`, "m"), `no heading for ${v.name}`);
    assert.ok(r.stdout.includes(v.doc), `${v.name} lost the sentence on its row`);
  }
});

// The fields a verb may carry are the common ones plus its own, and nothing
// else. A verb shown a field it may not carry is how a misplaced field gets
// written in the first place.
test("the fields a verb is shown are exactly COMMON_FIELDS plus its own", () => {
  for (const v of VERBS) {
    assert.deepEqual(fieldsShown(ask("verb", v.name).stdout), [...COMMON_FIELDS, ...v.fields], `wrong field set for ${v.name}`);
  }
});

// An inner array in `needs` means "one of these". Flattening it would turn an
// alternative into a requirement, which is a different case.
test("needs is rendered from verb.needs, alternatives kept as alternatives", () => {
  for (const v of VERBS) {
    const want = v.needs.map((n) => (Array.isArray(n) ? n.join(" | ") : n)).join(", ") || "nothing";
    assert.match(ask("verb", v.name).stdout, new RegExp(`needs\\s+: ${want.replace(/[|]/g, "\\|")}$`, "m"), `${v.name} needs`);
  }
});

// The property that makes a new COLUMN free: every key the row carries is
// printed as a label, so `verbsWhere("<something new>")` is visible the day the
// column exists.
test("every column a verb row carries is printed, so a new column needs no change here", () => {
  for (const v of VERBS) {
    const shown = labels(ask("verb", v.name).stdout);
    for (const k of Object.keys(v)) {
      if (k !== "name") assert.ok(shown.includes(k), `${v.name} carries ${k} and the view does not print it`);
    }
  }
});

test("every field in every vocabulary table can be queried", () => {
  const tables = [STEP_FIELDS, ROOT_FIELDS, IDENTITY_FIELDS, RESOLVE_FIELDS, PARAM_FIELDS];
  for (const name of new Set(tables.flatMap((t) => Object.keys(t)))) {
    const r = ask("field", name);
    assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /in this engine's vocabulary/, `${name} is in a table and reported unknown`);
  }
});

// Where a field is allowed comes from ownersOf(), which reads the verbs' own
// `fields` lists -- so "query belongs on a sql step" is never a sentence
// somebody maintained.
test("a field's owners are the ones ownersOf() names", () => {
  for (const name of Object.keys(STEP_FIELDS)) {
    const owners = ownersOf(name);
    const said = ask("field", name).stdout;
    if (COMMON_FIELDS.includes(name)) assert.match(said, /any verb \(a common field\)/, `${name} is common`);
    else assert.match(said, new RegExp(`only ${owners.join(", ")}`), `${name} should be only on ${owners.join(", ")}`);
  }
});

test("a name the vocabulary does not have is reported unknown, with the whole set", () => {
  const verb = ask("verb", "clicc");
  assert.equal(verb.status, 0, "a mistyped lookup is a miss, not a broken command");
  assert.match(verb.stdout, /no verb "clicc" in this engine's vocabulary/);
  for (const n of VERB_NAMES) assert.ok(verb.stdout.includes(n), `the miss did not offer ${n}`);

  const field = ask("field", "waitt");
  assert.match(field.stdout, /no field "waitt" in this engine's vocabulary/);
  assert.match(field.stdout, /never a key to invent/, "the miss has to say what to do instead");
});

// The one that keeps the whole design honest. If this view ever mentions a verb
// by name it has begun keeping its own copy of the vocabulary, and the copy is
// what drifts. Checked over STRING LITERALS, because the prose necessarily
// contains words like "as" and "wait".
test("the view names no verb — which is why a new verb row is queryable for free", () => {
  const source = readFileSync(VIEW, "utf8");
  const literals = [...source.matchAll(/"([^"\\]*)"|'([^'\\]*)'/g)].map((m) => m[1] ?? m[2]);
  const named = literals.filter((s) => VERB_NAMES.includes(s));
  assert.deepEqual(named, [], `src/query/dsl.mjs names ${named.join(", ")} — derive it from the table instead`);
});

test("the summary lists every verb and points at the detail commands", () => {
  const r = ask("dsl");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const v of VERBS) assert.match(r.stdout, new RegExp(`^ {2}${v.name}\\s`, "m"), `the summary skips ${v.name}`);
  assert.match(r.stdout, /query\.mjs verb <name>/);
  assert.match(r.stdout, /query\.mjs field <name>/);
});
