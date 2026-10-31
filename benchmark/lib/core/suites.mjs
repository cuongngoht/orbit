// BENCHMARK SUITES: what a benchmark case IS, declared once as fields and held to that declaration by the enforcement
// every Orbit table uses (src/constraints.mjs). A suite is a directory under benchmark/suites/ with a suite.json naming
// its cases; a case is a directory of that suite, named by its id in lower case, holding a case.json, the public
// request a host is given, what only the verifier reads (verifier/), the mutations a variant plants (variants/) and
// the controls that prove the verifier (controls/). Adding a case is adding a directory and one line in suite.json;
// nothing here names a case, a module of the engine or a check.
//
// A case is one of two KINDS. A `source` case holds Orbit's own source to independent checks, and may hand a failure
// to Orbit to repair through its engineering loop. A `qa` case asks whether Orbit's autonomous QA finds the defect
// planted in an application: the application, the variant that plants it and the ground truth are the case's.
//
//   suitesIn(root) -> [{ id, version, title, dir, cases }]         caseOf(root, id) -> case + { dir, suite }
//   caseFindings(c, dir) -> [sentence]                             dirDigest(dir) -> sha256 of every file, by path
//   KINDS · TRUTH_OUTCOMES · QA_HOSTS · caseDir(id)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { constraintFindings, missingFindings } from "../../../src/constraints.mjs";
import { Refused } from "../../../src/errors.mjs";
import { treeDigest, treeDigests, treeFiles } from "../../../src/store/tree.mjs";
import { realIo } from "../../../src/store/io.mjs";
import { safeRel } from "./paths.mjs";

export const SUITES_DIR = join("benchmark", "suites");

// A case's directory: its id in lower case, so no two cases differ only by case on a file system that folds it.
export const caseDir = (id) => String(id).toLowerCase();

const TEXT = { type: "string", pattern: "\\S" };
const REL = { type: "string", pattern: "^[A-Za-z0-9_.][A-Za-z0-9._/-]*$", says: { pattern: "a file of the case, relative to its directory" } };
const NAME = { type: "string", pattern: "^[a-z][a-z0-9-]{0,39}$" };
const LIST = { type: "array", items: { type: "string" } };
const VERDICT = { type: "string", enum: ["PASS", "FAIL"] };

// What a verification of a generated test may come to, as the engine words it -- the words a QA case's truth uses.
export const TRUTH_OUTCOMES = ["SATISFIED", "CONTRADICTED", "INCONCLUSIVE", "EXECUTION_ERROR", "CAPABILITY_MISSING"];

// The scripted hosts a QA case's controls are run with (lib/qa/hosts.mjs): what the verifier must credit and refuse.
export const QA_HOSTS = ["reference", "idle", "false-alarm"];

const COMMON_FIELDS = {
  schema: { type: "integer", enum: [1] },
  kind: { type: "string", enum: ["source", "qa"] },
  id: { type: "string", pattern: "^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$", says: { pattern: "id is upper-case words joined by dashes, such as ORBIT-SRC-001" } },
  version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" },
  title: TEXT,
  goal: TEXT,
  measures: { type: "object" },
  request: REL,
  acceptance: { type: "object" },
  limits: { type: "object" },
  artifacts: LIST,
  cleanup: { type: "object" },
  controls: { type: "array" },
};

const SOURCE_FIELDS = { ...COMMON_FIELDS, subject: { type: "object" }, prepare: { type: "object" }, reproduce: TEXT, scope: { type: "object" }, checks: { type: "object" }, variants: { type: "object", minProperties: 1 } };

const QA_FIELDS = { ...COMMON_FIELDS, target: { type: "object" } };

const BOX = { cpus: { type: "number", minimum: 0.5, maximum: 16 }, memoryMb: { type: "integer", minimum: 256, maximum: 65536 }, pids: { type: "integer", minimum: 64, maximum: 65536 }, minutes: { type: "integer", minimum: 1, maximum: 480 }, seconds: { type: "integer", minimum: 5, maximum: 7200 }, outputMb: { type: "integer", minimum: 1, maximum: 256 } };

const LABELLED = { type: "string", enum: ["run-label"] };

const SCRATCH = { type: "string", enum: ["after-run", "keep"] };

