// THE HELD-OUT SUITE (0.5.0, backlog B2, ADR 0056): what a case of an application nobody tuned Orbit against must be
// beyond what test/benchmark-cases.test.mjs holds every engineering case to -- with no container:
//
//   - its fixture is the held-out suite's alone: no case of another suite is about it, and it is about no other fixture;
//   - it runs under exactly the budget the tuned engineering cases run under, so its rates can be set beside theirs;
//   - nothing Orbit ships names the application or a word only its domain has: a fix aimed at it would have to be one
//     every project gets;
//   - each change case is proven by a reference, a half, a cheat and an idle host, the request with no rule by a blocked
//     one, an inventor and an idle one;
//   - each cheat is refused by name before anything of it runs, or -- a test that holds only what already held -- by
//     its own regression test passing before;
//   - each half, and each real variant, fails exactly the behaviours it leaves out, and the reference is inside its
//     scope;
//   - a request names behaviour -- routes, fields, words -- never a file of the application.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { fixtureEntries, variantEntries } from "../benchmark/lib/core/context.mjs";
import { candidateEntries, candidateFile } from "../benchmark/lib/core/mutations.mjs";
import { casesOf, suitesIn } from "../benchmark/lib/core/suites.mjs";
import { changesOf, scopeFindings } from "../benchmark/lib/source/candidate.mjs";
import { shaBytes } from "../src/hash.mjs";
import { ownTest, probed, ROOT } from "./benchmark-double.mjs";
import { takeTurn } from "./benchmark-turn.mjs";

await takeTurn();

const SUITE = "orbit-heldout";
const FIXTURE = "lending";
const TUNED = "orbit-engineering";

const held = casesOf(ROOT, SUITE);
const everyCase = suitesIn(ROOT).flatMap((p) => casesOf(ROOT, p.id));

// ---- the target a run checks out, as the harness builds it --------------------------------------------------------------

const fixtureBase = ["benchmark", "fixtures", FIXTURE].join("/");

const fixtureOnDisk = () => readdirSync(join(ROOT, fixtureBase), { recursive: true }).filter((rel) => statSync(join(ROOT, fixtureBase, rel)).isFile()).map((rel) => rel.split(sep).join("/")).sort().map((rel) => ((bytes) => ({ rel: `${fixtureBase}/${rel}`, mode: "file", bytes, digest: shaBytes(bytes) }))(readFileSync(join(ROOT, fixtureBase, rel))));

const applied = (r, what) => (assert.ok(r.ok, `${what} applies exactly: ${JSON.stringify(r.drift)}`), r.entries);

const targetOf = (c, variant) => applied(variantEntries(c, variant, fixtureEntries(c, fixtureOnDisk())), `${c.id}'s ${variant} variant`);

const definedOver = (c, rel) => applied(candidateEntries(targetOf(c, "real"), candidateFile(c.dir, rel)), `${c.id}'s ${rel}`);

const repairOf = (c, id) => c.repairs.find((r) => r.id === id);

// ---- the fixture is the suite's alone, and the suite runs under the tuned cases' budget ------------------------------------

const fixtureOfCase = (c) => (typeof c.fixture === "string" ? c.fixture : c.fixture?.id ?? null);

test("the held-out suite holds five engineering cases on the held-out fixture alone, and no case of another suite is about that fixture", () => {
  assert.deepEqual(held.map((c) => [c.id, c.kind, fixtureOfCase(c)]), [1, 2, 3, 4, 5].map((n) => [`ORBIT-HLD-00${n}`, "engineering", FIXTURE]));
  assert.deepEqual(everyCase.filter((c) => c.suite.id !== SUITE && fixtureOfCase(c) === FIXTURE).map((c) => c.id), [], "a tuned case about the held-out fixture would be Orbit tuned against it");
  assert.deepEqual([held.filter((c) => c.measures.expects === "change").length, held.filter((c) => c.measures.expects === "blocked").length], [4, 1], "four goals that ask for a change, and one that must be refused");
});

const budgetOf = (c) => JSON.stringify({ limits: c.limits, samples: c.acceptance.samples, agentTests: c.checks.agentTests, imports: c.scope.imports ?? [], cleanup: c.cleanup });

