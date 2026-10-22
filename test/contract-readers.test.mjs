// CONTRACT READERS (doc §4.3): an accepted OpenAPI 3.x, AsyncAPI 2/3 or schedule policy, read into the binding a test
// pins and the candidate expectations a person puts in a plan's criterion -- what the document STATES, and nothing it
// does not: no window, no business value, no decision word is invented, and a document a reader does not read is said.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openapiExpects } from "../skills/orbit-api-test/contracts/openapi.mjs";
import { asyncapiExpects } from "../skills/orbit-backend-test/contracts/asyncapi.mjs";
import { scheduleExpects } from "../skills/orbit-backend-test/contracts/schedule.mjs";

const ROOT = join(import.meta.dirname, "..");
const CONTRACTS = join(ROOT, "acceptance", "projects", "_shared", "contracts");
const read = (name) => JSON.parse(readFileSync(join(CONTRACTS, name), "utf8"));
const rules = (out) => (out.findings ?? []).map((f) => f.rule);

test("OpenAPI: one operation's status, and that its body conforms to the schema that response declares -- with where each came from", () => {
  const out = openapiExpects(read("openapi.json"), { operation: "readInvoice" });
  assert.equal(out.ok, true);
  assert.deepEqual(out.expects.map((e) => [e.id, e.property, e.op, e.value]), [["E1", "response.status", "eq", 200], ["E2", "response.body", "conforms", "#/components/schemas/Invoice"]]);
  assert.match(out.expects[0].because, /^Synthetic invoices r1: readInvoice \(GET \/invoices\/\{id\}\) answers 200/);
  assert.deepEqual([out.request.method, out.request.path, out.request.servers], ["GET", "/invoices/{id}", ["/api"]]);
  assert.deepEqual([out.source.kind, out.source.revision, out.source.digest.length], ["api-contract", "r1", 64]);
  assert.deepEqual(openapiExpects(read("openapi.json"), { operation: "readInvoice", status: 404 }).expects.map((e) => e.value), [404, "#/components/schemas/Error"]);
});

test("OpenAPI: what it does not read is said -- another version, an operation or status it does not declare, a schema behind a remote reference", () => {
  const doc = read("openapi.json");
  assert.deepEqual(rules(openapiExpects({ swagger: "2.0" })), ["SWAGGER"]);
  assert.deepEqual(rules(openapiExpects({ ...doc, openapi: "4.0.0" }, { operation: "readInvoice" })), ["VERSION"]);
  assert.deepEqual(rules(openapiExpects(doc, { operation: "deleteEverything" })), ["NO_OPERATION"]);
  assert.deepEqual(rules(openapiExpects(doc, { operation: "readInvoice", status: 418 })), ["NO_STATUS"]);
  const remote = { openapi: "3.1.0", info: { title: "t", version: "1" }, paths: { "/a": { get: { operationId: "a", responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "https://elsewhere.invalid/schema.json" } } } } } } } } };
  assert.deepEqual(rules(openapiExpects(remote, { operation: "a" })), ["REMOTE_REF"], "a remote $ref is never fetched");
  const bodiless = { openapi: "3.0.3", info: { title: "t", version: "1" }, paths: { "/a": { delete: { operationId: "a", responses: { 204: { description: "gone" } } } } } };
  assert.deepEqual(openapiExpects(bodiless, { operation: "a" }).expects.map((e) => e.property), ["response.status"], "no schema declared, no schema expectation");
});

test("AsyncAPI 3.0: a channel's address, who sends and receives, its correlation -- and a completion only within the window a person gives", () => {
  const doc = read("asyncapi.json");
  const out = asyncapiExpects(doc, { channel: "reminderRequested", within: 120 });
  assert.equal(out.ok, true);
  assert.deepEqual([out.channel.address, out.channel.actions.map((a) => a.action)], ["billing.reminder.requested", ["send", "receive"]]);
  assert.deepEqual(out.expects.map((e) => [e.property, e.op, e.value ?? null, e.within ?? null]), [["message.correlation", "present", null, null], ["settlement.outcome", "complete-within", "processed", 120]]);
  const unwindowed = asyncapiExpects(doc, { channel: "billing.reminder.requested" });
  assert.deepEqual(unwindowed.expects.map((e) => e.property), ["message.correlation"], "the channel is found by its address too, and no window is invented");
  assert.match(unwindowed.notes[0], /none is invented/);
  assert.deepEqual(rules(asyncapiExpects(doc, { channel: "nowhere" })), ["NO_CHANNEL"]);
  assert.deepEqual(rules(asyncapiExpects({ ...doc, asyncapi: "1.2.0" }, { channel: "reminderRequested" })), ["VERSION"]);
});

