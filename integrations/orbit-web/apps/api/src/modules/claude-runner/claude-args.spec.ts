import assert from "node:assert/strict";
import { test } from "node:test";
import { AZURE_DEVOPS_RESOURCE } from "../sources/azure-parse.js";
import { AZURE_NOTE, WORKSPACE_NOTES, claudeArgs } from "./claude-args.js";

const base = {
  model: "sonnet" as const,
  effort: "medium" as const,
  mode: "autonomous" as const,
  pluginDirs: ["/opt/orbit/plugin"],
  enabledPlugins: {},
  autoModeEnvironment: null,
  sessionId: "11111111-2222-3333-4444-555555555555",
  resume: false,
  webTools: false,
  azure: false,
  github: false,
  maxBudgetUsd: null,
  protectedDirs: ["/data/claude", "/data/github"],
};

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

test("a model that takes no effort level (the account's catalog says so) is given none", () => {
  const a = claudeArgs({ ...base, effort: null });
  assert.equal(a.includes("--effort"), false);
  assert.equal(after(a, "--model"), base.model);
});

test("the two modes are Claude Code's auto and plan modes, the effort is passed as chosen", () => {
  const a = claudeArgs({ ...base, effort: "xhigh" });
  assert.equal(after(a, "--permission-mode"), "auto");
  assert.equal(after(a, "--effort"), "xhigh");
  const plan = claudeArgs({ ...base, mode: "plan", effort: "max", model: "fable" });
  assert.equal(after(plan, "--permission-mode"), "plan");
  assert.equal(after(plan, "--effort"), "max");
  assert.equal(after(plan, "--model"), "fable");
});

test("a chat's project plugins load beside Orbit's, and its declared plugins are enabled for this run only", () => {
  const a = claudeArgs({ ...base, pluginDirs: ["/opt/orbit/plugin", "/data/sessions/s/project-plugin", "/data/workspaces/s/repository"], enabledPlugins: { "fmt@acme": true } });
  const dirs = a.flatMap((x, i) => (x === "--plugin-dir" ? [a[i + 1]] : []));
  assert.deepEqual(dirs, ["/opt/orbit/plugin", "/data/sessions/s/project-plugin", "/data/workspaces/s/repository"]);
  assert.deepEqual(JSON.parse(after(a, "--settings") ?? "{}"), { enabledPlugins: { "fmt@acme": true } });
  assert.equal(claudeArgs(base).includes("--settings"), false, "no settings flag when the project declares nothing");
  assert.equal(after(a, "--setting-sources"), "user", "the repository's own settings stay unread");
});

test("permissions never bypass; pushing and gh are refused in every mode", () => {
  const a = claudeArgs(base);
  assert.equal(a.some((x) => /bypass|dangerously/i.test(x)), false);
  assert.equal(after(a, "--allowedTools"), "Read,Edit,Write,Glob,Grep,Bash,Skill,Agent,TodoWrite");
  for (const rule of ["Bash(git push:*)", "Bash(gh:*)", "Read(//data/github/**)", "Edit(//data/claude/**)", "WebFetch", "WebSearch"]) assert.ok(a.includes(rule), rule);
});

test("Claude Code is told, in one fixed text, that it commits here and never chains a push", () => {
  const a = claudeArgs(base);
  const note = after(a, "--append-system-prompt") ?? "";
  assert.equal(note, WORKSPACE_NOTES.local);
  assert.match(note, /commit locally/);
  assert.match(note, /never chain a push or a gh command/);
  for (const other of [claudeArgs({ ...base, mode: "plan", model: "opus", effort: "max", resume: true }), claudeArgs({ ...base, webTools: true, maxBudgetUsd: 1 })]) {
    assert.equal(after(other, "--append-system-prompt"), WORKSPACE_NOTES.local, "the same text whatever the run");
  }
  assert.equal(a.filter((x) => x === "--append-system-prompt").length, 1);
});