// Every object a case holds, as a section: where it is, the fields it may have and the ones it must.
const SOURCE_SECTIONS = [
  { at: "case", of: (c) => [c], fields: SOURCE_FIELDS, required: Object.keys(SOURCE_FIELDS) },
  { at: "measures", of: (c) => [c.measures], fields: { kind: { type: "string", enum: ["correctness", "capability", "robustness"] }, capability: TEXT, repairable: LIST }, required: ["kind", "capability", "repairable"] },
  { at: "subject", of: (c) => [c.subject], fields: { paths: { ...LIST, minItems: 1 }, exports: { type: "object" } }, required: ["paths", "exports"] },
  { at: "prepare", of: (c) => [c.prepare], fields: { requires: LIST }, required: ["requires"] },
  { at: "acceptance", of: (c) => [c.acceptance], fields: { owner: { type: "string", enum: ["verifier"] }, spec: REL, probe: REL, samples: { type: "integer", minimum: 1, maximum: 512 } }, required: ["owner", "spec", "probe", "samples"] },
  { at: "scope", of: (c) => [c.scope], fields: { allow: { ...LIST, minItems: 1 }, deny: LIST }, required: ["allow", "deny"] },
  { at: "checks", of: (c) => [c.checks], fields: { gates: { type: "array" }, agentTests: { type: "object" } }, required: ["gates", "agentTests"] },
  { at: "checks.gates[]", of: (c) => c.checks?.gates ?? [], fields: { id: NAME, argv: { ...LIST, minItems: 1 }, stdout: { type: "string" } }, required: ["id", "argv"] },
  { at: "checks.agentTests", of: (c) => [c.checks?.agentTests], fields: { required: { type: "boolean" }, pattern: { type: "string" } }, required: ["required", "pattern"] },
  { at: "limits", of: (c) => [c.limits], fields: { rounds: { type: "integer", minimum: 1, maximum: 5 }, minutes: { type: "integer", minimum: 5, maximum: 600 }, usd: { type: "number", minimum: 0, maximum: 200 }, runner: { type: "object" }, verifier: { type: "object" }, engineering: { type: "object" } }, required: ["rounds", "minutes", "usd", "runner", "verifier", "engineering"] },
  { at: "limits.runner", of: (c) => [c.limits?.runner], fields: BOX, required: ["cpus", "memoryMb", "pids", "minutes", "outputMb"] },
  { at: "limits.verifier", of: (c) => [c.limits?.verifier], fields: BOX, required: ["cpus", "memoryMb", "pids", "seconds"] },
  { at: "limits.engineering", of: (c) => [c.limits?.engineering], fields: { attempts: { type: "integer", minimum: 1, maximum: 20 }, actions: { type: "integer", minimum: 10, maximum: 500 } }, required: ["attempts", "actions"] },
  { at: "cleanup", of: (c) => [c.cleanup], fields: { containers: LABELLED, networks: LABELLED, scratch: SCRATCH }, required: ["containers", "networks", "scratch"] },
  { at: "variants.*", of: (c) => Object.values(c.variants ?? {}), fields: { mutations: REL }, required: [] },
  { at: "controls[]", of: (c) => c.controls ?? [], fields: { id: NAME, variant: NAME, file: REL, expect: VERDICT }, required: ["id", "variant", "expect"] },
];

const QA_SECTIONS = [
  { at: "case", of: (c) => [c], fields: QA_FIELDS, required: Object.keys(QA_FIELDS) },
  { at: "measures", of: (c) => [c.measures], fields: { kind: { type: "string", enum: ["detection"] }, capability: TEXT }, required: ["kind", "capability"] },
  { at: "target", of: (c) => [c.target], fields: { app: NAME, stack: NAME, variant: NAME, clean: NAME, plan: NAME, mode: { type: "string", enum: ["observe", "fixture-write"] }, withheld: { ...LIST, minItems: 1 } }, required: ["app", "stack", "variant", "clean", "plan", "mode", "withheld"] },
  { at: "acceptance", of: (c) => [c.acceptance], fields: { owner: { type: "string", enum: ["verifier"] }, truth: REL, minCoverage: { type: "number", minimum: 0, maximum: 1 } }, required: ["owner", "truth", "minCoverage"] },
  { at: "limits", of: (c) => [c.limits], fields: { rounds: { type: "integer", minimum: 1, maximum: 3 }, minutes: { type: "integer", minimum: 10, maximum: 600 }, usd: { type: "number", minimum: 0, maximum: 200 }, runner: { type: "object" }, engine: { type: "object" } }, required: ["rounds", "minutes", "usd", "runner", "engine"] },
  { at: "limits.runner", of: (c) => [c.limits?.runner], fields: BOX, required: ["cpus", "memoryMb", "pids", "minutes", "outputMb"] },
  { at: "limits.engine", of: (c) => [c.limits?.engine], fields: { stepSeconds: { type: "integer", minimum: 30, maximum: 3600 }, callSeconds: { type: "integer", minimum: 10, maximum: 600 } }, required: ["stepSeconds", "callSeconds"] },
  { at: "cleanup", of: (c) => [c.cleanup], fields: { containers: LABELLED, networks: LABELLED, sandbox: { type: "string", enum: ["release"] }, scratch: SCRATCH }, required: ["containers", "networks", "sandbox", "scratch"] },
  { at: "controls[]", of: (c) => c.controls ?? [], fields: { id: NAME, host: { type: "string", enum: QA_HOSTS }, expect: VERDICT }, required: ["id", "host", "expect"] },
];

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const unknownOf = (s, record) => (isObject(record) ? Object.keys(record).filter((k) => !Object.hasOwn(s.fields, k)).map((k) => `${s.at}: takes no ${k}`) : []);

