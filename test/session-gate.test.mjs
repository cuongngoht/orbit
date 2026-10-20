import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionGate } from "../src/run/gates/session.mjs";

const none = (project) => ({ project, browser: { settled: () => "NONE", dir: () => "/store/runtime/h/sessions/c/agents/a" } });

// A host session's run directory is its own and ORBIT_RUN_DIR is not read there (src/project/affinity.mjs), so the
// refusal says where to open the browser instead of naming a variable that changes nothing.
test("a missing browser in a host session names that session's run directory, never a variable it does not read", () => {
  assert.throws(() => sessionGate(none({ isolated: true }), {}), (e) => /--run-dir \/store\/runtime\/h\/sessions\/c\/agents\/a/.test(e.message) && /is not read in a host session/.test(e.message));
  assert.throws(() => sessionGate(none({ isolated: false }), {}), /run the launcher, then export ORBIT_RUN_DIR=/);
});
