// The mini-SWE-agent arms: the skill listing read from a plugin's SKILL.md files, the two arms' declarations (on the
// host, no network and no credential for the container, the same plugin archive as the Claude Code plugin arm), the
// credential handed to the driver alone and under the name its client reads, a mini run's stream read as any host's,
// and a run whose credential is absent being NOT_RUN. The driver itself is proven by the self-check (Docker).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { armOf } from "../lib/arms/index.mjs";
import { BUILTIN_PLUGINS, HOME_FILES } from "../lib/arms/claude.mjs";
import { driverEnv, frontmatterOf, INTERPRETER, listingOf, MINI_CREDENTIAL, MINI_CREDENTIAL_AS, skillsOf } from "../lib/arms/mini.mjs";
import { summaryOf } from "../lib/core/stream.mjs";
import { missingCredentials } from "../lib/run/campaign.mjs";

const fixture = (name) => readFileSync(join(import.meta.dirname, "fixtures", "streams", name), "utf8");

function plugin() {
  const dir = mkdtempSync(join(tmpdir(), "evl-mini-"));
  const skill = (id, text) => (mkdirSync(join(dir, "skills", id), { recursive: true }), writeFileSync(join(dir, "skills", id, "SKILL.md"), text));
  skill("alpha", "---\nname: alpha\ndescription: >\n  Folds these\n  two lines.\nuser-invocable: true\n---\n# body");
  skill("beta", '---\nname: beta\ndescription: "A quoted one."\n---\n');
  skill("gamma", "---\nname: gamma\ndescription: |\n  Kept\n  as lines.\n---\n");
  skill("hidden", "---\nname: hidden\ndescription: Never listed.\ndisable-model-invocation: true\n---\n");
  skill("nameless", "---\ndescription: No name, not a skill a host lists.\n---\n");
  mkdirSync(join(dir, "skills", "no-skill-md"));
  return dir;
}

test("a SKILL.md frontmatter: plain, quoted, folded and literal values, and the hidden flag", () => {
  assert.deepEqual(frontmatterOf("---\nname: a\ndescription: >\n  one\n  two\n---\n"), { name: "a", description: "one two", hidden: false });
  assert.deepEqual(frontmatterOf("---\nname: 'b'\ndescription: |\n  x\n  y\nother: 1\n---"), { name: "b", description: "x\ny", hidden: false });
  assert.equal(frontmatterOf("---\nname: c\ndescription: d\ndisable-model-invocation: true\n---").hidden, true);
  assert.deepEqual(frontmatterOf("no frontmatter"), { name: null, description: null, hidden: false });
});

