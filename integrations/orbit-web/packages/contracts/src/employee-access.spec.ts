// AN EMPLOYEE'S ACCESS TO THE ACCOUNT'S CONNECTORS, as a person changes it: each connector named once, on or off, for
// every repository or the ones chosen -- and nothing else (no credential, no host, no field nobody declared).
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkUpdateEmployeeAccess } from "./employee-access.js";

test("a connector's access is on or off, for every repository or the ones chosen, reading only unless a person lets it write", () => {
  const body = { connectors: [{ connector: "azure", enabled: true, repositories: ["Fabrikam/278d5cd2-584d-4b63-824a-2ba458937249"], write: true }, { connector: "github", enabled: false, repositories: null }] };
  assert.deepEqual(checkUpdateEmployeeAccess(body), { ok: true, value: { connectors: [body.connectors[0], { ...body.connectors[1], write: false }], knowledge: [] } });
  assert.equal(checkUpdateEmployeeAccess({ connectors: [{ connector: "github", enabled: true, repositories: null, write: "yes" }] }).ok, false);
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

test("an employee's access to the account's MCP servers: each named once, on or off; alone or beside the connectors", () => {
  const id = "0b5e2a7c-4d1f-4b8e-9c3a-6f7d8e9a0b1c";
  assert.deepEqual(checkUpdateEmployeeAccess({ knowledge: [{ serverId: id, enabled: true }] }), { ok: true, value: { connectors: [], knowledge: [{ serverId: id, enabled: true }] } });
  const both = { connectors: [{ connector: "github", enabled: false, repositories: null }], knowledge: [{ serverId: id, enabled: false }] };
  assert.deepEqual(checkUpdateEmployeeAccess(both), { ok: true, value: { ...both, connectors: [{ ...both.connectors[0], write: false }] } });
  for (const b of [{ knowledge: [] }, { knowledge: [{ serverId: "kb", enabled: true }] }, { knowledge: [{ serverId: id, enabled: true }, { serverId: id, enabled: false }] }, { knowledge: [{ serverId: id }] }, { knowledge: [{ serverId: id, enabled: true, tools: [] }] }])
    assert.equal(checkUpdateEmployeeAccess(b).ok, false, JSON.stringify(b));
});
