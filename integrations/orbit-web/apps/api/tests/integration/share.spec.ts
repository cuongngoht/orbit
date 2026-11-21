// SHARING A CHAT: a read-only link to a snapshot of its conversation. Anyone with the link reads it -- without the access
// token or a Claude sign-in -- and nothing else: the API stays closed around it (the access token alone opens nothing
// either: a browser must finish its own Claude sign-in). Tools are said by their title unless
// the owner shares what they did; everything is masked by token shape; the copy moves only when its owner updates it,
// and stopping sharing ends the link at once.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { SIGN_IN_REQUIRED, SHARE_TOKEN, type SessionDetail, type SessionSummary, type SharedChat, type ShareInfo, type ShareState } from "@orbit-web/contracts";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { FakeProcessPort, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { browserAt, claudeRun, eventually, signedIn, signInBrowser, startHarness, TEST_PASSWORD, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";

const ACCESS = "a-long-and-random-access-token";
const SECRET = `ghp_${"A".repeat(36)}`;
const after1 = (args: string[], flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null);
const errorCode = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

// In token mode a browser trades the access token for its cookie first, then signs in with Claude.
async function tokenBrowser(h: Harness, token: string): Promise<Browser> {
  const jar: Record<string, string> = {};
  assert.equal((await browserAt(h.url, jar).send("POST", "/api/access", { token })).status, 204);
  return signInBrowser(h.url, "octo", TEST_PASSWORD, jar);
}

// Claude says something, runs a command whose output holds a token, and ends.
function run(c: FakeChild, call: Call): void {
  c.onInputClosed(() => {
    c.line({ type: "system", subtype: "init", cwd: call.cwd, session_id: after1(call.args, "--session-id") ?? after1(call.args, "--resume"), claude_code_version: "2.1.328", plugins: [{ name: "orbit" }] });
    c.line({ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "Checking the configuration." }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "cat config.env", description: "Read the configuration" } }] }, parent_tool_use_id: null });
    c.line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: `TOKEN=${SECRET}\nREGION=eu` }] }, parent_tool_use_id: null });
    c.line({ type: "assistant", message: { id: "msg_2", content: [{ type: "text", text: "The region is eu." }] }, parent_tool_use_id: null });
    c.line({ type: "result", subtype: "success", is_error: false, result: "The region is eu.", total_cost_usd: 0.01, num_turns: 1, duration_ms: 10, permission_denials: [] });
    c.exit(0);
  });
}

