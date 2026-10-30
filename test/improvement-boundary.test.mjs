// Self-improvement's LINE (0.3.0, ADR 0045), held by grep: src/improvement/ imports only leaves, the store's
// primitives and itself; it reads no environment, spawns nothing, calls no model and names no product; only composition
// roots import it; its commands are what its usage header documents and its governance governs -- and none of them
// promotes, reverts, rejects or changes a setting, which are a person's in Orbit Control.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { COMMAND_NAMES } from "../src/improvement/index.mjs";
import { NOT_IMPROVE, OPERATIONS } from "../src/improvement/governance.mjs";
import { authorize, isAuto } from "../src/protected/authorize.mjs";
import { documented, headerOf } from "../src/trace/commands.mjs";

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? (n === "node_modules" ? [] : walk(join(dir, n))) : n.endsWith(".mjs") ? [join(dir, n)] : []));
const code = (file) => readFileSync(file, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const importsOf = (file) => [...code(file).matchAll(/(?:import|export)\s[^"']*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);

const LEAVES = ["../errors.mjs", "../hash.mjs", "../scrub.mjs", "../printable.mjs", "../learn/args.mjs", "../memory/session.mjs", "../project/boundary.mjs", "../store/atomic.mjs", "../store/id.mjs", "../store/lock.mjs", "node:path"];

const PRODUCTS = /\b(claude|codex|antigravity|gemini|openai|anthropic|npm|dotnet|docker|github|azure|playwright|postgres|kafka|redis)\b/i;

test("src/improvement imports only leaves, the store's primitives and itself; it reaches no machine, model or product", () => {
  for (const file of walk("src/improvement")) {
    for (const spec of importsOf(file)) assert.ok(spec.startsWith("./") || LEAVES.includes(spec), `${file} imports ${spec}`);
    const text = code(file);
    assert.ok(!/process\.(env|cwd|argv|exit)|Date\.now\(|new Date\(|node:(fs|child_process|net|http|https|os)|fetch\(|eval\(|new Function\(/.test(text), `${file} reaches the machine itself`);
    assert.ok(!PRODUCTS.test(text), `${file} names a product: ${text.match(PRODUCTS)?.[0]}`);
  }
});

test("only the improvement store writes the improvement room, and nothing under src/improvement writes another owner's", () => {
  const writers = walk("src/improvement").filter((f) => /io\.(write|append|rename|remove|removeFile|copy|ensureDir)\(|writeAtomic\(/.test(code(f)));
  assert.deepEqual(writers.map((f) => f.split(/[\\/]/).at(-1)), ["store.mjs"]);
  for (const file of walk("src/improvement")) assert.ok(!/saveRegistry\(|writeDefinition\(|selectVersion\(|selectDefinition\(/.test(code(file)), `${file} writes an owner's registry behind its back`);
});

test("only composition roots import src/improvement", () => {
  const importers = ["src", "cli", "skills", "control-server/src", "satellite/src"].flatMap(walk).filter((f) => !f.startsWith(join("src", "improvement"))).filter((f) => importsOf(f).some((s) => /(^|\/)src\/improvement\/[a-z-]+\.mjs$/.test(s) || (f.startsWith("src") && /^\.\.\/improvement\//.test(s))));
  assert.deepEqual(importers.map((f) => f.split("\\").join("/")).sort(), ["cli/improve.mjs", "cli/live.mjs", "control-server/src/core.mjs"]);
});

test("the usage header, the command table and governance name the same commands -- and none that is a person's", () => {
  const header = headerOf(readFileSync("cli/improve.mjs", "utf8"));
  assert.deepEqual([...documented(header, "improve")].sort(), [...COMMAND_NAMES].sort());
  assert.deepEqual(OPERATIONS.flatMap((o) => o.commands).sort(), [...COMMAND_NAMES].sort());
  for (const word of NOT_IMPROVE) assert.ok(!COMMAND_NAMES.includes(word), word);
  assert.ok(NOT_IMPROVE.includes("promote") && NOT_IMPROVE.includes("settings"));
});

test("choosing which version of a definition runs crosses no protected boundary, and no word a campaign carries changes a verdict", () => {
  for (const kind of ["definition.select", "skill.successor.stage", "improvement.evaluate"]) assert.ok(isAuto(authorize({ kind })), kind);
  const forged = authorize({ kind: "repository.push", remote: "origin", runRef: "msn-000000000000/arn-1", attribution: "RUNTIME_BOUND", door: "improvement", campaign: "imp-000000000000" });
  assert.equal(forged.decision, authorize({ kind: "repository.push", remote: "origin" }).decision, "a campaign's identity is never authority");
});
