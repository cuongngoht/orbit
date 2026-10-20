// The skill factory's line (AGENTS.md, "A gap is an opportunity…", the second scoped exception): only a
// WORKFLOW gap may lead to drafting anything; a capability or policy gap never does; what is drafted is
// instruction-only, project-scoped and held to the contract before it is trusted; the factory writes only its
// own room, decides no opportunity, imports no subject and names no product; and a terminal can never
// register or activate a playbook.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GAP_KINDS, gapOf } from "../src/skill-factory/gap.mjs";
import { COMMAND_NAMES, NOT_FACTORY } from "../src/skill-factory/index.mjs";
import { SCOPES, STATUSES } from "../src/skill-factory/vocab.mjs";
import { MANIFEST_FIELDS } from "../src/extensions/contract.mjs";
import { documented, headerOf } from "../src/trace/commands.mjs";

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : n.endsWith(".mjs") ? [join(dir, n)] : []));
const code = (file) => readFileSync(file, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const importsOf = (file) => [...code(file).matchAll(/(?:import|export)\s[^"']*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);

test("exactly one gap kind may lead to generating, and it is a WORKFLOW gap", () => {
  assert.deepEqual(GAP_KINDS.filter((g) => g.generates).map((g) => g.kind), ["workflow"]);
  assert.equal(gapOf({ outcome: "gap", remedy: "prepare" }).generates, true);
  for (const r of [{ outcome: "provided" }, { outcome: "decision", why: "policy" }, { outcome: "gap", remedy: "enable", why: "switched off" }, { outcome: "impaired", why: "x" }, { outcome: "cannot-tell", why: "x" }, null]) {
    assert.equal(gapOf(r).generates, false, JSON.stringify(r));
  }
});

test("instruction-only and project-scoped: no machine scope, statuses in an extension's words", () => {
  assert.deepEqual(SCOPES, ["task", "project"]);
  assert.ok(STATUSES.map((s) => s.id).filter((id) => id !== "disabled").every((id) => MANIFEST_FIELDS.status.enum.includes(id)), "an extension's words, and a person's `disabled`");
  assert.deepEqual(STATUSES.filter((s) => s.offered).map((s) => s.id), ["active"]);
});

const LEAVES = ["../errors.mjs", "../hash.mjs", "../scrub.mjs", "../printable.mjs", "../learn/args.mjs", "../store/lock.mjs", "../project/boundary.mjs", "node:path"];

test("src/skill-factory imports only leaves and itself; it decides no opportunity and names no product", () => {
  for (const file of walk("src/skill-factory")) {
    for (const spec of importsOf(file)) assert.ok(spec.startsWith("./") || LEAVES.includes(spec), `${file} imports ${spec}`);
    const text = code(file);
    assert.ok(!/opportunities\.mjs|decided\(|saveOpportunity/.test(text), `${file} touches an opportunity — only a person decides one`);
    assert.ok(!/process\.(env|cwd|argv)|node:(fs|child_process|net|http)|fetch\(|eval\(|new Function\(/.test(text), `${file} reaches the machine itself`);
    assert.ok(!/\b(claude|codex|antigravity|gemini|openai|npm|dotnet|docker|github|azure)\b/i.test(text), `${file} names a product`);
  }
});

test("only the factory's lifecycle and its store write its room", () => {
  const writers = walk("src/skill-factory").filter((f) => /io\.(write|rename|remove|copy|removeFile)\(|saveRegistry\(/.test(code(f)));
  assert.deepEqual(writers.map((f) => f.split(/[\\/]/).at(-1)).sort(), ["lifecycle.mjs", "store.mjs"]);
});

test("a terminal can never register, activate or archive a playbook: no factory command does, and the usage says so", () => {
  for (const name of NOT_FACTORY) assert.ok(!COMMAND_NAMES.includes(name), name);
  assert.deepEqual([...documented(headerOf(readFileSync("cli/skill-factory.mjs", "utf8")), "skill-factory")].sort(), [...COMMAND_NAMES].sort());
});

test("AGENTS.md states the second scoped exception and names this test as what holds it", () => {
  const agents = readFileSync("AGENTS.md", "utf8");
  assert.match(agents, /SECOND scoped exception, for PLAYBOOKS/);
  assert.match(agents, /test\/skill-factory-boundary\.test\.mjs/);
});