describe("sharing a chat", () => {
  let h: Harness;
  // The owner's browser: the access token's cookie, then its Claude sign-in.
  let owner: Browser;
  let session: SessionSummary;
  const auth = { authorization: `Bearer ${ACCESS}` };
  const share = (body?: unknown) => owner.send("POST", `/api/sessions/${session.id}/share`, body);
  const shared = (token: string, headers: Record<string, string> = {}) => h.anonymous.get(`/api/shared/${token}`, headers);
  const settled = () => eventually(async () => ((await owner.get(`/api/sessions/${session.id}`)).body as SessionDetail).status, (s) => s === "completed");

  before(async () => {
    const fake = signedIn(new FakeProcessPort(new NodeProcessPort())).on(claudeRun, { spawn: run });
    h = await startHarness({ fake, env: { ORBIT_WEB_ALLOWED_HOSTS: "orbit.internal", ORBIT_WEB_ACCESS_TOKEN: ACCESS } });
    owner = await tokenBrowser(h, ACCESS);
    session = (await owner.send("POST", "/api/sessions", { model: "sonnet", prompt: `What region? My key is ${SECRET}` })).body as SessionSummary;
    await settled();
  });
  after(() => h.close());

  test("a chat is not shared until its owner shares it", async () => {
    assert.deepEqual((await owner.get(`/api/sessions/${session.id}/share`)).body as ShareState, { share: null });
    assert.equal((await h.anonymous.get(`/api/sessions/${session.id}/share`)).status, 401, "managing it needs the access token");
    const tokenOnly = await h.anonymous.get(`/api/sessions/${session.id}/share`, auth);
    assert.equal(tokenOnly.status, 401, "and a browser's own Claude sign-in: the access token alone is nobody");
    assert.equal(errorCode(tokenOnly), SIGN_IN_REQUIRED);
  });

  test("the link reads a snapshot of the conversation without the access token, the tools by their title only, every secret masked", async () => {
    const r = await share({});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const info = r.body as ShareInfo;
    assert.match(info.token, SHARE_TOKEN);
    assert.equal(info.includeTools, false);
    const page = await shared(info.token);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.match(page.headers.get("x-robots-tag") ?? "", /noindex/);
    const chat = page.body as SharedChat;
    assert.equal(chat.title, session.title);
    assert.deepEqual([...new Set(chat.events.map((e) => e.type))].sort(), ["message.completed", "tool.completed", "tool.started"]);
    const texts = chat.events.flatMap((e) => (e.type === "message.completed" ? [e.data.text] : []));
    assert.ok(texts.includes("The region is eu."));
    assert.ok(texts.some((t) => t.startsWith("What region?")));
    const tool = chat.events.find((e) => e.type === "tool.started");
    assert.equal(tool?.type === "tool.started" && tool.data.title, "$ cat config.env");
    assert.equal(tool?.type === "tool.started" && tool.data.input, "");
    assert.equal(chat.events.find((e) => e.type === "tool.completed")?.data && (chat.events.find((e) => e.type === "tool.completed")?.data as { output: string }).output, "");
    const text = JSON.stringify(chat);
    assert.equal(text.includes(SECRET), false, "masked by token shape");
    assert.equal(text.includes("ghp_"), false, "nor any piece of it -- the title included, whose first line was cut");
    assert.equal(text.includes(session.id), false, "no id of the chat reaches the page");
    assert.equal(info.entries, chat.events.length);
  });

  test("the same link moves only when its owner updates it -- with what the tools did, if they choose, still masked", async () => {
    const before = (await owner.get(`/api/sessions/${session.id}/share`)).body as ShareState;
    assert.equal((await owner.send("POST", `/api/sessions/${session.id}/messages`, { text: "And the zone?" })).status, 202);
    await settled();
    const old = (await shared(before.share?.token as string)).body as SharedChat;
    assert.equal(old.events.some((e) => e.type === "message.completed" && e.data.text === "And the zone?"), false, "a snapshot, not the live chat");
    const updated = (await share({ includeTools: true })).body as ShareInfo;
    assert.equal(updated.token, before.share?.token, "one link per chat");
    const chat = (await shared(updated.token)).body as SharedChat;
    assert.ok(chat.events.some((e) => e.type === "message.completed" && e.data.text === "And the zone?"));
    const output = chat.events.find((e) => e.type === "tool.completed")?.data as { output: string };
    assert.match(output.output, /REGION=eu/);
    assert.equal(JSON.stringify(chat).includes(SECRET), false);
  });

  test("the rest of the API stays closed to whoever holds a link; a token that names no share is not found", async () => {
    const token = ((await owner.get(`/api/sessions/${session.id}/share`)).body as ShareState).share?.token as string;
    assert.equal((await h.anonymous.get(`/api/sessions/${session.id}`)).status, 401);
    assert.equal((await h.anonymous.get(`/api/shared/${token}`.replace("/shared/", "/sessions/"))).status, 401);
    assert.equal((await shared("x".repeat(43))).status, 404);
    assert.equal((await shared("not-a-token")).status, 404);
    assert.equal((await h.anonymous.send("POST", `/api/shared/${token}`, {})).status, 401, "nothing but reading it is open");
  });

  test("stopping sharing ends the link at once; sharing again makes a new one, and deleting the chat ends it too", async () => {
    const first = ((await owner.get(`/api/sessions/${session.id}/share`)).body as ShareState).share?.token as string;
    assert.equal((await owner.send("DELETE", `/api/sessions/${session.id}/share`)).status, 204);
    assert.equal((await shared(first)).status, 404);
    assert.deepEqual((await owner.get(`/api/sessions/${session.id}/share`)).body, { share: null });
    const second = ((await share()).body as ShareInfo).token;
    assert.notEqual(second, first);
    assert.equal((await owner.send("DELETE", `/api/sessions/${session.id}`)).status, 204);
    assert.equal((await shared(second)).status, 404);
  });
});
