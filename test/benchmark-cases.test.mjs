// The Docker benchmark's first cases, judged here the way the verifier judges them -- the case's own probe run as a
// child over a tree of the subject's files, its raw answers judged by the frozen spec and the harness judge -- with no
// container: what this file proves is that the CHECKS discriminate. The source as it is passes ORBIT-SRC-001; a planted
// fault, a partial fix, an oracle that allows everything and one that refuses everything all fail it; ORBIT-SRC-002
// fails on the source as it is (a real finding) and passes a reference repair, which still passes ORBIT-SRC-001.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { mutatedEntries, mutationFile } from "../benchmark/lib/faults.mjs";
import { judgedAll, probeInput } from "../benchmark/lib/judge.mjs";
import * as spec1 from "../benchmark/packs/orbit-source/ORBIT-SRC-001/hidden/spec.mjs";
import * as spec2 from "../benchmark/packs/orbit-source/ORBIT-SRC-002/hidden/spec.mjs";
import { sha } from "../src/hash.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(import.meta.dirname, "..");
const PACK = join(ROOT, "benchmark", "packs", "orbit-source");
const CASE1 = join(PACK, "ORBIT-SRC-001");
const CASE2 = join(PACK, "ORBIT-SRC-002");

// The files the probes import, and what those import: the subject a check needs, read from the repository as it is.
const SUBJECT = ["src/hash.mjs", "src/improvement/oracle.mjs", "src/improvement/safety.mjs"];

const subject = () => SUBJECT.map((rel) => ((bytes) => ({ rel, mode: "file", bytes, digest: sha(bytes) }))(readFileSync(join(ROOT, rel))));

const mutated = (entries, dir, rel) => ((r) => (assert.ok(r.ok, `${rel} applies: ${JSON.stringify(r.drift)}`), r.entries))(mutatedEntries(entries, mutationFile(dir, rel)));

function treeOf(t, entries) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-bench-tree-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const e of entries) (mkdirSync(dirname(join(dir, e.rel)), { recursive: true }), writeFileSync(join(dir, e.rel), e.bytes));
  return dir;
}

function judged(t, caseDir, spec, entries, seed = 4242) {
  const cases = spec.cases(seed, 48);
  const r = spawnSync(process.execPath, [join(caseDir, "hidden", "probe.mjs"), treeOf(t, entries)], { input: probeInput(cases), env: sealed(), encoding: "utf8" });
  return judgedAll(cases, r.stdout, spec);
}

const failingGroups = (j) => [...new Set(j.checks.filter((c) => !c.ok).map((c) => c.group))].sort();

test("ORBIT-SRC-001 holds on the source as it is, and its reference model holds to the contract's own table", (t) => {
  const j = judged(t, CASE1, spec1, subject());
  assert.equal(j.error, null);
  assert.ok(j.checks.length >= 100, `${j.checks.length} checks`);
  assert.deepEqual(j.checks.filter((c) => !c.ok), []);
  assert.deepEqual(spec1.selfTest(), []);
});

test("the controlled fault fails every group it plants into, and is applied to a copy -- the repository's file never moves", (t) => {
  const before = sha(readFileSync(join(ROOT, "src/improvement/oracle.mjs")));
  const j = judged(t, CASE1, spec1, mutated(subject(), CASE1, "faults/controlled-fault.json"));
  for (const g of ["lower-bound-dropped", "lower-bound-raised", "upper-bound-raised", "upper-bound-dropped", "required-step-dropped"]) assert.ok(failingGroups(j).includes(g), g);
  assert.equal(sha(readFileSync(join(ROOT, "src/improvement/oracle.mjs"))), before);
});

test("a partial fix still fails: one planted defect repaired leaves the other two failing", (t) => {
  const fault = mutated(subject(), CASE1, "faults/controlled-fault.json");
  const groups = failingGroups(judged(t, CASE1, spec1, mutated(fault, CASE1, "controls/partial-fix.json")));
  assert.ok(!groups.includes("lower-bound-dropped") && !groups.includes("lower-bound-raised"), "the repaired defect holds");
  assert.ok(groups.includes("upper-bound-raised") && groups.includes("required-step-dropped"), "the others still fail");
});

