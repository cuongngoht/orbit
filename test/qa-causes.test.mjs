// ONE MODEL of what a design causes (src/qa/backend/causes.mjs, 0.6.0 Q2), held as properties over the whole corpus of
// designs (test/qa-designs.mjs): the contradiction rules read every design through it, and neither module names a
// family operation or a shape -- what a step does is its effects, what a shape says comes again is its own column.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { OPERATIONS } from "../src/adapters/families.mjs";
import { REDELIVERY } from "../src/qa/backend/causes.mjs";
import { CONTRADICTION_RULES, contradictionAdvice, contradictionFindings } from "../src/qa/backend/contradictions.mjs";
import { SHAPE_IDS } from "../src/qa/obligations/shapes.mjs";
import { HOST_READS, mutationsOf, unactionable } from "./qa-actionable.mjs";
import { contextOf, corpus, fixtureCaseOf, fixtureNamesIn, fixtureOf, references, ROOT, saidOf, sent, STACKS, worked } from "./qa-designs.mjs";

const DIR = "qa-contradictions";
const rulesOf = (said) => ({ findings: said.findings.map((f) => f.rule), advice: said.advice.map((f) => f.rule) });

const MODULES = ["causes.mjs", "contradictions.mjs"].map((f) => [f, readFileSync(join(ROOT, "src", "qa", "backend", f), "utf8")]);

test("neither the model nor the rules over it hold a family operation's id or a shape's id, in code or in a comment", () => {
  for (const [f, text] of MODULES) {
    assert.deepEqual(text.match(/orbit\.[a-z]+\.[a-z]+/g) ?? [], [], `${f}: an orbit.<family>.<op> literal`);
    assert.deepEqual(OPERATIONS.map((o) => o.capability).filter((c) => text.includes(c)), [], f);
    assert.deepEqual(SHAPE_IDS.filter((id) => new RegExp(`\\b${id}\\b`).test(text)), [], `${f}: a shape id`);
  }
});

// ── the gaps a review of the 0.5.0 rows found, each a regression fixture (test/fixtures/qa-contradictions/) ───────────
//
// Each fixture says what the rules refuse and say of it on stack A (`expect`), and on another stack where its broker
// declares otherwise (`expectOn`): a false alarm or a missed defect of a future host, fixed by reading the one model.
test("every regression fixture is refused and advised as it says, on each stack", () => {
  const names = fixtureNamesIn(DIR);
  assert.ok(names.length >= 15);
  const off = names.flatMap((name) => STACKS.map((stack) => [name, stack, fixtureOf(DIR, name)])).map(([name, stack, f]) => [`${name} ${stack}`, f.expectOn?.[stack] ?? f.expect, rulesOf(saidOf(fixtureCaseOf(DIR, name, stack)))]).filter(([, want, got]) => JSON.stringify(want) !== JSON.stringify(got));
  assert.deepEqual(off, []);
});

// ── properties over the whole corpus ───────────────────────────────────────────────────────────────────────────────

const ruled = (x) => ((s) => [...s.findings.map((f) => `refused ${f.rule}`), ...s.advice.map((f) => `said ${f.rule}`)])(saidOf(x));

test("no reference design, worked design or design an old benchmark control sent is refused or said anything, on either stack", () => {
  const all = [...references(), ...worked(), ...sent()];
  assert.ok(all.length >= 300, `${all.length}`);
  assert.deepEqual(all.flatMap((x) => ruled(x).map((r) => `${x.label}: ${r}`)), []);
});

// What a host reads of a refusal (src/investigation/loop.mjs findingLine): its first 240 characters, the rule's id first.
// Every contradiction refusal must say there the step it is about and, after the colon, what holds instead -- over the
// corpus and every design a host gets wrong made from the reference and worked ones (test/qa-actionable.mjs).
// The way out starts at the sentence's own colon (a value's colons are never followed by a space), and a host reads enough of
// it to act on: at least its first few words.
const WAY_OUT = 24;
const wayOut = (f) => ((line) => /^step \d+ /.test(f.say) && line.indexOf(": ", f.rule.length + 2) > 0 && line.indexOf(": ", f.rule.length + 2) + WAY_OUT <= HOST_READS)(`${f.rule}: ${f.say}`);

