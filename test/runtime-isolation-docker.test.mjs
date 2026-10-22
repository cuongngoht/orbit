// The DOCKER isolation provider (ADR 0038), over the fake Process port: what it would run is the contract, so every
// test reads the argument list and the environment the client would have been started with -- and never starts it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { isolationProblems } from "../src/runtime/isolation/contract-v1.mjs";
import { HANDED_NEVER, buildArgv, createArgv, docker, envProblems, facts, networkArgv } from "../src/runtime/isolation/docker.mjs";
import { createScratch } from "../src/runtime/sandbox/scratch.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { fakeProcess } from "./fakes/process.mjs";

const PIN = `sha256:${"a".repeat(64)}`;
// A path of this platform, as the sandbox context makes it (src/runtime/sandbox/context.mjs joins it).
const ROOM = join("/store/runtime/laptop-a/checkouts/c/sandboxes/sbx/scratch");

const spec = (over = {}) => ({ name: "orbit-abc-worker", image: PIN, network: { mode: "network", name: "orbit-net", alias: "worker" }, labels: { "orbit.task": "tsk-1", "orbit.env": "sbx" }, readOnly: true, tmpfs: ["/tmp:rw,nosuid,nodev,size=256m"], capDrop: ["ALL"], noNewPrivileges: true, mounts: [{ source: "/plugins/orbit", target: "/orbit", readOnly: true }], env: { names: [], values: {} }, limits: { cpus: 2, memoryMb: 2048, pids: 512 }, workdir: "/work/out", argv: ["run-me"], ...over });

// A machine whose docker answers `answer(args)`, with a scratch room of its own.
function machine(answer = () => ({ ok: true, out: "cid-1\n", status: 0 }), env = { PATH: "/usr/bin", HOME: "/Users/someone", DATABASE_URL: "postgres://db/app" }) {
  const io = fakeIo();
  const process = fakeProcess({ docker: (args, opts) => answer(args, opts, io) });
  return { io, process, deps: { process, env, scratch: createScratch(ROOM, io) } };
}

const envFileOf = (args) => args[args.indexOf("--env-file") + 1];

test("the docker provider is a provider of the current contract", () => {
  assert.deepEqual(isolationProblems(docker), []);
});

test("what it creates is said in its argument list: labelled, on the task's network, hardened, limited, and holding only the mounts declared", () => {
  const argv = createArgv(spec());
  const pairs = (flag) => argv.flatMap((a, i) => (a === flag ? [argv[i + 1]] : []));
  assert.deepEqual(pairs("--network"), ["orbit-net"]);
  assert.deepEqual(pairs("--network-alias"), ["worker"]);
  assert.deepEqual(pairs("--label"), ["orbit.task=tsk-1", "orbit.env=sbx"]);
  assert.deepEqual(pairs("--cap-drop"), ["ALL"]);
  assert.deepEqual(pairs("--security-opt"), ["no-new-privileges"]);
  assert.deepEqual(pairs("--mount"), ["type=bind,source=/plugins/orbit,target=/orbit,readonly"]);
  assert.deepEqual([pairs("--cpus")[0], pairs("--memory")[0], pairs("--pids-limit")[0]], ["2", "2048m", "512"]);
  assert.ok(argv.includes("--read-only") && argv.at(-2) === PIN && argv.at(-1) === "run-me");
  for (const never of ["-p", "--publish", "--privileged", "-v", "--volume", "--device", "--pid", "--ipc", "--cap-add"]) assert.ok(!argv.includes(never), `${never} is never asked`);
  assert.ok(!argv.some((a) => /docker\.sock|\/Users\/|\/store\b/.test(a)), "no socket, home or store is named");
  assert.deepEqual(createArgv(spec({ network: null })).slice(3, 5), ["--network", "none"], "a spec that names no network gets none");
  assert.deepEqual(createArgv(spec({ network: { mode: "container", container: "orbit-abc-pod" } })).filter((a, i, all) => all[i - 1] === "--network"), ["container:orbit-abc-pod"]);
  assert.deepEqual(networkArgv({ name: "orbit-net", labels: { "orbit.task": "tsk-1" } }), ["network", "create", "--internal", "--label", "orbit.task=tsk-1", "orbit-net"]);
});

