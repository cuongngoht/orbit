// A secret is NAMED, never kept: a variable a person listed for a component reaches that component's process at the
// moment it starts, and no document, receipt, lease or view of a sandbox holds its value or a path of this machine's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepared, sandboxWorld, TASK } from "./sandbox.harness.mjs";

const SECRET = "s3cr3t-value-9d41";

function listed(w) {
  const settings = w.ctx.readSettings();
  w.ctx.writeSettings({ next: { ...settings.settings, components: { "node:web": { env: ["SECRET_TOKEN"] } } }, revision: settings.revision, by: "person" });
}

test("a listed variable reaches only the component it was listed for, as its own environment -- and is in no argument", async () => {
  const w = sandboxWorld(undefined, { env: { PATH: "/usr/bin", SECRET_TOKEN: SECRET, OTHER_TOKEN: "unlisted-9d41" } });
  listed(w);
  await prepared(w);
  await w.run("sandbox-start", TASK, ["--wait=0"]);
  const web = w.process.launches.find((l) => l.file === "npm");
  const api = w.process.launches.find((l) => l.file === "dotnet");
  assert.equal(web.opts.env.SECRET_TOKEN, SECRET);
  assert.ok(!("SECRET_TOKEN" in api.opts.env) && !("OTHER_TOKEN" in web.opts.env), "nobody else's, and nothing nobody named");
  assert.ok(![...w.process.launches, ...w.process.calls].some((c) => c.args.some((a) => String(a).includes(SECRET))), "never on a command line");
});

test("no document a sandbox keeps -- the sandbox, its sessions, its operations, its leases, the settings -- holds the value or a path of this machine", async () => {
  const w = sandboxWorld(undefined, { env: { PATH: "/usr/bin", SECRET_TOKEN: SECRET } });
  listed(w);
  await prepared(w);
  await w.run("sandbox-start", TASK, ["--wait=0"]);
  const workspace = w.workspaces.tasks.get(TASK).path;
  const kept = [...w.io.files.entries()].filter(([path]) => !/\.(out|err|log)$/.test(path));
  assert.ok(kept.length > 5, "there is something to look at");
  for (const [path, text] of kept) {
    assert.ok(!String(text).includes(SECRET), `${path} holds the secret`);
    assert.ok(!String(text).includes(workspace), `${path} holds the workspace's path`);
  }
});

test("what a person or a page is shown of a sandbox holds neither: not the value, not a workspace, not a store path, not where a log is", async () => {
  const w = sandboxWorld(undefined, { env: { PATH: "/usr/bin", SECRET_TOKEN: SECRET } });
  listed(w);
  await prepared(w);
  await w.run("sandbox-start", TASK, ["--wait=0"]);
  const shown = JSON.stringify([await w.run("sandbox"), await w.run("sandboxes"), await w.run("sandbox-start", TASK, ["--wait=0"])]);
  assert.ok(!shown.includes(SECRET));
  assert.ok(!shown.includes(w.workspaces.tasks.get(TASK).path), "the workspace owner resolves a path live; no view carries it");
  assert.ok(!/\/store\//.test(shown) && !/\.out"|\.err"/.test(shown), "no store path, no log location");
});

test("a log is read through one bounded, scrubbed door, and the places it ran are said as places", async () => {
  const w = sandboxWorld(undefined, { env: { PATH: "/usr/bin" } });
  await prepared(w);
  const started = await w.run("sandbox-start", TASK, ["--wait=0"]);
  const session = started.started[0].session;
  const path = w.sandbox().sessions.logs(session).out;
  w.io.write(path, `listening in ${w.workspaces.tasks.get(TASK).path}/web\nTOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789ab\n${"x\n".repeat(500)}`);
  const logs = await w.run("sandbox-logs", TASK, [`--session=${session}`, "--tail=50"]);
  assert.equal(logs.lines.length <= 50, true);
  assert.equal(logs.truncated, true);
  assert.ok(!logs.lines.join("\n").includes("ghp_abc"));
  w.io.write(path, `listening in ${w.workspaces.tasks.get(TASK).path}/web\n`);
  assert.match((await w.run("sandbox-logs", TASK, [`--session=${session}`])).lines.join("\n"), /listening in <workspace>\/web/);
  await assert.rejects(async () => w.run("sandbox-logs", TASK, ["--session=rs-ffffffffffff"]), (e) => e.code === "SESSION_UNKNOWN");
});