test("an oracle that allows everything and one that refuses everything both fail, each on the side it gives away", (t) => {
  const allow = failingGroups(judged(t, CASE1, spec1, mutated(subject(), CASE1, "controls/allow-all.json")));
  const reject = failingGroups(judged(t, CASE1, spec1, mutated(subject(), CASE1, "controls/reject-all.json")));
  assert.ok(allow.includes("lower-bound-dropped") && allow.includes("approval-dropped") && !allow.includes("lower-bound-raised"), allow.join(","));
  assert.ok(reject.includes("lower-bound-raised") && reject.includes("bound-unchanged") && reject.includes("output-moved"), reject.join(","));
});

test("ORBIT-SRC-002 fails on the source as it is -- a removed step a person approved goes unnoticed -- and a reference repair passes it and ORBIT-SRC-001 alike", (t) => {
  const main = judged(t, CASE2, spec2, subject());
  assert.deepEqual(failingGroups(main).filter((g) => g !== "seeded-workflow"), ["optional-approval-removed", "optional-approval-renamed", "safety-approval-removed"]);
  const fixed = mutated(subject(), CASE2, "controls/known-good.json");
  assert.deepEqual(judged(t, CASE2, spec2, fixed).checks.filter((c) => !c.ok), []);
  assert.deepEqual(judged(t, CASE1, spec1, fixed).checks.filter((c) => !c.ok), [], "the repair weakens nothing ORBIT-SRC-001 holds");
  assert.deepEqual(spec2.selfTest(), []);
});

test("ORBIT-SRC-002's allow-all and reject-all controls fail too", (t) => {
  assert.ok(failingGroups(judged(t, CASE2, spec2, mutated(subject(), CASE2, "controls/allow-all.json"))).includes("optional-approval-removed"));
  assert.ok(failingGroups(judged(t, CASE2, spec2, mutated(subject(), CASE2, "controls/reject-all.json"))).includes("plain-optional-removed"));
});

test("a probe is handed inputs, never what they are expected to come to", () => {
  const sent = JSON.parse(probeInput(spec1.cases(7, 48)));
  assert.ok(sent.inputs.length > 0);
  assert.ok(sent.inputs.every((i) => !("expect" in i) && typeof i.id === "string" && typeof i.call === "string"));
});

test("the same seed makes the same checks, another seed other thresholds; boundaries are always among them", () => {
  assert.deepEqual(spec1.cases(11, 48), spec1.cases(11, 48));
  assert.notDeepEqual(spec1.cases(11, 48), spec1.cases(12, 48));
  const values = spec1.pairsOf(spec1.mulberry32(5), 12).flat();
  for (const want of [0, -1, Number.MAX_SAFE_INTEGER, 0.1 + 0.2]) assert.ok(values.includes(want), String(want));
  assert.ok(values.some((v) => v < 0) && values.some((v) => !Number.isInteger(v)) && values.every(Number.isFinite));
});

test("a subject whose modules cannot be loaded, or lack what the case declares, answers nothing -- and nothing passes", (t) => {
  const broken = subject().map((e) => (e.rel.endsWith("oracle.mjs") ? { ...e, bytes: Buffer.from("export const oracleOf = (;\n") } : e));
  const j = judged(t, CASE1, spec1, broken);
  assert.equal(j.error.code, "IMPORT");
  assert.ok(j.checks.every((c) => !c.ok));
  const missing = judged(t, CASE1, spec1, subject().map((e) => (e.rel.endsWith("oracle.mjs") ? { ...e, bytes: Buffer.from("export const oracleOf = () => null;\nexport const weakenings = undefined;\n") } : e)));
  assert.equal(missing.error.code, "MISSING_EXPORT");
  assert.ok(missing.error.names.includes("src/improvement/oracle.mjs#weakenings"));
});
