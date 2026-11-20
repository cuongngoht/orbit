import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { orbitPluginDir } from "../../testing/harness.js";
import { pluginCommands } from "./slash-commands.js";

const base = mkdtempSync(join(tmpdir(), "ow-slash-"));
after(() => rmSync(base, { recursive: true, force: true }));

function plugin(name: string, files: Record<string, string>): string {
  const root = join(base, name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const md = (fields: string) => `---\n${fields}\n---\nBody.\n`;

test("a plugin's skills and commands, by the names Claude Code gives them: the skill's directory, a command's path", () => {
  const dir = plugin("probe", {
    ".claude-plugin/plugin.json": JSON.stringify({ name: "probe", version: "0.0.0" }),
    "skills/hello/SKILL.md": md('name: hello\ndescription: Says hello\nargument-hint: "<who>"'),
    "skills/alpha-dir/SKILL.md": md("name: beta-name\ndescription: Named by its directory"),
    "skills/hidden/SKILL.md": md("name: hidden\ndescription: Not for people\nuser-invocable: false"),
    "skills/empty/notes.md": "no SKILL.md here",
    "commands/greet.md": md("description: Greets"),
    "commands/team/deploy.md": md("description: Deploys the team's app"),
    "commands/readme.txt": "not a command",
  });
  assert.deepEqual(pluginCommands(dir, "project"), [
    { name: "probe:alpha-dir", description: "Named by its directory", argumentHint: null, kind: "skill", origin: "project" },
    { name: "probe:hello", description: "Says hello", argumentHint: "<who>", kind: "skill", origin: "project" },
    { name: "probe:greet", description: "Greets", argumentHint: null, kind: "command", origin: "project" },
    { name: "probe:team:deploy", description: "Deploys the team's app", argumentHint: null, kind: "command", origin: "project" },
  ]);
});

test("nothing from a plugin without a manifest name Claude Code would accept, and nothing through a symlink", () => {
  assert.deepEqual(pluginCommands(plugin("no-manifest", { "skills/x/SKILL.md": md("description: x") }), "project"), []);
  assert.deepEqual(pluginCommands(plugin("bad-name", { ".claude-plugin/plugin.json": JSON.stringify({ name: "../evil" }), "skills/x/SKILL.md": md("description: x") }), "project"), []);
  const outside = plugin("outside", { "skills/secret/SKILL.md": md("description: outside the plugin") });
  const linked = plugin("linked", { ".claude-plugin/plugin.json": JSON.stringify({ name: "linked" }) });
  symlinkSync(join(outside, "skills"), join(linked, "skills"));
  assert.deepEqual(pluginCommands(linked, "project"), []);
  assert.deepEqual(pluginCommands(join(base, "missing"), "project"), []);
});

test("Orbit's own plugin: every skill a person may run, as orbit:<skill>", () => {
  const orbit = pluginCommands(orbitPluginDir(), "orbit");
  assert.ok(orbit.length > 10);
  assert.ok(orbit.every((c) => c.name.startsWith("orbit:") && c.origin === "orbit"));
  const help = orbit.find((c) => c.name === "orbit:orbit-help");
  assert.equal(help?.kind, "skill");
  assert.ok((help?.description ?? "").length > 0);
});
