// The network half of autonomous QA: parsing what playwright-cli prints, the
// ALLOW-listed view of a request, and the duplicate table. Every fixture text
// below was captured from playwright-cli 0.1.19 against a local server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyOf, consoleErrors, consoleTotals, parseDetail, parseRequests } from "../src/browser/index.mjs";
import { canonicalUrl } from "../src/network/canonical.mjs";
import { duplicateCandidates, EXPLANATIONS } from "../src/network/duplicates.mjs";
import { payloadFingerprint } from "../src/network/fingerprint.mjs";
import { NEVER_OBSERVED, observedRequest } from "../src/network/observe.mjs";
import { safeHeaders } from "../src/network/redact.mjs";

const DETAIL = `### Result
#2 [POST] http://127.0.0.1:18765/api/workspaces

  General
    status:    [201] Created
    duration:  2ms
    type:      fetch
    mimeType:  application/json

  Request headers
    x-request-id: abc
    authorization: Bearer SECRET
    referer: http://127.0.0.1:18765/
    content-type: application/json

  Response headers
    access-control-allow-origin: *
    date: Fri, 25 Sep 2026 12:48:46 GMT
    content-type: application/json

Run \`request-body 2\` to read the request body.`;

const FAILED = `#4 [GET] http://127.0.0.1:1/api/down

  General
    status:    [FAILED] net::ERR_UNSAFE_PORT
    type:      fetch
`;

test("parseDetail reads what request <n> prints, headers verbatim", () => {
  const d = parseDetail(DETAIL);
  assert.equal(d.n, 2);
  assert.equal(d.method, "POST");
  assert.equal(d.status, 201);
  assert.equal(d.durationMs, 2);
  assert.equal(d.type, "fetch");
  assert.equal(d.requestHeaders.authorization, "Bearer SECRET");
  assert.equal(d.responseHeaders.date, "Fri, 25 Sep 2026 12:48:46 GMT");
});

test("a failed request is failed, not in flight; a missing one is null", () => {
  assert.deepEqual([parseDetail(FAILED).status, parseDetail(FAILED).failed], [null, "net::ERR_UNSAFE_PORT"]);
  assert.equal(parseDetail("ERROR: Request #42 not found. Use browser_network_requests to see available indexes."), null);
  assert.equal(bodyOf(""), null);
  assert.equal(bodyOf("ERROR: nope"), null);
  assert.equal(bodyOf('{"name":"w1"}\n'), '{"name":"w1"}');
});

test("parseRequests keeps every old field and adds `failed` only when the log says so", () => {
  const rows = parseRequests("2. [GET] http://h/api/old => [302] Found\n4. [GET] http://h/api/down => [FAILED] net::ERR_UNSAFE_PORT\n5. [GET] http://h/api/y");
  assert.deepEqual(rows[0], { n: 2, method: "GET", url: "http://h/api/old", status: 302 });
  assert.deepEqual(rows[1], { n: 4, method: "GET", url: "http://h/api/down", status: null, failed: "net::ERR_UNSAFE_PORT" });
  assert.deepEqual(rows[2], { n: 5, method: "GET", url: "http://h/api/y", status: null });
});

test("the console's own totals and error lines", () => {
  const text = "Total messages: 3 (Errors: 2, Warnings: 1)\nReturning 2 messages for level \"error\"\n\n[ERROR] boom from page @ http://127.0.0.1:18767/:1\nError: unhandled one\n    at go (http://127.0.0.1:18767/:3:60)";
  assert.deepEqual(consoleTotals(text), { total: 3, errors: 2, warnings: 1 });
  assert.equal(consoleErrors(text).length, 2);
  assert.equal(consoleTotals("nothing"), null);
});

test("a canonical URL replaces variable segments by shape and keeps query KEYS only", () => {
  const u = canonicalUrl("https://app.test/api/workspaces/42/members/3f2a1b4c-0000-4000-8000-123456789abc?page=2&q=secret");
  assert.equal(u.template, "/api/workspaces/{n}/members/{uuid}");
  assert.deepEqual(u.queryKeys, ["page", "q"]);
  assert.equal(JSON.stringify({ endpoint: u.endpoint, template: u.template, keys: u.queryKeys }).includes("secret"), false);
});

test("headers are an ALLOW-list: authorization and cookie never keep a value, correlation is a fingerprint", () => {
  const h = safeHeaders({ Authorization: "Bearer SECRET", Cookie: "sid=zzz", "Content-Type": "application/json", "X-Request-Id": "abc", Location: "/next?code=SECRET" }, { correlationHeaders: ["x-request-id"] }, "salt");
  const kept = JSON.stringify(h);
  assert.equal(kept.includes("SECRET"), false);
  assert.equal(kept.includes("zzz"), false);
  assert.ok(h.names.includes("authorization"));
  assert.equal(h.values["content-type"], "application/json");
  assert.notEqual(h.correlation["x-request-id"], "abc");
});

