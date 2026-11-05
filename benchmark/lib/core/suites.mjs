// BENCHMARK SUITES: what a benchmark case IS, declared once as fields and held to that declaration by the enforcement
// every Orbit table uses (src/constraints.mjs). A suite is a directory under benchmark/suites/ with a suite.json naming
// its cases; a case is a directory of that suite, named by its id in lower case, holding a case.json, the public
// request a host is given, what only the verifier reads (verifier/), the mutations a variant plants (variants/) and
// the controls that prove the verifier (controls/). Adding a case is adding a directory and one line in suite.json;
// nothing here names a case, a module of the engine or a check.
//
// A case is one of three KINDS. A `source` case holds Orbit's own source to independent checks, and may hand a failure
// to Orbit to repair through its engineering loop. A `qa` case asks whether Orbit's autonomous QA finds the defect
// planted in an application: the application, the variant that plants it and the ground truth are the case's. An
// `engineering` case hands Orbit a GOAL over a frozen fixture repository (benchmark/fixtures/<fixture>/, its `real`
// variant taking one behaviour away) and judges what the goal left with the same probe, spec, gates and own-test proof
// a source case uses, plus record checks over what Orbit's owners recorded -- and whether the goal asks for a change or
// must be refused for want of a rule (`measures.expects`). An `activation` case (0.5.0, B22 M4) asks whether the host
// uses Orbit BY ITSELF: a prompt that names no skill, on arms with and without Orbit, held to a hidden truth of what a
// careful host does -- and, for an outcome case, the engineering kind's hidden checks on what it delivered.
//
//   suitesIn(root) -> [{ id, version, title, dir, cases }]         caseOf(root, id) -> case + { dir, suite }
//   suiteHolding(root, caseId) -> suite id | null
//   caseFindings(c, dir) -> [sentence]                             dirDigest(dir) -> sha256 of every file, by path
//   KINDS · TRUTH_OUTCOMES · QA_HOSTS · caseDir(id) · ARMS · DEFAULT_BASELINE · armsOf(c) · baselinePluginOf(c)
//   activationTruthFindings(t) -> [sentence]      activationTruthOf(c) -> truth | null      ACTIVATION_HOSTS · STRATEGIES
//   COORDINATIONS · TIERS · LANGUAGES · SWITCH_NAME · SELECTION_CAPS · RECORD_READS · NAMES_A_COMPONENT
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { constraintFindings, missingFindings } from "../../../src/constraints.mjs";
import { Refused } from "../../../src/errors.mjs";
import { treeDigest, treeDigests, treeFiles } from "../../../src/store/tree.mjs";
import { realIo } from "../../../src/store/io.mjs";
import { safeRel } from "./paths.mjs";
import { FAILURE_CLASSES } from "../source/classify.mjs";

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
  kind: { type: "string", enum: ["source", "qa", "engineering", "activation"] },
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

// What a source run of the case came to on the source as it is, when the case was written: a known finding says FAIL,
// so a report tells an expected failure from a regression, and a metric never counts a known finding as news.
const BASELINE = { type: "string", enum: ["PASS", "FAIL"] };

// What a repair control must earn: a candidate the verifier passes, one it rejects, or one that makes no progress.
export const REPAIR_OUTCOMES = ["REPAIRED_VERIFIED", "REPAIR_REJECTED", "NO_PROGRESS"];

// How a repair control is carried: straight to the JUDGE (the candidate built from its definition, no runner) or through
// Orbit's ENGINE (a scripted host drives the real engineering loop in the runner, no model).
export const REPAIR_THROUGH = ["judge", "engine"];

// What an engine-carried control's scripted host does (images/runner/scripted.mjs SCRIPTS): APPLY its definition
// through every step of the loop, or sit IDLE -- start nothing, change nothing -- which a verifier must never pass.
export const REPAIR_SCRIPTS = ["apply", "idle"];

const SOURCE_FIELDS = { ...COMMON_FIELDS, subject: { type: "object" }, prepare: { type: "object" }, reproduce: TEXT, scope: { type: "object" }, checks: { type: "object" }, variants: { type: "object", minProperties: 1 }, baseline: BASELINE, repairs: { type: "array" } };

