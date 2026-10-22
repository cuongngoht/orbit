// A run inside a worker, and what the host believes of it (ADR 0038): the document's two direct
// backend cases (doc §8.2) run through `run-case --worker` against an endpoint this test owns,
// with the endpoint and identity SEALED by the host, and the envelope they leave is checked --
// and a worker that forged a PASS, swapped a file or counted a layer nothing proved is caught.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { caseDigest } from "../src/dsl/digest.mjs";
import { createDslRegistry } from "../src/dsl/registry.mjs";
import { shaBytes } from "../src/hash.mjs";
import { envelopeFindings, rederivedFindings, workerFindings } from "../src/run/envelope.mjs";
import { WORKER_API, argvOf, sealedBinder } from "../src/run/worker.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_CASE = join(ROOT, "cli/run-case.mjs");
const server = { http: null, origin: null };
const dsl = createDslRegistry();

const OWNER = { id: "invoice-owner-read", name: "Tenant A reads its own invoice", seen: "src", steps: [{ do: "call", capability: "orbit.http.read", proves: "api", input: { endpointRef: "backend", identityRef: "tenant-a-reader", method: "GET", path: "/invoices/inv-a" }, expect: "it.status === 200 && it.body.id === 'inv-a' && it.body.tenantId === 'tenant-a'" }] };
const OTHER = { id: "invoice-other-tenant-read", name: "Tenant B cannot read tenant A invoice", seen: "src", steps: [{ do: "call", capability: "orbit.http.read", proves: "api", input: { endpointRef: "backend", identityRef: "tenant-b-reader", method: "GET", path: "/invoices/inv-a" }, expect: "it.status === 404 && it.body.error === 'not_found' && !JSON.stringify(it.body).includes('canary-invoice-a')" }] };

// The application's API, and -- as orbit.identity/v1 -- its identity hooks: an identity issued there, behind the
// hooks' own token, reads as its tenant.
const HOOKS_TOKEN = "hooks-secret-0123456789";
const ISSUED = new Map();

function issued(req, res) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => answeredIssue(req, res, JSON.parse(body || "{}")));
}

function answeredIssue(req, res, asked) {
  const ok = req.headers.authorization === `Bearer ${HOOKS_TOKEN}`;
  const token = `syn_${asked.principal}_${ISSUED.size}_0123456789`;
  if (ok) ISSUED.set(token, asked.tenant);
  res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
  res.end(JSON.stringify(ok ? { token, principal: asked.principal, tenant: asked.tenant } : { error: "unauthorized" }));
}

before(async () => {
  server.http = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/orbit/identity/v1/issue") return issued(req, res);
    const bearer = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    const mine = bearer === "token-a" || ISSUED.get(bearer) === "tenant-a";
    res.writeHead(mine ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(mine ? { id: "inv-a", tenantId: "tenant-a", marker: "canary-invoice-a" } : { error: "not_found" }));
  });
  await new Promise((resolve) => server.http.listen(0, "127.0.0.1", resolve));
  server.origin = `http://127.0.0.1:${server.http.address().port}`;
});

after(() => server.http.close());

function project(c) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-worker-"));
  cpSync(join(ROOT, "test/fixtures/ui-tests"), join(dir, "in/ui-tests"), { recursive: true });
  writeFileSync(join(dir, "in/ui-tests/project.json"), JSON.stringify({ name: "worker-fixture", packs: ["orbit-api-test", "orbit-backend-test"] }));
  const cases = join(dir, "in/ui-tests/screens/_no-screen/cases");
  mkdirSync(cases, { recursive: true });
  writeFileSync(join(cases, `${c.id}.json`), JSON.stringify(c, null, 2));
  mkdirSync(join(dir, "out/store"), { recursive: true });
  return { dir, file: join(cases, `${c.id}.json`), out: join(dir, "out") };
}

const requestOf = (p, c) => ({
  v: WORKER_API,
  runId: `run-${c.id}`,
  nonce: "n-1",
  out: p.out,
  case: { file: p.file, digest: caseDigest(c) },
  bindings: {
    endpoint: { backend: { alias: "backend", origin: server.origin } },
    identity: { "tenant-a-reader": { alias: "tenant-a-reader", header: "authorization", scheme: "Bearer", env: "ORBIT_ID_A" }, "tenant-b-reader": { alias: "tenant-b-reader", header: "authorization", scheme: "Bearer", env: "ORBIT_ID_B" } },
  },
  secrets: { ORBIT_ID_A: "token-a", ORBIT_ID_B: "token-b" },
});

