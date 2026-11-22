// A CHAT'S OR A RESEARCH SESSION'S RUN IN REAL CONTAINERS (`npm run test:sandbox`): the allocator makes a run's sandbox
// from ids alone -- the Orbit Web image's runner, hardened, holding that run's places of Orbit Web's data volume at the
// paths Orbit Web uses, and nothing else: not another chat's workspace, not another account's sign-in, not the control
// room, not the database -- and removes it, with its network, when asked or swept. What is inside is read with `docker
// exec`, so the suite needs no route from this process to a container's address.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { execIn, text } from "../../src/allocator/containers.js";
import type { SessionSpec } from "../../src/contexts/execution/infrastructure/sandbox/allocator-protocol.js";
import { sessionNames } from "../../src/contexts/execution/infrastructure/sandbox/ids.js";
import { DockerEngine } from "../../src/allocator/docker/engine.js";
import { createLab, dockerUnavailable, ensureImages, IMAGES, SOCKET, type Lab } from "./harness.js";

const why = (await dockerUnavailable()) ?? ((await new DockerEngine(SOCKET).imageInspect(IMAGES.session)) === null ? `no image ${IMAGES.session} (ORBIT_WEB_SANDBOX_TEST_SESSION)` : null);

describe("a chat's or research run's own sandbox, in real containers", { skip: why ?? false, timeout: 15 * 60_000 }, () => {
  let lab: Lab;
  before(async () => {
    await ensureImages();
    lab = await createLab();
  });
  after(async () => {
    await lab?.cleanup();
  });

  const spec = (over: Partial<SessionSpec>): SessionSpec => ({ accountId: lab.orbitA, sessionId: "chat-a", connectionId: "conn-1", runId: "run-a", dispatchKey: "session:run-a", kind: "chat", workspace: "rw", switches: { github: false, azure: false }, ...over });
  // A shell line run inside the sandbox as Orbit Web's user; what it printed.
  async function inside(name: string, script: string): Promise<{ code: number | null; out: string; err: string }> {
    const c = await lab.engine.containerInspect(name);
    assert.ok(c, `${name} exists`);
    const r = await execIn(lab.engine, c.Id, ["sh", "-c", script], { user: "10001:10001", timeoutMs: 30_000, maxOutputBytes: 65_536 });
    return { code: r.code, out: text(r.stdout).trim(), err: text(r.stderr).trim() };
  }

  test("a chat's run: its own chat, connection and Orbit store at Orbit Web's paths, writable; nothing of another chat, account or the control room; a read-only root", async () => {
    const made = await lab.allocator.startSession(spec({}));
    const r = await inside(made.name, [
      "id -u",
      "cat /data/workspaces/chat-a/repository/mine.txt",
      "touch /data/workspaces/chat-a/repository/new.txt && echo workspace-written",
      "touch /data/orbit/accounts/$ACCT/note && echo store-written",
      `test -r /data/connections/${lab.orbitA}/conn-1/claude/.credentials.json && echo own-login`,
      `test -e /data/connections/${lab.orbitB} && echo LEAK-other-account`,
      "test -e /data/workspaces/chat-b/repository/theirs.txt && echo LEAK-other-chat",
      "test -e /data/control/credentials/key && echo LEAK-control",
      "touch /etc/written 2>/dev/null && echo LEAK-root-writable",
      "touch /data/home/h && echo home-written",
      "true",
    ].join("; ").replace("$ACCT", lab.orbitA));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.out.split("\n"), ["10001", "mine", "workspace-written", "store-written", "own-login", "home-written"]);
    const c = await lab.engine.containerInspect(made.name);
    assert.deepEqual([c?.HostConfig.ReadonlyRootfs, c?.HostConfig.Privileged, c?.HostConfig.CapDrop], [true, false, ["ALL"]]);
    assert.deepEqual(Object.keys(c?.NetworkSettings.Networks ?? {}), [sessionNames(lab.prefix, "session:run-a").network], "a network of its own");
  });

  test("the database is not reachable from a run's sandbox", async () => {
    const r = await inside(sessionNames(lab.prefix, "session:run-a").container, `node -e "require('net').connect(5432,'${lab.databaseIp}').on('connect',()=>{console.log('LEAK-database');process.exit(0)}).on('error',()=>process.exit(0)).setTimeout(3000,()=>process.exit(0))"`);
    assert.equal(r.out.includes("LEAK-database"), false);
  });

  test("a Plan run on Codex reads its workspace and writes nothing there", async () => {
    const made = await lab.allocator.startSession(spec({ runId: "run-ro", dispatchKey: "session:run-ro", workspace: "ro" }));
    const r = await inside(made.name, "cat /data/workspaces/chat-a/repository/mine.txt; touch /data/workspaces/chat-a/repository/plan.txt 2>/dev/null && echo LEAK-wrote; true");
    assert.deepEqual(r.out.split("\n"), ["mine"]);
  });

  test("a research run holds its connection's home alone", async () => {
    const made = await lab.allocator.startSession(spec({ runId: "run-r", dispatchKey: "session:run-r", kind: "research", workspace: "none" }));
    const r = await inside(made.name, `test -r /data/connections/${lab.orbitA}/conn-1/claude/.credentials.json && echo own-login; test -e /data/workspaces/chat-a/repository/mine.txt && echo LEAK-workspace; test -e /data/orbit/accounts/${lab.orbitA} && echo LEAK-store; true`);
    assert.deepEqual(r.out.split("\n"), ["own-login"]);
  });

  test("removed with its network, read back; what is left after a restart is swept", async () => {
    const names = sessionNames(lab.prefix, "session:run-a");
    assert.equal((await lab.allocator.removeSession("session:run-a")).gone, true);
    assert.equal(await lab.engine.containerInspect(names.container), null);
    assert.equal(await lab.engine.networkInspect(names.network), null);
    assert.equal((await lab.allocator.removeSession("session:run-a")).gone, true, "removing it again answers gone");
    const swept = await lab.allocator.sweepSessions();
    assert.equal(swept.removed, 2, "the Plan run's and the research run's");
    for (const key of ["session:run-ro", "session:run-r"]) assert.equal(await lab.engine.containerInspect(sessionNames(lab.prefix, key).container), null);
  });
});
