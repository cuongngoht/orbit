// The ONE secret port: environment names for the MCP broker, vault references
// for the project-report connections, and never a plaintext fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Blocked, Refused } from "../src/errors.mjs";
import { credentialProblem, envSecrets, referenceProblem, secretSource } from "../src/secrets.mjs";
import { maskShapes, maskValues, scrub, scrubbed } from "../src/scrub.mjs";
import { fakeVault } from "./fakes/vault.mjs";

const PAT = "ghp_CanaryToken0123456789abcdefghijKLMN";

test("the environment secret port reports presence and reads only named values", () => {
  const s = envSecrets({ A: "1", EMPTY: "" });
  assert.deepEqual([s.has("A"), s.has("EMPTY"), s.value("B")], [true, false, null]);
});

test("a reference is a variable NAME or { vault: id } -- and a value in the wrong place is never echoed back", () => {
  assert.equal(referenceProblem("REPORT_GITHUB_PAT"), null);
  assert.equal(referenceProblem({ vault: "conn-github-acme" }), null);
  for (const bad of [PAT.replace("ghp_", "ghp-"), { vault: "x", value: PAT }, { value: PAT }, ["X"], 42]) {
    const said = referenceProblem(bad);
    assert.ok(said, JSON.stringify(bad));
    assert.ok(!said.includes("Canary"), "the sentence never repeats what it was given");
  }
});

test("a credential value must be one line of printable characters before any OS store sees it", () => {
  assert.equal(credentialProblem(PAT), null);
  for (const bad of ["short", `${PAT}\nadd-generic-password -s evil`, `${PAT} with space`, `"${PAT}`, `${PAT}\\`]) assert.ok(credentialProblem(bad), JSON.stringify(bad));
});

test("read() answers either kind; a vault reference with no vault bound is BLOCKED, never read from anywhere else", async () => {
  const vault = fakeVault({ items: { "conn-a": PAT } });
  const withVault = secretSource({ env: { REPORT_PAT: "from-env-12345" }, vault });
  assert.equal(await withVault.read("REPORT_PAT"), "from-env-12345");
  assert.equal(await withVault.read({ vault: "conn-a" }), PAT);
  assert.equal(await withVault.read({ vault: "conn-missing" }), null);
  await assert.rejects(secretSource({ env: { "conn-a": PAT } }).read({ vault: "conn-a" }), Blocked);
});

test("store() takes a vault reference only, checks the value first, and has no plaintext fallback", async () => {
  const vault = fakeVault();
  const source = secretSource({ vault });
  await source.store({ vault: "conn-a" }, PAT);
  assert.equal(vault.items.get("conn-a"), PAT);
  await assert.rejects(source.store("REPORT_PAT", PAT), Refused);
  await assert.rejects(source.store({ vault: "conn-b" }, "has a\nnewline"), Refused);
  await assert.rejects(secretSource({}).store({ vault: "conn-c" }, PAT), Blocked);
  assert.equal(secretSource({ vault }).backend(), "fake-vault");
});

test("remove() deletes the vault item and ignores an environment reference", async () => {
  const vault = fakeVault({ items: { "conn-a": PAT } });
  await secretSource({ vault }).remove({ vault: "conn-a" });
  await secretSource({ vault }).remove("REPORT_PAT");
  assert.equal(vault.items.size, 0);
  assert.deepEqual(vault.calls.map((c) => c.op), ["remove"]);
});

test("a known value is masked in every spelling it travels in", () => {
  const basic = Buffer.from(`:${PAT}`).toString("base64");
  const text = `raw ${PAT} basic ${basic} url ${encodeURIComponent(PAT)} b64 ${Buffer.from(PAT).toString("base64")}`;
  assert.ok(!maskValues(text, [PAT]).includes("Canary"));
  assert.ok(!maskValues(text, [PAT]).includes(basic));
  assert.equal(maskValues("no secret here", ["short"]), "no secret here", "a value too short to be a credential masks nothing");
});

test("Basic credentials, pat-named keys and secret-named env assignments are masked by shape", () => {
  const header = `Authorization: Basic ${Buffer.from(`:${PAT}`).toString("base64")}`;
  assert.ok(!scrub(header).includes(Buffer.from(`:${PAT}`).toString("base64")));
  assert.equal(scrub("GITHUB_PAT=abcdef123456 PATH=/usr/bin"), "GITHUB_PAT=[redacted] PATH=/usr/bin");
  assert.deepEqual(scrubbed({ ado_pat: "x", credentials: "y", path: "/a", patch: "p" }), { ado_pat: "[redacted]", credentials: "[redacted]", path: "/a", patch: "p" });
  assert.equal(maskShapes(`token ${PAT} end`, ["gh[pousr]_[A-Za-z0-9]{20,}"]), "token [redacted] end");
});
