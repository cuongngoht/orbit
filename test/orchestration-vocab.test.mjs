// The orchestrator speaks the TASK's words and owns none of its own lifecycle, so every stage,
// stop, need, cause and receipt word it uses is held equal to src/task/vocab.mjs here -- and the
// boundaries that keep it an orchestrator (no subject imported, nothing spawned, no product named,
// no shell) are held by grep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LIFECYCLE } from "../src/task/model.mjs";
import { ATTEMPT_CAUSES, NEEDS as TASK_NEEDS, OUTCOMES, RECEIPT_DOMAINS, STAGE_NAMES, TEXT_LIMIT as TASK_TEXT, WRITABLE_STOPS } from "../src/task/vocab.mjs";
import { CAUSE, DECISION_FIELDS, DECISION_FORBIDDEN, DOMAIN, FAILURE_IDS, LIFE, NEEDS, RESULT, SANDBOX_STATE, SESSION_WORD, STAGE, STOP, TEXT_LIMIT } from "../src/orchestration/vocab.mjs";
import { STAGES } from "../src/orchestration/stages.mjs";
import { CLASSES } from "../src/orchestration/failure.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HERE = join(ROOT, "src", "orchestration");

test("every stage, stop, need, cause, lifecycle and receipt word is the task's own -- never a second spelling", () => {
  assert.deepEqual(Object.values(STAGE), STAGE_NAMES, "the twelve stages, in the task's order");
  assert.deepEqual(STAGES.map((s) => s.stage), STAGE_NAMES, "the stage table has one row per stage, in order");
  assert.ok(Object.values(STOP).every((s) => WRITABLE_STOPS.includes(s)), "only stops the task lets an engine write");
  assert.deepEqual(NEEDS, TASK_NEEDS);
  assert.deepEqual(Object.values(CAUSE), ATTEMPT_CAUSES);
  assert.ok(Object.values(LIFE).every((l) => LIFECYCLE.some((row) => row.state === l)));
  assert.ok(Object.values(DOMAIN).every((d) => RECEIPT_DOMAINS.includes(d)), "check, runtime and investigation are task receipt domains");
  assert.ok([RESULT.SUCCEEDED, RESULT.FAILED].every((o) => OUTCOMES.includes(o)));
  assert.equal(TEXT_LIMIT, TASK_TEXT);
});

test("the sandbox is a receipt domain of the task, and its words are ones a receipt may hold", () => {
  assert.equal(DOMAIN.SANDBOX, "sandbox");
  assert.ok(RECEIPT_DOMAINS.includes("sandbox"));
  const word = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
  assert.ok([...Object.values(SANDBOX_STATE), ...Object.values(SESSION_WORD)].every((w) => word.test(w)));
  assert.deepEqual(Object.values(SESSION_WORD), ["RUNNING", "STOPPED", "EXITED"]);
});

test("a decision may assert nothing the engine derives: an outcome, a stage, a signature, a confidence or an approval", () => {
  for (const word of ["outcome", "verdict", "status", "passed", "succeeded", "completed", "stage", "signature", "failureSignature", "confidence", "approved", "granted", "human", "door"]) assert.ok(DECISION_FORBIDDEN.includes(word), word);
  assert.deepEqual(DECISION_FIELDS.filter((f) => DECISION_FORBIDDEN.includes(f)), []);
});

test("every failure class a row can return is a class the vocabulary names", () => {
  assert.ok(CLASSES.every((c) => FAILURE_IDS.includes(c.id)));
  assert.ok(CLASSES.every((c) => ["high", "low"].includes(c.confidence)));
  assert.equal(CLASSES.at(-1).when({}), true, "the last row always answers");
});

// ---- the boundaries -------------------------------------------------------------------------------

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const files = walk(HERE).filter((p) => p.endsWith(".mjs"));
const code = (p) => readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

const ALLOWED = /^(orchestration)\//;
const SINGLE = new Set(["errors.mjs", "hash.mjs", "constraints.mjs", "scrub.mjs", "printable.mjs", "project/boundary.mjs", "learn/args.mjs", "process/env.mjs", "store/lock.mjs", "store/atomic.mjs"]);

test("src/orchestration imports only leaves, the store's lock and itself -- no subject: not the task, runtime, work, requirements, investigations or capabilities", () => {
  const bad = files.flatMap((p) => [...code(p).matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => relative(join(ROOT, "src"), resolve(dirname(p), m[1])).replace(/\\/g, "/")).filter((target) => !SINGLE.has(target) && !ALLOWED.test(target)).map((target) => `${relative(ROOT, p)} imports ${target}`));
  assert.deepEqual(bad, []);
});

test("src/orchestration spawns nothing, opens nothing and reads no environment, argument list or clock of its own", () => {
  const forbidden = /(from\s+"node:(child_process|net|http|https|fs|os|dgram|worker_threads)")|\bprocess\.(env|cwd|argv|exit|kill)\b|\bfetch\(|\bDate\.now\(/;
  const hits = files.flatMap((p) => code(p).split("\n").map((l, i) => [relative(ROOT, p), i + 1, l]).filter(([, , l]) => forbidden.test(l)).map(([f, n, l]) => `${f}:${n}  ${l.trim().slice(0, 80)}`));
  assert.deepEqual(hits, []);
});

const PRODUCTS = /\b(npm|pnpm|yarn|nodejs?|dotnet|nuget|csproj|msbuild|python3?|pip|java|golang|ruby|rustc|cargo|maven|gradle|postgres(ql)?|redis|kafka|rabbitmq|mongo(db)?|mysql|mariadb|sql ?server|playwright|github|gitlab|azure|aws|vscode|microsoft|jetbrains|kubernetes|terraform|docker|claude|codex|openai|gemini|anthropic)\b/i;

test("nothing under src/orchestration names a stack, a product, a vendor or a host", () => {
  const hits = files.flatMap((p) => code(p).split("\n").map((l, i) => [relative(ROOT, p), i + 1, l]).filter(([, , l]) => PRODUCTS.test(l)).map(([f, n, l]) => `${f}:${n}  ${l.trim().slice(0, 100)}`));
  assert.deepEqual(hits, []);
});

// A command line nothing declared would be a second way to run things: no shell, no exec of a string.
const SHELL = /\b(bash|zsh|powershell|pwsh)\b|\bsh\s+-c\b|\bcmd(\.exe)?\s+\/c\b|\bexec(Sync)?\(|\bshell\s*:\s*true|\beval\(|new Function\(/i;

test("nothing under src/orchestration -- nor the CLI that binds it -- runs a shell or executes a string", () => {
  const all = [...files, join(ROOT, "cli", "autonomous-engineering.mjs"), join(ROOT, "src", "frontend", "local-clones.mjs")];
  const hits = all.flatMap((p) => code(p).split("\n").map((l, i) => [relative(ROOT, p), i + 1, l]).filter(([, , l]) => SHELL.test(l)).map(([f, n, l]) => `${f}:${n}  ${l.trim().slice(0, 100)}`));
  assert.deepEqual(hits, []);
});
