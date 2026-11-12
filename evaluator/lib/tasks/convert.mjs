// THE PACK CONVERTER: turns a CHANGE case of the old in-repo benchmark (a fixture, a `real` variant that takes one
// behaviour away, a request, a hidden spec and probe, a reference solution and controls) into a local task pack of
// this evaluator -- by READING its files as data, never importing them. Run once, while the old benchmark is still
// there; what it writes is committed under tasks/packs/ and needs nothing of the source afterwards.
//
// A pack holds the starting repository as data (start.json, so no test file of the pack is a test file of this
// repository), the request verbatim (issue.md), the hidden fail-to-pass tests (the public test files the variant
// removed, and the case's spec and probe behind one generic node test), the pass-to-pass test files (every public test
// the start keeps), and control patches: gold (the reference solution), half, cheat, and two the evaluator derives the
// same way for every pack -- tamper (no fix, every graded test file replaced by one that passes) and regress (the gold
// patch, a module a pass-to-pass test imports emptied, and that test deleted).
//
//   convertCase(benchDir, suite, caseDir, outRoot) -> { id, excluded? }      packIdOf(c) -> id
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { builtRepo, gitMust } from "../core/git.mjs";
import { EVALUATOR_DIR, sha256, writeJson } from "../core/util.mjs";

export const SEED = 20261112;

const json = (file) => JSON.parse(readFileSync(file, "utf8"));

const walk = (dir, base = dir) => readdirSync(dir).flatMap((n) => ((p) => (statSync(p).isDirectory() ? walk(p, base) : [relative(base, p)]))(join(dir, n)));

// The fixture as a project checkout: its own files, its public checks renamed to test/<name>.test.mjs.
function fixtureFiles(benchDir, fixture) {
  const root = join(benchDir, "fixtures", fixture);
  const t = json(join(root, "fixture.json")).tests;
  const renamed = (rel) => (rel.startsWith(t.from) && rel.endsWith(".mjs") ? `${t.to}${rel.slice(t.from.length, -".mjs".length)}${t.suffix}` : rel);
  return walk(root).filter((rel) => rel !== "fixture.json").sort().map((rel) => ({ rel: renamed(rel), text: readFileSync(join(root, rel), "utf8") }));
}

// ---- a candidate's mutations, files and deletes over a list of files --------------------------------------------------------

const occurrences = (text, find) => text.split(find).length - 1;

function mutated(files, m) {
  const f = files.find((x) => x.rel === m.file);
  const found = f ? occurrences(f.text, m.find) : 0;
  if (found !== m.count) throw new Error(`mutation ${m.id} on ${m.file}: expected ${m.count} match(es), found ${found} -- the fixture moved under it`);
  return files.map((x) => (x.rel === m.file ? { ...x, text: x.text.split(m.find).join(m.replace) } : x));
}

const lined = (f) => ({ rel: f.rel, text: f.lines.map((l) => `${l}\n`).join("") });

