import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { azureUrls, cloneUrlOf, parseAccounts, parseProfile, parseRefs, parseRepositories } from "./azure-parse.js";

const REPO_ID = "278d5cd2-584d-4b63-824a-2ba458937249";

test("the profile, the organizations and the URLs asked of the Azure DevOps REST API", () => {
  assert.deepEqual(parseProfile('{"id":"d6245f20-2af8-44f4-9451-8107cb2767db","displayName":"Octo","emailAddress":"octo@example.com"}'), { id: "d6245f20-2af8-44f4-9451-8107cb2767db", displayName: "Octo", email: "octo@example.com" });
  assert.equal(parseProfile('{"id":"not-a-guid"}'), null);
  assert.equal(parseProfile("az: error"), null);
  assert.deepEqual(parseAccounts('{"count":3,"value":[{"accountName":"Fabrikam"},{"accountName":"--evil"},{"accountName":"Fabrikam"},{"accountName":"NormalPaulk"}]}'), ["Fabrikam", "NormalPaulk"]);
  assert.equal(azureUrls.repositories("Fabrikam"), "https://dev.azure.com/Fabrikam/_apis/git/repositories?api-version=7.1");
  assert.equal(azureUrls.refs("Fabrikam", REPO_ID), `https://dev.azure.com/Fabrikam/_apis/git/repositories/${REPO_ID}/refs?filter=heads/&api-version=7.1`);
});

test("a repository is kept with an https clone URL on Azure DevOps and no user name in it; anything else is dropped", () => {
  const stdout = JSON.stringify({
    value: [
      { id: REPO_ID.toUpperCase(), name: "Web", project: { name: "Fiber", visibility: "private", lastUpdateTime: "2026-01-01T00:00:00Z" }, defaultBranch: "refs/heads/main", remoteUrl: "https://Fabrikam@dev.azure.com/Fabrikam/Fiber/_git/Web", isDisabled: false },
      { id: "66efb083-777a-4cac-a350-a24b046be6be", name: "Old", project: { name: "Fiber", visibility: "public" }, remoteUrl: "https://fabrikam.visualstudio.com/Fiber/_git/Old", isDisabled: true, isFork: true },
      { id: "11111111-2222-3333-4444-555555555555", name: "Elsewhere", project: { name: "Fiber" }, remoteUrl: "https://evil.example/Fiber/_git/x" },
      { id: "22222222-2222-3333-4444-555555555555", name: "Secret", project: { name: "Fiber" }, remoteUrl: "https://user:pat@dev.azure.com/Fabrikam/Fiber/_git/Secret" },
      { id: "nope", name: "Bad", project: { name: "Fiber" }, remoteUrl: "https://dev.azure.com/Fabrikam/Fiber/_git/Bad" },
    ],
  });
  const repos = parseRepositories(stdout, "Fabrikam");
  assert.deepEqual(
    repos.map((r) => [r.id, r.fullName, r.private, r.defaultBranch, r.archived, r.fork, r.cloneUrl]),
    [
      [`Fabrikam/${REPO_ID}`, "Fabrikam/Fiber/Web", true, "main", false, false, "https://dev.azure.com/Fabrikam/Fiber/_git/Web"],
      ["Fabrikam/66efb083-777a-4cac-a350-a24b046be6be", "Fabrikam/Fiber/Old", false, null, true, true, "https://fabrikam.visualstudio.com/Fiber/_git/Old"],
    ],
  );
  assert.equal(repos[0]?.source, "azure");
  assert.equal(repos[0]?.project, "Fiber");
  assert.equal(cloneUrlOf("http://dev.azure.com/F/P/_git/R", "F"), null, "https only");
  assert.equal(cloneUrlOf("https://dev.azure.com/F/P/_git/R?x=1", "F"), null);
});

test("branches are the heads, the default one marked", () => {
  const refs = JSON.stringify({ value: [{ name: "refs/heads/main", objectId: "ffe9", isLocked: true }, { name: "refs/heads/feature/x", objectId: "917" }, { name: "refs/tags/v1", objectId: "1" }] });
  assert.deepEqual(parseRefs(refs, "main"), [
    { name: "main", protected: true, commit: "ffe9", isDefault: true },
    { name: "feature/x", protected: false, commit: "917", isDefault: false },
  ]);
});

// The image's git credential helper, run the way git runs it, with a stand-in `az` first on PATH.
function webRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "docker", "git-credential-azure-cli.mjs"))) dir = dirname(dir);
  return dir;
}

const scratch = mkdtempSync(join(tmpdir(), "ow-helper-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function helper(action: string, input: string, azToken = "eyJ0eXAi.token.value"): { stdout: string; stderr: string; asked: string } {
  const bin = join(scratch, "bin");
  mkdirSync(bin, { recursive: true });
  const log = join(scratch, "asked.log");
  writeFileSync(join(bin, "az"), `#!/bin/sh\necho "$@" > "${log}"\necho "$AZURE_CONFIG_DIR" >> "${log}"\nprintf '%s\\n' '${azToken}'\n`);
  chmodSync(join(bin, "az"), 0o755);
  rmSync(log, { force: true });
  const r = spawnSync(process.execPath, [join(webRoot(), "docker", "git-credential-azure-cli.mjs"), action], { input, encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH}`, AZURE_CONFIG_DIR: "/data/azure" } });
  return { stdout: r.stdout, stderr: r.stderr, asked: existsSync(log) ? (spawnSync("cat", [log], { encoding: "utf8" }).stdout ?? "") : "" };
}

test("the credential helper answers git for Azure DevOps only, from the Azure CLI's own profile, and stores nothing", () => {
  const ok = helper("get", "protocol=https\nhost=dev.azure.com\npath=Fabrikam/Fiber/_git/Web\n\n");
  assert.equal(ok.stdout, "username=orbit-web\npassword=eyJ0eXAi.token.value\n");
  assert.match(ok.asked, /^account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken --output tsv\n\/data\/azure\n$/);
  assert.equal(helper("get", "protocol=https\nhost=fabrikam.visualstudio.com\n\n").stdout.startsWith("username=orbit-web\n"), true);
  for (const input of ["protocol=https\nhost=github.com\n\n", "protocol=http\nhost=dev.azure.com\n\n", "protocol=https\nhost=dev.azure.com.evil.example\n\n"]) {
    const r = helper("get", input);
    assert.equal(r.stdout, "", input);
    assert.equal(r.asked, "", `the Azure CLI is not even asked for ${input}`);
  }
  for (const action of ["store", "erase"]) assert.equal(helper(action, "protocol=https\nhost=dev.azure.com\npassword=x\n\n").stdout, "");
  const none = helper("get", "protocol=https\nhost=dev.azure.com\n\n", "");
  assert.equal(none.stdout, "");
  assert.match(none.stderr, /no Azure DevOps token/);
});