test("a value never rides the command line or the client's own environment: it is in an owner-only scratch file for exactly one call", () => {
  const seen = [];
  const m = machine((args, opts, io) => (seen.push({ args, env: opts.env, file: io.files.get(envFileOf(args)) }), { ok: true, out: "cid-1\n", status: 0 }), { PATH: "/usr/bin", HOME: "/Users/someone" });
  const values = { LD_PRELOAD: "/evil.so", NODE_OPTIONS: "--require /e.js", DOCKER_HOST: "tcp://evil:2375", HOME: "/scratch-home" };
  const made = docker.container.create(spec({ env: { names: [], values } }), m.deps);
  assert.deepEqual(made, { ok: true, id: "cid-1" });
  const [call] = seen;
  assert.ok(!call.args.some((a) => Object.values(values).some((v) => a.includes(v))), "no value is an argument");
  assert.ok(!call.args.includes("-e"), "nothing is handed by name");
  assert.deepEqual(call.env, { PATH: "/usr/bin", HOME: "/Users/someone" }, "the client runs with this machine's own names: no LD_PRELOAD, no NODE_OPTIONS, no DOCKER_HOST a file said");
  assert.equal(call.file, "LD_PRELOAD=/evil.so\nNODE_OPTIONS=--require /e.js\nDOCKER_HOST=tcp://evil:2375\nHOME=/scratch-home\n", "the container is handed them, through the file the client reads");
  assert.ok(dirname(envFileOf(call.args)) === ROOM && m.io.state.private.has(envFileOf(call.args)), "the file is the sandbox's, made owner-only and new");
  assert.equal(m.io.files.has(envFileOf(call.args)), false, "and it is gone once the call ended");
});