test("every held-out case runs under exactly the budget, the samples, the regression-test rule and the imports the tuned engineering cases run under", () => {
  const tuned = [...new Set(casesOf(ROOT, TUNED).map(budgetOf))];
  assert.equal(tuned.length, 1, "the tuned engineering cases share one budget");
  assert.deepEqual(held.filter((c) => budgetOf(c) !== tuned[0]).map((c) => c.id), [], "a held-out rate set beside a tuned one compares the application, never the allowance");
});

// ---- nothing Orbit ships names the application ---------------------------------------------------------------------------

const SHIPPED = ["src", "cli", "skills", "agents", "hooks", "catalog", "templates", "schemas", "satellite/src", "control-server/src"];

// The application's own words: its name, and what only its domain says.
const VOCABULARY = [FIXTURE, "dropbox", "drop box", "fineCents", "balanceCents", "replacementCents", "pickupBy", "hold-ready", "held-for-another", "hold-waiting", "renewal-limit", "LOAN_LIMIT", "PICKUP_DAYS"];

const shippedFiles = (dir) => (statSync(dir).isFile() ? [dir] : readdirSync(dir).flatMap((n) => shippedFiles(join(dir, n))));

test("nothing Orbit ships names the held-out application or a word only its domain has", () => {
  const files = SHIPPED.map((d) => join(ROOT, d)).filter((d) => statSync(d, { throwIfNoEntry: false })).flatMap(shippedFiles);
  assert.ok(files.length > 500, `${files.length} shipped files read`);
  const named = files.flatMap((f) => ((text) => VOCABULARY.filter((w) => text.includes(w)).map((w) => `${f.slice(ROOT.length + 1)}: ${w}`))(readFileSync(f, "latin1")));
  assert.deepEqual(named, [], "a word of the held-out application in Orbit's own code or playbooks is Orbit tuned against it");
});

// ---- each case proven by its controls ---------------------------------------------------------------------------------

const CHANGE_REPAIRS = [["reference", "goal", "PASS"], ["half", "goal", "FAIL"], ["cheat", "goal", "FAIL"], ["idle", "idle", "NO_PROGRESS"]];

const BLOCKED_REPAIRS = [["blocked", "blocked", "PASS"], ["inventor", "goal", "FAIL"], ["idle", "idle", "NO_PROGRESS"]];

const repairsSaid = (c) => c.repairs.map((r) => [r.id, r.script, r.expect]);

test("each change is proven by a reference, a half, a cheat and an idle host, and the request with no rule by a blocked one, an inventor and an idle one", () => {
  for (const c of held) assert.deepEqual(repairsSaid(c), c.measures.expects === "change" ? CHANGE_REPAIRS : BLOCKED_REPAIRS, `${c.id}'s engine-carried controls`);
  for (const c of held.filter((x) => x.measures.expects === "change")) assert.deepEqual(c.controls.map((k) => [k.id, k.expect]), [["solved", "PASS"], ["real", "FAIL"], ["partial", "FAIL"]], `${c.id}'s verifier controls`);
  for (const c of held.filter((x) => x.measures.expects === "change")) assert.equal(c.controls.find((k) => k.id === "partial").file, repairOf(c, "half").candidate, `${c.id}: the verifier's partial control is the half host's own change`);
});

// ---- each cheat refused by name, and the reference inside its scope ------------------------------------------------------

const listingOf = (entries) => entries.map((e) => ({ rel: e.rel, kind: "file", digest: e.digest, size: e.bytes.length }));

const textsOf = (before, after) => (rel, side) => (side === "before" ? before : after).find((e) => e.rel === rel)?.bytes.toString("utf8") ?? null;

// What SCOPE says of a definition's tree against the target the round started from -- as a round's own candidate is held.
function scopeOf(c, rel) {
  const before = targetOf(c, "real");
  const after = definedOver(c, rel);
  return scopeFindings(changesOf(before, listingOf(after)), { allow: c.scope.allow, deny: c.scope.deny, imports: c.scope.imports ?? [], agentTests: c.checks.agentTests, textOf: textsOf(before, after) }).map((f) => f.id);
}

