import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBrowser } from "../src/browser/index.mjs";
import { choices, launch } from "../src/awake/launcher.mjs";
import { emailIn, installed, isRunning, processName, profilesIn } from "../skills/orbit-browser/browsers.mjs";
import { cliConfig, copyPlan, parseFlags, targetUrl } from "../skills/orbit-browser/profile.mjs";

const WIN = { LOCALAPPDATA: "C:\U\AppData\Local" };
const chromeData = join(WIN.LOCALAPPDATA, "Google", "Chrome", "User Data");

test("only the browsers whose user data is on this disk are offered", () => {
  const some = installed("win32", WIN, (p) => p === chromeData);
  assert.deepEqual(some.map((b) => b.channel), ["chrome"]);
  assert.equal(some[0].dataDir, chromeData);
  assert.deepEqual(installed("win32", WIN, () => false), [], "nothing installed offers nothing");
  assert.deepEqual(installed("win32", {}, () => true), [], "no LOCALAPPDATA means no guess");
  assert.ok(installed("darwin", { HOME: "/Users/u" }, () => true).length, "macOS has its own layout");
});

// The directory and the display name are different strings on any machine where
// someone renamed a profile: `Profile 1` showing as "Profile 2" is real. The
// picker must carry both, because the launcher needs the directory and the
// human only recognises the name.
test("profiles carry the directory AND the name, and a broken file is not a crash", () => {
  const localState = JSON.stringify({ profile: { info_cache: { "Default": { name: "Work", user_name: "a@b.com" }, "Profile 1": { name: "qs sol" } } } });
  assert.deepEqual(profilesIn(localState), [{ dir: "Default", name: "Work", email: "a@b.com" }, { dir: "Profile 1", name: "qs sol", email: "" }]);
  assert.deepEqual(profilesIn("not json"), [], "an unreadable browser is one we do not offer");
  assert.deepEqual(profilesIn("{}"), []);
});

// A work profile signed in through an identity provider leaves user_name empty;
// the account is then only in that profile's own Preferences.
test("the account falls back to the profile's own Preferences", () => {
  assert.equal(emailIn(JSON.stringify({ account_info: [{ full_name: "x" }, { email: "c@d.com" }] })), "c@d.com");
  assert.equal(emailIn("{}"), "");
  assert.equal(emailIn(""), "");
  const cache = JSON.stringify({ profile: { info_cache: { "Profile 2": { name: "qs sol" } } } });
  assert.equal(profilesIn(cache, () => "c@d.com")[0].email, "c@d.com");
});

// The two details that decide whether the copy opens signed IN. Both are
// invisible until a real product silently shows a login page.
test("the copy renames the profile to Default and brings Local State from the parent", () => {
  const plan = copyPlan("/data", "Profile 2", "/target");
  const to = plan.map((p) => p.to);
  assert.ok(to.every((p) => p === join("/target", "Local State") || p.startsWith(join("/target", "Default"))), "everything lands in Default/ except Local State");
  assert.deepEqual(plan.at(-1), { from: join("/data", "Local State"), to: join("/target", "Local State") }, "the decryption key lives beside the profile, not inside it");
  assert.ok(plan.some((p) => p.from === join("/data", "Profile 2", "Network")), "Cookies has lived in Network/ since Chromium 96");
  assert.ok(!plan.some((p) => /Cache|Service Worker/.test(p.from)), "gigabytes of nothing stay behind");
});

// The engine spawns the launcher with exactly one shape of argv. Nothing else
// states that contract, so it is exercised end to end against the real emitter.
test("the engine's launcher flags and this launcher's parser agree", () => {
  const config = { launch: { channel: "chrome", env: "staging" } };
  let seen = null;
  const spawn = (_bin, argv) => ((seen = argv), { stdout: "run directory : /r\ntarget : https://x" });
  launch("open.mjs", choices({ ORBIT_MODE: "headed" }, config), "work", "/run/dir", spawn);
  assert.deepEqual(parseFlags(seen.slice(1)), { channel: "chrome", env: "staging", profile: "work", runDir: "/run/dir", mode: "headed" });
});

