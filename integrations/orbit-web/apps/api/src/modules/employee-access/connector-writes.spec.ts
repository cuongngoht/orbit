// GOVERNED PR PROPOSALS THROUGH ConnectorWrites: dry-run patch validation against a real local git repository,
// protected/default/existing branch refusals, approval creation with diffstat + fingerprint, and post-approval push + PR creation.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { BranchList, Repository } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import type { ApprovalRecord } from "../../infra/governance/stores.js";
import type { ProcessPort, RunResult } from "../../infra/process/process.port.js";
import type { GovernanceContext } from "../auth/principal.js";
import type { ApprovalAsk, ApprovalService } from "../governance/approvals.service.js";
import type { PolicyService } from "../governance/policy.service.js";
import type { GitGateway } from "../changes/git.gateway.js";
import type { SourcesService } from "../sources/sources.module.js";
import { ConnectorWrites, type ConnectorPullRequestWrite } from "./connector-writes.js";

function runRealGit(cwd: string, args: string[]): RunResult {
  try {
    const stdout = execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, signal: null, stdout, stderr: "", timedOut: false, truncated: false, spawnError: null };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, signal: null, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? ""), timedOut: false, truncated: false, spawnError: null };
  }
}

function setupFixture() {
  const root = mkdtempSync(join(tmpdir(), "orbit-pr-test-"));
  const originBare = join(root, "origin.git");
  const seed = join(root, "seed");
  const control = join(root, "control");
  mkdirSync(control, { recursive: true });
  execFileSync("git", ["init", "--bare", "--initial-branch=main", originBare]);
  execFileSync("git", ["clone", originBare, seed]);
  writeFileSync(join(seed, "README.md"), "# Toolkit\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: seed });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-m", "initial"], { cwd: seed });
  execFileSync("git", ["push", "origin", "main"], { cwd: seed });

  const ghCalls: string[][] = [];
  const asked: ApprovalAsk[] = [];
  const config = {
    binaries: { git: "git", gh: "gh", az: "az", azureGitHelper: "az-helper" },
    controlHome: control,
    githubUrl: "https://github.com",
    sourceEnv: {},
    governance: { deployment: "single" },
    limits: { commandTimeoutMs: 30_000, cloneTimeoutMs: 30_000 },
    data: { control, home: control, github: control, azure: control },
  } as unknown as AppConfig;

  const processPort = {
    run: async (_file: string, args: string[]): Promise<RunResult> => {
      ghCalls.push(args);
      return { code: 0, signal: null, stdout: JSON.stringify({ number: 7, html_url: "https://github.com/octo/toolkit/pull/7" }), stderr: "", timedOut: false, truncated: false, spawnError: null };
    },
  } as unknown as ProcessPort;

  const git = {
    controlGit: async (cwd: string, args: string[]) => runRealGit(cwd, args),
  } as unknown as GitGateway;

  const repo: Repository = { source: "github", id: "octo/toolkit", fullName: "octo/toolkit", owner: "octo", project: null, name: "toolkit", private: false, defaultBranch: "main", updatedAt: null, archived: false, fork: false };
  let remoteBranches: BranchList["branches"] = [{ name: "main", protected: true, commit: "abc", isDefault: true }];
  const sources = {
    find: async () => repo,
    authorized: async () => repo,
    branches: async (): Promise<BranchList> => ({ source: "github", repository: repo.id, branches: remoteBranches }),
    clone: async (origin: { branch: string }, destination: string, cwd: string) => runRealGit(cwd, ["clone", "--branch", origin.branch, "--single-branch", originBare, destination]),
    pushRemote: async () => ({ url: originBare, env: {}, helper: [] }),
  } as unknown as SourcesService;

  const policy = {
    decide: async () => ({ verdict: "require_approval", reasonCodes: ["REQUIRE_APPROVAL"], decisionId: "dec-1", fingerprint: "fp-pr-1" }),
  } as unknown as PolicyService;

  const approvals = {
    registerExecutor: () => undefined,
    request: async (_ctx: unknown, ask: ApprovalAsk) => {
      asked.push(ask);
      return { id: "apr-pr-1", ...ask };
    },
  } as unknown as ApprovalService;

  const writes = new ConnectorWrites(config, processPort, policy, approvals, sources, git);
  const ctx = { principal: { kind: "agent", binding: { agentId: "emp-1", runId: "run-1" } } } as unknown as GovernanceContext;

  return {
    writes,
    ctx,
    asked,
    ghCalls,
    originBare,
    setBranches: (b: BranchList["branches"]) => {
      remoteBranches = b;
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const VALID_PATCH = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
 # Toolkit
+Added status section.
`;

const PR_BASE: ConnectorPullRequestWrite = {
  connector: "github",
  operation: "pull_request",
  owner: "octo",
  container: "toolkit",
  repository: "toolkit",
  baseBranch: null,
  headBranch: "orbit/add-status",
  title: "Add status section",
  body: "Adds a status section to README.",
  commitMessage: "docs: add status section",
  patch: VALID_PATCH,
  draft: true,
};

test("proposePullRequest refuses default/protected/existing branches and bad patches before requesting approval", async () => {
  const f = setupFixture();
  try {
    const onMain = await f.writes.propose(f.ctx, { ...PR_BASE, headBranch: "main" });
    assert.equal(onMain.isError, true);
    assert.match(onMain.text, /default branch/);

    f.setBranches([
      { name: "main", protected: true, commit: "abc", isDefault: true },
      { name: "orbit/add-status", protected: false, commit: "def", isDefault: false },
    ]);
    const existing = await f.writes.propose(f.ctx, PR_BASE);
    assert.equal(existing.isError, true);
    assert.match(existing.text, /already exists/);

    f.setBranches([{ name: "main", protected: true, commit: "abc", isDefault: true }]);
    const badPatch = await f.writes.propose(f.ctx, { ...PR_BASE, patch: "diff --git a/NOPE.md b/NOPE.md\n--- a/NOPE.md\n+++ b/NOPE.md\n@@ -1 +1 @@\n-missing\n+new\n" });
    assert.equal(badPatch.isError, true);
    assert.match(badPatch.text, /does not apply cleanly/);
    assert.equal(f.asked.length, 0);
  } finally {
    f.cleanup();
  }
});

test("proposePullRequest validates patch, captures diffstat on approval, and pushes branch + opens PR when run", async () => {
  const f = setupFixture();
  try {
    const res = await f.writes.propose(f.ctx, PR_BASE);
    assert.equal(res.isError, false, res.text);
    assert.match(res.text, /approval apr-pr-1/);
    assert.equal(f.asked.length, 1);
    const ask = f.asked[0]!;
    assert.equal(ask.action, "connector.write");
    assert.deepEqual(ask.change && { files: ask.change.files, insertions: ask.change.insertions, deletions: ask.change.deletions, commits: ask.change.commits }, { files: 1, insertions: 1, deletions: 0, commits: 1 });
    assert.equal(ask.params.baseBranch, "main");

    // Fingerprint re-check is deterministic.
    const approval = { id: "apr-pr-1", params: ask.params, environment: ask.environment } as ApprovalRecord;
    const fp1 = await f.writes.fingerprintNow(approval);
    const fp2 = await f.writes.fingerprintNow(approval);
    assert.equal(fp1, fp2);

    // Running the approved action pushes the branch to originBare and calls gh api pulls.
    const done = await f.writes.run(f.ctx, approval);
    assert.equal(done.ok, true, done.outcome);
    assert.match(done.outcome, /https:\/\/github\.com\/octo\/toolkit\/pull\/7/);
    const refs = execFileSync("git", ["--git-dir", f.originBare, "branch", "--list"], { encoding: "utf8" });
    assert.match(refs, /orbit\/add-status/);
    assert.equal(f.ghCalls.length, 1);
    assert.ok(f.ghCalls[0]!.includes("repos/octo/toolkit/pulls"));
  } finally {
    f.cleanup();
  }
});
