// A WRITE THROUGH A CONNECTOR PASSES EVERY GATE A READ DOES, FIRST: the policy's word on the employee using that
// connector on that resource at all (`tool.connector`) comes before anything is asked of the connector -- even the read
// that checks a work item's project -- and before a write is proposed.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppConfig } from "../../config/config.js";
import type { ProcessPort } from "../../infra/process/process.port.js";
import type { GovernanceContext } from "../auth/principal.js";
import type { PolicyService } from "../governance/policy.service.js";
import { ConnectorBroker } from "./connector-broker.js";
import type { ConnectorWrites } from "./connector-writes.js";
import type { ConnectionGrantStore } from "./grants.store.js";

function brokerWith(deny: string) {
  const runs: string[][] = [];
  const proposed: unknown[] = [];
  const decided: string[] = [];
  const config = { binaries: { az: "az", gh: "gh" }, controlHome: "/tmp/control", sourceEnv: {}, governance: { deployment: "single" }, data: { home: "/tmp/home", azure: "/tmp/azure" } } as unknown as AppConfig;
  const process = { run: async (_file: string, args: string[]) => (runs.push(args), { code: 0, signal: null, stdout: JSON.stringify({ fields: { "System.TeamProject": "Fiber" } }), stderr: "", timedOut: false, truncated: false, spawnError: null }) } as unknown as ProcessPort;
  const grants = { live: async () => new Map([["azure", { repositories: null, write: true, grantedAt: "2026-11-22T00:00:00.000Z" }]]) } as unknown as ConnectionGrantStore;
  const policy = { decide: async (_ctx: unknown, ask: { action: string }) => (decided.push(ask.action), { verdict: ask.action === deny ? "deny" : "allow", reasonCodes: ["RULE_MATCHED"], decisionId: "dec-1" }) } as unknown as PolicyService;
  const writes = { propose: async (_ctx: unknown, w: unknown) => (proposed.push(w), { text: "asked", isError: false }) } as unknown as ConnectorWrites;
  return { broker: new ConnectorBroker(config, process, grants, policy, writes), runs, proposed, decided };
}

const COMMENT = { url: "https://dev.azure.com/Fabrikam/Fiber/_workitems/edit/42", text: "PDF export is in the summary." };

test("a resource the policy keeps the employee from is neither read nor written, whatever the write's own rule says", async () => {
  const { broker, runs, proposed, decided } = brokerWith("tool.connector");
  const a = await broker.call({} as GovernanceContext, "acct", "emp", "azure_devops_comment", COMMENT);
  assert.equal(a.isError, true);
  assert.match(a.text, /policy in effect does not let you use azure-devops:Fabrikam\/Fiber/);
  assert.deepEqual(decided, ["tool.connector"]);
  assert.deepEqual(runs, [], "nothing is asked of Azure DevOps");
  assert.deepEqual(proposed, [], "nothing is proposed");
});

test("a resource the policy lets the employee use: the work item's project is checked, then the write is proposed", async () => {
  const { broker, runs, proposed, decided } = brokerWith("none");
  const a = await broker.call({} as GovernanceContext, "acct", "emp", "azure_devops_comment", COMMENT);
  assert.deepEqual([a.isError, a.text], [false, "asked"]);
  assert.deepEqual(decided, ["tool.connector"]);
  assert.equal(runs.length, 1);
  assert.deepEqual(proposed, [{ connector: "azure", operation: "comment", owner: "Fabrikam", container: "Fiber", item: 42, value: COMMENT.text }]);
});
