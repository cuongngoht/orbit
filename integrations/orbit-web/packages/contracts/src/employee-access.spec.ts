// AN EMPLOYEE'S ACCESS TO THE ACCOUNT'S CONNECTORS, as a person changes it: each connector named once, on or off, for
// every repository or the ones chosen -- and nothing else (no credential, no host, no field nobody declared).
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkUpdateEmployeeAccess } from "./employee-access.js";

test("a connector's access is on or off, for every repository or the ones chosen", () => {
  const body = { connectors: [{ connector: "azure", enabled: true, repositories: ["Fabrikam/278d5cd2-584d-4b63-824a-2ba458937249"] }, { connector: "github", enabled: false, repositories: null }] };
  assert.deepEqual(checkUpdateEmployeeAccess(body), { ok: true, value: body });
});

test("anything else is refused: an unknown connector, one named twice, a token, a list that is not one", () => {
  const bad = [
    {},
    { connectors: [] },
    { connectors: [{ connector: "gitlab", enabled: true, repositories: null }] },
    { connectors: [{ connector: "github", enabled: true, repositories: null }, { connector: "github", enabled: false, repositories: null }] },
    { connectors: [{ connector: "github", enabled: "yes", repositories: null }] },
    { connectors: [{ connector: "github", enabled: true, repositories: "all" }] },
    { connectors: [{ connector: "github", enabled: true, repositories: ["a\nb"] }] },
    { connectors: [{ connector: "github", enabled: true, repositories: null, token: "ghp_x" }] },
    { connectors: [{ connector: "github", enabled: true, repositories: null }], employeeId: "x" },
  ];
  for (const b of bad) assert.equal(checkUpdateEmployeeAccess(b).ok, false, JSON.stringify(b));
});
