// A hook Claude Code delivers twice is ONE call (0.0.2): its `tool_use_id` is the call's delivery key, hashed like
// Codex's and Grok's, and the working-set line carries it -- so the session's view folds the two however far apart
// they ran. Before, only a 500 ms window folded them, and a busy machine drew one edit twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lifecycleEvent } from "../src/lifecycle/event.mjs";
import { resolveHost } from "../skills/orbit-learn/hosts/index.mjs";
import { workingSet } from "../src/lifecycle/subscribers/working-set.mjs";

const input = (over = {}) => ({ hook_event_name: "PostToolUse", session_id: "s-1", cwd: "/repo", tool_name: "Edit", tool_input: { file_path: "/repo/src/a.js" }, ...over });

test("Claude's tool_use_id becomes the call's hashed delivery key, and none is invented when it is absent", () => {
  const e = lifecycleEvent(resolveHost(input({ tool_use_id: "toolu_1" }), []), input({ tool_use_id: "toolu_1" }), []);
  assert.equal(typeof e.delivery, "string");
  assert.notEqual(e.delivery, "toolu_1", "hashed, never stored as it arrived");
  assert.equal(e.delivery, lifecycleEvent(resolveHost(input({ tool_use_id: "toolu_1" }), []), input({ tool_use_id: "toolu_1" }), []).delivery, "the same call, the same key");
  assert.equal("delivery" in lifecycleEvent(resolveHost(input(), []), input(), []), false);
});

test("the working-set line of a Claude call carries its delivery key", () => {
  const lines = [];
  const ws = { roots: ["/repo"], now: () => "2026-10-20T00:00:00.000Z", host: "claude", append: (session, line) => lines.push(line) };
  const e = lifecycleEvent(resolveHost(input({ tool_use_id: "toolu_1" }), []), input({ tool_use_id: "toolu_1" }), []);
  workingSet.run(e, { workingSet: () => ws });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].delivery, e.delivery);
});
