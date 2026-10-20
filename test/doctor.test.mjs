import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createTools } from "../src/tools/index.mjs";
import { doctorFindings } from "../src/query/doctor.mjs";
import { fakeTools } from "./fakes/tools.mjs";

// Installing the plugin installs the ENGINE. The browser driver and the database
// client are somebody else's software, and when one is absent the first case to
// run fails somewhere that reads like a product defect.
test("only the tools the project DECLARED are required", () => {
  const asked = (config) => doctorFindings({ config, tools: fakeTools({ "playwright-cli": { ok: true, said: "0.1.20" } }) });

  const bare = asked({ sql: { command: null }, launcher: null });
  assert.deepEqual(bare.map((r) => r.what), ["playwright-cli"], "the browser driver is the only unconditional one");
  assert.ok(bare.every((r) => r.ok));

  const withSql = asked({ sql: { command: ["sqlcmd", "-x"] }, launcher: null });
  assert.deepEqual(withSql.map((r) => r.what), ["playwright-cli", "sqlcmd"], "declaring sql.command makes its binary required");
  assert.equal(withSql[1].ok, false);
  assert.match(withSql[1].detail, /not found on PATH/);
  assert.match(withSql[1].fix, /sql.command runs/);
});

// The engine cannot install anything, so its whole job here is to say WHICH
// thing is wrong in a way somebody can act on.
test("a launcher the project names but does not ship is named as missing", () => {
  const rows = doctorFindings({ config: { sql: { command: null }, launcher: "/nope/launch.mjs" }, tools: fakeTools({ "playwright-cli": { ok: true } }) });
  const launcher = rows.find((r) => r.what === "launcher");
  assert.equal(launcher.ok, false);
  assert.match(launcher.fix, /project.json launcher names/);
});

// "not installed" and "installed but unusable here" are different things to tell
// somebody, and telling the second as the first sends people to reinstall
// software they already have. An ordinary npm shim is unwrapped and just works
// (process/shim.mjs); this is the case where even that could not resolve it.
test("a .cmd shim on PATH is diagnosed as unusable, not as missing", () => {
  // A real shim on a real PATH: the file is there, and Node still says ENOENT.
  const dir = mkdtempSync(join(tmpdir(), "orbit-shim-"));
  writeFileSync(join(dir, "driver.cmd"), "@echo off");
  const shimmed = createTools(() => ({ error: { code: "ENOENT" } }), { PATH: dir });
  const real = shimmed.present("driver");
  assert.equal(real.ok, false);
  assert.match(real.why, /installed at .*driver.cmd, but not runnable from here/);
  assert.match(real.fix, /the entry point it forwards to could not be resolved/);

  const absent = createTools(() => ({ error: { code: "ENOENT" } }), { PATH: "" }).present("nothing-here");
  assert.equal(absent.ok, false);
  assert.equal(absent.why, "not found on PATH");
  assert.equal(absent.fix, undefined, "no advice to give about software that is simply not there");
});

// A tool that answers --version with an error is still installed, which is all
// the probe asks -- and the probe must never be the thing that fails a doctor.
test("the probe asks whether the process can start, not whether it is happy", () => {
  const grumpy = createTools(() => ({ status: 1, stdout: "", stderr: "unknown flag --version" }), {});
  assert.equal(grumpy.present("grumpy").ok, true);

  const chatty = createTools(() => ({ status: 0, stdout: "v1.2.3\nmore" }), {});
  assert.deepEqual(chatty.present("chatty"), { ok: true, said: "v1.2.3" });
});

// A tool with a package name can be installed for you; one without is somebody
// else's software, and the only honest thing to offer is the reason and the fix.
// cli/setup.mjs splits the two on exactly this field.
test("a requirement that can be installed carries its package name", () => {
  const rows = doctorFindings({ config: { sql: { command: ["sqlcmd"] }, launcher: null }, tools: fakeTools() });
  const [driver, client] = rows;
  assert.equal(driver.install, "@playwright/cli", "the engine's own adapter is installable");
  assert.equal(client.install, undefined, "a client the PROJECT named is not the engine's to install");
  assert.match(driver.fix, /setup.mjs --install/);
});

// Installing is the one thing the port does that changes the machine, so what it
// reports when it cannot has to be actionable rather than an exit code.
test("install reports why it failed, and never pretends", () => {
  const enoent = createTools(() => ({ error: { code: "ENOENT" } }), {});
  assert.deepEqual(enoent.install("@playwright/cli"), { ok: false, why: "npm is not on PATH — install Node.js, which ships it" });

  const refused = createTools(() => ({ status: 1 }), {});
  assert.match(refused.install("@playwright/cli").why, /npm i -g @playwright\/cli exited 1/);

  let ran = null;
  const fine = createTools((bin, args) => { ran = [bin, ...args]; return { status: 0 }; }, {});
  assert.deepEqual(fine.install("@playwright/cli"), { ok: true });
  assert.deepEqual(ran, ["npm", "i", "-g", "@playwright/cli"], "the verified recipe, not a guessed one");
});
