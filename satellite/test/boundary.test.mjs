// Satellite's DEPENDENCY DIRECTION, held by grep: nothing under satellite/src/ reads an environment, a working
// directory or a child process, and it imports from Orbit only the leaves and pure modules named here. Every owner --
// an engineering task, a QA investigation, the checkout's git, a spawned Orbit command, the skill factory -- is bound
// by satellite/cli/bind.mjs and handed in, so the engine can never reach past a port.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { NOT_SATELLITE } from "../src/governance.mjs";
import { OPERATION_NAMES } from "../src/permissions/operations.mjs";
import { MODES } from "../src/execution/modes.mjs";
import { PROFILES } from "../src/permissions/profiles.mjs";
import { ACTION_KINDS } from "../src/mission/actions.mjs";

const SATELLITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(SATELLITE, "..");

const files = (p) => (statSync(p).isFile() ? (p.endsWith(".mjs") ? [p] : []) : readdirSync(p).flatMap((n) => files(join(p, n))));

const SOURCES = files(join(SATELLITE, "src"));

const orbitImports = (file) => [...readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)].map((m) => join(dirname(file), m[1])).filter((p) => !p.startsWith(SATELLITE)).map((p) => relative(REPO, p).split("\\").join("/"));

// The leaves and the pure modules Satellite's engine may import from Orbit -- and nothing that binds a real machine.
export const ALLOWED_ORBIT = new Set(["src/errors.mjs", "src/hash.mjs", "src/scrub.mjs", "src/printable.mjs", "src/project/boundary.mjs", "src/store/id.mjs", "src/store/lock.mjs", "src/store/atomic.mjs", "src/store/control.mjs", "src/store/revisioned.mjs", "src/goal/spec.mjs", "src/goal/fields.mjs", "src/learn/args.mjs", "src/live/presentation.mjs", "src/live/words.mjs", "src/live/orbit.mjs", "src/live/render/ansi.mjs", "src/live/render/width.mjs", "src/live/render/lines.mjs", "src/live/render/theme.mjs", "src/live/tui/sections/parts.mjs", "src/live/tui/keys.mjs", "src/live/tui/diff.mjs", "src/live/tui/glyphs.mjs", "src/live/tui/workspace.mjs", "src/skill-factory/interpret.mjs", "src/skill-factory/workflow.mjs", "src/attribution.mjs"]);

test("satellite/src imports from Orbit only the leaves and pure modules it is allowed", () => {
  const imported = [...new Set(SOURCES.flatMap(orbitImports))];
  assert.ok(imported.length >= 10, `only ${imported.length} Orbit imports found — the scan lost its subject`);
  assert.deepEqual(imported.filter((p) => !ALLOWED_ORBIT.has(p)), []);
});

test("satellite/src reads no environment, no working directory and starts no process", () => {
  for (const f of SOURCES) {
    const said = readFileSync(f, "utf8");
    assert.doesNotMatch(said, /\bprocess\.(env|cwd|argv|exit|pid)\b/, `${relative(REPO, f)} reaches the process; a port is handed in instead`);
    assert.doesNotMatch(said, /from "node:(fs|child_process|os|net|http|https)"/, `${relative(REPO, f)} imports a Node module that touches the machine`);
  }
});

test("nothing Satellite dispatches can name a shell, a secret, an install, a push, a merge or a deploy", () => {
  const words = [...OPERATION_NAMES, ...Object.keys(MODES), ...Object.keys(PROFILES), ...ACTION_KINDS].join(" ").toLowerCase();
  for (const banned of ["shell", "secret", "install", "push", "merge", "deploy", "approve"]) assert.doesNotMatch(words, new RegExp(`\\b${banned}`), banned);
  assert.ok(NOT_SATELLITE.includes("ARBITRARY_SHELL") && NOT_SATELLITE.includes("PUSH"));
});

test("only the composition roots under satellite/cli bind Orbit's owners", () => {
  const owners = ["src/task/store.mjs", "src/investigation/store.mjs", "src/process/index.mjs", "src/runtime/context.mjs", "src/store/context.mjs"];
  const importers = SOURCES.filter((f) => orbitImports(f).some((p) => owners.includes(p)));
  assert.deepEqual(importers.map((f) => relative(REPO, f)), []);
  assert.match(readFileSync(join(SATELLITE, "cli", "bind.mjs"), "utf8"), /runtimeProject\(env, cwd\)/);
});