const sectionFindings = (s, c) => s.of(c).filter((r) => r !== undefined).flatMap((r) => (isObject(r) ? [...unknownOf(s, r), ...missingFindings(s.required, r, s.at), ...constraintFindings(s.fields, r, s.at)] : [`${s.at}: must be an object`]));

const duplicates = (ids) => ids.filter((id, i) => ids.indexOf(id) !== i);

const missingFiles = (dir, files) => files.filter((f) => typeof f === "string").filter((f) => !safeRel(f) || !existsSync(join(dir, f)));

const sourceFiles = (c) => [c.request, c.acceptance?.spec, c.acceptance?.probe, ...Object.values(c.variants ?? {}).map((v) => v?.mutations), ...(c.controls ?? []).map((k) => k?.file)];

const unsafeGlobs = (globs) => (globs ?? []).filter((g) => typeof g !== "string" || g.startsWith("/") || g.split("/").includes(".."));

// What a source case must be beyond its fields: the files it names are its own and there, its real variant exists,
// every control runs on a declared variant, and no two gates or controls share an id.
const SOURCE_CROSS = [
  { fails: (c, dir) => missingFiles(dir, sourceFiles(c)), say: (bad) => `names files it does not hold: ${bad.join(", ")}` },
  { fails: (c) => (isObject(c.variants) && !Object.hasOwn(c.variants, "real") ? ["real"] : []), say: () => "has no `real` variant: the source as it is must always be measurable" },
  { fails: (c) => (c.controls ?? []).filter((k) => isObject(c.variants) && !Object.hasOwn(c.variants, k?.variant)).map((k) => k?.id), say: (bad) => `controls on a variant it does not declare: ${bad.join(", ")}` },
  { fails: (c) => duplicates([...(c.checks?.gates ?? []).map((g) => g?.id), ...(c.controls ?? []).map((k) => k?.id)]), say: (bad) => `ids used twice: ${bad.join(", ")}` },
  { fails: (c) => unsafeGlobs(c.scope?.allow), say: (bad) => `scope globs reach outside the repository: ${bad.join(", ")}` },
];

// A QA case's ground truth: which verification each test shape must come to on the planted variant, SATISFIED
// unless it says otherwise -- the engine's own words, over shapes the case names.
const TRUTH_FIELDS = { schema: { type: "integer", enum: [1] }, from: { type: "object" }, default: { type: "string", enum: TRUTH_OUTCOMES }, shapes: { ...LIST, minItems: 1 }, expect: { type: "object" } };

function readTruth(dir, rel) {
  try { return JSON.parse(readFileSync(join(dir, rel), "utf8")); }
  catch { return null; }
}

const expectFindings = (t) => Object.entries(isObject(t.expect) ? t.expect : {}).filter(([shape, word]) => !(t.shapes ?? []).includes(shape) || !TRUTH_OUTCOMES.includes(word)).map(([shape]) => `truth: expect.${shape} is not a shape it names, or not one of ${TRUTH_OUTCOMES.join(", ")}`);

export const truthFindings = (t) => (isObject(t) ? [...unknownOf({ at: "truth", fields: TRUTH_FIELDS }, t), ...missingFindings(Object.keys(TRUTH_FIELDS), t, "truth"), ...constraintFindings(TRUTH_FIELDS, t, "truth"), ...expectFindings(t)] : ["truth: the truth file must hold one object"]);

const truthOf = (c, dir) => (typeof c.acceptance?.truth === "string" && safeRel(c.acceptance.truth) ? readTruth(dir, c.acceptance.truth) : null);