test("a name is handed from this machine's environment only when it cannot steer the client: the loader, a runtime, a proxy, trust and the client's own are refused by a table", () => {
  const refused = ["LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "HTTPS_PROXY", "NO_PROXY", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "DOCKER_HOST", "DOCKER_CONFIG", "BUILDKIT_PROGRESS", "PATH", "HOME", "TMPDIR", "XDG_RUNTIME_DIR", "OTEL_EXPORTER_OTLP_ENDPOINT", "GODEBUG", "JAVA_TOOL_OPTIONS", "PYTHONPATH", "http_proxy", "lower", "1ABC", "A-B"];
  for (const name of refused) assert.equal(envProblems({ names: [name] }).length, 1, `${name} is refused`);
  assert.deepEqual(envProblems({ names: ["DATABASE_URL", "NODE_ENV", "API_TOKEN"] }), []);
  assert.ok(HANDED_NEVER.every((r) => typeof r.why === "string" && r.why.length > 10), "every row says why, in a sentence");
  const m = machine();
  const answer = docker.container.create(spec({ env: { names: ["DATABASE_URL", "LD_PRELOAD"], values: {} } }), m.deps);
  assert.equal(answer.ok, false);
  assert.match(answer.why, /LD_PRELOAD: the dynamic loader reads it/);
  assert.equal(m.process.calls.length, 0, "docker is never called");
});

test("a name that passes is handed as `-e NAME`, its value read from this machine's environment by the client and never written", () => {
  const m = machine();
  docker.container.create(spec({ env: { names: ["DATABASE_URL"], values: {} } }), m.deps);
  const [call] = m.process.calls;
  assert.deepEqual(call.args.slice(call.args.indexOf("-e"), call.args.indexOf("-e") + 2), ["-e", "DATABASE_URL"]);
  assert.ok(!call.args.includes("--env-file") && !call.args.some((a) => a.includes("postgres://")));
  assert.equal(call.opts.env.DATABASE_URL, "postgres://db/app");
  assert.equal(m.io.files.size, 0, "nothing was written for it");
});

test("a value that cannot be one line is refused before anything runs; a scratch file is removed when docker fails and when the call throws", () => {
  const m = machine();
  for (const values of [{ A: "one\ntwo" }, { A: "nul\u0000" }, { A: "x".repeat(40000) }, { "my.var": "x" }]) assert.equal(docker.container.create(spec({ env: { names: [], values } }), m.deps).ok, false);
  assert.equal(m.process.calls.length + m.io.files.size, 0);
  const failing = machine(() => ({ ok: false, out: "", error: "Error response from daemon", status: 125 }));
  assert.equal(docker.container.create(spec({ env: { names: [], values: { A: "1" } } }), failing.deps).ok, false);
  assert.equal(failing.io.files.size, 0);
  const throwing = machine(() => { throw new Error("the port broke"); });
  assert.throws(() => docker.container.create(spec({ env: { names: [], values: { A: "1" } } }), throwing.deps), /the port broke/);
  assert.equal(throwing.io.files.size, 0);
});

test("with values to hand and no scratch room, nothing is called at all", () => {
  const m = machine();
  const answer = docker.container.create(spec({ env: { names: [], values: { A: "1" } } }), { ...m.deps, scratch: null });
  assert.deepEqual([answer.ok, answer.refused], [false, true]);
  assert.equal(m.process.calls.length, 0);
});

test("a run-once container keeps its scratch file until its run settles, then removes it", async () => {
  const io = fakeIo();
  let release;
  const process = { runObserved: (file, args) => new Promise((resolve) => (release = () => resolve({ ok: true, out: "RESOLVED UNREACHABLE\n", status: 0, args }))) };
  const pending = docker.container.runOnce(spec({ env: { names: [], values: { A: "1" } } }), { process, env: {}, scratch: createScratch(ROOM, io) });
  assert.equal(io.files.size, 1, "the file is there while the client may read it");
  release();
  const answer = await pending;
  assert.equal(answer.ok, true);
  assert.equal(io.files.size, 0);
  assert.deepEqual(answer.args.slice(0, 3), ["run", "--rm", "-i"]);
});

test("a container is removed with the anonymous volumes it was created with -- never a named volume, never a prune", () => {
  const m = machine(() => ({ ok: true, out: "", status: 0 }));
  assert.equal(docker.container.remove("cid-1", m.deps).ok, true);
  assert.deepEqual(m.process.calls.map((c) => c.args), [["rm", "-v", "cid-1"]], "an image's own VOLUME belongs to the container that made it, and leaves with it");
  assert.equal(m.process.calls.some((c) => ["volume", "prune", "system"].includes(c.args[0]) || c.args.includes("--volumes")), false);
});

test("facts are what docker inspect SAID, in the generic words the profile reads", () => {
  const raw = { Id: "f00d", Name: "/orbit-abc-worker", Image: PIN, State: { Running: true, StartedAt: "2026-10-21T10:00:01.5Z" }, Config: { Labels: { "orbit.task": "tsk-1" }, Env: ["PATH=/usr/bin", "ORBIT_STORE_DIR=/work/out/store"] }, HostConfig: { ReadonlyRootfs: true, NetworkMode: "orbit-net", PortBindings: { "80/tcp": [{ HostPort: "8080" }], "81/tcp": [] }, Privileged: false, Devices: [], PidMode: "", IpcMode: "private", UTSMode: "", UsernsMode: "", CapDrop: ["ALL"], CapAdd: null, SecurityOpt: ["no-new-privileges"], NanoCpus: 2e9, Memory: 2147483648, PidsLimit: 512 }, Mounts: [{ Type: "bind", Source: "/plugins/orbit", Destination: "/orbit", RW: false }, { Type: "volume", Name: "data", Destination: "/data", RW: true }], NetworkSettings: { Networks: { "orbit-net": {} } } };
  assert.deepEqual(facts(raw), { id: "f00d", name: "orbit-abc-worker", running: true, startedAt: "2026-10-21T10:00:01.5Z", image: PIN, labels: { "orbit.task": "tsk-1" }, readOnly: true, mounts: [{ type: "bind", source: "/plugins/orbit", target: "/orbit", readOnly: true }, { type: "volume", source: "data", target: "/data", readOnly: false }], networks: ["orbit-net"], networkMode: "orbit-net", published: ["80/tcp"], privileged: false, devices: 0, hostNamespaces: 0, capDrop: ["ALL"], capAdd: [], securityOpt: ["no-new-privileges"], limits: { cpus: 2e9, memory: 2147483648, pids: 512 }, env: ["PATH", "ORBIT_STORE_DIR"] });
  assert.equal(facts({ ...raw, State: { Running: false, StartedAt: "0001-01-01T00:00:00Z" } }).startedAt, null, "a container that never started has no start time");
  assert.equal(facts({ ...raw, HostConfig: { ...raw.HostConfig, PidMode: "host", Privileged: true } }).hostNamespaces, 1);
  assert.equal(facts(null), null);
});

test("an image is used only when it is already on this machine, and an image is built with no network unless a person said so", () => {
  const m = machine((args) => (args[0] === "image" ? { ok: true, out: JSON.stringify([{ RepoDigests: [`node@${PIN}`], Id: `sha256:${"b".repeat(64)}` }]), status: 0 } : { ok: true, out: "", status: 0 }));
  assert.equal(docker.imageDigest(PIN, m.deps), PIN, "a pinned reference is its own answer");
  assert.equal(m.process.calls.length, 0);
  assert.equal(docker.imageDigest("node:22", m.deps), `node@${PIN}`);
  assert.deepEqual(m.process.calls.map((c) => c.args.slice(0, 2)), [["image", "inspect"]], "asked, never pulled");
  const at = { dockerfile: "/ws/app/Dockerfile", tag: "orbit-x:1", labels: { "orbit.env": "sbx" }, context: "/ws/app" };
  assert.deepEqual(buildArgv(at).slice(0, 3), ["build", "--network", "none"]);
  assert.deepEqual(buildArgv({ ...at, network: "default" }).slice(0, 3), ["build", "--network", "default"]);
  assert.deepEqual(buildArgv({ ...at, network: "host" }).slice(0, 3), ["build", "--network", "none"], "anything else is none");
});
