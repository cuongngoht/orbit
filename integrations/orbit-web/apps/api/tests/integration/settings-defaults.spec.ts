// A NEW CHAT'S DEFAULTS NAME THEIR AI, through the real API: Settings → Code keeps the AI a new chat starts on (Claude
// Code or OpenAI Codex) and a model, effort and mode of THAT AI's own -- held to its connection's catalog, never to
// another AI's -- and an AI the account has not signed in is refused, saying where to sign it in.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ModelCatalog, Settings } from "@orbit-web/contracts";
import { fakeCodexControl } from "../../src/testing/fake-codex.js";
import { startHarness, type Harness } from "../../src/testing/harness.js";

const settingsOf = async (h: Harness): Promise<Settings> => (await h.send("GET", "/api/settings")).body as Settings;

describe("a new chat's defaults, on an account with Claude Code and OpenAI Codex", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness();
    fakeCodexControl(h.fake);
    const made = await h.send("POST", "/api/connections", { runtime: "codex", method: "api_key", apiKey: "sk-proj-test-key-0123456789abcdefghijABCDE" });
    assert.equal(made.status, 201, JSON.stringify(made.body));
  });
  after(() => h.close());

  test("a new chat starts on Claude Code until a person chooses another AI", async () => {
    assert.equal((await settingsOf(h)).defaultRuntime, "claude");
  });

  test("choosing OpenAI Codex moves the default model to one of Codex's own: the one it recommends", async () => {
    const saved = await h.send("PATCH", "/api/settings", { defaultRuntime: "codex" });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual([(saved.body as Settings).defaultRuntime, (saved.body as Settings).defaultModel], ["codex", "gpt-6.1-sol"]);
    assert.deepEqual(await settingsOf(h), saved.body, "kept");
  });

  test("a model is held to the default AI's own catalog: Codex's is taken, Claude's is refused", async () => {
    const taken = await h.send("PATCH", "/api/settings", { defaultModel: "gpt-5.5", defaultEffort: "low" });
    assert.equal(taken.status, 200, JSON.stringify(taken.body));
    assert.deepEqual([(taken.body as Settings).defaultModel, (taken.body as Settings).defaultEffort], ["gpt-5.5", "low"]);
    const refused = await h.send("PATCH", "/api/settings", { defaultModel: "opus" });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.equal((await settingsOf(h)).defaultModel, "gpt-5.5", "nothing changed");
  });

  test("an AI and its model may be named together; back on Claude Code, the model is Claude's again", async () => {
    const both = await h.send("PATCH", "/api/settings", { defaultRuntime: "claude", defaultModel: "opus" });
    assert.equal(both.status, 200, JSON.stringify(both.body));
    assert.deepEqual([(both.body as Settings).defaultRuntime, (both.body as Settings).defaultModel], ["claude", "opus"]);
    assert.equal(((await h.send("PATCH", "/api/settings", { defaultRuntime: "codex" })).body as Settings).defaultModel, "gpt-6.1-sol");
    const back = (await h.send("PATCH", "/api/settings", { defaultRuntime: "claude" })).body as Settings;
    const claude = (await h.send("GET", "/api/claude/models")).body as ModelCatalog;
    assert.deepEqual([back.defaultRuntime, back.defaultModel], ["claude", claude.recommended]);
  });
});

describe("a new chat's defaults, on an account that has not signed OpenAI Codex in", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness();
    fakeCodexControl(h.fake);
  });
  after(() => h.close());

  test("OpenAI Codex cannot be the default AI yet: the answer says to sign it in first, and nothing changes", async () => {
    const refused = await h.send("PATCH", "/api/settings", { defaultRuntime: "codex" });
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.match((refused.body as { error: { message: string } }).error.message, /OpenAI Codex is not signed in.*Settings → AI Connections/);
    assert.equal((await settingsOf(h)).defaultRuntime, "claude");
  });
});
