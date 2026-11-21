import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError } from "./config.js";
import { egressConfig } from "./egress-config.js";

test("the proxy's cap on one run's open connections is always on: 256 unless the installation sets another", () => {
  assert.deepEqual(egressConfig({}), { maxConnectionsPerRun: 256 });
  assert.deepEqual(egressConfig({ ORBIT_WEB_EGRESS_MAX_CONNECTIONS_PER_RUN: "  " }), { maxConnectionsPerRun: 256 });
  assert.deepEqual(egressConfig({ ORBIT_WEB_EGRESS_MAX_CONNECTIONS_PER_RUN: " 16 " }), { maxConnectionsPerRun: 16 });
  for (const bad of ["0", "-1", "1.5", "1e3", "abc", "65536", "off"]) assert.throws(() => egressConfig({ ORBIT_WEB_EGRESS_MAX_CONNECTIONS_PER_RUN: bad }), ConfigError, bad);
});
