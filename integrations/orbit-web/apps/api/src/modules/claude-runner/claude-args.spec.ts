import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeArgs } from "./claude-args.js";

const base = { model: "sonnet" as const, pluginDir: "/opt/orbit/plugin", sessionId: "11111111-2222-3333-4444-555555555555", resume: false, webTools: false, azure: false, maxBudgetUsd: null, protectedDirs: ["/data/claude", "/data/github"] };

const after = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1];

test("the first turn names its session id; a later turn resumes it", () => {
  const first = claudeArgs(base);
  assert.equal(after(first, "--session-id"), base.sessionId);
  assert.equal(first.includes("--resume"), false);
  const next = claudeArgs({ ...base, resume: true });
  assert.equal(after(next, "--resume"), base.sessionId);
  assert.equal(next.includes("--session-id"), false);
});

test("headless, structured, partial messages, the Orbit plugin and the model alias", () => {
  const a = claudeArgs({ ...base, model: "opus" });
  assert.equal(a[0], "-p");
  assert.equal(after(a, "--output-format"), "stream-json");
  assert.ok(a.includes("--verbose") && a.includes("--include-partial-messages"));
  assert.equal(after(a, "--plugin-dir"), "/opt/orbit/plugin");
  assert.equal(after(a, "--model"), "opus");
  assert.equal(after(a, "--setting-sources"), "user", "a repository's own settings file is never read: it could redirect the CLI's traffic");
  assert.ok(a.includes("--strict-mcp-config"));
  assert.equal(a.includes("--bare"), false, "Orbit's hooks and skills must load");
});

test("permissions never ask and never bypass; pushing and gh are refused", () => {
  const a = claudeArgs(base);
  assert.equal(after(a, "--permission-mode"), "dontAsk");
  assert.equal(a.some((x) => /bypass|dangerously/i.test(x)), false);
  assert.equal(after(a, "--allowedTools"), "Read,Edit,Write,Glob,Grep,Bash,Skill,Agent,TodoWrite");
  for (const rule of ["Bash(git push:*)", "Bash(gh:*)", "Read(//data/github/**)", "Edit(//data/claude/**)", "WebFetch", "WebSearch"]) assert.ok(a.includes(rule), rule);
});

test("the web tools and a budget cap are added only when set", () => {
  const a = claudeArgs({ ...base, webTools: true, maxBudgetUsd: 2 });
  assert.match(after(a, "--allowedTools") ?? "", /WebFetch,WebSearch$/);
  assert.equal(a.includes("WebFetch") && a.indexOf("WebFetch") > a.indexOf("--disallowedTools"), false);
  assert.equal(after(a, "--max-budget-usd"), "2");
  assert.equal(claudeArgs(base).includes("--max-budget-usd"), false);
});

test("the Azure CLI is refused to Claude Code unless a person allowed it", () => {
  assert.ok(claudeArgs(base).includes("Bash(az:*)"));
  assert.equal(claudeArgs({ ...base, azure: true }).includes("Bash(az:*)"), false);
});
