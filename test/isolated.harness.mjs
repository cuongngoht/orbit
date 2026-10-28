// An ISOLATED task sandbox over fakes: the person's runtime and a task's workspace (test/sandbox.harness.mjs), a
// policy that says isolation is required, and a scripted container world (test/fakes/isolation.mjs). What a test varies
// is what the world does; a person's review marks (`trust`) are evidence, never a gate.
import { sandboxFilled } from "../src/runtime/sandbox/policy.mjs";
import { CONTAINER_TOOLS, sandboxWorld } from "./sandbox.harness.mjs";
import { fakeIsolation } from "./fakes/isolation.mjs";

export const pin = (c) => `sha256:${c.repeat(64)}`;
export const WORKER = `registry.example/orbit-worker@${pin("e")}`;
export const IMAGES = { "node:22": `node@${pin("1")}`, "postgres:16": `postgres@${pin("2")}` };
export const FILES = {
  "web/package.json": JSON.stringify({ name: "web", engines: { node: ">=22" }, scripts: { dev: "vite" } }),
  "web/package-lock.json": "{}",
  "compose.yaml": "services:\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_PASSWORD: example\n",
};

const TRUST_LIST = { topology: "trustedTopologies", "worker-image": "trustedWorkers" };

export function isolationSet(world, patch) {
  const current = world.ctx.readSettings();
  const sandbox = sandboxFilled(current.settings.sandbox);
  return world.ctx.writeSettings({ next: { ...current.settings, sandbox: { ...sandbox, isolation: { ...sandbox.isolation, ...patch(sandbox.isolation) } } }, revision: current.revision, by: "person" });
}

export const trust = (world, kind, fingerprint) => isolationSet(world, (i) => ({ [TRUST_LIST[kind]]: [...i[TRUST_LIST[kind]], fingerprint] }));

// A task's sandbox whose policy says isolation is required, over a container world nobody has trusted anything in yet.
export function isolatedWorld(opts = {}) {
  const iso = fakeIsolation({ images: IMAGES, ...opts.iso });
  const world = sandboxWorld(opts.files ?? FILES, { tools: CONTAINER_TOOLS, reachWorld: { addresses: { "example.com": "93.184.215.14" } } });
  Object.assign(world.ctx, { isolation: [iso], pluginRoot: "/plugins/orbit", supervisorArgv: ["node", "/plugins/orbit/cli/sandbox-supervisor.mjs"] });
  isolationSet(world, () => ({ mode: "required", provider: "fake", workerImage: opts.workerImage === undefined ? WORKER : opts.workerImage }));
  return { ...world, iso };
}

// Prepared from the first ask: a task's own isolated sandbox is brought up autonomously (0.2.0) -- nobody's review mark
// on its worker image or its topology is waited for; the image is a person's choice, pinned by digest.
export async function readyWorld(opts = {}) {
  const w = isolatedWorld(opts);
  return { ...w, ready: await w.run("sandbox-prepare") };
}