test("the listing: every skill a host would list, by name and description, and how to use one -- listed, never ordered", () => {
  const dir = plugin();
  try {
    assert.deepEqual(skillsOf(dir).map((s) => [s.id, s.description]), [["alpha", "Folds these two lines."], ["beta", "A quoted one."], ["gamma", "Kept\nas lines."]]);
    const text = listingOf(dir, "/opt/p");
    assert.match(text, /- alpha \(\/opt\/p\/skills\/alpha\/SKILL\.md\): Folds these two lines\./);
    assert.match(text, /read \/opt\/p\/skills\/<id>\/SKILL\.md and follow it/);
    assert.match(text, /`node \/opt\/p\/cli\/<x>\.mjs \.\.\.`; ORBIT_STORE_DIR is already set/);
    assert.doesNotMatch(text, /hidden|nameless|\b(must|always|should|required)\b/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the mini arms: on the host, the container with no network and no credential, the plugin arm needing a rev", () => {
  const plain = armOf("m", { kind: "mini" });
  const orbit = armOf("o", { kind: "mini+orbit", rev: "v0.5.0" });
  for (const a of [plain, orbit]) {
    assert.equal(a.runsOn, "host");
    assert.equal(a.needsNetwork, false);
    assert.deepEqual(a.containerCredentialNames, []);
    assert.deepEqual(a.credentialNames, [MINI_CREDENTIAL]);
    assert.equal(a.charges, true);
  }
  assert.equal(plain.pluginDir, null);
  assert.equal(orbit.pluginDir, "/opt/orbit-plugin");
  assert.throws(() => armOf("o", { kind: "mini+orbit" }), /rev/);
  assert.throws(() => armOf("m", { kind: "mini", rev: "v0.5.0" }), /no rev/);
  assert.throws(() => armOf("m", { kind: "mini", effort: "high" }), /not a field/);
  const det = armOf("d", { kind: "mini+orbit", rev: "HEAD", deterministic: "gold" });
  assert.equal(det.charges, false);
  assert.deepEqual(det.credentialNames, []);
  assert.deepEqual(INTERPRETER, ["bash", "-c"]);
});

test("the driver's environment: the credential under the name its client reads, and no other credential at all", () => {
  const env = { PATH: "/bin", HOME: "/h", HTTPS_PROXY: "http://p", [MINI_CREDENTIAL]: "sk-test-value-0123456789", CLAUDE_CODE_OAUTH_TOKEN: "oauth-x", ORBIT_CODE_OAUTH_TOKEN: "oauth-y", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "http://elsewhere", OTHER: "o" };
  const ctx = { caFile: "/ca.pem", configDir: "/cfg" };
  const e = driverEnv(ctx, [MINI_CREDENTIAL], env);
  assert.equal(e[MINI_CREDENTIAL_AS], env[MINI_CREDENTIAL]);
  for (const n of [MINI_CREDENTIAL, "CLAUDE_CODE_OAUTH_TOKEN", "ORBIT_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "OTHER"]) assert.equal(e[n], undefined, n);
  assert.equal(e.HTTPS_PROXY, "http://p");
  assert.equal(e.SSL_CERT_FILE, "/ca.pem");
  assert.equal(e.MSWEA_GLOBAL_CONFIG_DIR, "/cfg");
  assert.equal(driverEnv(ctx, [], env)[MINI_CREDENTIAL_AS], undefined);
});

test("a run whose arm's credential the controller lacks: named as missing, by name only", () => {
  const arm = armOf("m", { kind: "mini" });
  assert.deepEqual(missingCredentials(arm, {}), [MINI_CREDENTIAL]);
  assert.deepEqual(missingCredentials(arm, { [MINI_CREDENTIAL]: "" }), [MINI_CREDENTIAL]);
  assert.deepEqual(missingCredentials(arm, { [MINI_CREDENTIAL]: "set" }), []);
  assert.deepEqual(missingCredentials(armOf("d", { kind: "mini", deterministic: "gold" }), {}), []);
});

test("a mini run's stream reads as any host's: status, calls, the plugin's skills listed and its command counted", () => {
  const s = summaryOf(fixture("mini-done.jsonl"), { pluginDir: "/opt/orbit-plugin" });
  assert.equal(s.started, true);
  assert.equal(s.status, "DONE");
  assert.equal(s.turns, 4);
  assert.equal(s.costUsd, 0);
  assert.equal(s.stoppedOn, null);
  assert.equal(s.skillsListed, 25);
  assert.deepEqual(s.plugins, ["orbit@0.5.0"]);
  assert.deepEqual(s.orbit, { commands: 1, byCli: { query: 1 } });
  const budget = summaryOf('{"type":"system","subtype":"init","model":"m"}\n{"type":"result","subtype":"error_max_budget_usd","is_error":true,"num_turns":12,"total_cost_usd":1.02,"result":""}\n');
  assert.equal(budget.stoppedOn, "budget");
  const api = summaryOf('{"type":"system","subtype":"init","model":"m"}\n{"type":"result","subtype":"error_during_execution","is_error":true,"num_turns":0,"total_cost_usd":0,"result":"API Error: AuthenticationError: invalid x-api-key"}\n');
  assert.match(api.apiError, /AuthenticationError/);
});

test("the Claude Code arms switch off the host's built-in plugins, both alike, in the run's own home", () => {
  const a = armOf("p", { kind: "claude" });
  const b = armOf("o", { kind: "claude+orbit", rev: "v0.5.0" });
  assert.deepEqual(a.homeFiles, b.homeFiles);
  assert.equal(a.homeFiles, HOME_FILES);
  const settings = JSON.parse(HOME_FILES[0].text);
  assert.deepEqual(Object.keys(settings.enabledPlugins).sort(), BUILTIN_PLUGINS.map((p) => `${p}@builtin`).sort());
  assert.ok(Object.values(settings.enabledPlugins).every((v) => v === false));
  assert.match(HOME_FILES[0].path, /^\/work\/home\/\.claude\/settings\.json$/);
});
