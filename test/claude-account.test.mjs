// Who is signed in to Claude Code on THIS machine, for Orbit Control's top bar:
// read from this machine's own Claude configuration, and only the profile --
// never a token, an API key, a server's secret, or any other file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createClaudeAccount, PROFILE } from "../skills/orbit-learn/hosts/claude-account.mjs";

const HOME = "/home/someone";

// A configuration with everything a real one may hold beside the profile.
const config = (over = {}) => JSON.stringify({
  oauthAccount: { displayName: "Lan Nguyen", emailAddress: "lan@example.test", organizationName: "Example Co", organizationRole: "admin", accountUuid: "0000-aaaa", organizationUuid: "0000-bbbb", billingType: "stripe" },
  primaryApiKey: "sk-ant-api03-NEVER-LEAVES",
  mcpServers: { corp: { type: "http", url: "https://corp.example/mcp", headers: { Authorization: "Bearer mcp-secret-777" } } },
  ...over,
});

function machine(files, env = {}) {
  const reads = [];
  const io = { read: (p) => (reads.push(p), files[p] ?? null) };
  return { reads, account: () => createClaudeAccount({ env, home: HOME, io }).account() };
}

test("the signed-in profile -- name, email, organization, role -- and nothing else in the file", () => {
  const m = machine({ [join(HOME, ".claude.json")]: config() });
  assert.deepEqual(m.account(), { signedIn: true, displayName: "Lan Nguyen", email: "lan@example.test", organization: "Example Co", role: "admin" });
  const said = JSON.stringify(m.account());
  for (const secret of ["sk-ant-api03", "NEVER-LEAVES", "mcp-secret", "0000-aaaa", "stripe"]) assert.equal(said.includes(secret), false, secret);
  assert.deepEqual(PROFILE.map(([, to]) => to), ["displayName", "email", "organization", "role"]);
});

test("it reads exactly ONE file -- this machine's Claude configuration -- never a credentials file or anything else", () => {
  const m = machine({ [join(HOME, ".claude.json")]: config() });
  m.account();
  m.account();
  assert.deepEqual([...new Set(m.reads)], [join(HOME, ".claude.json")]);
});

test("each machine answers with its own: CLAUDE_CONFIG_DIR relocates the file it reads", () => {
  const m = machine({ [join("/cfg", ".claude.json")]: config({ oauthAccount: { displayName: "Other Person", emailAddress: "other@example.test" } }) }, { CLAUDE_CONFIG_DIR: "/cfg" });
  assert.deepEqual(m.account(), { signedIn: true, displayName: "Other Person", email: "other@example.test" });
  assert.deepEqual(m.reads, [join("/cfg", ".claude.json")]);
});

test("no profile, no file, or a file that is not JSON: 'no profile', never an error", () => {
  assert.deepEqual(machine({ [join(HOME, ".claude.json")]: config({ oauthAccount: undefined }) }).account(), { signedIn: false });
  assert.deepEqual(machine({}).account(), { signedIn: false });
  assert.deepEqual(machine({ [join(HOME, ".claude.json")]: "{ not json" }).account(), { signedIn: false });
  assert.deepEqual(machine({ [join(HOME, ".claude.json")]: JSON.stringify({ oauthAccount: ["odd"] }) }).account(), { signedIn: false });
});

test("a profile field is text, trimmed and bounded; an empty or non-text one is left out", () => {
  const m = machine({ [join(HOME, ".claude.json")]: config({ oauthAccount: { displayName: `  ${"x".repeat(500)}  `, emailAddress: 42, organizationName: "   " } }) });
  const found = m.account();
  assert.deepEqual([found.signedIn, found.displayName.length, "email" in found, "organization" in found], [true, 200, false, false]);
});