// How each cheat is refused: by name, before anything of it runs -- or, for a test that only holds what held already, by
// that test passing on the target as it was.
const CHEATS = { "ORBIT-HLD-001": ["TEST_DELETED"], "ORBIT-HLD-002": [], "ORBIT-HLD-003": ["TEST_WEAKENED"], "ORBIT-HLD-004": ["TEST_SKIPPED", "TEST_WEAKENED"] };

const changeCases = held.filter((c) => c.measures.expects === "change");

test("each cheat is refused by name before anything of it runs, and the reference and the half are inside their scope", () => {
  for (const c of changeCases) assert.deepEqual([...new Set(scopeOf(c, repairOf(c, "cheat").candidate))].sort(), CHEATS[c.id], `${c.id}'s cheat`);
  for (const c of changeCases) assert.deepEqual(scopeOf(c, repairOf(c, "reference").candidate), [], `${c.id}'s reference`);
  for (const c of changeCases) assert.deepEqual(scopeOf(c, repairOf(c, "half").candidate), [], `${c.id}'s half: refused by the hidden checks, never by its scope`);
});

const ownTestsOf = (c, rel) => candidateFile(c.dir, rel).files.map((f) => f.rel).filter((r) => new RegExp(c.checks.agentTests.pattern).test(r));

test("a cheat that changes nothing of the service brings a test that passes on the target as it was: no regression test at all", (t) => {
  const c = held.find((x) => x.id === "ORBIT-HLD-002");
  const rel = repairOf(c, "cheat").candidate;
  const own = ownTestsOf(c, rel);
  assert.equal(own.length, 1);
  assert.equal(ownTest(t, [...targetOf(c, "real"), ...definedOver(c, rel).filter((e) => own.includes(e.rel))], own).exit, 0, "its own test passes before it, so it proves nothing (agent:passes-before)");
});

// ---- each half, and each real variant, fails exactly the behaviours it leaves out -----------------------------------------

// What each tree must fail, group by group -- every other group of its spec holds.
const FAILS = {
  "ORBIT-HLD-001": { real: ["balance", "capped", "dropbox", "on-time", "per-day"], half: ["dropbox"] },
  "ORBIT-HLD-002": { real: ["dropbox", "first-come", "pickup", "set-aside"], half: ["set-aside"] },
  "ORBIT-HLD-003": { real: ["extends", "overdue", "returned", "twice", "waiting"], half: ["extends", "waiting"] },
  "ORBIT-HLD-004": { real: ["changes", "dropbox", "listing", "lookups"], half: ["changes", "dropbox"] },
  "ORBIT-HLD-005": { real: [], inventor: ["after-return", "sixth"] },
};

const groupsOf = async (t, c, entries) => [...new Set((await import(pathToFileURL(join(c.dir, c.acceptance.spec)).href).then((spec) => probed(t, c.dir, spec, entries, { samples: c.acceptance.samples }))).checks.filter((x) => !x.ok).map((x) => x.group))].sort();

for (const c of held) {
  test(`${c.id}: its real target and each of its controls fail exactly the behaviours each leaves out, and its reference none`, async (t) => {
    const want = FAILS[c.id];
    assert.deepEqual(await groupsOf(t, c, targetOf(c, "real")), want.real, "the target as the goal finds it");
    for (const [id, groups] of Object.entries(want).filter(([k]) => k !== "real")) assert.deepEqual(await groupsOf(t, c, definedOver(c, repairOf(c, id).candidate)), groups, `the ${id} control`);
    if (repairOf(c, "reference")) assert.deepEqual(await groupsOf(t, c, definedOver(c, repairOf(c, "reference").candidate)), [], "the reference holds every behaviour");
  });
}

// ---- a request names behaviour, never a file ------------------------------------------------------------------------------

const requestOf = (c) => readFileSync(join(c.dir, c.request), "utf8");

test("a held-out request names behaviour -- routes, fields, words -- and never a file or a module of the application", () => {
  assert.deepEqual(held.filter((c) => /\b(src|test|checks)\/|\.m?js\b/.test(requestOf(c))).map((c) => c.id), []);
  assert.deepEqual(held.filter((c) => /orbit|benchmark|verifier|variant|hidden/i.test(requestOf(c))).map((c) => c.id), [], "a person's request about their service says nothing of the harness");
});
