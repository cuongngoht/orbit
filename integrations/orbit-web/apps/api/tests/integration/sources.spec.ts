// Azure DevOps as the second repository source: its organizations, repositories and branches come from `az rest` with
// the Azure CLI's own profile (the CLI holds the token); a repository opens only if the listing has it; its clone uses
// the image's one-shot credential helper, and nothing of a credential is written into the workspace.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { BranchList, RepositoryList, SessionDetail, SessionSummary, SourcesStatus } from "@orbit-web/contracts";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { FakeProcessPort, program, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { AZURE, AZURE_REPOSITORY, azureSignedIn, claudeRun, eventually, gitClone, signedIn, startHarness, type Harness } from "../../src/testing/harness.js";

const quickRun = (c: FakeChild, call: Call) =>
  c.onInputClosed(() => {
    c.line({ type: "system", subtype: "init", cwd: call.cwd, session_id: call.args[call.args.indexOf("--session-id") + 1], model: "claude-sonnet-5-5", claude_code_version: "2.1.328", plugins: [{ name: "orbit" }] });
    c.line({ type: "result", subtype: "success", is_error: false, result: "ok", total_cost_usd: 0, num_turns: 1, duration_ms: 1, permission_denials: [] });
    c.exit(0);
  });

describe("Azure DevOps as a repository source", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  before(async () => {
    fake = azureSignedIn(signedIn(new FakeProcessPort(new NodeProcessPort()))).on(claudeRun, { spawn: quickRun });
    h = await startHarness({ fake });
  });
  after(() => h.close());

  test("the sources say which can list repositories, and as whom", async () => {
    const status = (await h.get("/api/sources")).body as SourcesStatus;
    assert.deepEqual(status.sources, [
      { source: "github", state: "connected", account: "octo" },
      { source: "azure", state: "connected", account: AZURE.user },
    ]);
  });

  test("organizations, repositories and branches come from az rest, with the Azure CLI's own profile", async () => {
    const list = (await h.get("/api/repositories?source=azure")).body as RepositoryList;
    assert.equal(list.source, "azure");
    assert.deepEqual(
      list.repositories.map((r) => [r.source, r.id, r.fullName, r.owner, r.project, r.name, r.defaultBranch]),
      [["azure", AZURE_REPOSITORY, "Fabrikam/Fiber/Web", "Fabrikam", "Fiber", "Web", "main"]],
    );
    assert.equal(JSON.stringify(list).includes("dev.azure.com"), false, "the clone URL stays on the server");
    const branches = (await h.get(`/api/repositories/branches?source=azure&id=${AZURE_REPOSITORY}`)).body as BranchList;
    assert.deepEqual(branches.branches.map((b) => [b.name, b.isDefault]), [["main", true], ["dev", false]]);
    const rest = fake.callsOf(program("az", "rest"));
    assert.ok(rest.length >= 4);
    for (const c of rest) {
      assert.equal(c.args[c.args.indexOf("--resource") + 1], "499b84ac-1321-427f-aa17-267ca6975798");
      assert.equal(c.args[c.args.indexOf("--method") + 1], "get");
      assert.equal(c.env.AZURE_CONFIG_DIR, h.config.data.azure);
    }
    assert.equal(fake.callsOf(program("az", "account", "get-access-token")).length, 0, "Orbit Web never asks for a token");
    assert.equal((await h.get("/api/repositories/branches?source=azure&id=Fabrikam/11111111-2222-3333-4444-555555555555")).status, 403);
    assert.equal((await h.get("/api/repositories/branches?source=azure&id=Fabrikam/Fiber/Web")).status, 400);
  });

  test("a chat on an Azure repository is cloned with the one-shot credential helper, and nothing of it is written", async () => {
    const created = await h.send("POST", "/api/sessions", { repository: { source: "azure", id: AZURE_REPOSITORY }, model: "sonnet", prompt: "Look around." });
    assert.equal(created.status, 201);
    const session = created.body as SessionSummary;
    assert.deepEqual([session.source, session.repository, session.branch], ["azure", "Fabrikam/Fiber/Web", "main"], "no branch named: the default one");
    await eventually(async () => ((await h.get(`/api/sessions/${session.id}`)).body as SessionDetail).status, (s) => s === "completed");
    const clone = fake.callsOf(gitClone).at(-1) as Call;
    const helperAt = clone.args.indexOf(`credential.helper=${h.config.binaries.azureGitHelper}`);
    assert.ok(helperAt > 0 && clone.args[helperAt - 2] === "credential.helper=" && clone.args[helperAt - 3] === "-c", "every other helper is reset first");
    assert.deepEqual(clone.args.slice(-3), ["--", "https://dev.azure.com/Fabrikam/Fiber/_git/Web", "repository"], "the listing's URL, without its user name");
    assert.equal(clone.args[clone.args.indexOf("--branch") + 1], "main");
    assert.equal(clone.env.AZURE_CONFIG_DIR, h.config.data.azure);
    assert.equal(clone.env.GIT_TERMINAL_PROMPT, "0");
    const config = readFileSync(join(h.config.data.workspaces, session.id, "repository", ".git", "config"), "utf8");
    assert.doesNotMatch(config, /credential|helper|token|password/i, "nothing of a credential is written into the workspace");
    assert.match(config, new RegExp(`email = ${AZURE.user.replace(".", "\\.")}`), "commits carry the Azure account's address");
    const claude = fake.children.find((c) => claudeRun(c.call.file, c.call.args))?.call as Call;
    assert.equal(claude.env.AZURE_CONFIG_DIR, undefined, "Claude Code is not given the Azure sign-in unless a person allows it");
  });
});

describe("Azure DevOps before the Azure sign-in", () => {
  let h: Harness;
  before(async () => (h = await startHarness({ fake: signedIn(new FakeProcessPort(new NodeProcessPort())) })));
  after(() => h.close());

  test("its repositories, and a chat on one, wait for it", async () => {
    const list = await h.get("/api/repositories?source=azure");
    assert.equal(list.status, 409);
    assert.equal((list.body as { error: { code: string } }).error.code, "azure_not_connected");
    const created = await h.send("POST", "/api/sessions", { repository: { source: "azure", id: AZURE_REPOSITORY }, model: "sonnet" });
    assert.equal(created.status, 409);
    const status = (await h.get("/api/sources")).body as SourcesStatus;
    assert.deepEqual(status.sources.map((s) => [s.source, s.state]), [["github", "connected"], ["azure", "not_connected"]]);
  });
});
