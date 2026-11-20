import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDelta, DURABLE_EVENT_TYPES, EVENT_CATALOG, isDurableType, isEventType, streamOf } from "./events/index.js";
import { EFFORT_CHOICES, MODEL_CHOICES, MODE_PERMISSION } from "./models.js";
import {
  checkClaudeLogin,
  checkCreateSession,
  isRepositoryRef,
  splitAzureId,
  checkLoginCode,
  checkSendMessage,
  checkUpdateSession,
  checkUpdateSettings,
  isBranchName,
  splitFullName,
} from "./validate.js";

test("a repository is owner/name and nothing that could be a path or an option", () => {
  assert.deepEqual(splitFullName("cuongngoht/orbit"), { owner: "cuongngoht", name: "orbit" });
  assert.deepEqual(splitFullName("a-b/c.d_e"), { owner: "a-b", name: "c.d_e" });
  for (const bad of ["orbit", "a/b/c", "../x", "a/..", "-a/b", "a/ b", "a/b;rm", "", 7, null]) assert.equal(splitFullName(bad), null, String(bad));
});

test("a branch name follows git's rules and never starts like an option", () => {
  for (const ok of ["main", "feature/x-1", "release-0.7.0", "v1.2"]) assert.equal(isBranchName(ok), true, ok);
  for (const bad of ["", "-rf", "a..b", "a b", "a~1", "a^", "a:b", "x.lock", "x/", "/x", "@", "a@{1}", ".hidden", "a//b", "a\u0000"]) assert.equal(isBranchName(bad), false, bad);
});

const AZURE_REPO = "Fabrikam/278d5cd2-584d-4b63-824a-2ba458937249";

test("a new chat has a model, and a repository of either source -- or none -- and refuses fields it does not know", () => {
  const github = checkCreateSession({ repository: { source: "github", id: "o/r" }, branch: "main", model: "sonnet", effort: "xhigh", mode: "plan", title: "  Fix it  ", prompt: "hello" });
  assert.deepEqual(github, { ok: true, value: { repository: { source: "github", id: "o/r" }, branch: "main", model: "sonnet", effort: "xhigh", mode: "plan", title: "Fix it", prompt: "hello" } });
  const azure = checkCreateSession({ repository: { source: "azure", id: AZURE_REPO }, model: "fable" });
  assert.deepEqual(azure, { ok: true, value: { repository: { source: "azure", id: AZURE_REPO }, branch: null, model: "fable" } });
  assert.deepEqual(checkCreateSession({ model: "opus", prompt: "no repository" }), { ok: true, value: { repository: null, branch: null, model: "opus", prompt: "no repository" } });
  assert.deepEqual(checkCreateSession({ repository: null, branch: null, model: "haiku" }), { ok: true, value: { repository: null, branch: null, model: "haiku" } });
  const bad = checkCreateSession({ repository: { source: "github", id: "o" }, branch: "-x", model: "gpt", effort: "huge", mode: "dontAsk", extra: 1 });
  assert.equal(bad.ok, false);
  assert.equal(bad.ok ? 0 : bad.errors.length, 6);
  assert.equal(checkCreateSession({ branch: "main", model: "sonnet" }).ok, false, "a branch needs a repository");
  assert.equal(checkCreateSession({ repository: "o/r", model: "sonnet" }).ok, false, "a bare string is not a repository reference");
  assert.equal(checkCreateSession([]).ok, false);
});

test("a repository reference is a known source and an id of that source's shape", () => {
  assert.equal(isRepositoryRef({ source: "github", id: "cuongngoht/orbit" }), true);
  assert.equal(isRepositoryRef({ source: "azure", id: AZURE_REPO }), true);
  for (const bad of [{ source: "gitlab", id: "o/r" }, { source: "azure", id: "o/r" }, { source: "github", id: "o/r/x" }, { source: "github", id: "o/r", url: "x" }, { source: "azure", id: "-org/278d5cd2-584d-4b63-824a-2ba458937249" }, null, "o/r"])
    assert.equal(isRepositoryRef(bad), false, JSON.stringify(bad));
  assert.deepEqual(splitAzureId("Fabrikam/278D5CD2-584D-4B63-824A-2BA458937249"), { organization: "Fabrikam", repositoryId: "278d5cd2-584d-4b63-824a-2ba458937249" });
  assert.equal(splitAzureId("Fabrikam/project/repo"), null);
});

test("a message is non-empty text of a bounded length", () => {
  assert.equal(checkSendMessage({ text: "go" }).ok, true);
  assert.equal(checkSendMessage({ text: "   " }).ok, false);
  assert.equal(checkSendMessage({ text: "x".repeat(100_001) }).ok, false);
  assert.equal(checkSendMessage({ text: "go", command: "rm" }).ok, false);
});

