// skills/orbit-control: which Node can run Orbit Control, and the skill that
// starts it. The pure half is driven with made-up paths; the CLI only with
// --which, so no test here ever starts a server.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { EMPTY_HOME, sealed } from "./home.mjs";
import { supported } from "../control-server/src/runtime.mjs";
import { candidates, pick } from "../skills/orbit-control/node.mjs";
import { DIST, RuntimeError, assetOf, chooseRelease, expectedDigest, folderOf, installRuntime, targetOf } from "../skills/orbit-control/install.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const START = join(ROOT, "skills", "orbit-control", "start.mjs");

// Keys built with join, as the code builds them: a literal "/home/u/.nvm/…"
// would never match on Windows, where join writes backslashes.
const NVM = join("/home/u", ".nvm", "versions", "node");
const dirs = { [NVM]: ["v22.23.1", "v24.9.0", ".DS_Store", "v24.21.0", "v21.7.3"], "C:\\nvm": ["v24.15.0", "settings.txt"] };
const list = (dir) => dirs[dir] ?? [];

test("the override comes first, then the running Node, then every nvm version newest first", () => {
  const found = candidates({ env: { ORBIT_CONTROL_NODE: "/opt/node24/bin/node" }, home: "/home/u", execPath: "/usr/bin/node", list });
  assert.deepEqual(found, [
    "/opt/node24/bin/node",
    "/usr/bin/node",
    join(NVM, "v24.21.0", "bin", "node"),
    join(NVM, "v24.9.0", "bin", "node"),
    join(NVM, "v22.23.1", "bin", "node"),
    join(NVM, "v21.7.3", "bin", "node"),
  ]);
});

test("NVM_DIR relocates nvm-sh, and nvm-windows is read from NVM_HOME", () => {
  const found = candidates({ env: { NVM_DIR: "/elsewhere", NVM_HOME: "C:\\nvm" }, home: "/home/u", execPath: "node.exe", list });
  assert.deepEqual(found, ["node.exe", join("C:\\nvm", "v24.15.0", "node.exe")]);
});

test("a private runtime is tried after the running Node and before nvm, newest first", () => {
  const withRuntime = { ...dirs, "/store/control-runtime": ["v24.15.0-darwin-arm64", "v24.21.0-darwin-arm64", ".install-x1"] };
  const found = candidates({ env: {}, home: "/home/u", execPath: "/usr/bin/node", list: (d) => withRuntime[d] ?? [], runtime: { root: "/store/control-runtime", bin: join("bin", "node") } });
  assert.deepEqual(found.slice(0, 4), [
    "/usr/bin/node",
    join("/store/control-runtime", "v24.21.0-darwin-arm64", "bin", "node"),
    join("/store/control-runtime", "v24.15.0-darwin-arm64", "bin", "node"),
    join(NVM, "v24.21.0", "bin", "node"),
  ]);
});

test("the first candidate whose ANSWERED version is new enough wins, and nothing after it is asked", () => {
  const versions = { a: "22.23.1", b: null, c: "24.15.0", d: "25.0.0" };
  const asked = [];
  const versionOf = (p) => (asked.push(p), versions[p]);
  assert.deepEqual(pick(["a", "b", "c", "d"], versionOf, (v) => supported(v, ">=24.15")), { node: "c", version: "24.15.0" });
  assert.deepEqual(asked, ["a", "b", "c"]);
  assert.equal(pick(["a", "b"], (p) => versions[p], (v) => supported(v, ">=24.15")), null);
});

// A Node >= 24.15 running this suite finds itself; an older one, with an empty
// home and no nvm, finds nothing and says what to do. Both, never a server.
test("--which names the Node it would use, or exits 1 with what to install", () => {
  const said = spawnSync(process.execPath, [START, "--which"], { encoding: "utf8", env: sealed({ NVM_DIR: join(EMPTY_HOME, "nvm"), NVM_HOME: "" }) });
  if (supported(process.versions.node)) return assert.match(said.stdout, new RegExp(`\\(Node ${process.versions.node.replace(/\./g, "\\.")}\\)`));
  assert.equal(said.status, 1);
  assert.match(said.stderr, /needs Node >=24\.15, and none was found here/);
  assert.match(said.stderr, /--install-runtime/, "it says how to get one, and downloads nothing unasked");
  assert.match(said.stderr, /The system Node, nvm and PATH are not touched/);
  assert.match(said.stderr, /ORBIT_CONTROL_NODE/);
});

// ---- the private runtime, with no network and no archive --------------------

const MAC = targetOf("darwin", "arm64");
const accepts = (v) => supported(v, ">=24.15");
const INDEX = [
  { version: "v25.1.0", lts: false, files: ["osx-arm64-tar"] },
  { version: "v24.21.0", lts: "Krypton", files: ["osx-arm64-tar", "win-x64-zip"] },
  { version: "v24.20.0", lts: "Krypton", files: ["osx-arm64-tar"] },
  { version: "v22.23.1", lts: "Jod", files: ["osx-arm64-tar"] },
];