test("AsyncAPI 2.x: a channel keyed by its address, where `publish` is what the application RECEIVES", () => {
  const doc = { asyncapi: "2.6.0", info: { title: "v2", version: "7" }, channels: { "orders.placed": { publish: { operationId: "onOrder", summary: "the order service consumes it", message: { name: "OrderPlaced", correlationId: { location: "$message.header#/cid" }, payload: { type: "object" } } } } } };
  const out = asyncapiExpects(doc, { channel: "orders.placed", within: 30 });
  assert.deepEqual([out.channel.actions.map((a) => [a.operation, a.action]), out.channel.messages[0].correlation], [[["onOrder", "receive"]], "$message.header#/cid"]);
  assert.equal(out.expects.at(-1).within, 30);
  const remote = { ...doc, channels: { "orders.placed": { subscribe: { message: { $ref: "https://elsewhere.invalid/m.json" } } } } };
  assert.deepEqual(rules(asyncapiExpects(remote, { channel: "orders.placed" })), ["REMOTE_REF"]);
});

test("a schedule policy is held to the pack's schedule engine and pinned; the occurrence due at a named instant is computed, never assumed", () => {
  const doc = read("schedule.json");
  const out = scheduleExpects(doc, { at: "2026-10-22T09:00:30+07:00" });
  assert.deepEqual([out.ok, out.schedule.expression, out.schedule.timezone, out.source.kind], [true, "0 9 * * *", "Asia/Ho_Chi_Minh", "schedule-policy"]);
  assert.deepEqual(out.expects.map((e) => [e.property, e.op, e.value]), [["occurrence.id", "eq", "billing-daily:2026-10-22T09:00:00+07:00"]]);
  assert.match(scheduleExpects(doc, { at: "2026-10-22T09:05:00+07:00" }).notes[0], /past its execution deadline/);
  assert.deepEqual([scheduleExpects(doc).expects, scheduleExpects(doc).notes.length], [[], 1], "with no instant named, no occurrence is assumed");
  assert.deepEqual(rules(scheduleExpects({ ...doc, timezone: "Mars/Olympus" })), ["TIMEZONE"]);
  assert.deepEqual(rules(scheduleExpects({ ...doc, misfire: "sometimes" })), ["POLICY"]);
  assert.deepEqual(rules(scheduleExpects({ ...doc, dialect: "quartz" })), ["DIALECT"]);
  assert.deepEqual(rules(scheduleExpects({ ...doc, expression: "61 9 * * *" })), ["EXPRESSION"]);
  assert.deepEqual(rules(scheduleExpects(doc, { at: "tomorrow" })), ["INSTANT"]);
});

test("qa-plan expects reads a contract by its own kind, prints JSON, and exits 2 for anything it cannot read", () => {
  const cli = (...argv) => spawnSync(process.execPath, [join(ROOT, "cli", "qa-plan.mjs"), "expects", ...argv], { encoding: "utf8" });
  const ok = cli(join(CONTRACTS, "openapi.json"), "--operation=readInvoice");
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual([JSON.parse(ok.stdout).kind, JSON.parse(ok.stdout).expects[0].value], ["openapi", 200]);
  assert.equal(cli(join(CONTRACTS, "asyncapi.json"), "--channel=nowhere").status, 2, "a reader's refusal is REFUSED");
  const dir = mkdtempSync(join(tmpdir(), "orbit-contracts-"));
  writeFileSync(join(dir, "other.json"), JSON.stringify({ name: "not a contract" }));
  const other = cli(join(dir, "other.json"));
  assert.deepEqual([other.status, /not a contract any reader here reads/.test(other.stderr)], [2, true]);
  assert.equal(cli().status, 2);
  rmSync(dir, { recursive: true, force: true });
});
