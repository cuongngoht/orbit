// The OS secret store adapters: the value travels on STDIN and never in argv,
// what the OS says on failure never reaches an error, and a machine with no
// store has none. The real Windows store is round-tripped on Windows CI; the
// real macOS Keychain only when ORBIT_TEST_KEYCHAIN=1 (it is somebody's login
// keychain).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProcess } from "../src/process/index.mjs";
import { realIo } from "../src/store/io.mjs";
import { PROTECT, SERVICE, osVault, powershell, psArgs } from "../skills/orbit-control/vault.mjs";
import { fakeProcess } from "./fakes/process.mjs";

const PAT = "abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst";

test("macOS: the value goes in on stdin, is read back with -w, and 'not found' is unset rather than a failure", async () => {
  const p = fakeProcess({ "/usr/bin/security": (args, opts) => (args[0] === "-i" ? { ok: true, status: 0, out: "", err: "" } : args[0] === "find-generic-password" ? (args.includes("missing") ? { ok: false, status: 44, out: "", err: "The specified item could not be found" } : { ok: true, status: 0, out: `${PAT}\n`, err: "" }) : { ok: true, status: 0, out: "", err: "" }) });
  const vault = osVault({ platform: "darwin", env: {}, process: p, io: { exists: () => true }, dir: "/unused" });
  await vault.store("connection-acme", PAT);
  assert.ok(p.calls.every((c) => !c.args.join(" ").includes(PAT)), "never in argv");
  assert.ok(p.calls[0].opts.input.includes(PAT) && p.calls[0].opts.input.includes(`-s ${SERVICE} -a connection-acme`));
  assert.equal(await vault.read("connection-acme"), PAT);
  assert.equal(await vault.read("missing"), null);
});

test("macOS: a failing keychain says so in its own words, never in the tool's", async () => {
  const p = fakeProcess({ "/usr/bin/security": () => ({ ok: false, status: 51, out: "", err: `security: SecKeychainItemCreate: ${PAT} User interaction is not allowed.` }) });
  const vault = osVault({ platform: "darwin", env: {}, process: p, io: { exists: () => true }, dir: "/unused" });
  await assert.rejects(vault.read("connection-acme"), (e) => /could not read the credential/.test(e.message) && !e.message.includes(PAT) && !e.message.includes("SecKeychain"));
  await assert.rejects(vault.store("connection-acme", `${PAT}"; rm -rf ~`), /quotes or backslashes/);
});

test("Windows: DPAPI through the system PowerShell by path, a fixed encoded script, the value on stdin, the blob in the store", async () => {
  const blobs = new Map();
  const io = { exists: () => true, read: (f) => blobs.get(f) ?? null, write: (f, v) => blobs.set(f, v), removeFile: (f) => blobs.delete(f) };
  const p = fakeProcess({ "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe": (args, opts) => ({ ok: true, status: 0, out: opts.input === PAT ? Buffer.from(`protected:${PAT}`).toString("base64") : Buffer.from(opts.input, "base64").toString().replace(/^protected:/, ""), err: "" }) });
  const vault = osVault({ platform: "win32", env: { SystemRoot: "C:\\Windows" }, process: p, io, dir: "C:\\store\\vault" });
  await vault.store("connection-acme", PAT);
  assert.ok(p.calls.every((c) => !c.args.join(" ").includes(PAT)) && p.calls[0].args.includes("-EncodedCommand"));
  assert.ok([...blobs.keys()][0].endsWith("connection-acme.dpapi"));
  assert.equal(await vault.read("connection-acme"), PAT);
  await vault.remove("connection-acme");
  assert.equal(await vault.read("connection-acme"), null);
});

test("Linux has no OS store here: a vault reference is Blocked by the secret port, never kept in a file", () => {
  assert.equal(osVault({ platform: "linux", env: {}, process: fakeProcess({}), io: realIo(), dir: "/x" }), null);
});

test("an item id is checked before any command is built", async () => {
  const vault = osVault({ platform: "darwin", env: {}, process: fakeProcess({}), io: { exists: () => true }, dir: "/x" });
  await assert.rejects(vault.read("../../etc; rm"), /vault item id/);
});

// What PowerShell itself answered, for a CI log to explain a failed store: its
// exit status, how much it wrote, and what it said on stderr -- the value went in
// on stdin and is never part of the script, so none of this can carry it.
async function protectAnswer() {
  const r = await createProcess().runAsync(powershell(process.env), psArgs(PROTECT), { input: PAT, timeoutMs: 60000 });
  return `status ${r.status ?? "none"}, stdout ${String(r.out ?? "").length} chars, error ${JSON.stringify(String(r.error ?? "").slice(0, 300))}, stderr ${JSON.stringify(String(r.err ?? "").slice(0, 600))}`;
}

test("the real Windows DPAPI round trip", { skip: process.platform !== "win32" && "Windows only" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-dpapi-"));
  try {
    const vault = osVault({ platform: "win32", env: process.env, process: createProcess(), io: realIo(), dir });
    await vault.store("orbit-test-roundtrip", PAT).catch(async (e) => assert.fail(`${e.message} -- ${await protectAnswer()}`));
    assert.equal(await vault.read("orbit-test-roundtrip"), PAT);
    await vault.remove("orbit-test-roundtrip");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the real macOS Keychain round trip", { skip: (process.platform !== "darwin" || process.env.ORBIT_TEST_KEYCHAIN !== "1") && "macOS with ORBIT_TEST_KEYCHAIN=1 only" }, async () => {
  const vault = osVault({ platform: "darwin", env: process.env, process: createProcess(), io: realIo(), dir: "/unused" });
  await vault.store("orbit-test-roundtrip", PAT);
  assert.equal(await vault.read("orbit-test-roundtrip"), PAT);
  await vault.remove("orbit-test-roundtrip");
  assert.equal(await vault.read("orbit-test-roundtrip"), null);
});