function worker(p, request) {
  const env = { PATH: process.env.PATH, ORBIT_UI_TESTS: join(p.dir, "in/ui-tests"), ORBIT_STORE_DIR: join(p.out, "store") };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUN_CASE, "--worker"], { env, stdio: ["pipe", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) => resolve({ code, err, envelope: JSON.parse(readFileSync(join(p.out, "envelope.json"), "utf8")) }));
    child.stdin.end(JSON.stringify(request));
  });
}

// What the HOST lists, never what the envelope says -- under the evidence directory it names.
function listedBy(out, envelope) {
  const dir = join(out, envelope.evidence);
  const files = readdirSync(dir, { recursive: true }).map((n) => join(dir, String(n))).filter((p) => statSync(p).isFile());
  return new Map(files.map((p) => [relative(out, p).replace(/\\/g, "/"), { sha256: shaBytes(readFileSync(p)), bytes: statSync(p).size }]));
}

const recordsOf = (out, envelope) => readFileSync(join(out, envelope.evidence, "run-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("the owner's read passes and the other tenant's is refused by the product -- both inside a worker, both checked by the host", async () => {
  for (const c of [OWNER, OTHER]) {
    const p = project(c);
    const request = requestOf(p, c);
    const { code, err, envelope } = await worker(p, request);
    assert.equal(envelope.status, "PASS", `${c.id}: ${envelope.why ?? err}`);
    assert.equal(code, 0);
    const expected = { runId: request.runId, nonce: "n-1", caseDigest: caseDigest(c) };
    assert.deepEqual(workerFindings({ envelope, expected, listed: listedBy(p.out, envelope), records: recordsOf(p.out, envelope), frozen: c, provedBy: (s) => dsl.provedBy(s), grants: [] }), [], "the one call the host makes holds the envelope, the claim and the spends");
    assert.equal(JSON.stringify(envelope).includes("token-a"), false, "a secret never reaches the envelope");
    rmSync(p.dir, { recursive: true, force: true });
  }
});

