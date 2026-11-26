// THE GATE, FROM ORBIT WEB'S SIDE (ADR 0063): the model plane's runner credential exists in this process only after the
// allocator's gate released it, and -- under enforce -- only as long as the proof it was released on stands. A start past
// that must open again, through the gate.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AllocatorApi, AttemptStatusRecord } from "./allocator-protocol.js";
import { ContainerSandboxProvider } from "./container-provider.js";

const record: AttemptStatusRecord = {
  dispatchKey: "asg-1:1",
  runId: "run-1",
  toolPlane: { id: "t", name: "tool" },
  modelPlane: { id: "m", name: "model", ip: "10.0.0.2", port: 7070 },
  createdAt: "2026-11-26T00:00:00.000Z",
  modelPlaneHome: "/connection",
  modelPlaneCwd: "/workdir",
  bridgeCommand: { command: "node", args: [] },
  protection: null,
  toolPlaneRunning: true,
  modelPlaneRunning: true,
  oomKilled: { modelPlane: false, toolPlane: false },
};

const providerWith = (validUntil: string | null) => {
  let opens = 0;
  const api = { findAttempt: async () => record, openAttempt: async () => ((opens += 1), { runnerCredential: "c".repeat(64), protection: null, validUntil }) } as unknown as AllocatorApi;
  const p = new ContainerSandboxProvider(api, { secret: "s".repeat(32), prefix: "ow", modelPlaneAddress: "ip", readInput: async () => Buffer.alloc(0), probes: { egress: { host: "1.1.1.1", port: 443 }, dnsName: "example.com", database: null }, acceptSoftStorage: false });
  return { p, opens: () => opens };
};

test("no credential before the gate: the model plane cannot be reached until the attempt is opened", async () => {
  const { p } = providerWith(null);
  const found = await p.find("asg-1:1");
  assert.ok(found !== null);
  assert.throws(() => p.modelPlane(found.handle), /not been opened/);
  await p.open(found.handle);
  assert.ok(p.modelPlane(found.handle));
});

test("an enforced attempt's credential lasts only as long as the proof it was released on: past it, open again", async () => {
  const fresh = providerWith(new Date(Date.now() + 60_000).toISOString());
  const h = (await fresh.p.find("asg-1:1"))!.handle;
  await fresh.p.open(h);
  assert.ok(fresh.p.modelPlane(h), "within the proof's freshness");
  const stale = providerWith(new Date(Date.now() - 1).toISOString());
  const h2 = (await stale.p.find("asg-1:1"))!.handle;
  await stale.p.open(h2);
  assert.throws(() => stale.p.modelPlane(h2), /expired/, "past it: the gate must be asked again");
  // Removing the attempt forgets its credential.
  await stale.p.open(h2);
  assert.equal(stale.opens(), 2);
});
