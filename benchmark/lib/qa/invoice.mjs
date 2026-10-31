// THE INVOICE APPLICATION as a QA target: Orbit's own synthetic acceptance application (acceptance/projects/), built on
// a stack from the run's FROZEN copy with one variant planted in its tree, the variants' outcomes its ground truth
// (acceptance/truth.json). What a person sets up for it in Orbit Control is set here, the way acceptance/run.mjs sets
// it: the tenancy contract a permission test is held to, the kinds of write a generated test may make on its own
// fixture, an address an isolation attestation must fail to reach, and the component's environment by NAME. None of
// it is a secret: the two tokens a run hands the application are made per run, kept in memory and never written.
//
//   INVOICE.assembled(engineDir, stack, variant, dest)      INVOICE.graph(engineDir, stack) -> path
//   INVOICE.clock(engineDir, stack) -> "live" | "none"      INVOICE.designs(engineDir) -> [{ shape, order, design, by-clock? }]
//   INVOICE.tenancy · writes · egress · stackEnv(stack) · componentEnv(stack) · objective · falseAlarm
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const STACK_ENV = { "invoice-a": { AMQP_USER: "invoice", AMQP_PASSWORD: "invoice-pass" }, "invoice-b": { NATS_USER: "invoice", NATS_PASSWORD: "invoice-pass" } };

const TENANCY = { claim: "tid", tenants: { A: "tenant-a", B: "tenant-b" }, identities: { "tenant-a-reader": ["A"], "tenant-b-reader": ["B"], "tenant-a-writer": ["A"] }, resources: { "inv-a": { tenant: "A", marker: "canary-invoice-a", api: "/api/invoices/inv-a" } }, matrix: [{ identity: "tenant-b-reader", resource: "inv-a", operation: "read", expect: "denied" }] };

const truthOf = (engineDir) => JSON.parse(readFileSync(join(engineDir, "acceptance", "truth.json"), "utf8"));

const designAt = (dir, f) => ({ shape: f.slice(0, -5), ...JSON.parse(readFileSync(join(dir, f), "utf8")) });

export const INVOICE = {
  assembled: async (engineDir, stack, variant, dest) => (await import(pathToFileURL(join(engineDir, "acceptance", "projects", "assemble.mjs")).href)).assemble(stack, dest, { variant }),
  graph: (engineDir, stack) => join(engineDir, "acceptance", "graph", `${stack}.jsonl`),
  clock: (engineDir, stack) => truthOf(engineDir).stacks[stack]?.clock ?? "none",
  // The reference host's proposals: acceptance's own scripted designs, one per shape, in their order.
  designs: (engineDir) => ((dir) => readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => designAt(dir, f)).sort((a, b) => a.order - b.order))(join(engineDir, "acceptance", "designs")),
  tenancy: TENANCY,
  writes: ["trigger", "create-resource", "consume", "publish", "control-workload", "advance-clock", "write", "delete-resource"],
  egress: { host: "example.com", port: 443, address: "93.184.215.14" },
  stackEnv: (stack) => STACK_ENV[stack] ?? {},
  componentEnv: (stack) => [...Object.keys(STACK_ENV[stack] ?? {}), "ORBIT_SINK_TOKEN", "ORBIT_TEST_HOOKS", "ORBIT_TEST_HOOKS_TOKEN"],
  objective: "find the defects of the invoice application against its accepted requirement",
  // The one design the false-alarm control breaks: a test that runs to a verdict whatever is planted -- it publishes and
  // reads state back, with no page and no sign-in -- so its false alarm shows in every variant.
  falseAlarm: { shape: "effect-once-per-key" },
};

// The applications a QA case may name, by `target.app`.
export const TARGETS = { invoice: INVOICE };