// Fields a case may leave out: older cases (and the frozen copies older runs keep) have none of them.
const OPTIONAL = ["baseline", "repairs", "interrupt", "arms", "baselinePlugin"];

// THE ARMS a case may be compared on (0.5.0, B23), each handing the host a different plugin and nothing else different:
// `none` hands it no Orbit at all (no plugin, so no hooks and no trail), `baseline` the plugin frozen from a named git
// revision -- the previous release, `v0.4.0` unless the case or its suite names another (`baselinePlugin`) -- and
// `release` the run's own source, which is what every run was before arms. A case that declares no arms runs `release`.
export const ARMS = ["none", "baseline", "release"];

export const DEFAULT_BASELINE = "v0.4.0";

// A revision a baseline may be named by: a tag, a branch or a commit -- never an option, never a range.
const REVISION = { type: "string", pattern: "^(?!.*\\.\\.)[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$", says: { pattern: "baselinePlugin names a git revision: a tag, a branch or a commit id, never an option or a range" } };

const ARM_FIELDS = { arms: { type: "array", items: { type: "string", enum: ARMS }, minItems: 1 }, baselinePlugin: REVISION };

const requiredOf = (fields) => Object.keys(fields).filter((k) => !OPTIONAL.includes(k));

const QA_FIELDS = { ...COMMON_FIELDS, target: { type: "object" } };

const ENGINEERING_FIELDS = { ...COMMON_FIELDS, baseline: BASELINE, fixture: { type: "string", pattern: "^[a-z][a-z0-9-]{0,39}$" }, subject: { type: "object" }, reproduce: TEXT, scope: { type: "object" }, checks: { type: "object" }, variants: { type: "object", minProperties: 1 }, repairs: { type: "array" }, interrupt: { type: "object" }, ...ARM_FIELDS };

// What an engineering control must come to: the goal reached and verified, refused, no progress, or blocked.
export const GOAL_OUTCOMES = ["PASS", "FAIL", "NO_PROGRESS", "BLOCKED"];

// What an engineering control's scripted host does: drive the GOAL through Orbit's goal intake to a change, stop it as
// BLOCKED for want of a rule, INTERRUPT its own first round mid-check (the next round reconciles and goes on), or sit IDLE.
export const GOAL_SCRIPTS = ["goal", "blocked", "interrupt", "idle"];

const BOX = { cpus: { type: "number", minimum: 0.5, maximum: 16 }, memoryMb: { type: "integer", minimum: 256, maximum: 65536 }, pids: { type: "integer", minimum: 64, maximum: 65536 }, minutes: { type: "integer", minimum: 1, maximum: 480 }, seconds: { type: "integer", minimum: 5, maximum: 7200 }, outputMb: { type: "integer", minimum: 1, maximum: 256 } };

const LABELLED = { type: "string", enum: ["run-label"] };

const SCRATCH = { type: "string", enum: ["after-run", "keep"] };

// Every object a case holds, as a section: where it is, the fields it may have and the ones it must.
const SOURCE_SECTIONS = [
  { at: "case", of: (c) => [c], fields: SOURCE_FIELDS, required: requiredOf(SOURCE_FIELDS) },
  { at: "measures", of: (c) => [c.measures], fields: { kind: { type: "string", enum: ["correctness", "capability", "robustness"] }, capability: TEXT, repairable: LIST }, required: ["kind", "capability", "repairable"] },
  { at: "subject", of: (c) => [c.subject], fields: { paths: { ...LIST, minItems: 1 }, exports: { type: "object" } }, required: ["paths", "exports"] },
  { at: "prepare", of: (c) => [c.prepare], fields: { requires: LIST }, required: ["requires"] },
  { at: "acceptance", of: (c) => [c.acceptance], fields: { owner: { type: "string", enum: ["verifier"] }, spec: REL, probe: REL, samples: { type: "integer", minimum: 1, maximum: 512 } }, required: ["owner", "spec", "probe", "samples"] },
  { at: "scope", of: (c) => [c.scope], fields: { allow: { ...LIST, minItems: 1 }, deny: LIST, imports: LIST }, required: ["allow", "deny"] },
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
  { at: "repairs[]", of: (c) => c.repairs ?? [], fields: { id: NAME, variant: NAME, candidate: REL, through: { type: "string", enum: REPAIR_THROUGH }, expect: { type: "string", enum: REPAIR_OUTCOMES }, rejects: LIST, seconds: BOX.seconds, script: { type: "string", enum: REPAIR_SCRIPTS } }, required: ["id", "variant", "candidate", "through", "expect"] },
];

