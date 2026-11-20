// THE RUNNER: a program started through it behaves as one started here -- what it prints, what it is given, how it
// ends, the limits `run` holds it to, bytes kept as bytes -- and nothing it starts outlives the connection. Its
// isolation check tells a room it can see from one it cannot, a writable directory from a read-only one, and a way out
// from none.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { RunnerProcessPort } from "../infra/process/runner-port.js";
import { RunnerAttestor } from "../modules/governance/runner-attestor.js";
import { dataDirs } from "../config/config.js";
import { startRunner } from "./server.js";

const NODE = process.execPath;
const env = { PATH: process.env.PATH ?? "" };

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("a program through the runner", () => {
  let server: Server;
  let port: RunnerProcessPort;
  before(async () => {
    const p = await freePort();
    server = await startRunner(p, "127.0.0.1");
    port = new RunnerProcessPort("127.0.0.1", p);
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  test("prints, reads its input, and exits as it would here", async () => {
    const r = await port.run(NODE, ["-e", "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{process.stdout.write('got:'+s);process.stderr.write('warn');process.exit(3)})"], { cwd: tmpdir(), env, input: "hello", timeoutMs: 10_000 });
    assert.deepEqual([r.stdout, r.stderr, r.code, r.spawnError, r.timedOut], ["got:hello", "warn", 3, null, false]);
  });

  test("gets exactly the environment and directory it was given, as an argument list (no shell)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runner-cwd-"));
    try {
      const r = await port.run(NODE, ["-e", "process.stdout.write(JSON.stringify([process.cwd(), process.env.ONLY, process.env.HOME ?? null, process.argv[1]]))", "; rm -rf /"], { cwd: dir, env: { ...env, ONLY: "this" }, timeoutMs: 10_000 });
      const [cwd, only, home, arg] = JSON.parse(r.stdout) as string[];
      assert.ok(cwd?.endsWith(dir.split("/").at(-1) as string));
      assert.deepEqual([only, home, arg], ["this", null, "; rm -rf /"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("is held to run()'s limits on this side: output cut, time out stops the group", async () => {
    const big = await port.run(NODE, ["-e", "process.stdout.write('x'.repeat(100000))"], { cwd: tmpdir(), env, timeoutMs: 10_000, maxOutputBytes: 1000 });
    assert.deepEqual([big.stdout.length, big.truncated], [1000, true]);
    const slow = await port.run(NODE, ["-e", "setTimeout(()=>{},60000)"], { cwd: tmpdir(), env, timeoutMs: 300 });
    assert.equal(slow.timedOut, true);
    assert.notEqual(slow.signal, null);
  });

  test("bytes stay bytes", async () => {
    const r = await port.runBinary(NODE, ["-e", "process.stdout.write(Buffer.from([0,255,1,254,10,13]))"], { cwd: tmpdir(), env, timeoutMs: 10_000 });
    assert.deepEqual([...r.stdout], [0, 255, 1, 254, 10, 13]);
  });

  test("is stopped as a group, and killed when the connection ends", async () => {
    const handle = port.spawn(NODE, ["-e", "setInterval(()=>{},1000)"], { cwd: tmpdir(), env });
    await new Promise((r) => setTimeout(r, 300));
    handle.kill("SIGTERM");
    const exit = await handle.exited;
    assert.equal(exit.signal, "SIGTERM");
    const orphan = port.spawn(NODE, ["-e", "setInterval(()=>{},1000)"], { cwd: tmpdir(), env });
    for (let i = 0; i < 50 && orphan.pid === null; i += 1) await new Promise((r) => setTimeout(r, 20));
    const pid = orphan.pid as number;
    assert.equal(alive(pid), true);
    (orphan as unknown as { socket: { destroy(): void } }).socket.destroy();
    for (let i = 0; i < 100 && alive(pid); i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.equal(alive(pid), false, "nothing outlives the connection that started it");
  });

  test("a program that cannot start is said so", async () => {
    const r = await port.run("/no/such/program", [], { cwd: tmpdir(), env, timeoutMs: 5_000 });
    assert.equal(r.spawnError, "ENOENT");
  });
});

test("a runner nobody answers is a program that could not start, never a hang", async () => {
  const port = new RunnerProcessPort("127.0.0.1", await freePort());
  const r = await port.run(NODE, ["-e", ""], { cwd: tmpdir(), env, timeoutMs: 5_000 });
  assert.equal(r.spawnError, "ERUNNERUNREACHABLE");
});

describe("the isolation check", () => {
  let server: Server;
  let root: string;
  let port: RunnerProcessPort;
  before(async () => {
    const p = await freePort();
    server = await startRunner(p, "127.0.0.1");
    port = new RunnerProcessPort("127.0.0.1", p);
    root = mkdtempSync(join(tmpdir(), "attest-"));
    for (const d of ["app", "governance", "github", "azure", "control", "research", "sessions", "repos"]) mkdirSync(join(root, d));
  });
  after(async () => {
    rmSync(root, { recursive: true, force: true });
    await new Promise<void>((r) => server.close(() => r()));
  });

  test("on one machine (no isolation) it fails, naming every room it can see and the way out it has", async () => {
    const closed = await freePort();
    const attestor = new RunnerAttestor({ data: dataDirs(root) } as never, port, { egress: { host: "127.0.0.1", port: closed }, dnsName: "localhost" });
    const { checks } = await attestor.attest();
    const byName = Object.fromEntries(checks.map((c) => [c.name, c.ok]));
    assert.deepEqual(byName, { sees_sessions: true, sees_repos: true, no_app: false, no_governance: false, no_github: false, no_azure: false, no_control: false, no_research: false, repos_read_only: false, direct_egress: true, public_dns: false });
    assert.match(checks.find((c) => c.name === "no_governance")?.detail ?? "", /VISIBLE/);
  });

  test("it removes every canary it wrote", async () => {
    const attestor = new RunnerAttestor({ data: dataDirs(root) } as never, port, { egress: { host: "127.0.0.1", port: await freePort() }, dnsName: "no-such-host.invalid" });
    await attestor.attest();
    const { readdirSync } = await import("node:fs");
    for (const d of ["app", "governance", "sessions", "repos"]) assert.deepEqual(readdirSync(join(root, d)), [], d);
  });

  test("a direct way out is seen", async () => {
    const listener = createServer((s) => s.end());
    await new Promise<void>((r) => listener.listen(0, "127.0.0.1", () => r()));
    const open = (listener.address() as AddressInfo).port;
    try {
      const attestor = new RunnerAttestor({ data: dataDirs(root) } as never, port, { egress: { host: "127.0.0.1", port: open }, dnsName: "no-such-host.invalid" });
      const { checks } = await attestor.attest();
      assert.deepEqual(checks.filter((c) => c.name === "direct_egress" || c.name === "public_dns").map((c) => [c.name, c.ok]), [["direct_egress", false], ["public_dns", true]]);
    } finally {
      listener.close();
    }
  });

  test("a canary somebody planted a link at is never written through", async () => {
    // The attestor's canaries get fresh names, created exclusively: a link left anywhere is never followed.
    const target = join(root, "governance", "precious");
    writeFileSync(target, "keep me");
    const { symlinkSync, readFileSync } = await import("node:fs");
    symlinkSync(target, join(root, "sessions", ".orbit-attest-planted"));
    const attestor = new RunnerAttestor({ data: dataDirs(root) } as never, port, { egress: { host: "127.0.0.1", port: await freePort() }, dnsName: "no-such-host.invalid" });
    await attestor.attest();
    assert.equal(readFileSync(target, "utf8"), "keep me");
  });
});