test("one row per official build, named the way nodejs.org names it", () => {
  assert.equal(assetOf("v24.21.0", MAC), "node-v24.21.0-darwin-arm64.tar.gz");
  assert.equal(folderOf("v24.21.0", MAC), "node-v24.21.0-darwin-arm64");
  assert.equal(assetOf("v24.21.0", targetOf("win32", "x64")), "node-v24.21.0-win-x64.zip");
  assert.equal(targetOf("win32", "x64").bin, "node.exe");
  assert.equal(targetOf("sunos", "x64"), null, "no official build, no guess");
});

test("the newest LTS the server accepts that has a build for this machine; never a Current release", () => {
  assert.equal(chooseRelease(INDEX, MAC, accepts).version, "v24.21.0");
  assert.equal(chooseRelease(INDEX, targetOf("linux", "arm64"), accepts), null);
  assert.equal(chooseRelease(INDEX.slice(3), MAC, accepts), null, "an LTS too old for the server is not a candidate");
});

test("the expected digest is read off the published SHASUMS256.txt line for exactly that asset", () => {
  const sums = "aaa  node-v24.21.0-darwin-arm64.tar.xz\nbbb  node-v24.21.0-darwin-arm64.tar.gz\n";
  assert.equal(expectedDigest(sums, "node-v24.21.0-darwin-arm64.tar.gz"), "bbb");
  assert.equal(expectedDigest(sums, "node-v24.21.0-linux-x64.tar.gz"), null);
});

function fakeIo(over = {}) {
  const calls = { get: [], unpacked: [] };
  const io = {
    root: "/store/control-runtime",
    target: MAC,
    supported: accepts,
    log: () => {},
    exists: () => false,
    sha256: (bytes) => `digest-of-${bytes}`,
    getJson: async (url) => (calls.get.push(url), INDEX),
    getText: async (url) => (calls.get.push(url), "digest-of-ARCHIVE  node-v24.21.0-darwin-arm64.tar.gz\n"),
    getBytes: async (url) => (calls.get.push(url), "ARCHIVE"),
    unpack: (bytes, asset, folder, dir) => (calls.unpacked.push([bytes, asset, folder, dir]), dir),
    ...over,
  };
  return { io, calls };
}

test("an install downloads the official archive and its checksums, verifies, and unpacks into the store", async () => {
  const { io, calls } = fakeIo();
  const dir = await installRuntime(io);
  assert.equal(dir, join("/store/control-runtime", "v24.21.0-darwin-arm64"));
  assert.deepEqual(calls.get, [`${DIST}/index.json`, `${DIST}/v24.21.0/node-v24.21.0-darwin-arm64.tar.gz`, `${DIST}/v24.21.0/SHASUMS256.txt`]);
  assert.deepEqual(calls.unpacked, [["ARCHIVE", "node-v24.21.0-darwin-arm64.tar.gz", "node-v24.21.0-darwin-arm64", dir]]);
});

test("an archive that does not match its published SHA-256 installs nothing", async () => {
  const { io, calls } = fakeIo({ sha256: () => "something-else" });
  await assert.rejects(installRuntime(io), (e) => e instanceof RuntimeError && /does not match the SHA-256/.test(e.message));
  assert.deepEqual(calls.unpacked, []);
  const unlisted = fakeIo({ getText: async () => "zzz  some-other-file.tar.gz\n" });
  await assert.rejects(installRuntime(unlisted.io), /does not list/);
  assert.deepEqual(unlisted.calls.unpacked, []);
});

test("an installed runtime is reused without a single download, and no fitting release is said out loud", async () => {
  const { io, calls } = fakeIo({ exists: () => true });
  assert.equal(await installRuntime(io), join("/store/control-runtime", "v24.21.0-darwin-arm64"));
  assert.deepEqual(calls.get, [`${DIST}/index.json`], "only the index is asked");
  const none = fakeIo({ target: targetOf("linux", "arm64") });
  await assert.rejects(installRuntime(none.io), /no LTS release the server accepts/);
});

test("the skill may run its own launcher and nothing else, and starts the server in the background", () => {
  const skill = readFileSync(join(ROOT, "skills", "orbit-control", "SKILL.md"), "utf8");
  const grants = [...skill.split("---")[1].matchAll(/^ {2}- (.+)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(grants, ["Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/orbit-control/*)"]);
  assert.match(skill, /background/i);
  assert.match(skill, /verbatim/i, "the URL with its token is handed over as printed");
  assert.match(skill, /--install-runtime/, "a machine with no Node new enough gets one installed");
  assert.match(skill, /not touched/, "and is told its own Node is left alone");
});
