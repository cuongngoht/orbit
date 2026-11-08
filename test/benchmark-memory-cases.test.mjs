// The memory-first cases (0.5.0, backlog B3 part 1) -- ORBIT-MEM-007, 008 and 009 -- held check by check, with no
// container: each case's own probe run as a child over the subject's files, its raw answers judged by its frozen spec.
// test/benchmark-cases.test.mjs holds every source case to its baseline and its controls' verdicts; this file holds what
// makes THESE checks worth having: every control fails on the groups it plants into and nowhere it does not, so each
// check provably discriminates -- and what a look measured (its time, its git calls, its reads) is kept beside its
// verdict, whether it held or not.
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { frozen, HARNESS, subjectOf } from "../benchmark/lib/core/freeze.mjs";
import { mutatedEntries, mutationFile } from "../benchmark/lib/core/mutations.mjs";
import { caseOf } from "../benchmark/lib/core/suites.mjs";
import { closureOf, probed, ROOT } from "./benchmark-double.mjs";
import { sealed } from "./home.mjs";
import { takeTurn } from "./benchmark-turn.mjs";

await takeTurn();

let subject = null;

const subjectNow = () => (subject ??= subjectOf(frozen(ROOT, "head", sealed()).entries, HARNESS).entries);

const applied = (entries, c, rel) => ((r) => (assert.ok(r.ok, `${rel} applies exactly: ${JSON.stringify(r.drift)}`), r.entries))(mutatedEntries(entries, mutationFile(c.dir, rel)));

const controlEntries = (c, k) => ((v) => (k.file ? applied(v, c, k.file) : v))(c.variants[k.variant]?.mutations ? applied(subjectNow(), c, c.variants[k.variant].mutations) : subjectNow());

const failing = (judged) => [...new Set(judged.checks.filter((x) => !x.ok).map((x) => x.group))].sort();

async function held(t, id) {
  const c = caseOf(ROOT, id);
  const spec = await import(pathToFileURL(join(c.dir, c.acceptance.spec)).href);
  const run = (k) => probed(t, c.dir, spec, closureOf(controlEntries(c, k), c.subject.paths), { samples: c.acceptance.samples });
  return { c, spec, groups: Object.fromEntries(c.controls.map((k) => [k.id, failing(run(k))])), clean: run(c.controls.find((k) => k.id === "clean")) };
}

// Each control: the groups it must fail, and the groups it must leave holding.
const holds = (groups, id, fails, keeps) => {
  for (const g of fails) assert.ok(groups[id].includes(g), `${id} fails ${g}: it failed ${groups[id].join(", ") || "nothing"}`);
  for (const g of keeps) assert.ok(!groups[id].includes(g), `${id} leaves ${g} holding: it failed ${groups[id].join(", ")}`);
};

// A look that is always CURRENT never learns, so it fails the first look every plan begins with: it gives away
// everything, and holds nothing.
test("ORBIT-MEM-007: a forgetful scan and a fingerprint per fact each fail a second look; an always-current and an always-rescan look fail what they give away", async (t) => {
  const { groups, clean } = await held(t, "ORBIT-MEM-007");
  assert.deepEqual(groups.clean, [], "the source as it is holds every check");
  holds(groups, "planted", ["second-look-current", "stays-current", "dry-current", "current-is-cheap"], ["first-look-learns", "dry-writes-nothing"]);
  holds(groups, "partial-fix", ["second-look-current", "stays-current"], ["first-look-learns", "dry-writes-nothing"]);
  holds(groups, "allow-all", ["first-look-learns", "dry-writes-nothing", "second-look-current"], []);
  holds(groups, "reject-all", ["second-look-current", "stays-current", "dry-current", "current-is-cheap"], []);
  const cheap = clean.checks.find((k) => k.group === "current-is-cheap");
  assert.ok(cheap.measured["2"].ms < cheap.measured["1"].ms / 2, "the time a look took is kept beside its verdict");
  assert.deepEqual([cheap.measured["1"].said, cheap.measured["2"].said, cheap.measured["2"].reads, cheap.measured["2"].calls <= 4], ["BOOTSTRAP", "CURRENT", 0, true]);
});

test("ORBIT-MEM-008: the root's folder taken for the whole tree fails a note's commit, and a scan reading everything fails every declaration's", async (t) => {
  const { groups } = await held(t, "ORBIT-MEM-008");
  assert.deepEqual(groups.clean, []);
  holds(groups, "planted", ["note-moves-nothing", "manifest-moves-its-scope", "root-file-moves-itself", "document-moves-its-folder"], []);
  holds(groups, "partial-fix", ["manifest-moves-its-scope", "root-file-moves-itself", "uncommitted-is-unknown"], ["note-moves-nothing"]);
  holds(groups, "allow-all", ["manifest-moves-its-scope", "uncommitted-is-unknown", "note-moves-nothing"], []);
  holds(groups, "reject-all", ["note-moves-nothing", "current-after-rescan"], []);
});

test("ORBIT-MEM-009: one look per claim fails every recall, a stamp trusted fails every moved scope; all-fresh and all-stale each fail their side", async (t) => {
  const { groups, clean } = await held(t, "ORBIT-MEM-009");
  assert.deepEqual(groups.clean, []);
  holds(groups, "planted", ["unchanged-is-fresh", "moved-is-stale", "uncommitted-is-unknown", "one-look-for-many"], []);
  holds(groups, "partial-fix", ["moved-is-stale", "stale-stays-stale", "uncommitted-is-unknown"], []);
  holds(groups, "allow-all", ["moved-is-stale", "stale-stays-stale", "uncommitted-is-unknown"], ["unchanged-is-fresh", "note-moves-nothing", "one-look-for-many"]);
  holds(groups, "reject-all", ["unchanged-is-fresh", "note-moves-nothing", "one-look-for-many"], []);
  assert.ok(clean.checks.every((k) => Object.values(k.measured).every((m) => m.reads === 0 && m.calls <= 3)), "a recall reads no file, in a few git calls");
});

test("the memory cases keep their probes inputs-only and their checks the same for one seed", async () => {
  for (const id of ["ORBIT-MEM-007", "ORBIT-MEM-008", "ORBIT-MEM-009"]) {
    const c = caseOf(ROOT, id);
    const spec = await import(pathToFileURL(join(c.dir, c.acceptance.spec)).href);
    assert.deepEqual(spec.selfTest(), [], id);
    assert.equal(JSON.stringify(spec.cases(5, c.acceptance.samples)), JSON.stringify(spec.cases(5, c.acceptance.samples)), id);
    assert.ok(spec.cases(5, c.acceptance.samples).every((k) => !("expect" in k.input)), `${id}: no expectation rides in an input`);
  }
});
