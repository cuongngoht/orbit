import assert from "node:assert/strict";
import { test } from "node:test";
import { branchFromApi, ndjson, parseAuthHosts, parseUser, repositoryFromApi, repositoryFromList } from "./gh.gateway.js";
import { readGhLogin } from "./github-auth.service.js";

test("gh auth status --json: signed out, signed in, and a broken sign-in", () => {
  assert.deepEqual(parseAuthHosts('{"hosts":{}}'), []);
  assert.deepEqual(parseAuthHosts(JSON.stringify({ hosts: { "github.com": [{ state: "success", active: true, login: "octo", tokenSource: "x" }] } })), [{ state: "success", active: true, login: "octo", error: null }]);
  assert.deepEqual(parseAuthHosts(JSON.stringify({ hosts: { "github.com": [{ state: "error", active: true, login: "octo", error: "token expired" }] } })), [{ state: "error", active: true, login: "octo", error: "token expired" }]);
  assert.equal(parseAuthHosts("You are not logged into any GitHub hosts."), null);
});

test("gh api user gives the login, id and name", () => {
  assert.deepEqual(parseUser('{"login":"octo","id":42,"name":"Octo Cat","email":null}'), { login: "octo", id: 42, name: "Octo Cat" });
  assert.equal(parseUser("{}"), null);
});

test("the device flow's one-time code and URL are read exactly as gh printed them", () => {
  const out = "! First copy your one-time code: AB12-CD34\nOpen this URL to continue in your web browser: https://github.com/login/device\n";
  assert.deepEqual(readGhLogin(out), { code: "AB12-CD34", url: "https://github.com/login/device", message: null });
  const done = readGhLogin(`${out}✓ Authentication complete.\n✓ Logged in as octo\n`);
  assert.match(done.message ?? "", /accepted/);
  assert.deepEqual(readGhLogin("nothing yet"), { code: null, url: null, message: null });
  const failed = readGhLogin('failed to authenticate via web browser: Post "https://github.com/login/device/code": tls: failed');
  assert.equal(failed.url, null, "a URL inside an error message is not a URL to open");
});

test("repository and branch rows from the API and from gh repo list", () => {
  const rows = ndjson('{"full_name":"o/r","name":"r","owner":"o","private":true,"default_branch":"main","updated_at":"2026-01-01T00:00:00Z","archived":false,"fork":true}\nnot json\n');
  assert.equal(rows.length, 1);
  assert.deepEqual(repositoryFromApi(rows[0] as Record<string, unknown>), { source: "github", id: "o/r", fullName: "o/r", owner: "o", project: null, name: "r", private: true, defaultBranch: "main", updatedAt: "2026-01-01T00:00:00Z", archived: false, fork: true });
  assert.deepEqual(repositoryFromList({ nameWithOwner: "o/s", isPrivate: false, defaultBranchRef: { name: "trunk" }, updatedAt: null, isArchived: true, isFork: false }), { source: "github", id: "o/s", fullName: "o/s", owner: "o", project: null, name: "s", private: false, defaultBranch: "trunk", updatedAt: null, archived: true, fork: false });
  assert.deepEqual(branchFromApi({ name: "main", protected: true, sha: "abc" }, "main"), { name: "main", protected: true, commit: "abc", isDefault: true });
});
