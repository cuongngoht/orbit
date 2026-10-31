// BENCHMARK PACKS: what a benchmark case IS, declared once as fields and held to that declaration by the enforcement
// every Orbit table uses (src/constraints.mjs). A pack is a directory under benchmark/packs/ with a pack.json naming its
// cases; a case is a directory of that pack holding a case.json, the public request a repair is asked with, and what
// only the verifier reads: a hidden spec (the judge), a probe (what runs the subject's code), faults a variant plants
// and controls that prove the verifier. Adding a case is adding a directory and one line in pack.json; nothing here
// names a case, a module of the engine or a check.
//
//   packsIn(root) -> [{ id, version, title, dir, cases }]          caseOf(root, id) -> case + { dir, pack }
//   caseFindings(c, dir) -> [sentence]                             dirDigest(dir) -> sha256 of every file, by path
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { constraintFindings, missingFindings } from "../../src/constraints.mjs";
import { Refused } from "../../src/errors.mjs";
import { treeDigest, treeDigests, treeFiles } from "../../src/store/tree.mjs";
import { realIo } from "../../src/store/io.mjs";
import { safeRel } from "./paths.mjs";

export const PACKS_DIR = join("benchmark", "packs");

const TEXT = { type: "string", pattern: "\\S" };
const REL = { type: "string", pattern: "^[A-Za-z0-9_.][A-Za-z0-9._/-]*$", says: { pattern: "a file of the case, relative to its directory" } };
const NAME = { type: "string", pattern: "^[a-z][a-z0-9-]{0,39}$" };
const LIST = { type: "array", items: { type: "string" } };

export const CASE_FIELDS = {
  schema: { type: "integer", enum: [1] },
  id: { type: "string", pattern: "^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$", says: { pattern: "id is upper-case words joined by dashes, such as ORBIT-SRC-001" } },
  version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" },
  title: TEXT,
  goal: TEXT,
  measures: { type: "object" },
  subject: { type: "object" },
  prepare: { type: "object" },
  request: REL,
  reproduce: TEXT,
  acceptance: { type: "object" },
  scope: { type: "object" },
  checks: { type: "object" },
  limits: { type: "object" },
  artifacts: LIST,
  cleanup: { type: "object" },
  variants: { type: "object", minProperties: 1 },
  controls: { type: "array" },
};

const BOX = { cpus: { type: "number", minimum: 0.5, maximum: 16 }, memoryMb: { type: "integer", minimum: 256, maximum: 65536 }, pids: { type: "integer", minimum: 64, maximum: 65536 }, minutes: { type: "integer", minimum: 1, maximum: 480 }, seconds: { type: "integer", minimum: 5, maximum: 7200 }, outputMb: { type: "integer", minimum: 1, maximum: 256 } };

// Every object a case holds, as a section: where it is, the fields it may have and the ones it must.
export const SECTIONS = [
  { at: "case", of: (c) => [c], fields: CASE_FIELDS, required: Object.keys(CASE_FIELDS) },
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
  { at: "cleanup", of: (c) => [c.cleanup], fields: { containers: { type: "string", enum: ["run-label"] }, networks: { type: "string", enum: ["run-label"] }, scratch: { type: "string", enum: ["after-run", "keep"] } }, required: ["containers", "networks", "scratch"] },
  { at: "variants.*", of: (c) => Object.values(c.variants ?? {}), fields: { faults: REL }, required: [] },
  { at: "controls[]", of: (c) => c.controls ?? [], fields: { id: NAME, variant: NAME, file: REL, expect: { type: "string", enum: ["PASS", "FAIL"] } }, required: ["id", "variant", "expect"] },
];

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const unknownOf = (s, record) => (isObject(record) ? Object.keys(record).filter((k) => !Object.hasOwn(s.fields, k)).map((k) => `${s.at}: takes no ${k}`) : []);

const sectionFindings = (s, c) => s.of(c).filter((r) => r !== undefined).flatMap((r) => (isObject(r) ? [...unknownOf(s, r), ...missingFindings(s.required, r, s.at), ...constraintFindings(s.fields, r, s.at)] : [`${s.at}: must be an object`]));

const filesNamed = (c) => [c.request, c.acceptance?.spec, c.acceptance?.probe, ...Object.values(c.variants ?? {}).map((v) => v?.faults), ...(c.controls ?? []).map((k) => k?.file)].filter((f) => typeof f === "string");