test("every refusal says, within what a host reads of it, the step it is about and what holds instead", () => {
  const made = [...references(), ...worked()].flatMap((x) => mutationsOf(x.design).map((design, n) => ({ ...x, label: `${x.label} mutation ${n + 1}`, design })));
  const refusals = [...corpus(), ...made].flatMap((x) => saidOf(x).findings.map((f) => ({ label: x.label, f })));
  assert.ok(refusals.length >= 20, `${refusals.length}`);
  assert.deepEqual(refusals.filter((r) => !wayOut(r.f)).map((r) => `${r.label}: ${r.f.rule}: ${r.f.say.slice(0, 160)}`), []);
  assert.deepEqual(refusals.flatMap((r) => unactionable([`${r.f.rule}: ${r.f.say}`])), [], "none is a criterion refusal a host cannot act on");
});

// The rules read what a step's operation DECLARES, never its id: a family whose operations declare the same refs, effects
// and outputs as another's is held to exactly the same verdicts, step for step, on every design of the corpus.
const twin = (o) => ({ ...o, family: `${o.family}twin`, capability: `orbit.${o.family}twin.${o.op}` });
const twinned = (design) => JSON.parse(JSON.stringify(design ?? {}).replace(/"orbit\.([a-z]+)\.([a-z]+)"/g, (all, family, op) => (OPERATIONS.some((o) => o.capability === `orbit.${family}.${op}`) ? `"orbit.${family}twin.${op}"` : all)));
const rulesOnly = (x, cx) => ((s) => [...s.findings, ...s.advice].map((f) => f.rule))({ findings: contradictionFindings(x.design, cx), advice: contradictionAdvice(x.design, cx) });

test("the verdicts are the same when one family's operations are answered by another's that declares the same", () => {
  const twins = OPERATIONS.map(twin);
  OPERATIONS.push(...twins);
  try {
    const all = corpus();
    const off = all.filter((x) => JSON.stringify(rulesOnly(x, contextOf(x))) !== JSON.stringify(rulesOnly({ ...x, design: twinned(x.design) }, { ...contextOf(x), investigation: twinnedRecord(contextOf(x).investigation) })));
    assert.deepEqual(off.map((x) => x.label), []);
    assert.ok(all.some((x) => rulesOnly(x, contextOf(x)).length > 0), "and the corpus is not one nothing is said of");
  } finally {
    OPERATIONS.splice(OPERATIONS.length - twins.length, twins.length);
  }
});

const twinnedRecord = (investigation) => (investigation ? { ...investigation, earlier: investigation.earlier.map((e) => ({ ...e, design: twinned(e.design) })) } : undefined);

test("what brings a delivery back is classified for every value the semantics vocabulary allows, and for nothing else", () => {
  const row = JSON.parse(readFileSync(join(ROOT, "catalog", "semantics.json"), "utf8")).fields.find((f) => f.id === "redeliveryTriggers");
  assert.deepEqual(Object.keys(REDELIVERY).sort(), [...row.values].sort());
  assert.deepEqual([...new Set(Object.values(REDELIVERY))].sort(), ["elapses", "interrupt", "rejects"]);
});

test("each rule has one id and says whether it refuses; every refusing rule has its advice twin's subject apart", () => {
  assert.equal(new Set(CONTRADICTION_RULES.map((r) => r.id)).size, CONTRADICTION_RULES.length);
  assert.ok(CONTRADICTION_RULES.every((r) => typeof r.refuses === "boolean"));
  assert.deepEqual(CONTRADICTION_RULES.filter((r) => r.refuses).map((r) => r.id), ["MATCH_PINS", "SELF_SATISFIED", "SECOND_SETTLED", "SETTLED_BEFORE", "NEVER_REDELIVERED", "NEVER_DECIDED"]);
});