test("what a host refuses of a worker: another dispatch, another case, a file it did not declare, a forged PASS, a layer nothing proved", async () => {
  const p = project(OWNER);
  const request = requestOf(p, OWNER);
  const { envelope } = await worker(p, request);
  const expected = { runId: request.runId, nonce: "n-1", caseDigest: caseDigest(OWNER) };
  const listed = listedBy(p.out, envelope);
  assert.match(envelopeFindings({ ...envelope, nonce: "n-2" }, expected, listed).join(), /answers another dispatch/);
  assert.match(envelopeFindings({ ...envelope, caseDigest: "x" }, expected, listed).join(), /ran another case/);
  assert.match(envelopeFindings({ ...envelope, files: [...envelope.files, { path: "../../etc/passwd", sha256: "x" }] }, expected, listed).join(), /outside its output/);
  assert.match(envelopeFindings({ ...envelope, files: envelope.files.slice(1) }, expected, listed).join(), /is there and not declared/);
  assert.match(envelopeFindings({ ...envelope, files: envelope.files.map((f) => ({ ...f, sha256: "0".repeat(64) })) }, expected, listed).join(), /does not have the digest/);
  const records = recordsOf(p.out, envelope);
  const proved = (s) => dsl.provedBy(s);
  const failedStep = records.map((r) => (r.kind === "step" ? { ...r, ok: false, error: "x" } : r));
  assert.match(rederivedFindings(envelope.result, OWNER, failedStep, proved, expected).join(), /claims PASS and its steps did not all run and hold/);
  const dropped = records.filter((r) => r.kind !== "step");
  assert.match(rederivedFindings({ ...envelope.result, done: 0, verdicts: 0, proved: {} }, OWNER, dropped, proved, expected).join(), /did not all run and hold/, "a worker that drops the record of a step is refused, not believed");
  const twice = [...records, ...records.filter((r) => r.kind === "step")];
  assert.match(rederivedFindings(envelope.result, OWNER, twice, proved, expected).join(), /one step at a time, in order/);
  assert.match(rederivedFindings(envelope.result, OWNER, records, proved, { caseDigest: "another" }).join(), /ran another case than the one dispatched/);
  assert.match(rederivedFindings({ ...envelope.result, proved: { ui: 1, api: 1, sql: 0 } }, OWNER, records, proved, expected).join(), /layers the result claims are not the layers its steps prove/);
  assert.match(rederivedFindings({ ...envelope.result, status: "SKIP" }, OWNER, records, proved, expected).join(), /no step that can stop a run stopped it/);
  assert.match(envelopeFindings({ ...envelope, status: "FAIL" }, expected, listed).join(), /status is not its result's/);
  rmSync(p.dir, { recursive: true, force: true });
});

// What the first generated PAGE test showed: a worker tallies its layers in the layers' order, the host in its steps',
// and the same layers counted in two orders are the same claim.
test("the layers a claim names are compared whatever order each side counted them in", () => {
  const frozen = { id: "gen-page", steps: [{ do: "api", match: "/a", status: 200 }, { do: "call", capability: "x", proves: "sql", expect: "compiled:{}" }, { do: "report", js: "1", expect: "compiled:{}" }] };
  const records = [{ kind: "run", case_digest: "d" }, { kind: "step", i: 1, ok: true }, { kind: "step", i: 2, ok: true }, { kind: "step", i: 3, ok: true }];
  const provedBy = (st) => (st.do === "api" ? "api" : st.do === "report" ? "ui" : st.proves);
  const result = { status: "PASS", case_digest: "d", proved: { ui: 1, api: 1, sql: 1 }, verdicts: 3, done: 3 };
  assert.deepEqual(rederivedFindings(result, frozen, records, provedBy, { caseDigest: "d" }), []);
  assert.match(rederivedFindings({ ...result, proved: { ui: 2, api: 1, sql: 1 } }, frozen, records, provedBy, { caseDigest: "d" }).join(), /layers the result claims are not the layers its steps prove/, "a count that differs still differs");
});

test("a ref the host did not seal is never bound, and the arguments a request stands for carry no secret", () => {
  const binder = sealedBinder({ bindings: { endpoint: { backend: { alias: "backend", origin: "http://app:8080" } } }, secrets: { ORBIT_ID_A: "token-a" } });
  assert.equal(binder.resolve("endpoint", "backend").ok, true);
  assert.match(binder.resolve("endpoint", "elsewhere").why, /nothing named elsewhere is bound as endpoint/);
  const argv = argvOf({ case: { file: "/work/in/c.json" }, out: "/work/out", params: { NAME: "TC-1" } });
  assert.deepEqual(argv, ["/work/in/c.json", "NAME=TC-1", "--json"]);
});

const issuingRequest = (p, hooksToken) => ({ ...requestOf(p, OWNER), bindings: { endpoint: { backend: { alias: "backend", origin: server.origin } }, identity: { "tenant-a-reader": { alias: "tenant-a-reader", principal: "tenant-a-reader", tenant: "tenant-a", env: "ORBIT_BIND_TENANT_A_READER_TOKEN", issue: { transport: "orbit-identity-v1", origin: server.origin, credential: { tokenEnv: "ORBIT_BIND_HOOKS_TOKEN" } } } } }, secrets: { ORBIT_BIND_HOOKS_TOKEN: hooksToken } });

test("an identity the host could not issue is issued INSIDE the worker, through the identity hooks, and its token reaches the helper alone", async () => {
  const p = project(OWNER);
  const { envelope, err } = await worker(p, issuingRequest(p, HOOKS_TOKEN));
  assert.equal(envelope.status, "PASS", envelope.why ?? err);
  const log = readFileSync(join(p.out, envelope.evidence, "run-log.jsonl"), "utf8");
  for (const token of ISSUED.keys()) assert.equal(log.includes(token) || JSON.stringify(envelope).includes(token), false, "an issued token is in no log and no envelope");
  assert.equal(log.includes(HOOKS_TOKEN), false);
  const q = project(OWNER);
  const refused = await worker(q, issuingRequest(q, "not-the-hooks-token-000"));
  assert.equal(refused.envelope.status, "BLOCKED", "hooks that refuse the token issue nothing, and nothing about the product was observed");
  rmSync(p.dir, { recursive: true, force: true });
  rmSync(q.dir, { recursive: true, force: true });
});