const duplicates = (ids) => ids.filter((id, i) => ids.indexOf(id) !== i);

// What a case must be beyond its fields: the files it names are its own and there, its real variant exists, every
// control runs on a declared variant, and no two gates or controls share an id.
const CROSS = [
  { fails: (c, dir) => filesNamed(c).filter((f) => !safeRel(f) || !existsSync(join(dir, f))), say: (bad) => `names files it does not hold: ${bad.join(", ")}` },
  { fails: (c) => (isObject(c.variants) && !Object.hasOwn(c.variants, "real") ? ["real"] : []), say: () => "has no `real` variant: the source as it is must always be measurable" },
  { fails: (c) => (c.controls ?? []).filter((k) => isObject(c.variants) && !Object.hasOwn(c.variants, k?.variant)).map((k) => k?.id), say: (bad) => `controls on a variant it does not declare: ${bad.join(", ")}` },
  { fails: (c) => duplicates([...(c.checks?.gates ?? []).map((g) => g?.id), ...(c.controls ?? []).map((k) => k?.id)]), say: (bad) => `ids used twice: ${bad.join(", ")}` },
  { fails: (c) => (c.scope?.allow ?? []).filter((g) => typeof g !== "string" || g.startsWith("/") || g.split("/").includes("..")), say: (bad) => `scope globs reach outside the repository: ${bad.join(", ")}` },
];

const crossFindings = (c, dir) => CROSS.map((r) => [r, r.fails(c, dir)]).filter(([, bad]) => bad.length).map(([r, bad]) => `case: ${r.say(bad)}`);

export const caseFindings = (c, dir) => (isObject(c) ? [...SECTIONS.flatMap((s) => sectionFindings(s, c)), ...crossFindings(c, dir)] : ["case: case.json must hold one object"]);

function jsonAt(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { throw new Refused(`${file} is not a JSON document this harness can read (${e.code ?? e.message})`); }
}

const PACK_FIELDS = { schema: { type: "integer", enum: [1] }, id: NAME, version: CASE_FIELDS.version, title: TEXT, cases: { ...LIST, minItems: 1 } };

const packFindings = (p) => (isObject(p) ? [...unknownOf({ at: "pack", fields: PACK_FIELDS }, p), ...missingFindings(Object.keys(PACK_FIELDS), p, "pack"), ...constraintFindings(PACK_FIELDS, p, "pack")] : ["pack: pack.json must hold one object"]);

function packAt(dir) {
  const p = jsonAt(join(dir, "pack.json"));
  const findings = packFindings(p);
  if (findings.length) throw new Refused(`${join(dir, "pack.json")} does not hold: ${findings.join("; ")}`);
  return { ...p, dir };
}

const packDirs = (root) => (existsSync(join(root, PACKS_DIR)) ? readdirSync(join(root, PACKS_DIR), { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(root, PACKS_DIR, e.name, "pack.json"))).map((e) => join(root, PACKS_DIR, e.name)) : []);

export const packsIn = (root) => packDirs(root).map(packAt).sort((a, b) => a.id.localeCompare(b.id, "en"));

const packOfCase = (root, id) => packsIn(root).find((p) => p.cases.includes(id)) ?? null;

export function caseOf(root, id) {
  const pack = packOfCase(root, id);
  if (!pack) throw new Refused(`no pack names a case ${id} — node benchmark/run.mjs list shows the ones there are`);
  return loadedCase(join(pack.dir, id), pack, id);
}

function loadedCase(dir, pack, id) {
  const c = jsonAt(join(dir, "case.json"));
  const findings = [...caseFindings(c, dir), ...(c?.id === id ? [] : [`case: its id is ${c?.id}, and its directory and pack name it ${id}`])];
  if (findings.length) throw new Refused(`${id} is not a benchmark case this harness can run: ${findings.join("; ")}`);
  return { ...c, dir, pack: { id: pack.id, version: pack.version, dir: pack.dir } };
}

export const casesOf = (root, packId) => ((p) => (p ? p.cases.map((id) => loadedCase(join(p.dir, id), p, id)) : []))(packsIn(root).find((x) => x.id === packId));

// One digest for a directory: every file, by its path and its bytes -- the same files are the same digest wherever
// the directory sits, and a link is never followed.
export const dirDigest = (dir, io = realIo()) => treeDigest(treeDigests(dir, treeFiles(dir), io));