test("a person may let Claude Code push and open pull requests: gh and git push are allowed, gh's own sign-in is not", () => {
  const a = claudeArgs({ ...base, github: true });
  for (const allowed of ["Bash(git push:*)", "Bash(gh:*)"]) assert.equal(a.includes(allowed), false, allowed);
  const kept = ["Bash(gh auth:*)", "Bash(gh api:*)", "Bash(gh extension:*)", "Bash(gh workflow:*)", "Bash(gh release:*)", "Bash(gh gist:*)", "Bash(gh secret:*)", "Bash(gh repo delete:*)", "Bash(gh repo edit:*)"];
  for (const rule of [...kept, "Bash(git credential:*)", "Bash(git config --global:*)", "Read(//data/github/**)", "Edit(//data/github/**)"]) assert.ok(a.includes(rule), rule);
  assert.equal(a.some((x) => /^Bash\(gh (pr|repo create|repo view)/.test(x)), false, "pull requests and the repository itself stay usable");
  const note = after(a, "--append-system-prompt") ?? "";
  assert.equal(note, WORKSPACE_NOTES.github);
  assert.match(note, /open a pull request with gh/);
  assert.match(note, /never force-push/);
  assert.equal(a.some((x) => /bypass|dangerously/i.test(x)), false);
});

test("the web tools are refused when switched off, and otherwise never pre-approved: each fetch goes to the classifier", () => {
  const a = claudeArgs({ ...base, webTools: true, maxBudgetUsd: 2 });
  assert.equal(after(a, "--allowedTools")?.split(",").some((t) => t.startsWith("Web")), false, "a fetch can carry data in its URL: it is reviewed, never let through by a rule");
  assert.equal(a.includes("WebFetch") || a.includes("WebSearch"), false, "and not refused");
  const off = claudeArgs({ ...base, webTools: false });
  assert.ok(off.indexOf("WebFetch") > off.indexOf("--disallowedTools") && off.includes("WebSearch"));
  assert.equal(after(a, "--max-budget-usd"), "2");
  assert.equal(claudeArgs(base).includes("--max-budget-usd"), false);
});

test("the Azure CLI is refused to Claude Code unless a person allowed it", () => {
  assert.ok(claudeArgs(base).includes("Bash(az:*)"));
  assert.equal(claudeArgs({ ...base, azure: true }).includes("Bash(az:*)"), false);
});

test("in Autonomous the classifier is told what is true of this place; Plan says nothing; no rule lets a network command past it", () => {
  const env = ["**Network posture**: Open internet egress"];
  assert.deepEqual(JSON.parse(after(claudeArgs({ ...base, autoModeEnvironment: env }), "--settings") ?? "{}"), { autoMode: { environment: env } });
  assert.deepEqual(JSON.parse(after(claudeArgs({ ...base, autoModeEnvironment: env, enabledPlugins: { "fmt@acme": true } }), "--settings") ?? "{}"), { enabledPlugins: { "fmt@acme": true }, autoMode: { environment: env } });
  assert.equal(claudeArgs({ ...base, mode: "plan", autoModeEnvironment: env }).includes("--settings"), false);
  const a = claudeArgs({ ...base, autoModeEnvironment: env, webTools: true });
  assert.equal(after(a, "--allowedTools")?.split(",").some((t) => /curl|wget|Bash\(|Web/.test(t)), false);
});

test("with the Azure CLI's sign-in, Claude Code is told to read Azure DevOps through az rest -- no extension -- and nothing of it otherwise", () => {
  const on = after(claudeArgs({ ...base, azure: true }), "--append-system-prompt") ?? "";
  assert.equal(on, `${WORKSPACE_NOTES.local} ${AZURE_NOTE}`);
  assert.ok(AZURE_NOTE.includes(`--resource ${AZURE_DEVOPS_RESOURCE}`), "the one resource id Orbit Web reads Azure DevOps with");
  assert.match(AZURE_NOTE, /az boards/);
  assert.match(AZURE_NOTE, /'https:\/\/dev\.azure\.com\/<organization>\/_apis\/wit\/workitems\/<id>\?\$expand=all&api-version=7\.1'/, "quoted, so a shell keeps $expand");
  assert.equal(after(claudeArgs({ ...base, azure: true, github: true }), "--append-system-prompt"), `${WORKSPACE_NOTES.github} ${AZURE_NOTE}`);
  assert.equal(after(claudeArgs(base), "--append-system-prompt")?.includes("az rest"), false);
});