test("headless is the default, and a run directory is optional", () => {
  let seen = null;
  const spawn = (_bin, argv) => ((seen = argv), { stdout: "" });
  launch("open.mjs", choices({}, { launch: { channel: "msedge", env: "test" } }), "admin", null, spawn);
  assert.equal(parseFlags(seen.slice(1)).mode, "headless");
  assert.equal(parseFlags(seen.slice(1)).runDir, undefined);
});

// The url is a per-project value; this repository knows only the shape of the
// variable that holds it.
test("the url comes from the environment, per deployment, then the origin", () => {
  assert.equal(targetUrl({ ORBIT_BROWSER_URL_TEST: "https://t", ORBIT_ORIGIN: "https://o" }, "test"), "https://t");
  assert.equal(targetUrl({ ORBIT_ORIGIN: "https://o" }, "test"), "https://o");
  assert.equal(targetUrl({ ORBIT_BROWSER_URL_PRE_PROD: "https://p" }, "pre-prod"), "https://p", "a dash is a separator like any other");
  assert.equal(targetUrl({}, "test"), null);
});

// The launcher writes this file and the engine reads it back to say which
// profile a session drives; if the two disagree the run reports the wrong user.
test("what the launcher writes is what the engine reads back as the profile", () => {
  const runDir = mkdtempSync(join(tmpdir(), "pw-test-"));
  const userDataDir = join(tmpdir(), "playwright-profiles", "work");
  mkdirSync(join(runDir, ".playwright"), { recursive: true });
  writeFileSync(join(runDir, ".playwright", "cli.config.json"), JSON.stringify(cliConfig("chrome", userDataDir, "headed")));
  assert.equal(createBrowser(runDir, { exec: () => "" }).profile(), "work");
});

test("the config carries the channel and turns --headed into headless:false", () => {
  assert.equal(cliConfig("msedge", "/x", "headed").browser.launchOptions.headless, false);
  assert.equal(cliConfig("msedge", "/x", "headless").browser.launchOptions.headless, true);
  assert.equal(cliConfig("msedge", "/x", "headed").browser.browserName, "chromium", "every channel here is a chromium");
  assert.equal(cliConfig("msedge", "/x", "headed").browser.launchOptions.channel, "msedge");
});

// Copying a profile whose browser is open captures a cookie database mid-write.
test("a running browser is recognised from the platform's process list", () => {
  assert.equal(processName("chrome", "win32"), "chrome.exe");
  assert.equal(processName("msedge", "darwin"), "Microsoft Edge");
  assert.equal(processName("nope", "win32"), null);
  assert.ok(isRunning("Image Name\nmsedge.exe   2268 Console", "msedge.exe"));
  assert.ok(!isRunning("chrome.exe   1 Console", "msedge.exe"));
  assert.ok(!isRunning("anything", null), "an unknown channel is never reported as running");
});

test("isolated sessions use distinct names and never retry against the default browser", async () => {
  const { createSession, sessionName } = await import('../src/browser/session.mjs');
  const seen = [];
  const exec = (_file, args) => { seen.push(args); throw Object.assign(new Error('missing'), { stdout: 'is not open' }); };
  const a = createSession('/runtime/a', exec, 1000, { file: 'browser', prefix: [] }, { isolate: true });
  const b = createSession('/runtime/b', exec, 1000, { file: 'browser', prefix: [] }, { isolate: true });
  assert.notEqual(a.session(), b.session());
  assert.equal(a.session(), sessionName('/runtime/a'));
  assert.match(a.cli(['console'], true), /ERROR/);
  assert.equal(seen.length, 1, 'no fallback to a different browser');
  a.use('/runtime/c', 'admin');
  assert.equal(a.session(), sessionName('/runtime/c'));
});

test("--blank opens a browser with no profile at all: its own url and its own run directory, and the parser says so", () => {
  assert.deepEqual(parseFlags(["--blank", "--url", "http://127.0.0.1:42000", "--run-dir", "/run/sandbox/env-x", "--headed"]), { url: "http://127.0.0.1:42000", runDir: "/run/sandbox/env-x", mode: "headed", blank: true });
  assert.equal(parseFlags(["--profile", "work"]).blank, undefined, "an ordinary launch is as it was");
});
