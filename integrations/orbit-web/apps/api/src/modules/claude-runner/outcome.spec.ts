import assert from "node:assert/strict";
import { test } from "node:test";
import { decideOutcome, lostConversation } from "./outcome.js";

const ok = { subtype: "success", isError: false, text: "Done", costUsd: 0.1, turns: 3, durationMs: 1000, permissionDenials: 0 };
const exit = (code: number | null, signal: string | null = null) => ({ code, signal, spawnError: null });

test("completed needs the CLI's success result AND exit code 0", () => {
  assert.equal(decideOutcome({ stoppedBy: null, exit: exit(0), result: ok, stderrTail: "" }).status, "completed");
  assert.equal(decideOutcome({ stoppedBy: null, exit: exit(1), result: ok, stderrTail: "" }).status, "failed");
  assert.equal(decideOutcome({ stoppedBy: null, exit: exit(0), result: { ...ok, isError: true, subtype: "error_max_budget_usd" }, stderrTail: "" }).status, "failed");
});

test("a stopped run is interrupted whatever it printed or returned", () => {
  const o = decideOutcome({ stoppedBy: "user_stop", exit: exit(0), result: ok, stderrTail: "" });
  assert.equal(o.status, "interrupted");
  assert.equal(o.type === "session.interrupted" && o.data.reason, "user_stop");
  assert.equal(decideOutcome({ stoppedBy: "server_restart", exit: exit(null, "SIGKILL"), result: null, stderrTail: "" }).status, "interrupted");
});

test("no result line, a crash or a missing program is a failure that says so", () => {
  const crash = decideOutcome({ stoppedBy: null, exit: exit(1), result: null, stderrTail: "Error: Invalid model" });
  assert.equal(crash.type === "session.failed" && crash.data.reason, "exit");
  assert.match(crash.type === "session.failed" ? crash.data.message : "", /Invalid model/);
  const missing = decideOutcome({ stoppedBy: null, exit: { code: null, signal: null, spawnError: "ENOENT" }, result: null, stderrTail: "" });
  assert.equal(missing.type === "session.failed" && missing.data.reason, "spawn");
  const silent = decideOutcome({ stoppedBy: null, exit: exit(0), result: null, stderrTail: "" });
  assert.equal(silent.type === "session.failed" && silent.data.reason, "no_result");
});

test("a conversation the CLI cannot find is recognised", () => {
  assert.equal(lostConversation("No conversation found with session ID: x"), true);
  assert.equal(lostConversation("all good"), false);
});
