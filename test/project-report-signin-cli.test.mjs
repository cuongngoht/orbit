// The sign-in commands of cli/project-report.mjs, as a person runs them: how a connection is made to sign in, what
// `connections` says about it, and the refusals -- offline, in a store of their own. The sign-in itself (a browser, a
// real `az`) is not run here: the sequence is held by test/azure-cli-adapter.test.mjs and test/azure-cli-isolation.test.mjs,
// and the real program by skills/orbit-release/azure-cli-runtime-smoke.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { documented, headerOf } from "../src/trace/commands.mjs";
import { sealed } from "./home.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "cli", "project-report.mjs");

function store(t) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-signin-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const cli = (dir, args) => spawnSync(process.execPath, [CLI, ...args], { env: sealed({ ORBIT_STORE_DIR: dir }), cwd: REPO, encoding: "utf8", timeout: 60_000 });

const connectionsOf = (dir) => JSON.parse(cli(dir, ["connections", "--json"]).stdout);

test("an Azure DevOps connection signs in by default; a GitHub one reads a credential; `connections` says which, and never shows one", (t) => {
  const dir = store(t);
  assert.equal(cli(dir, ["connect", "ado-acme", "--provider=azure-devops", "--organization=acme"]).status, 0);
  assert.equal(cli(dir, ["connect", "gh-acme", "--provider=github", "--organization=acme", "--credential-env=GH_TOKEN_FOR_ORBIT"]).status, 0);
  const text = cli(dir, ["connections"]).stdout;
  assert.match(text, /ado-acme · acme · https:\/\/dev\.azure\.com · signs in \(azure-cli\)/);
  assert.match(text, /gh-acme · acme · https:\/\/api\.github\.com · credential from env GH_TOKEN_FOR_ORBIT/);
  const [ado, gh] = connectionsOf(dir);
  assert.deepEqual([ado.auth, ado.credential, gh.auth], [{ strategy: "azure-cli" }, { set: false, from: null }, { strategy: "credential" }]);
});

test("a directory and a device code named on the command line are kept on the connection, so the reads that follow use the same ones", (t) => {
  const dir = store(t);
  cli(dir, ["connect", "ado-acme", "--provider=azure-devops", "--organization=acme"]);
  const changed = cli(dir, ["connect", "ado-acme", "--tenant=contoso.example", "--device-code"]);
  assert.equal(changed.status, 0);
  assert.match(changed.stdout, /signs in \(azure-cli, directory contoso\.example\)/);
  assert.deepEqual(connectionsOf(dir)[0].auth, { strategy: "azure-cli", tenant: "contoso.example", deviceCode: true });
});

test("a connection can be made to read a credential instead, and a person can change their mind", (t) => {
  const dir = store(t);
  assert.equal(cli(dir, ["connect", "ado-acme", "--provider=azure-devops", "--organization=acme", "--auth=credential", "--credential-env=ADO_PAT_FOR_ORBIT"]).status, 0);
  assert.deepEqual([connectionsOf(dir)[0].auth, connectionsOf(dir)[0].credential], [{ strategy: "credential" }, { set: true, from: "env", name: "ADO_PAT_FOR_ORBIT" }]);
  assert.equal(cli(dir, ["connect", "ado-acme", "--auth=azure-cli"]).status, 0);
  assert.equal(connectionsOf(dir)[0].auth.strategy, "azure-cli");
});

test("the refusals are REFUSED (2), in words that never repeat what was typed: a credential connection has nothing to sign in to, an unknown way in or a malformed directory is not held, a missing id is a usage line", (t) => {
  const dir = store(t);
  cli(dir, ["connect", "gh-acme", "--provider=github", "--organization=acme"]);
  cli(dir, ["connect", "ado-acme", "--provider=azure-devops", "--organization=acme"]);
  const cases = [["sign-in", "gh-acme"], ["sign-out", "gh-acme"], ["sign-in"], ["sign-out"], ["sign-in", "no-such-connection"], ["connect", "ado-acme", "--auth=magic"], ["connect", "ado-acme", "--tenant=SECRET tenant!!"]];
  for (const args of cases) {
    const run = cli(dir, args);
    assert.equal(run.status, 2, args.join(" "));
    assert.equal(`${run.stdout}${run.stderr}`.includes("SECRET"), false, "no echo");
  }
  assert.match(cli(dir, ["sign-in", "gh-acme"]).stderr, /reads a credential: there is nothing to sign in to/);
});

test("a token or password is still refused by name on every command, the new ones included", (t) => {
  const dir = store(t);
  for (const args of [["sign-in", "x", "--token=abc"], ["connect", "x", "--pat=abc"], ["sign-in", "x", "--password=abc"]]) assert.equal(cli(dir, args).status, 2, args.join(" "));
});

test("the usage header documents both commands, so the session trail may name them -- and nothing else is added to the store by asking", (t) => {
  const dir = store(t);
  const subs = documented(headerOf(readFileSync(CLI, "utf8")), "project-report");
  for (const sub of ["sign-in", "sign-out", "connect", "connections", "probe"]) assert.equal(subs.has(sub), true, `${sub} is in the usage header`);
  cli(dir, ["sign-in", "gh-acme"]);
  assert.deepEqual(readdirSync(dir).filter((n) => n !== "control"), [], "a refused sign-in creates nothing beside the connections room");
});

test("naming an environment variable for a NEW connection means it reads a credential; the way in is the person's to change afterwards", (t) => {
  const dir = store(t);
  assert.equal(cli(dir, ["connect", "ado-pat", "--provider=azure-devops", "--organization=acme", "--credential-env=ADO_PAT_FOR_ORBIT"]).status, 0);
  assert.deepEqual([connectionsOf(dir)[0].auth, connectionsOf(dir)[0].credential.name], [{ strategy: "credential" }, "ADO_PAT_FOR_ORBIT"]);
  assert.equal(cli(dir, ["connect", "ado-pat", "--auth=azure-cli"]).status, 0, "and it can be changed to sign in");
  assert.equal(connectionsOf(dir)[0].auth.strategy, "azure-cli");
});
