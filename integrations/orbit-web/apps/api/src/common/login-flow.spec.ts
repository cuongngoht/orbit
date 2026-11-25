import assert from "node:assert/strict";
import { test } from "node:test";
import type { LoginSnapshot } from "@orbit-web/contracts";
import { FakeChild, FakeProcessPort } from "../testing/fake-process.js";
import { LoginFlow, lastWords, type LoginDriver, type LoginFields } from "./login-flow.js";
import { readGhLogin } from "../modules/github/github-auth.service.js";

// A CLI whose sign-in asks for a code pasted back (what LoginFlow supports for any driver that says needsCode).
const readCodeLogin = (output: string): LoginFields => ({ url: [...output.matchAll(/visit:\s*(https:\/\/\S+)/g)].at(-1)?.[1] ?? null, needsCode: /paste code here/i.test(output) });

const until = async (flow: LoginFlow, state: LoginSnapshot["state"]): Promise<LoginSnapshot> => {
  for (let i = 0; i < 200; i += 1) {
    if (flow.current().state === state) return flow.current();
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`never reached ${state}: ${JSON.stringify(flow.current())}`);
};

function setup(drive: (c: FakeChild) => void, verify = async () => ({ ok: true, message: "ok" }), timeoutMs = 2_000, read = readGhLogin) {
  const fake = new FakeProcessPort().on(() => true, { spawn: drive });
  const flow = new LoginFlow(fake);
  const driver: LoginDriver = { file: "gh", args: ["auth", "login"], cwd: "/", env: {}, timeoutMs, read, ready: (f) => Boolean(f.url) && (read !== readGhLogin || Boolean(f.code)), verify, failure: lastWords };
  return { fake, flow, driver };
}

test("GitHub's device flow: the code and URL are shown, and only gh's status decides connected", async () => {
  let child: FakeChild | null = null;
  let verified = 0;
  const { flow, driver } = setup((c) => {
    child = c;
    c.stderr("! First copy your one-time code: AB12-CD34\n");
    c.stderr("Open this URL to continue in your web browser: https://github.com/login/device\n");
  }, async () => ({ ok: (verified += 1) > 0, message: "Connected as octo." }));
  const seen: string[] = [];
  flow.subscribe((s) => seen.push(s.state));
  assert.equal(flow.start(driver).state, "starting");
  const waiting = await until(flow, "awaiting_user");
  assert.equal(waiting.code, "AB12-CD34");
  assert.equal(waiting.url, "https://github.com/login/device");
  assert.equal(flow.start(driver).state, "awaiting_user", "a second start returns the flow under way");
  (child as unknown as FakeChild).stderr("✓ Authentication complete.\n");
  (child as unknown as FakeChild).exit(0);
  const done = await until(flow, "connected");
  assert.equal(verified, 1);
  assert.equal(done.code, null, "the one-time code is not kept once the flow ends");
  assert.deepEqual(seen.filter((s, i) => seen.indexOf(s) === i), ["starting", "awaiting_user", "verifying", "connected"]);
});

test("a CLI that exits 0 is still not connected unless its status says so", async () => {
  const { flow, driver } = setup((c) => c.exit(0), async () => ({ ok: false, message: "not signed in" }));
  flow.start(driver);
  assert.equal((await until(flow, "failed")).message, "not signed in");
});

test("a failure quotes the CLI's last words, masked", async () => {
  const { flow, driver } = setup((c) => {
    c.stderr(`failed to authenticate via web browser: HTTP 415 gho_${"t".repeat(36)}\n`);
    c.exit(1);
  });
  flow.start(driver);
  const failed = await until(flow, "failed");
  assert.match(failed.message ?? "", /HTTP 415/);
  assert.doesNotMatch(failed.message ?? "", /gho_/);
});

test("cancel stops the process group and says cancelled", async () => {
  let child: FakeChild | null = null;
  const { flow, driver } = setup((c) => {
    child = c;
    c.onSignal(() => c.exit(null, "SIGTERM"));
  });
  flow.start(driver);
  await new Promise((r) => setTimeout(r, 10));
  flow.cancel();
  await until(flow, "cancelled");
  assert.deepEqual((child as unknown as FakeChild).signals.slice(0, 1), ["SIGTERM"]);
});

test("a sign-in nobody finishes times out", async () => {
  const { flow, driver } = setup((c) => c.onSignal(() => c.exit(null, "SIGTERM")), undefined, 50);
  flow.start(driver);
  assert.match((await until(flow, "timed_out")).message ?? "", /timed out/);
});

test("a flow that asks for a code: the code a person pastes goes to the CLI's stdin, and a second prompt asks again", async () => {
  let child: FakeChild | null = null;
  const { flow, driver } = setup((c) => {
    child = c;
    c.stdout("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?x=1\nPaste code here if prompted > ");
  }, undefined, 2_000, readCodeLogin);
  flow.start(driver);
  const waiting = await until(flow, "awaiting_user");
  assert.equal(waiting.needsCode, true);
  flow.submit("bad#code");
  assert.equal(flow.current().state, "verifying");
  (child as unknown as FakeChild).stdout("\nInvalid code.\nPaste code here if prompted > ");
  await until(flow, "awaiting_user");
  flow.submit("good#code");
  assert.deepEqual((child as unknown as FakeChild).written, ["bad#code\n", "good#code\n"]);
  (child as unknown as FakeChild).exit(0);
  await until(flow, "connected");
});
