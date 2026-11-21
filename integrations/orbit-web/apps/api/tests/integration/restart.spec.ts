// A restart of Orbit Web (the container restarting) keeps history, workspaces and the Claude conversation, and
// reports a run it cut short as interrupted -- never as still running, never as completed, never started again.
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { SessionDetail, SessionSummary } from "@orbit-web/contracts";
import { Db } from "../../src/infra/db/db.js";
import { FakeProcessPort, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { claudeRun, eventually, REPOSITORY, signedIn, startHarness } from "../../src/testing/harness.js";

const sessionIdIn = (args: string[]) => args[args.indexOf(args.includes("--resume") ? "--resume" : "--session-id") + 1];

function hangingRun(c: FakeChild, call: Call): void {
  c.onInputClosed(() => c.line({ type: "system", subtype: "init", session_id: sessionIdIn(call.args), claude_code_version: "2.1.328", plugins: [{ name: "orbit" }] }));
  c.onSignal(() => c.exit(null, "SIGTERM"));
}

test("a graceful restart interrupts the active run, and the next start shows it interrupted with everything kept", async () => {
  const fake = signedIn(new FakeProcessPort(new NodeProcessPort())).on(claudeRun, { spawn: hangingRun });
  const first = await startHarness({ fake });
  const created = (await first.send("POST", "/api/sessions", { repository: { source: "github", id: REPOSITORY }, branch: "main", model: "sonnet", prompt: "Work on it." })).body as SessionSummary;
  await eventually(async () => ((await first.get(`/api/sessions/${created.id}`)).body as SessionDetail).status, (s) => s === "running");
  await eventually(() => fake.children.filter((c) => claudeRun(c.call.file, c.call.args)).length, (n) => n === 1);
  await new Promise((r) => setTimeout(r, 50));
  await first.close(true);

  const second = await startHarness({ dataDir: first.dataDir, database: first.database, fake: signedIn(new FakeProcessPort(new NodeProcessPort())) });
  try {
    const detail = (await second.get(`/api/sessions/${created.id}`)).body as SessionDetail;
    assert.equal(detail.status, "interrupted");
    assert.equal(detail.turns, 1, "the run reached Claude Code's init, so the conversation can be resumed");
    assert.deepEqual(detail.messages.map((m) => [m.role, m.text]), [["user", "Work on it."]]);
    assert.equal(existsSync(join(second.config.data.workspaces, created.id, "repository", "sum.mjs")), true);
    const { events } = await second.events(`/api/sessions/${created.id}/events`, { until: (es) => es.some((e) => e.type === "session.interrupted"), timeoutMs: 3000 });
    const interrupted = events.find((e) => e.type === "session.interrupted")?.data as { reason: string };
    assert.equal(interrupted.reason, "server_restart");
    assert.equal(second.fake.children.filter((c) => claudeRun(c.call.file, c.call.args)).length, 0, "nothing was started again on its own");
  } finally {
    await second.close();
  }
});

// A page holds its app stream open for as long as it is open. A stop must end it: the HTTP server waits for every open
// connection before the shutdown hooks after it run, so with one open the database's pool was never closed (its
// connections held at the server until they timed out) and the container was killed at its grace period.
test("a stop ends the streams a page holds open and closes the database's connections", async () => {
  const first = await startHarness();
  const db = first.app.get(Db);
  const stream = await first.stream("/api/events");
  const stopped = await Promise.race([first.close(true).then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000).unref())]);
  // A stop that waits is ended here, so the assertion below fails instead of the suite hanging.
  if (!stopped) first.app.getHttpServer().closeAllConnections();
  stream.close();
  try {
    assert.equal(stopped, true, "the stop waited for the open stream");
    assert.equal(db.isClosed(), true, "the database's pool was closed");
    await assert.rejects(db.query("SELECT 1"), /closed/, "and nothing more reaches it");
  } finally {
    rmSync(first.dataDir, { recursive: true, force: true });
    await first.database.drop();
  }
});

test("after a crash (the record still says running), the next start marks it interrupted", async () => {
  const first = await startHarness({ fake: signedIn(new FakeProcessPort(new NodeProcessPort())).on(claudeRun, { spawn: (c) => c.onInputClosed(() => c.exit(0)) }) });
  const created = (await first.send("POST", "/api/sessions", { repository: { source: "github", id: REPOSITORY }, branch: "main", model: "haiku" })).body as SessionSummary;
  await eventually(async () => ((await first.get(`/api/sessions/${created.id}`)).body as SessionDetail).status, (s) => s === "ready");
  // What a crash leaves: the records say a run is going on, and no process does (nothing here stops it on the way down).
  await first.sql("UPDATE sessions SET status = 'running' WHERE id = $1", [created.id]);
  await first.sql("INSERT INTO runs (id, account_id, session_id, status, model, resumed, started_at) SELECT 'r-crash', account_id, id, 'running', 'haiku', false, '2026-01-01T00:00:00Z' FROM sessions WHERE id = $1", [created.id]);
  await first.close(true);

  const second = await startHarness({ dataDir: first.dataDir, database: first.database });
  try {
    const detail = (await second.get(`/api/sessions/${created.id}`)).body as SessionDetail;
    assert.equal(detail.status, "interrupted");
    assert.match(detail.statusReason ?? "", /restarted/);
    assert.deepEqual((await second.sql("SELECT status FROM runs WHERE id = 'r-crash'")).map((r) => r.status), ["interrupted"]);
  } finally {
    await second.close();
  }
});