// What a QA case must be beyond its fields: its files are there, its truth holds and is the truth of the variant it
// plants, what it withholds from the host stays inside the repository, and no two controls share an id.
const QA_CROSS = [
  { fails: (c, dir) => missingFiles(dir, [c.request, c.acceptance?.truth]), say: (bad) => `names files it does not hold: ${bad.join(", ")}` },
  { fails: (c, dir) => (missingFiles(dir, [c.acceptance?.truth]).length ? [] : truthFindings(truthOf(c, dir))), say: (bad) => bad.join("; ") },
  { fails: (c, dir) => ((t) => (t && (t.from?.stack !== c.target?.stack || t.from?.variant !== c.target?.variant) ? ["its truth is another stack's or variant's"] : []))(truthOf(c, dir)), say: (bad) => bad.join("") },
  { fails: (c) => unsafeGlobs(c.target?.withheld), say: (bad) => `withheld globs reach outside the repository: ${bad.join(", ")}` },
  { fails: (c) => duplicates((c.controls ?? []).map((k) => k?.id)), say: (bad) => `control ids used twice: ${bad.join(", ")}` },
];

export const KINDS = { source: { sections: SOURCE_SECTIONS, cross: SOURCE_CROSS }, qa: { sections: QA_SECTIONS, cross: QA_CROSS } };

const crossFindings = (kind, c, dir) => kind.cross.map((r) => [r, r.fails(c, dir)]).filter(([, bad]) => bad.length).map(([r, bad]) => `case: ${r.say(bad)}`);

const kindFindings = (kind, c, dir) => [...kind.sections.flatMap((s) => sectionFindings(s, c)), ...crossFindings(kind, c, dir)];

export const caseFindings = (c, dir) => (!isObject(c) ? ["case: case.json must hold one object"] : Object.hasOwn(KINDS, c.kind) ? kindFindings(KINDS[c.kind], c, dir) : [`case: kind is one of ${Object.keys(KINDS).join(", ")}`]);

function jsonAt(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { throw new Refused(`${file} is not a JSON document this harness can read (${e.code ?? e.message})`); }
}

const SUITE_FIELDS = { schema: { type: "integer", enum: [1] }, id: NAME, version: COMMON_FIELDS.version, title: TEXT, cases: { ...LIST, minItems: 1 } };

const suiteFindings = (p) => (isObject(p) ? [...unknownOf({ at: "suite", fields: SUITE_FIELDS }, p), ...missingFindings(Object.keys(SUITE_FIELDS), p, "suite"), ...constraintFindings(SUITE_FIELDS, p, "suite")] : ["suite: suite.json must hold one object"]);

function suiteAt(dir) {
  const p = jsonAt(join(dir, "suite.json"));
  const findings = suiteFindings(p);
  if (findings.length) throw new Refused(`${join(dir, "suite.json")} does not hold: ${findings.join("; ")}`);
  return { ...p, dir };
}

const suiteDirs = (root) => (existsSync(join(root, SUITES_DIR)) ? readdirSync(join(root, SUITES_DIR), { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(root, SUITES_DIR, e.name, "suite.json"))).map((e) => join(root, SUITES_DIR, e.name)) : []);

export const suitesIn = (root) => suiteDirs(root).map(suiteAt).sort((a, b) => a.id.localeCompare(b.id, "en"));

const suiteOfCase = (root, id) => suitesIn(root).find((p) => p.cases.some((x) => caseDir(x) === caseDir(id))) ?? null;

export function caseOf(root, id) {
  const suite = suiteOfCase(root, id);
  if (!suite) throw new Refused(`no suite names a case ${id} — node benchmark/run.mjs list shows the ones there are`);
  return loadedCase(suite, suite.cases.find((x) => caseDir(x) === caseDir(id)));
}

function loadedCase(suite, id) {
  const dir = join(suite.dir, caseDir(id));
  const c = jsonAt(join(dir, "case.json"));
  const findings = [...caseFindings(c, dir), ...(c?.id === id ? [] : [`case: its id is ${c?.id}, and its suite names it ${id}`])];
  if (findings.length) throw new Refused(`${id} is not a benchmark case this harness can run: ${findings.join("; ")}`);
  return { ...c, dir, suite: { id: suite.id, version: suite.version, dir: suite.dir } };
}

export const casesOf = (root, suiteId) => ((p) => (p ? p.cases.map((id) => loadedCase(p, id)) : []))(suitesIn(root).find((x) => x.id === suiteId));

// One digest for a directory: every file, by its path and its bytes -- the same files are the same digest wherever
// the directory sits, and a link is never followed.
export const dirDigest = (dir, io = realIo()) => treeDigest(treeDigests(dir, treeFiles(dir), io));