// An engineering case's sections: a source case's checks and limits, over a fixture's target instead of Orbit's source.
const sharedWith = (ats) => SOURCE_SECTIONS.filter((x) => ats.includes(x.at));

const ENGINEERING_SECTIONS = [
  { at: "case", of: (c) => [c], fields: ENGINEERING_FIELDS, required: requiredOf(ENGINEERING_FIELDS).concat(["baseline"]) },
  { at: "measures", of: (c) => [c.measures], fields: { kind: { type: "string", enum: ["engineering"] }, capability: TEXT, expects: { type: "string", enum: ["change", "blocked"] } }, required: ["kind", "capability", "expects"] },
  ...sharedWith(["subject", "acceptance", "scope", "checks", "checks.gates[]", "checks.agentTests", "limits", "limits.runner", "limits.verifier", "limits.engineering", "cleanup", "variants.*", "controls[]"]),
  { at: "repairs[]", of: (c) => c.repairs ?? [], fields: { id: NAME, variant: NAME, candidate: REL, through: { type: "string", enum: ["engine"] }, expect: { type: "string", enum: GOAL_OUTCOMES }, script: { type: "string", enum: GOAL_SCRIPTS } }, required: ["id", "variant", "candidate", "through", "expect", "script"] },
  { at: "interrupt", of: (c) => (c.interrupt ? [c.interrupt] : []), fields: { round: { type: "integer", minimum: 1, maximum: 5 }, afterMinutes: { type: "integer", minimum: 1, maximum: 120 } }, required: ["round", "afterMinutes"] },
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

const sourceFiles = (c) => [c.request, c.acceptance?.spec, c.acceptance?.probe, ...Object.values(c.variants ?? {}).map((v) => v?.mutations), ...(c.controls ?? []).map((k) => k?.file), ...(c.repairs ?? []).map((r) => r?.candidate)];

const unsafeGlobs = (globs) => (globs ?? []).filter((g) => typeof g !== "string" || g.startsWith("/") || g.split("/").includes(".."));

// What a source case must be beyond its fields: the files it names are its own and there, its real variant exists,
// every control runs on a declared variant, and no two gates or controls share an id.
const SOURCE_CROSS = [
  { fails: (c, dir) => missingFiles(dir, sourceFiles(c)), say: (bad) => `names files it does not hold: ${bad.join(", ")}` },
  { fails: (c) => (isObject(c.variants) && !Object.hasOwn(c.variants, "real") ? ["real"] : []), say: () => "has no `real` variant: the source as it is must always be measurable" },
  { fails: (c) => [...(c.controls ?? []), ...(c.repairs ?? [])].filter((k) => isObject(c.variants) && !Object.hasOwn(c.variants, k?.variant)).map((k) => k?.id), say: (bad) => `controls on a variant it does not declare: ${bad.join(", ")}` },
  { fails: (c) => duplicates([...(c.checks?.gates ?? []).map((g) => g?.id), ...(c.controls ?? []).map((k) => k?.id), ...(c.repairs ?? []).map((r) => r?.id)]), say: (bad) => `ids used twice: ${bad.join(", ")}` },
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

// Where a case's fixture lives, from the case's own directory: <root>/benchmark/suites/<suite>/<case>.
export const fixtureDirOf = (caseDir, fixture) => join(caseDir, "..", "..", "..", "fixtures", fixture);

// An engineering case beyond its fields: what a source case must be, and a fixture that is there, its target's variant
// named `real`, and the goal it states one of the two it may be.
const ENGINEERING_CROSS = [
  ...SOURCE_CROSS.filter((r) => !/real/.test(r.say([]))),
  { fails: (c) => (isObject(c.variants) && !Object.hasOwn(c.variants, "real") ? ["real"] : []), say: () => "has no `real` variant: the target the goal is handed must always be measurable" },
  { fails: (c, dir) => (typeof c.fixture === "string" && !existsSync(join(fixtureDirOf(dir, c.fixture), "fixture.json")) ? [c.fixture] : []), say: (bad) => `names a fixture benchmark/fixtures/ does not hold: ${bad.join(", ")}` },
  { fails: (c) => duplicates(Array.isArray(c.arms) ? c.arms : []), say: (bad) => `arms named twice: ${bad.join(", ")}` },
  { fails: (c) => (Array.isArray(c.arms) ? c.arms.filter((a) => !ARMS.includes(a)) : []), say: (bad) => `an arm is one of ${ARMS.join(", ")}, never ${bad.join(", ")}` },
];

// The arms a case runs on, and the revision its baseline arm is frozen from: the case's, else its suite's, else the
// previous release.
export const armsOf = (c) => c.arms ?? ["release"];

export const baselinePluginOf = (c) => c.baselinePlugin ?? c.suite?.baselinePlugin ?? DEFAULT_BASELINE;

// ---- THE ACTIVATION KIND (0.5.0, B22 M4, the activation benchmark): does the host use Orbit by itself -------------------
//
// A prompt that names no skill and no command, in English or Vietnamese, handed to the real Claude Code with Orbit (or,
// on the `none` arm, without it) over a fixture project, with an optional SEED of the runner's store; what the host did
// is read off the stream the controller captured and the trail Orbit's hooks wrote, and held to a hidden TRUTH
// (verifier/truth.json) -- whether to activate, the strategy, the skills and agents a profile accepts, what is forbidden,
// which agent must stay read-only, and the owners' records that must hold. An OUTCOME case adds the engineering kind's
// hidden checks (verifier/spec.mjs and probe.mjs) on what the host delivered. A selection case is capped near $3 and 25
// turns; an outcome case runs within the engineering kind's limits. The harness never reaches a plugin (HARNESS), and
// what a case WITHHOLDS beside it -- a document of the plugin's own that restates the suite's truths -- is left out of
// every plugin its host is handed, as a QA case withholds its ground truth.
export const ACTIVATION_HOSTS = ["idle", "over-eager", "forging", "half", "escalating", "reference"];

export const STRATEGIES = ["NONE", "DIRECT", "COORDINATED", "SATELLITE", "RESUME"];

export const COORDINATIONS = ["automation", "goal"];

export const TIERS = ["selection", "outcome"];

export const LANGUAGES = ["en", "vi"];

// The switches a case may hand the runner, by name and value: a component's own (ORBIT_SKILL_*, ORBIT_AGENT_*) and the
// prompt router's -- nothing else of the environment.
export const SWITCH_NAME = /^ORBIT_(SKILL|AGENT)_[A-Z0-9_]{1,60}$|^ORBIT_PROMPT_ROUTER$/;

export const SWITCH_VALUES = ["on", "off"];

// What a selection case may spend: about three dollars and twenty-five turns, judged on what the host did before the cap.
export const SELECTION_CAPS = { usd: 3, maxTurns: 25 };

// The owners' records a truth may hold the host to, each read back by the inspection (lib/activation/judge.mjs RECORDS).
export const RECORD_READS = ["tasks", "workflows", "works", "architecture", "plans", "cases", "ledger", "store", "rooms", "router"];

// What a prompt never names: one of Orbit's components, a slash command (one the prompt opens with, or Orbit's own
// anywhere), a CLI of the plugin or a command line of node. An API path in a pasted specification is none of these.
export const NAMES_A_COMPONENT = /\borbit-[a-z]|^\s*\/[a-z]|(^|\s)\/orbit\b|\bcli\/[a-z-]+\.mjs\b|\bnode\s+\S+\.mjs\b/i;

const ACTIVATION_FIELDS = { ...COMMON_FIELDS, language: { type: "string", enum: LANGUAGES }, fixture: { type: "object" }, seed: { type: "object" }, switches: { type: "object" }, withheld: LIST, scope: { type: "object" }, checks: { type: "object" }, variants: { type: "object", minProperties: 1 }, ...ARM_FIELDS };

const ACTIVATION_REQUIRED = ["schema", "kind", "id", "version", "title", "goal", "measures", "request", "language", "fixture", "arms", "acceptance", "limits", "artifacts", "cleanup", "variants", "controls"];

const SHARED_CHECKS = ["checks", "checks.gates[]", "checks.agentTests"];

const ACTIVATION_SECTIONS = [
  { at: "case", of: (c) => [c], fields: ACTIVATION_FIELDS, required: ACTIVATION_REQUIRED },
  { at: "measures", of: (c) => [c.measures], fields: { kind: { type: "string", enum: ["activation"] }, capability: NAME, tier: { type: "string", enum: TIERS } }, required: ["kind", "capability", "tier"] },
  { at: "fixture", of: (c) => [c.fixture], fields: { id: NAME }, required: ["id"] },
  { at: "seed", of: (c) => (c.seed ? [c.seed] : []), fields: { files: REL, script: REL }, required: [] },
  { at: "acceptance", of: (c) => [c.acceptance], fields: { owner: { type: "string", enum: ["verifier"] }, truth: REL, spec: REL, probe: REL, samples: { type: "integer", minimum: 1, maximum: 512 } }, required: ["owner", "truth"] },
  { at: "limits", of: (c) => [c.limits], fields: { rounds: { type: "integer", minimum: 1, maximum: 1 }, minutes: { type: "integer", minimum: 5, maximum: 600 }, usd: { type: "number", minimum: 0, maximum: 200 }, maxTurns: { type: "integer", minimum: 1, maximum: 400 }, runner: { type: "object" }, verifier: { type: "object" } }, required: ["rounds", "minutes", "usd", "maxTurns", "runner"] },
  { at: "limits.runner", of: (c) => [c.limits?.runner], fields: BOX, required: ["cpus", "memoryMb", "pids", "minutes", "outputMb"] },
  { at: "limits.verifier", of: (c) => (c.limits?.verifier ? [c.limits.verifier] : []), fields: BOX, required: ["cpus", "memoryMb", "pids", "seconds"] },
  { at: "scope", of: (c) => (c.scope ? [c.scope] : []), fields: { allow: { ...LIST, minItems: 1 }, deny: LIST, imports: LIST, tests: { type: "string", enum: ["guarded", "as-left"] } }, required: ["allow", "deny"] },
  ...SOURCE_SECTIONS.filter((x) => SHARED_CHECKS.includes(x.at)).map((x) => ({ ...x, of: (c) => (c.checks ? x.of(c) : []) })),
  { at: "cleanup", of: (c) => [c.cleanup], fields: { containers: LABELLED, networks: LABELLED, scratch: SCRATCH }, required: ["containers", "networks", "scratch"] },
  { at: "variants.*", of: (c) => Object.values(c.variants ?? {}), fields: { mutations: REL }, required: [] },
  { at: "controls[]", of: (c) => c.controls ?? [], fields: { id: NAME, host: { type: "string", enum: ACTIVATION_HOSTS }, expect: VERDICT, class: { type: "string", enum: FAILURE_CLASSES }, file: REL }, required: ["id", "host", "expect"] },
];

// ---- an activation case's hidden truth ------------------------------------------------------------------------------------

const ACTIVATE = { enum: [true, false, null] };

const TRUTH_SHAPE = { schema: { type: "integer", enum: [1] }, activate: ACTIVATE, strategy: LIST, how: LIST, selection: { type: "array", minItems: 1 }, forbid: { type: "object" }, readOnly: { type: "object" }, records: { type: "array" }, relevant: {}, grounding: {} };

const PART = { require: LIST, allow: LIST, max: { type: "integer", minimum: 0, maximum: 20 } };

const RECORD_ROW = { id: NAME, read: { type: "string", enum: RECORD_READS }, expect: { type: "object" }, arms: LIST };

const RELEVANT = { direct: LIST, dependency: LIST, downstream: LIST, verification: LIST };

const FORBID = { skills: LIST, agents: LIST, commands: LIST };

// A component's bare name, or `*` for every one of its kind.
const COMPONENT = /^(\*|[a-z][a-z0-9-]{0,39})$/;

// What a list holds, entry by entry (src/constraints.mjs holds an entry to its type alone).
const entriesFindings = (at, list, ok, says) => (Array.isArray(list) ? list.filter((x) => !ok(x)).map((x) => `${at}: ${x} is not ${says}`) : []);

const shapeOf = (at, fields, record, required = Object.keys(fields)) => (isObject(record) ? [...unknownOf({ at, fields }, record), ...missingFindings(required, record, at), ...constraintFindings(fields, record, at)] : [`${at}: must be an object`]);

const namesFindings = (at, part) => [...entriesFindings(`${at}.require`, part?.require, (x) => COMPONENT.test(x) && x !== "*", "a component's bare name"), ...entriesFindings(`${at}.allow`, part?.allow, (x) => COMPONENT.test(x), "a component's bare name, or *")];

const partFindings = (at, part, required) => [...shapeOf(at, PART, part, required), ...namesFindings(at, part)];

const profileFindings = (p, i) => (isObject(p) ? [...unknownOf({ at: `truth.selection[${i}]`, fields: { skills: 1, agents: 1 } }, p), ...missingFindings(["skills", "agents"], p, `truth.selection[${i}]`), ...partFindings(`truth.selection[${i}].skills`, p.skills, ["require", "allow"]), ...partFindings(`truth.selection[${i}].agents`, p.agents, ["require", "allow", "max"])] : [`truth.selection[${i}]: must be an object`]);

const objectOrNull = (at, v) => (v === undefined || v === null || isObject(v) ? [] : [`${at}: must be an object or null`]);

const wordsFindings = (t) => [...entriesFindings("truth.strategy", t.strategy, (x) => STRATEGIES.includes(x), `one of ${STRATEGIES.join(", ")}`), ...entriesFindings("truth.how", t.how, (x) => COORDINATIONS.includes(x), `one of ${COORDINATIONS.join(", ")}`), ...entriesFindings("truth.forbid.skills", t.forbid?.skills, (x) => COMPONENT.test(x), "a skill's bare name, or *"), ...entriesFindings("truth.forbid.agents", t.forbid?.agents, (x) => COMPONENT.test(x), "an agent's bare name, or *"), ...(t.records ?? []).flatMap((r, i) => entriesFindings(`truth.records[${i}].arms`, r?.arms, (x) => ARMS.includes(x), `one of ${ARMS.join(", ")}`)), ...objectOrNull("truth.relevant", t.relevant), ...objectOrNull("truth.grounding", t.grounding)];

const badPattern = (p) => {
  try { return (new RegExp(p), false); }
  catch { return true; }
};

const patternFindings = (at, list) => (Array.isArray(list) ? list.filter((p) => typeof p !== "string" || badPattern(p)).map((p) => `${at}: ${p} is not a pattern this judge can compile`) : [`${at}: must be a list of patterns`]);

const readOnlyFindings = (t) => Object.entries(isObject(t.readOnly) ? t.readOnly : {}).flatMap(([agent, list]) => [...(/^[a-z][a-z0-9-]{0,39}$/.test(agent) ? [] : [`truth.readOnly: ${agent} is not an agent's bare name`]), ...patternFindings(`truth.readOnly.${agent}`, list)]);

const partsFindings = (t) => [...(t.selection ?? []).flatMap(profileFindings), ...(isObject(t.forbid) ? shapeOf("truth.forbid", FORBID, t.forbid) : []), ...patternFindings("truth.forbid.commands", t.forbid?.commands ?? []), ...readOnlyFindings(t), ...(t.records ?? []).flatMap((r, i) => shapeOf(`truth.records[${i}]`, RECORD_ROW, r, ["id", "read", "expect"])), ...(isObject(t.relevant) ? shapeOf("truth.relevant", RELEVANT, t.relevant) : [])];

const truthKeys = ["schema", "activate", "strategy", "how", "selection", "forbid", "readOnly", "records"];

// The truth's own coherence: a truth that says not to activate names no strategy but NONE; one that names a coordinated
// strategy says how; a record id is used once.
const COHERENT = [
  { says: "a truth that says not to activate accepts only the strategy NONE", fails: (t) => t.activate === false && (t.strategy ?? []).some((s) => s !== "NONE") },
  { says: "a truth that says to activate never accepts the strategy NONE", fails: (t) => t.activate === true && (t.strategy ?? []).includes("NONE") },
  { says: "a coordinated strategy says how it is coordinated (automation, goal)", fails: (t) => (t.strategy ?? []).includes("COORDINATED") && !(t.how ?? []).length },
  { says: "a record id is used once", fails: (t) => duplicates((t.records ?? []).map((r) => r?.id)).length > 0 },
];

export const activationTruthFindings = (t) => (isObject(t) ? [...shapeOf("truth", TRUTH_SHAPE, t, truthKeys), ...partsFindings(t), ...wordsFindings(t), ...COHERENT.filter((r) => r.fails(t)).map((r) => `truth: ${r.says}`)] : ["truth: the truth file must hold one object"]);

// ---- what an activation case must be beyond its fields -------------------------------------------------------------------

const outcomeCase = (c) => c.measures?.tier === "outcome";

const verifierParts = (c) => [c.acceptance?.spec, c.acceptance?.probe, c.acceptance?.samples, c.checks, c.scope, c.limits?.verifier];

const activationFiles = (c) => [c.request, c.acceptance?.truth, c.acceptance?.spec, c.acceptance?.probe, c.seed?.script, ...Object.values(c.variants ?? {}).map((v) => v?.mutations), ...(c.controls ?? []).map((k) => k?.file)];

const missingDir = (dir, rel) => (typeof rel === "string" && (!safeRel(rel) || !existsSync(join(dir, rel))) ? [rel] : []);

const requestText = (c, dir) => (typeof c.request === "string" && safeRel(c.request) && existsSync(join(dir, c.request)) ? readFileSync(join(dir, c.request), "utf8") : "");

const badSwitches = (c) => Object.entries(isObject(c.switches) ? c.switches : {}).filter(([k, v]) => !SWITCH_NAME.test(k) || !SWITCH_VALUES.includes(v)).map(([k, v]) => `${k}=${v}`);

const overCap = (c) => c.measures?.tier === "selection" && (c.limits?.usd > SELECTION_CAPS.usd || c.limits?.maxTurns > SELECTION_CAPS.maxTurns);

const noFixture = (c, dir) => typeof c.fixture?.id === "string" && c.fixture.id !== "none" && !existsSync(join(fixtureDirOf(dir, c.fixture.id), "fixture.json"));

const plantedOnNothing = (c) => c.fixture?.id === "none" && Object.values(c.variants ?? {}).some((v) => v?.mutations);

const ACTIVATION_CROSS = [
  { fails: (c, dir) => [...missingFiles(dir, activationFiles(c)), ...missingDir(dir, c.seed?.files)], say: (bad) => `names files it does not hold: ${bad.join(", ")}` },
  { fails: (c, dir) => (missingFiles(dir, [c.acceptance?.truth]).length ? [] : activationTruthFindings(readTruth(dir, c.acceptance.truth))), say: (bad) => bad.join("; ") },
  { fails: (c) => (isObject(c.variants) && !Object.hasOwn(c.variants, "real") ? ["real"] : []), say: () => "has no `real` variant: the target the prompt is handed must always be measurable" },
  { fails: (c, dir) => (noFixture(c, dir) ? [c.fixture.id] : []), say: (bad) => `names a fixture benchmark/fixtures/ does not hold: ${bad.join(", ")}` },
  { fails: (c) => (plantedOnNothing(c) ? ["none"] : []), say: () => "plants a variant on no fixture at all" },
  { fails: (c) => (outcomeCase(c) && verifierParts(c).some((x) => x === undefined) ? ["outcome"] : []), say: () => "is an outcome case with no spec, probe, samples, checks, scope or verifier limits: its hidden checks are what decide it" },
  { fails: (c) => (overCap(c) ? [c.limits.usd, c.limits.maxTurns] : []), say: () => `is a selection case past its caps: at most ${SELECTION_CAPS.usd} USD and ${SELECTION_CAPS.maxTurns} turns` },
  { fails: (c) => badSwitches(c), say: (bad) => `hands the runner a switch it may not: ${bad.join(", ")} (only ORBIT_SKILL_*, ORBIT_AGENT_* and ORBIT_PROMPT_ROUTER, on or off)` },
  { fails: (c) => duplicates((c.controls ?? []).map((k) => k?.id)), say: (bad) => `control ids used twice: ${bad.join(", ")}` },
  { fails: (c) => ((c.controls ?? []).some((k) => k?.host === "reference" && k?.expect === "PASS") ? [] : ["reference"]), say: () => "carries no reference control that must PASS: a case nobody can pass proves nothing" },
  { fails: (c, dir) => (NAMES_A_COMPONENT.test(requestText(c, dir)) ? [c.request] : []), say: () => "has a prompt that names a skill, an agent, a slash command or a command line: the host is never told what to use" },
  { fails: (c) => duplicates(Array.isArray(c.arms) ? c.arms : []), say: (bad) => `arms named twice: ${bad.join(", ")}` },
  { fails: (c) => unsafeGlobs(c.scope?.allow), say: (bad) => `scope globs reach outside the repository: ${bad.join(", ")}` },
  { fails: (c) => unsafeGlobs(c.withheld), say: (bad) => `withheld globs reach outside the repository: ${bad.join(", ")}` },
];

// A case's truth, read from its own (frozen) directory: null when it cannot be read.
export const activationTruthOf = (c) => readTruth(c.dir, c.acceptance.truth);

export const KINDS = { source: { sections: SOURCE_SECTIONS, cross: SOURCE_CROSS }, qa: { sections: QA_SECTIONS, cross: QA_CROSS }, engineering: { sections: ENGINEERING_SECTIONS, cross: ENGINEERING_CROSS }, activation: { sections: ACTIVATION_SECTIONS, cross: ACTIVATION_CROSS } };

const crossFindings = (kind, c, dir) => kind.cross.map((r) => [r, r.fails(c, dir)]).filter(([, bad]) => bad.length).map(([r, bad]) => `case: ${r.say(bad)}`);

const kindFindings = (kind, c, dir) => [...kind.sections.flatMap((s) => sectionFindings(s, c)), ...crossFindings(kind, c, dir)];

export const caseFindings = (c, dir) => (!isObject(c) ? ["case: case.json must hold one object"] : Object.hasOwn(KINDS, c.kind) ? kindFindings(KINDS[c.kind], c, dir) : [`case: kind is one of ${Object.keys(KINDS).join(", ")}`]);

function jsonAt(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { throw new Refused(`${file} is not a JSON document this harness can read (${e.code ?? e.message})`); }
}

// A suite may name the revision its cases' baseline arm is frozen from (`baselinePlugin`); a case's own outranks it.
const SUITE_FIELDS = { schema: { type: "integer", enum: [1] }, id: NAME, version: COMMON_FIELDS.version, title: TEXT, cases: { ...LIST, minItems: 1 }, baselinePlugin: REVISION };

const SUITE_REQUIRED = Object.keys(SUITE_FIELDS).filter((k) => k !== "baselinePlugin");

const suiteFindings = (p) => (isObject(p) ? [...unknownOf({ at: "suite", fields: SUITE_FIELDS }, p), ...missingFindings(SUITE_REQUIRED, p, "suite"), ...constraintFindings(SUITE_FIELDS, p, "suite")] : ["suite: suite.json must hold one object"]);

function suiteAt(dir) {
  const p = jsonAt(join(dir, "suite.json"));
  const findings = suiteFindings(p);
  if (findings.length) throw new Refused(`${join(dir, "suite.json")} does not hold: ${findings.join("; ")}`);
  return { ...p, dir };
}

const suiteDirs = (root) => (existsSync(join(root, SUITES_DIR)) ? readdirSync(join(root, SUITES_DIR), { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(root, SUITES_DIR, e.name, "suite.json"))).map((e) => join(root, SUITES_DIR, e.name)) : []);

export const suitesIn = (root) => suiteDirs(root).map(suiteAt).sort((a, b) => a.id.localeCompare(b.id, "en"));

const suiteOfCase = (root, id) => suitesIn(root).find((p) => p.cases.some((x) => caseDir(x) === caseDir(id))) ?? null;

// The id of the suite the catalog holds a case in, or null -- for a kept room that names its case and not its suite.
export const suiteHolding = (root, id) => (root && id ? suiteOfCase(root, id)?.id ?? null : null);

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
  return { ...c, dir, suite: { id: suite.id, version: suite.version, dir: suite.dir, ...(suite.baselinePlugin ? { baselinePlugin: suite.baselinePlugin } : {}) } };
}

export const casesOf = (root, suiteId) => ((p) => (p ? p.cases.map((id) => loadedCase(p, id)) : []))(suitesIn(root).find((x) => x.id === suiteId));

// One digest for a directory: every file, by its path and its bytes -- the same files are the same digest wherever
// the directory sits, and a link is never followed.
export const dirDigest = (dir, io = realIo()) => treeDigest(treeDigests(dir, treeFiles(dir), io));
