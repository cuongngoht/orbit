// A MODEL PLANE'S RUNNER answers only its own attempt: a connection that does not name the attempt's token first -- or
// names another attempt's -- starts nothing; with the token, a program runs as through any runner, and gets the
// runner's pass-through environment beneath its own. A runner started without a token (the governed deployment's
// agent container) is unchanged.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { runnerToken } from "../contexts/execution/infrastructure/sandbox/ids.js";
import { RunnerProcessPort } from "../infra/process/runner-port.js";
import { startRunner } from "./server.js";

const NODE = process.execPath;
const secret = "q".repeat(40);

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });

describe("a runner started with an attempt's token", () => {
  let server: Server;
  let port: number;
  const own = runnerToken(secret, "run-1:1");
  before(async () => {
    port = await freePort();
    server = await startRunner(port, "127.0.0.1", { token: own, baseEnv: { PATH: process.env.PATH ?? "", FROM_RUNNER: "base", OVERRIDDEN: "base" } });
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  test("with its token, a program runs, and gets the runner's environment beneath its own", async () => {
    const r = await new RunnerProcessPort("127.0.0.1", port, own).run(NODE, ["-e", "process.stdout.write([process.env.FROM_RUNNER, process.env.OVERRIDDEN, process.env.ONLY].join(','))"], { cwd: tmpdir(), env: { OVERRIDDEN: "frame", ONLY: "frame" }, timeoutMs: 10_000 });
    assert.deepEqual([r.code, r.stdout], [0, "base,frame,frame"]);
  });

  test("without a token, or with another attempt's, nothing starts", async () => {
    for (const token of [null, runnerToken(secret, "run-2:1"), "x".repeat(64)]) {
      const marker = join(tmpdir(), `runner-auth-${randomBytes(6).toString("hex")}`);
      const r = await new RunnerProcessPort("127.0.0.1", port, token).run(NODE, ["-e", "require('fs').writeFileSync(process.argv[1], 'ran')", marker], { cwd: tmpdir(), env: {}, timeoutMs: 10_000 });
      assert.deepEqual([r.code, r.spawnError], [null, "ERUNNERLOST"]);
      assert.equal(existsSync(marker), false, "the program never ran");
    }
  });
});

test("a runner started without a token behaves as before", async () => {
  const p = await freePort();
  const server = await startRunner(p, "127.0.0.1");
  try {
    const r = await new RunnerProcessPort("127.0.0.1", p).run(NODE, ["-e", "process.stdout.write('ok')"], { cwd: tmpdir(), env: {}, timeoutMs: 10_000 });
    assert.deepEqual([r.code, r.stdout], [0, "ok"]);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