export function applied(files, doc) {
  for (const rel of doc.deletes ?? []) if (!files.some((f) => f.rel === rel)) throw new Error(`delete ${rel}: no such file`);
  const after = (doc.mutations ?? []).reduce(mutated, files);
  const brought = (doc.files ?? []).map(lined);
  return [...after.filter((f) => !(doc.deletes ?? []).includes(f.rel) && !brought.some((b) => b.rel === f.rel)), ...brought].sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

// ---- patches, made by git between the start and a candidate -----------------------------------------------------------------

function patchOf(start, files) {
  const dir = mkdtempSync(join(tmpdir(), "evl-conv-"));
  try {
    builtRepo(dir, start);
    for (const f of start) rmSync(join(dir, f.rel), { force: true });
    for (const f of files) (mkdirSync(join(dir, f.rel, ".."), { recursive: true }), writeFileSync(join(dir, f.rel), f.text));
    gitMust(["add", "-A"], { cwd: dir });
    return gitMust(["diff", "--cached", "--binary", "--full-index", "HEAD"], { cwd: dir }).out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const isTest = (rel) => /^test\/[^/]+\.test\.mjs$/.test(rel);

const srcOnly = (files) => JSON.stringify(files.filter((f) => !isTest(f.rel)));

// The old benchmark refused a cheat by its scope rule; this evaluator grades only by hidden tests, with every graded test
// file put back as the start had it -- so a cheat that carries the reference change and only edits a test resolves.
const CHEAT_NOTE = "graded by the hidden tests alone, every graded test file restored from the start: RESOLVED when the cheat carries the reference change (its test edit is undone), NOT_RESOLVED otherwise";

const STUB = 'import { test } from "node:test";\n\ntest("passes", () => {});\n';

// The tamper control: nothing fixed, and every file the grader will run replaced (or created) by one that passes.
const tampered = (start, graded) => [...start.filter((f) => !graded.includes(f.rel)), ...graded.map((rel) => ({ rel, text: STUB }))];

// A test's import of a module of the project's own src/ (written so that this file names no module itself).
const IMPORTED = /from\s["]\.\.\/(src\/[^"]+\.mjs)["]/;

// The regress control: the gold change, a module the first pass-to-pass test imports emptied, and that test deleted.
function regressed(gold, p2p) {
  const test = p2p.map((rel) => gold.find((f) => f.rel === rel)).find((f) => f && IMPORTED.test(f.text));
  const mod = IMPORTED.exec(test.text)[1];
  return { files: gold.filter((f) => f.rel !== test.rel).map((f) => (f.rel === mod ? { ...f, text: "export {};\n" } : f)), test: test.rel, module: mod };
}

// ---- one case -----------------------------------------------------------------------------------------------------------------

export const packIdOf = (c) => `${c.fixture}-${c.id.toLowerCase().replace(/^orbit-/, "")}`;

const ACCEPTANCE = "acceptance";

const hiddenTarget = (name) => `test/${name}.test.mjs`;

function excludedWhy(c, seen, startDigest) {
  if (c.measures?.expects !== "change") return `its correct outcome is to ${c.measures?.expects === "blocked" ? "refuse and stop" : c.measures?.expects}: the request leaves out a rule it needs, and a single headless run cannot receive a person's answer`;
  if (!c.variants?.real?.mutations) return "it has no `real` variant to start from";
  const twin = seen.get(startDigest);
  return twin ? `its request, starting tree and hidden checks are the same as ${twin}'s; what made it a case of its own (a session cut mid-work) is not a property of the task` : null;
}

export function convertCase(benchDir, suite, caseDirName, outRoot, seen = new Map()) {
  const caseDir = join(benchDir, "suites", suite, caseDirName);
  const c = json(join(caseDir, "case.json"));
  const id = packIdOf(c);
  const solved = fixtureFiles(benchDir, c.fixture);
  const real = c.variants?.real?.mutations ? json(join(caseDir, c.variants.real.mutations)) : null;
  const start = real ? applied(solved, real) : solved;
  const issue = readFileSync(join(caseDir, c.request), "utf8");
  const startDigest = sha256(JSON.stringify([start, issue, readFileSync(join(caseDir, c.acceptance.probe), "utf8")]));
  const why = excludedWhy(c, seen, startDigest);
  if (why) return { id, case: c.id, excluded: why };
  seen.set(startDigest, id);
  return { id, case: c.id, ...writtenPack({ benchDir, suite, caseDir, c, id, solved, start, issue, real }, join(outRoot, id)) };
}

function writtenPack(x, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "hidden", ACCEPTANCE), { recursive: true });
  mkdirSync(join(dir, "controls"), { recursive: true });
  const removedTests = (x.real.deletes ?? []).filter(isTest);
  const f2p = [...removedTests.map((rel) => ({ name: rel.slice(5, -".test.mjs".length), file: `${rel.slice(5, -".test.mjs".length)}.spec.mjs` })), { name: `eval-${ACCEPTANCE}`, file: `${ACCEPTANCE}.spec.mjs` }].map((t) => ({ ...t, target: hiddenTarget(t.name) }));
  for (const rel of removedTests) writeFileSync(join(dir, "hidden", `${rel.slice(5, -".test.mjs".length)}.spec.mjs`), x.solved.find((f) => f.rel === rel).text);
  writeFileSync(join(dir, "hidden", `${ACCEPTANCE}.spec.mjs`), readFileSync(join(EVALUATOR_DIR, "lib", "tasks", "acceptance-template.mjs"), "utf8"));
  cpSync(join(x.caseDir, x.c.acceptance.spec), join(dir, "hidden", ACCEPTANCE, "spec.mjs"));
  cpSync(join(x.caseDir, x.c.acceptance.probe), join(dir, "hidden", ACCEPTANCE, "probe.mjs"));
  writeJson(join(dir, "hidden", ACCEPTANCE, "meta.json"), { seed: SEED, samples: x.c.acceptance.samples ?? 48, probeSeconds: 120 });
  const p2p = x.start.map((f) => f.rel).filter(isTest);
  writeFileSync(join(dir, "issue.md"), x.issue);
  writeJson(join(dir, "start.json"), { schema: 1, files: x.start });
  const controls = controlsOf(x, dir, f2p, p2p);
  writeJson(join(dir, "pack.json"), packJson(x, f2p, p2p, controls));
  return { controls: Object.keys(controls) };
}

function controlsOf(x, dir, f2p, p2p) {
  const ref = applied(x.start, json(join(x.caseDir, "controls", "reference.json")));
  const out = { gold: { expect: "RESOLVED", about: "the case's reference solution" } };
  writeFileSync(join(dir, "controls", "gold.patch"), patchOf(x.start, ref));
  for (const name of ["half", "cheat"]) {
    const file = join(x.caseDir, "controls", `${name}.json`);
    if (!existsSync(file)) continue;
    const doc = json(file);
    const files = applied(x.start, doc);
    writeFileSync(join(dir, "controls", `${name}.patch`), patchOf(x.start, files));
    out[name] = { expect: name === "cheat" && srcOnly(files) === srcOnly(ref) ? "RESOLVED" : "NOT_RESOLVED", about: doc.about, ...(name === "cheat" ? { graded: CHEAT_NOTE } : {}) };
  }
  const graded = [...f2p.map((t) => t.target), ...p2p];
  writeFileSync(join(dir, "controls", "tamper.patch"), patchOf(x.start, tampered(x.start, graded)));
  out.tamper = { expect: "NOT_RESOLVED", about: "nothing fixed; every test file the grader runs replaced or created by one that passes" };
  const r = regressed(ref, p2p);
  writeFileSync(join(dir, "controls", "regress.patch"), patchOf(x.start, r.files));
  out.regress = { expect: "REGRESSED", about: `the gold change, ${r.module} emptied, and ${r.test} (which imports it) deleted` };
  return out;
}

const packJson = (x, f2p, p2p, controls) => ({
  schema: 1,
  id: packIdOf(x.c),
  title: x.c.title,
  source: { kind: "orbit-benchmark-case", suite: x.suite, case: x.c.id, version: x.c.version, caseDigest: sha256(readFileSync(join(x.caseDir, "case.json"))) },
  fixture: x.c.fixture,
  image: "node:22",
  repo: "/work/repo",
  f2p,
  p2p,
  controls,
  grade: { perFileSeconds: 180, cpus: 2, memoryMb: 2048, pids: 512 },
});