test("a payload fingerprint ignores key order and declared volatile fields, and is salted", () => {
  const a = payloadFingerprint('{"name":"w1","at":1}', { salt: "s", ignore: ["at"] });
  const b = payloadFingerprint('{"at":2,"name":"w1"}', { salt: "s", ignore: ["at"] });
  assert.equal(a.fp, b.fp);
  assert.notEqual(payloadFingerprint('{"name":"w1"}', { salt: "other" }).fp, a.fp);
});

const OPTS = { salt: "s", fingerprints: true, correlationHeaders: [], idempotencyHeaders: ["idempotency-key"], ignoreFields: [] };
const req = (n, method, url, status, body, headers = {}) => observedRequest({ n, method, url, status }, { n, method, url, status, failed: null, durationMs: 3, type: "fetch", mimeType: null, requestHeaders: headers, responseHeaders: {} }, body, OPTS);

test("what the adapter never shows is named on every request", () => {
  const r = req(1, "POST", "https://app.test/api/things", 201, "{}");
  assert.deepEqual(NEVER_OBSERVED, ["startedAt", "completedAt", "initiator", "retryMarker", "preflight"]);
  assert.deepEqual(r.missing, []);
  const bare = observedRequest({ n: 1, method: "POST", url: "https://app.test/api/things", status: 201 }, null, undefined, OPTS);
  assert.ok(bare.missing.includes("detail"));
  assert.ok(bare.missing.includes("payload"));
});

const explain = (requests, policy = {}) => duplicateCandidates(requests, policy).map((c) => [c.explanation, c.outcome]);

test("one request is no candidate; a preflight and its request are two methods, never a pair", () => {
  assert.deepEqual(explain([req(1, "POST", "https://app.test/api/things", 201, "{}")]), []);
  assert.deepEqual(explain([req(1, "OPTIONS", "https://app.test/api/things", 204), req(2, "POST", "https://app.test/api/things", 201, "{}")]), []);
});

test("two equivalent writes are SUSPECTED on the network alone, never confirmed", () => {
  const two = [req(1, "POST", "https://app.test/api/things", 201, '{"n":"a"}'), req(2, "POST", "https://app.test/api/things", 201, '{"n":"a"}')];
  assert.deepEqual(explain(two), [["EQUIVALENT_WRITES", "SUSPECTED_DEFECT"]]);
  assert.deepEqual(explain(two, { contracts: [{ match: "^/api/things$", method: "POST", maxPerAction: 1 }] }), [["CONTRACT", "CONFIRMED_DEFECT"]]);
});

test("different payloads or different pages are different requests", () => {
  assert.deepEqual(explain([req(1, "POST", "https://app.test/api/things", 201, '{"n":"a"}'), req(2, "POST", "https://app.test/api/things", 201, '{"n":"b"}')]), []);
  assert.deepEqual(explain([req(1, "GET", "https://app.test/api/things?page=1", 200), req(2, "GET", "https://app.test/api/things?page=2", 200)]), []);
});

test("a retry is legitimate only when declared; otherwise it asks for a requirement", () => {
  const retry = [req(1, "POST", "https://app.test/api/things", 503, '{"n":"a"}'), req(2, "POST", "https://app.test/api/things", 201, '{"n":"a"}')];
  assert.deepEqual(explain(retry, { retries: [{ match: "/api/things", attempts: 3 }] }), [["RETRY_DECLARED", "OBSERVED_EXPECTED_BEHAVIOR"]]);
  assert.deepEqual(explain(retry), [["RETRY_UNDECLARED", "REQUIRES_REQUIREMENT"]]);
});

test("the environment changes how a duplicate reads, and polling or a declared idempotent call is expected", () => {
  const reads = [req(1, "GET", "https://app.test/api/me", 200), req(2, "GET", "https://app.test/api/me", 200)];
  assert.deepEqual(explain(reads, { environment: { kind: "development" } }), [["DEVELOPMENT", "INCONCLUSIVE"]]);
  assert.deepEqual(explain(reads, { environment: { kind: "test" } }), [["REDUNDANT_READ", "SUSPECTED_DEFECT"]]);
  assert.deepEqual(explain(reads, { polling: [{ match: "/api/me" }] }), [["POLLING", "OBSERVED_EXPECTED_BEHAVIOR"]]);
});

test("writes whose bodies could not be compared are INCONCLUSIVE, with what is missing", () => {
  const blind = [1, 2].map((n) => observedRequest({ n, method: "POST", url: "https://app.test/api/things", status: 201 }, null, undefined, OPTS));
  const [c] = duplicateCandidates(blind);
  assert.equal(c.explanation, "PAYLOAD_UNKNOWN");
  assert.equal(c.outcome, "INCONCLUSIVE");
  assert.ok(c.missing.includes("payload"));
});

test("the explanation table ends in a row that always matches, and every row names a known outcome", () => {
  assert.equal(EXPLANATIONS.at(-1).when(), true);
  const known = ["CONFIRMED_DEFECT", "SUSPECTED_DEFECT", "OBSERVED_EXPECTED_BEHAVIOR", "REQUIRES_REQUIREMENT", "BLOCKED", "INCONCLUSIVE"];
  assert.ok(EXPLANATIONS.every((e) => known.includes(e.outcome)));
});
