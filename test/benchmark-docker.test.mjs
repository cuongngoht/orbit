// The Docker benchmark's containers, through a fake Process port: what a container is created with (no socket, no
// home, no network for a verifier, a read-only root, every capability dropped, limits, a credential only BY NAME),
// that a container which does not hold to its isolation rows is removed before it starts, that a deadline stops and
// removes it whatever runs inside, and that cleanup removes only what carries the run's own label.
import assert from "node:assert/strict";
import { test } from "node:test";
import { argvOf, cleaned, labelsOf, ranContainer, specFor } from "../benchmark/lib/docker.mjs";

const RUN = { id: "bnr-0123456789ab" };

const probeSpec = () => specFor("probe", RUN, { image: "sha256:" + "a".repeat(64), user: "1000:1000", argv: ["node", "/probe/probe.mjs", "/in/subject"], mounts: [{ source: "/store/benchmark/bnr-0123456789ab/scratch/t", target: "/in/subject", readOnly: true }], limits: { cpus: 2, memoryMb: 2048, pids: 512 }, attestRole: "worker" });

const runnerSpec = () => specFor("runner", RUN, { image: "sha256:" + "b".repeat(64), user: "1000:1000", argv: ["node", "/bench/entry.mjs"], mounts: [{ source: "/store/x/checkout", target: "/work/repo", readOnly: true }], env: { names: ["ANTHROPIC_API_KEY"], values: { HTTPS_PROXY: "http://egress:3128" } }, network: { mode: "network", name: "orbit-bench-abc", alias: "runner" }, limits: { cpus: 2, memoryMb: 6144, pids: 2048 } });

test("a verifier's container has no network, a read-only root, no capability, limits, an init, and no socket or home mounted", () => {
  const argv = argvOf(probeSpec(), "/scratch/env.file");
  const pairs = (k) => argv.flatMap((a, i) => (a === k ? [argv[i + 1]] : []));
  assert.deepEqual(pairs("--network"), ["none"]);
  assert.ok(argv.includes("--read-only") && argv.includes("--init"));
  assert.deepEqual(pairs("--cap-drop"), ["ALL"]);
  assert.deepEqual(pairs("--security-opt"), ["no-new-privileges"]);
  assert.deepEqual([pairs("--cpus")[0], pairs("--memory")[0], pairs("--pids-limit")[0], pairs("--user")[0]], ["2", "2048m", "512", "1000:1000"]);
  assert.ok(pairs("--tmpfs")[0].includes(",exec,"), "the repository's tests run programs they write to /tmp");
  assert.deepEqual(pairs("--mount"), ["type=bind,source=/store/benchmark/bnr-0123456789ab/scratch/t,target=/in/subject,readonly"]);
  assert.ok(!argv.some((a) => /docker\.sock|\.ssh|\.orbit/.test(a)));
  assert.deepEqual(pairs("--label"), ["orbit.benchmark.run=bnr-0123456789ab", "orbit.benchmark.role=probe"]);
});

test("a credential reaches the runner by NAME only: the docker client fills it, and its value is never an argument", () => {
  const argv = argvOf(runnerSpec(), "/scratch/env.file");
  assert.ok(argv.join(" ").includes("-e ANTHROPIC_API_KEY"));
  assert.ok(argv.includes("--env-file"), "a value (the proxy, the locale) rides a private env file");
  assert.ok(!argv.some((a) => a.includes("HTTPS_PROXY=") || a.includes("sk-ant")));
});

// ---- a fake Process port that plays docker ------------------------------------------------------------------------------

function fakeDocker(o = {}) {
  const calls = [];
  const raw = (spec) => ({ Id: "cid-1", Name: `/${spec.name}`, Image: spec.image, Config: { User: spec.user, Labels: spec.labels, Env: ["PATH=/usr/bin", "LANG=C.UTF-8", "LC_ALL=C.UTF-8"] }, HostConfig: { ReadonlyRootfs: o.writableRoot ? false : true, CapDrop: ["ALL"], CapAdd: [], SecurityOpt: ["no-new-privileges"], NanoCpus: 2e9, Memory: 2 ** 31, PidsLimit: 512, Privileged: false, Devices: [], NetworkMode: "none" }, Mounts: spec.mounts.map((m) => ({ Type: "bind", Source: m.source, Destination: m.target, RW: !m.readOnly })), NetworkSettings: { Networks: { none: {} } }, State: { ExitCode: o.exit ?? 0, OOMKilled: false } });
  let spec = null;
  const process = {
    run: (file, args) => (calls.push(args), docker(args)),
    runObserved: async (file, args) => (calls.push(args), o.timeout ? { ok: false, out: "", timedOut: true } : { ok: true, out: "", status: 0 }),
  };
  const docker = (args) => ({ create: () => ({ ok: true, out: "cid-1\n" }), inspect: () => ({ ok: true, out: JSON.stringify([o.inspect ? o.inspect(args[1]) : raw(spec)]) }), stop: () => ({ ok: true, out: "" }), rm: () => ({ ok: true, out: "" }), ps: () => ({ ok: true, out: (o.listed ?? []).join("\n") }), network: () => ({ ok: true, out: "" }) })[args[0]]?.() ?? { ok: true, out: "" };
  return { deps: { process, env: {}, scratch: { write: () => "/scratch/env.file", remove: () => null } }, calls, bind: (s) => (spec = s) };
}

const attest = { network: "none", forbidden: ["/home/dev"], pluginTarget: "/in/subject", imageEnv: ["PATH"] };

test("a container past its deadline is stopped and removed, whatever runs inside it", async () => {
  const f = fakeDocker({ timeout: true, exit: 137 });
  const spec = probeSpec();
  f.bind(spec);
  const r = await ranContainer(spec, f.deps, { timeoutMs: 10, attest });
  assert.equal(r.timedOut, true);
  const verbs = f.calls.map((a) => a[0]);
  assert.ok(verbs.indexOf("stop") > verbs.indexOf("start") && verbs.indexOf("rm") > verbs.indexOf("stop"), verbs.join(","));
  assert.equal(r.exit, 137);
});

test("a container that does not hold to its isolation rows is removed before it ever starts", async () => {
  const f = fakeDocker({ writableRoot: true });
  const spec = probeSpec();
  f.bind(spec);
  const r = await ranContainer(spec, f.deps, { timeoutMs: 10, attest });
  assert.match(r.refused, /ROOT_READ_ONLY/);
  assert.ok(!f.calls.some((a) => a[0] === "start"));
  assert.ok(f.calls.some((a) => a[0] === "rm"));
});

test("cleanup removes only what docker says, again, carries this run's own label", () => {
  const theirs = { Config: { Labels: { "orbit.benchmark.run": "bnr-ffffffffffff" } } };
  const ours = { Config: { Labels: labelsOf(RUN.id, "probe") } };
  const f = fakeDocker({ listed: ["c-ours", "c-theirs"], inspect: (id) => (id === "c-ours" ? ours : theirs) });
  const r = cleaned(RUN.id, f.deps);
  assert.deepEqual(r.containers, [{ id: "c-ours", removed: true }, { id: "c-theirs", removed: false }]);
  assert.ok(!f.calls.some((a) => a[0] === "rm" && a.includes("c-theirs")));
});

test("an environment that cannot be handed by the provider's rules creates nothing", async () => {
  const f = fakeDocker();
  const spec = { ...probeSpec(), env: { names: ["PATH"], values: {} } };
  const r = await ranContainer(spec, f.deps, { timeoutMs: 10, attest });
  assert.match(r.refused, /could not be created/);
  assert.ok(!f.calls.some((a) => a[0] === "create"));
});
