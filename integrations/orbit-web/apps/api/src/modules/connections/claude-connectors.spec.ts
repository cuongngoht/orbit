import assert from "node:assert/strict";
import { test } from "node:test";
import { connectorsOf, controlRequest, CONNECTORS_PROBE_ARGS, settledOver } from "./claude-connectors.js";

const answer = (servers: unknown[]) => ({ type: "control_response", response: { subtype: "success", request_id: "m1", response: { mcpServers: servers } } });

test("the connectors probe asks the CLI's control protocol on the user's settings source, with no tool and none allowed", () => {
  assert.deepEqual(CONNECTORS_PROBE_ARGS.slice(0, 2), ["--input-format", "stream-json"]);
  assert.equal(CONNECTORS_PROBE_ARGS[CONNECTORS_PROBE_ARGS.indexOf("--tools") + 1], "");
  assert.equal(CONNECTORS_PROBE_ARGS[CONNECTORS_PROBE_ARGS.indexOf("--setting-sources") + 1], "user", "the account's connectors come only with it");
  assert.equal(CONNECTORS_PROBE_ARGS[CONNECTORS_PROBE_ARGS.indexOf("--permission-mode") + 1], "dontAsk");
  assert.equal(CONNECTORS_PROBE_ARGS.includes("--restricted"), false, "restricted, the CLI lists no connector");
  assert.deepEqual(JSON.parse(controlRequest("x", "mcp_status")), { type: "control_request", request_id: "x", request: { subtype: "mcp_status" } });
});

test("an mcp_status answer is read into names, states and tool counts -- nothing nameless, nothing unprintable", () => {
  assert.deepEqual(connectorsOf(answer([{ name: "claude.ai Claude Docs", status: "connected", tools: [{}, {}] }, { name: "claude.ai Gmail", status: "needs-auth" }, { status: "connected" }, { name: "bad\u0000name", status: "connected" }])), [
    { name: "claude.ai Claude Docs", status: "connected", tools: 2 },
    { name: "claude.ai Gmail", status: "needs-auth", tools: null },
  ]);
  assert.equal(connectorsOf({ type: "control_response", response: { response: { models: [] } } }), null, "the initialize answer is not this one");
  assert.equal(connectorsOf({ type: "system", subtype: "init" }), null);
});

test("the list has settled when nothing is still connecting and the names are those of the answer before", () => {
  const a = [{ name: "claude.ai Claude Docs", status: "connected", tools: 8 }];
  assert.equal(settledOver(null, a), false, "one answer is not yet a settled list");
  assert.equal(settledOver(a, [{ ...a[0], status: "pending", tools: null }]), false);
  assert.equal(settledOver([], a), false, "a connector arrived");
  assert.equal(settledOver(a, a), true);
});