test("an update names something to change: the title, or the model, effort or mode of the next message", () => {
  assert.equal(checkUpdateSession({}).ok, false);
  assert.deepEqual(checkUpdateSession({ model: "opus" }), { ok: true, value: { model: "opus" } });
  assert.deepEqual(checkUpdateSession({ effort: "max", mode: "autonomous" }), { ok: true, value: { effort: "max", mode: "autonomous" } });
  assert.equal(checkUpdateSession({ mode: "bypassPermissions" }).ok, false);
  assert.equal(checkUpdateSettings({ webTools: "yes" }).ok, false);
  assert.equal(checkUpdateSettings({ projectPlugins: 1 }).ok, false);
  assert.equal(checkUpdateSettings({ githubForClaude: "on" }).ok, false);
  assert.deepEqual(checkUpdateSettings({ githubForClaude: true }), { ok: true, value: { githubForClaude: true } });
  assert.deepEqual(checkUpdateSettings({ theme: "dark" }), { ok: true, value: { theme: "dark" } });
  assert.deepEqual(checkUpdateSettings({ defaultEffort: "low", defaultMode: "plan", projectPlugins: false }), { ok: true, value: { defaultEffort: "low", defaultMode: "plan", projectPlugins: false } });
});

test("the models, efforts and modes are the CLI's own words", () => {
  assert.deepEqual([...MODEL_CHOICES], ["opus", "fable", "sonnet", "haiku"]);
  assert.deepEqual([...EFFORT_CHOICES], ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(MODE_PERMISSION, { autonomous: "auto", plan: "plan" });
});

test("the event catalog is the one list of what exists, which stream it travels on, and whether it is kept", () => {
  for (const [type, spec] of Object.entries(EVENT_CATALOG)) {
    assert.equal(isEventType(type), true, type);
    assert.ok(spec.summary.length > 0, type);
    if (spec.stream === "app") assert.equal(spec.durable, false, `${type}: the app stream is notifications`);
  }
  assert.equal(isDurableType("message.delta"), false);
  assert.equal(isDurableType("session.summary"), false);
  assert.equal(isDurableType("tool.started"), true);
  assert.equal(isEventType("constructor"), false);
  assert.equal(streamOf("connector.flow"), "app");
  assert.equal(DURABLE_EVENT_TYPES.every((t) => streamOf(t) === "session"), true);
});

test("a sign-in code is printable and has no whitespace", () => {
  assert.deepEqual(checkLoginCode({ code: " abc#DEF-123 " }), { ok: true, value: { code: "abc#DEF-123" } });
  assert.equal(checkLoginCode({ code: "a b" }).ok, false);
  assert.equal(checkLoginCode({ code: "" }).ok, false);
});

test("a delta never doubles text a client already holds, and a gap waits", () => {
  assert.equal(applyDelta("", { messageId: "m", offset: 0, text: "Hel" }), "Hel");
  assert.equal(applyDelta("Hel", { messageId: "m", offset: 3, text: "lo" }), "Hello");
  assert.equal(applyDelta("Hello", { messageId: "m", offset: 0, text: "Hello, world" }), "Hello, world");
  assert.equal(applyDelta("Hello", { messageId: "m", offset: 2, text: "llo" }), "Hello");
  assert.equal(applyDelta("He", { messageId: "m", offset: 5, text: "!" }), "He");
});

test("an Azure tenant is a GUID or a domain, never an option", async () => {
  const { checkAzureLogin } = await import("./validate.js");
  assert.deepEqual(checkAzureLogin(undefined), { ok: true, value: {} });
  assert.deepEqual(checkAzureLogin({ tenant: " contoso.onmicrosoft.com " }), { ok: true, value: { tenant: "contoso.onmicrosoft.com" } });
  assert.deepEqual(checkAzureLogin({ tenant: "72f988bf-86f1-41af-91ab-2d7cd011db47" }), { ok: true, value: { tenant: "72f988bf-86f1-41af-91ab-2d7cd011db47" } });
  assert.deepEqual(checkAzureLogin({ tenant: "" }), { ok: true, value: {} });
  for (const bad of ["--allow-no-subscriptions", "a b.com", "x", "contoso", { a: 1 }]) assert.equal(checkAzureLogin({ tenant: bad }).ok, false, String(bad));
  assert.equal(checkAzureLogin({ tenant: "contoso.com", extra: 1 }).ok, false);
});

test("the Claude sign-in takes no mode: a Claude account is the only sign-in", () => {
  assert.deepEqual(checkClaudeLogin(undefined), { ok: true, value: null });
  assert.deepEqual(checkClaudeLogin(null), { ok: true, value: null });
  assert.deepEqual(checkClaudeLogin({}), { ok: true, value: null });
  assert.equal(checkClaudeLogin({ mode: "console" }).ok, false);
  assert.equal(checkClaudeLogin({ mode: "claudeai" }).ok, false);
  assert.equal(checkClaudeLogin("claudeai").ok, false);
});
