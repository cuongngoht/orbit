import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { frontmatter as parsedFrontmatter } from "../src/skill-factory/frontmatter.mjs";
import { TYPES } from "../src/query/classify.mjs";

// The agent-facing layer is shipped code, and it drifts in ways nothing was
// watching. The `<engine>` sentence is repeated in nine files, the two shared
// references are pointed at from eight, and a plugin subagent silently ignores
// three of the frontmatter keys a person would reasonably reach for. None of
// that is a judgement call, so all of it is asserted here -- and `node --test`
// is the release gate's first gate, so a dead pointer cannot be published.
//
// What is deliberately NOT asserted is the prose. A test that greps a playbook
// for a sentence makes the sentence unrewritable, and the words are the part a
// person is meant to improve.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const REFERENCES = ["tools.md", "dsl.md"].map((n) => join("skills", "orbit-ui-test", "references", n));

// The keys a HOST drops on the floor for a plugin subagent. Writing one is not
// an error anywhere -- it simply does nothing, which is worse: the playbook
// reads as though a restriction is in force when none is.
const IGNORED_ON_PLUGIN_AGENTS = ["hooks", "mcpServers", "permissionMode"];

const playbooks = () => [...skillFiles(), ...agentFiles()];
const skillFiles = () => readdirSync(join(ROOT, "skills")).map((d) => join("skills", d, "SKILL.md")).filter(there);
const agentFiles = () => readdirSync(join(ROOT, "agents")).filter((f) => f.endsWith(".md")).map((f) => join("agents", f));
const there = (rel) => existsSync(join(ROOT, rel));
const text = (rel) => readFileSync(join(ROOT, rel), "utf8");
const frontmatter = (rel) => text(rel).split("---")[1] ?? "";

test("the two shared references exist and say something", () => {
  for (const rel of REFERENCES) {
    assert.ok(there(rel), `${rel} is pointed at by the playbooks and is not in the archive`);
    assert.ok(text(rel).length > 500, `${rel} is too short to be the guidance eight files defer to`);
  }
});

// A pointer into the plugin's own tree is the one kind of playbook mistake a
// machine can catch: it is either a file or it is not. A `*` is a permission
// pattern, not a path, so it is skipped.
test("every path a playbook points at inside the plugin actually resolves", () => {
  const seen = [];
  for (const rel of playbooks()) {
    for (const m of text(rel).matchAll(/[$][{]CLAUDE_PLUGIN_ROOT[}]\/([\w./-]+)/g)) {
      seen.push(m[1]);
      assert.ok(there(m[1]), `${rel} points at ${m[1]}, which is not in the archive`);
    }
  }
  assert.ok(seen.length >= 8, `only ${seen.length} plugin-root pointers found — the reference wiring is gone`);
});

test("every skill and every agent defers to the shared tool reference", () => {
  const owing = playbooks().filter((rel) => text(rel).includes("references/tools.md"));
  assert.ok(owing.length >= 8, `only ${owing.length} playbooks point at the tool reference`);
  for (const rel of agentFiles()) assert.ok(text(rel).includes("references/tools.md"), `${rel} names no tool guidance at all`);
});

// A plugin subagent with no name, or a name and no description, is skipped by
// the host WITHOUT saying so: it simply never appears.
test("every agent carries the frontmatter a host needs to load it", () => {
  for (const rel of agentFiles()) {
    const fm = frontmatter(rel);
    assert.match(fm, /^name: [a-z][a-z-]*$/m, `${rel} has no loadable name`);
    assert.match(fm, /^description:/m, `${rel} has no description, so the host will skip it`);
    assert.match(fm, /^tools:/m, `${rel} declares no tools, so it inherits every one of them`);
  }
});

test("no agent declares a key a plugin host ignores", () => {
  for (const rel of agentFiles()) {
    for (const key of IGNORED_ON_PLUGIN_AGENTS) {
      assert.doesNotMatch(frontmatter(rel), new RegExp(`^${key}:`, "m"), `${rel} sets ${key}, which a plugin subagent silently ignores — it reads as a restriction that is not in force`);
    }
  }
});

// A grant is a convenience, and a broad one is a convenience bought with the
// user's permission prompt. Every rule here names the tool AND narrows it.
test("no skill grants an unrestricted tool", () => {
  const grants = skillFiles().flatMap((rel) => [...frontmatter(rel).matchAll(/^ {2}- (.+)$/gm)].map((m) => [rel, m[1].trim()]));
  assert.ok(grants.length >= 20, `only ${grants.length} grants found — allowed-tools is not being read`);
  for (const [rel, g] of grants) {
    assert.notEqual(g, "*", `${rel} grants every tool there is`);
    assert.notEqual(g, "Bash", `${rel} grants an unrestricted shell — name the commands instead`);
  }
});

// The whole point of the introspection view is that a specialist learns the
// current contract by ASKING. An agent that tells its reader to go and read
// src/dsl/ instead has reintroduced "read the engine to write a test", and one
// that carries the contract in its own prose has made a second definition.
test("the DSL specialists learn the vocabulary from the engine, not from the source", () => {
  for (const name of ["orbit-dsl-doctor.md", "orbit-qa-case-writer.md"]) {
    const said = text(join("agents", name));
    assert.match(said, /query\.mjs verb/, `${name} never asks the engine what a verb is`);
    assert.match(said, /query\.mjs field/, `${name} never asks the engine what a field is`);
    assert.doesNotMatch(said, /src\/dsl\//, `${name} sends its reader into the engine source instead of asking it`);
  }
});

// Nine classes, and each has to appear in the agent that owns the routing --
// otherwise a class the engine can produce has nowhere to go.
test("the analyst names every class the engine can classify, and the parent routes each one", () => {
  const analyst = text(join("agents", "orbit-failure-analyst.md"));
  const parent = text(join("skills", "orbit-test-suite", "SKILL.md"));
  for (const type of TYPES) {
    assert.ok(analyst.includes(type), `the analyst never mentions ${type}`);
    assert.ok(parent.includes(type), `orbit-test-suite routes nowhere for ${type}`);
  }
});

// The analyst reads and the healer proposes; neither may be the thing that
// edits the map. Withholding the tool is the only version of that rule a model
// cannot talk itself out of.
test("the analyst cannot write, and neither agent can edit the map in place", () => {
  const tools = (rel) => parsedFrontmatter(text(rel)).tools;
  const analyst = tools(join("agents", "orbit-failure-analyst.md"));
  assert.ok(!analyst.includes("Write") && !analyst.includes("Edit"), "an analyst that can write is not an analyst");
  for (const name of readdirSync(join(ROOT, "agents"))) {
    assert.ok(!tools(join("agents", name)).includes("Agent"), `${name} can spawn subagents — the parent session orchestrates`);
  }
  assert.ok(!tools(join("agents", "orbit-map-healer.md")).includes("Edit"), "the healer proposes a patch; it never edits graph/edges.json");
  const doctor = tools(join("agents", "orbit-dsl-doctor.md"));
  assert.ok(doctor.includes("Edit") && doctor.includes("Write"), "the doctor repairs a case file, so it needs both");
});
