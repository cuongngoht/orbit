// SETTINGS → SYSTEM'S UPDATES, through the real API: what this image holds against each publisher's newest release --
// asked when a person checks (at most once a minute; a second check answers the first), never on any page's read; a
// feed that fails is that component's "unknown". Signed-in only. (The feed here is a fake: no test asks a real one.)
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { SystemUpdates } from "@orbit-web/contracts";
import { UPDATE_FEED, type FetchJson } from "../../src/modules/health/updates.js";
import { startHarness, type Harness } from "../../src/testing/harness.js";

describe("Settings → System: whether a newer release exists", () => {
  let h: Harness;
  const asked: string[] = [];
  const feed: FetchJson = (url) => {
    asked.push(url);
    if (url.includes("claude-code")) return Promise.resolve({ version: "9.9.9" });
    return Promise.reject(new Error("offline"));
  };

  before(async () => {
    h = await startHarness({ overrides: [[UPDATE_FEED, feed]] });
  });
  after(() => h.close());

  test("before anyone checks, nothing is asked: each component is said as not checked yet", async () => {
    const r = await h.get("/api/system/updates");
    assert.equal(r.status, 200);
    const u = r.body as SystemUpdates;
    assert.equal(u.checkedAt, null);
    assert.ok(u.components.length > 0 && u.components.every((c) => c.state === "not_checked"));
    assert.ok(u.howToUpdate.some((l) => l.includes("update-pins.mjs")));
    assert.deepEqual(asked, []);
  });

  test("a check asks the publishers once: a newer release is an update, a feed that fails is unknown with why", async () => {
    const r = await h.send("POST", "/api/system/updates/check");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const u = r.body as SystemUpdates;
    assert.ok(u.checkedAt !== null);
    const claude = u.components.find((c) => c.component === "claude");
    assert.deepEqual([claude?.latest, claude?.state], ["9.9.9", "update_available"]);
    const codex = u.components.find((c) => c.component === "codex");
    assert.equal(codex?.state, "unknown");
    const n = asked.length;
    const again = (await h.send("POST", "/api/system/updates/check")).body as SystemUpdates;
    assert.equal(again.checkedAt, u.checkedAt, "within a minute, the same answer");
    assert.equal(asked.length, n, "nothing asked again");
    assert.deepEqual(((await h.get("/api/system/updates")).body as SystemUpdates).checkedAt, u.checkedAt);
  });

  test("signed out, nothing is said", async () => {
    assert.equal((await h.anonymous.get("/api/system/updates")).status, 401);
  });
});
