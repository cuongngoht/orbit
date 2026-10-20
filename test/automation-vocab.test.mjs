// The coordinator's boundary: its words are the task's, asserted rather than shared; it imports no subject,
// reads no environment, spawns nothing and names no product or host; only composition roots import it; and
// its CLI's usage header, its command table and its governance say the same thing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CAUSE, DOMAIN, FORBIDDEN, LIFE, NEEDS, STAGE, STOP, TEXT_LIMIT } from "../src/automation/vocab.mjs";
import { COMMAND_NAMES } from "../src/automation/index.mjs";
import { NOT_AUTOMATION, OPERATIONS } from "../src/automation/governance.mjs";
import { KIND_IDS } from "../src/automation/steps.mjs";
import { DECISION_FORBIDDEN } from "../src/orchestration/vocab.mjs";
import { LIFECYCLE } from "../src/task/model.mjs";
import { ATTEMPT_CAUSES, NEEDS as TASK_NEEDS, RECEIPT_DOMAINS, STAGE_NAMES, TEXT_LIMIT as TASK_TEXT, WRITABLE_STOPS } from "../src/task/vocab.mjs";
import { documented, headerOf } from "../src/trace/commands.mjs";

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : n.endsWith(".mjs") ? [join(dir, n)] : []));
const code = (file) => readFileSync(file, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const importsOf = (file) => [...code(file).matchAll(/(?:import|export)\s[^"']*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);

test("every stage, stop, need, cause, lifecycle and domain word is the task's own", () => {
  assert.deepEqual(Object.values(STAGE), STAGE_NAMES);
  assert.ok(Object.values(STOP).every((s) => WRITABLE_STOPS.includes(s)));
  assert.deepEqual(Object.values(NEEDS).sort(), [...TASK_NEEDS].sort());
  assert.deepEqual(Object.values(CAUSE).sort(), [...ATTEMPT_CAUSES].sort());
  assert.deepEqual(Object.values(LIFE).sort(), LIFECYCLE.map((r) => r.state).sort());
  assert.ok(Object.values(DOMAIN).every((d) => RECEIPT_DOMAINS.includes(d)));
  assert.equal(TEXT_LIMIT, TASK_TEXT);
});

test("a host may assert nothing the engine derives: every word the orchestrator forbids, and more", () => {
  for (const word of DECISION_FORBIDDEN.filter((w) => !["class"].includes(w))) assert.ok(FORBIDDEN.includes(word), word);
});

const LEAVES = ["../errors.mjs", "../hash.mjs", "../scrub.mjs", "../printable.mjs", "../policy.mjs", "../learn/args.mjs", "../store/control.mjs", "../store/lock.mjs", "../store/revisioned.mjs", "node:path"];

test("src/automation imports only leaves, store primitives and itself -- never a subject", () => {
  for (const file of walk("src/automation")) {
    for (const spec of importsOf(file)) assert.ok(spec.startsWith("./") || LEAVES.includes(spec), `${file} imports ${spec}`);
  }
});

const PRODUCTS = /\b(claude|codex|antigravity|gemini|openai|anthropic|npm|dotnet|docker|github|azure|playwright)\b/i;

test("src/automation reads no environment, spawns nothing, calls no model and names no product", () => {
  for (const file of walk("src/automation")) {
    const text = code(file);
    assert.ok(!/process\.(env|cwd|argv|exit)|Date\.now\(|node:(fs|child_process|net|http|https|os)|fetch\(|eval\(|new Function\(/.test(text), `${file} reaches the machine itself`);
    assert.ok(!PRODUCTS.test(text), `${file} names a product: ${text.match(PRODUCTS)?.[0]}`);
  }
});

test("only composition roots import src/automation", () => {
  const importers = ["src", "cli", "skills", "control-server/src"].flatMap(walk).filter((f) => !f.startsWith(join("src", "automation"))).filter((f) => importsOf(f).some((s) => /(^|\/)src\/automation\/[a-z-]+\.mjs$/.test(s) || (f.startsWith("src") && /^\.\.\/automation\//.test(s))));
  // cli/live.mjs (1.8.5) reads `live.open` and `live.display` to decide whether `live ensure` opens a viewer by itself.
  assert.deepEqual(importers.sort(), [join("cli", "automation.mjs"), join("cli", "help.mjs"), join("cli", "live.mjs"), join("cli", "skill-factory.mjs"), join("control-server", "src", "core.mjs"), join("skills", "orbit-control", "world.mjs")].sort());
});

test("the usage header, the command table and governance name the same commands, and no forbidden one", () => {
  const header = headerOf(readFileSync("cli/automation.mjs", "utf8"));
  assert.deepEqual([...documented(header, "automation")].sort(), [...COMMAND_NAMES].sort());
  const governed = OPERATIONS.flatMap((o) => o.commands);
  assert.deepEqual([...governed].sort(), [...COMMAND_NAMES].sort());
  assert.deepEqual(OPERATIONS.flatMap((o) => o.steps).sort(), [...KIND_IDS].sort(), "every step kind is governed once");
  for (const word of ["settings", "approve", "resume --human", "exec", "shell", "deploy"]) assert.ok(!COMMAND_NAMES.includes(word), word);
  assert.ok(NOT_AUTOMATION.includes("SETTINGS_WRITE") && NOT_AUTOMATION.includes("MODEL_CALL"));
});
