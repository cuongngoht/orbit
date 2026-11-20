// IMAGES IN A CHAT MESSAGE -- a screenshot pasted into the composer. An upload is read from its own bytes and kept for
// the account that made it; a message names its images, and Claude Code is given them as one stream-json user message
// (the words and each image's own bytes, base64) -- the only way its CLI takes an image headless. The chat shows them
// again to whoever may read it, and to nobody else; an image goes with one message; a chat's images go with it.
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";
import { IMAGE_LIMITS, MUTATION_HEADER, type ImageRef, type SessionDetail, type SessionSummary } from "@orbit-web/contracts";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { ClaudeAuthService } from "../../src/modules/claude-auth/claude-auth.service.js";
import { ImagesService, UNCLAIMED_MS } from "../../src/modules/images/images.service.js";
import { FakeProcessPort, program, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { CLAUDE_SIGNED_IN, claudeRun, eventually, signedIn, startHarness, type Harness } from "../../src/testing/harness.js";
import { gifOf, pngHeaderOf, pngOf } from "../../src/testing/image-fixtures.js";

const ALICE = { ...CLAUDE_SIGNED_IN, email: "alice@example.com", orgId: "org-a", orgName: "Alice Org" };
const BOB = { ...CLAUDE_SIGNED_IN, email: "bob@example.com", orgId: "org-b", orgName: "Bob Org" };

const after1 = (args: string[], flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null);

function quickRun(c: FakeChild, call: Call): void {
  c.onInputClosed(() => {
    c.line({ type: "system", subtype: "init", session_id: after1(call.args, "--session-id") ?? after1(call.args, "--resume"), model: "claude-sonnet-5-5", claude_code_version: "2.1.328", plugins: [{ name: "orbit" }] });
    c.line({ type: "result", subtype: "success", is_error: false, result: "A red square.", total_cost_usd: 0, num_turns: 1, duration_ms: 1 });
    c.exit(0);
  });
}

interface UserMessage {
  type: string;
  message: { role: string; content: ({ type: "text"; text: string } | { type: "image"; source: { type: string; media_type: string; data: string } })[] };
}

describe("images in a chat message", () => {
  let h: Harness;
  const state = { who: ALICE as Record<string, unknown> };
  const as = async (account: Record<string, unknown>) => {
    state.who = account;
    await h.app.get(ClaudeAuthService).account(true);
  };
  const upload = (bytes: Buffer, contentType = "application/octet-stream") =>
    fetch(`${h.url}/api/images`, { method: "POST", headers: { [MUTATION_HEADER]: "1", "content-type": contentType }, body: bytes }).then(async (r) => ({ status: r.status, body: (await r.json()) as ImageRef & { error?: { code: string } } }));
  const chat = async (body: Record<string, unknown> = {}): Promise<SessionSummary> => {
    const r = await h.send("POST", "/api/sessions", { model: "sonnet", mode: "plan", ...body });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body as SessionSummary;
  };
  const settled = (id: string) => eventually(async () => ((await h.get(`/api/sessions/${id}`)).body as SessionDetail).status, (s) => s === "ready" || s === "completed");
  const runs = () => h.fake.children.filter((c) => claudeRun(c.call.file, c.call.args));
  const stdinOf = (child: FakeChild): string => child.written.join("");

  before(async () => {
    const fake = signedIn(new FakeProcessPort(new NodeProcessPort()))
      .on(program("claude", "auth", "status"), { run: () => ({ stdout: JSON.stringify(state.who) }) })
      .on(claudeRun, { spawn: quickRun });
    h = await startHarness({ fake });
    await as(ALICE);
  });
  after(() => h.close());

  test("an upload is what its bytes say, kept for its account in a room only Orbit Web reads; anything else is refused", async () => {
    const png = await upload(pngOf(8, 6));
    assert.equal(png.status, 201, JSON.stringify(png.body));
    assert.deepEqual({ ...png.body, id: "" }, { id: "", mediaType: "image/png", width: 8, height: 6, bytes: pngOf(8, 6).length });
    const room = join(h.config.data.app, "images");
    assert.equal(statSync(room).mode & 0o777, 0o700);
    assert.equal(statSync(join(room, png.body.id)).mode & 0o777, 0o600);
    assert.equal((await upload(gifOf(4, 4))).body.mediaType, "image/gif");
    for (const [bytes, code] of [
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "unsupported_image"],
      [Buffer.from("not an image"), "unsupported_image"],
      [pngHeaderOf(IMAGE_LIMITS.side + 1, 10), "image_dimensions"],
      [Buffer.concat([pngOf(2, 2), Buffer.alloc(IMAGE_LIMITS.bytes)]), "image_too_large"],
    ] as const) {
      const r = await upload(bytes);
      assert.equal(r.body.error?.code, code, `${r.status} ${JSON.stringify(r.body)}`);
    }
    assert.equal((await upload(pngOf(2, 2), "image/png")).status, 415, "only the file's own bytes, as octet-stream, pass the guard here");
    assert.equal((await h.send("POST", "/api/images", { image: "x" })).status, 415);
  });

  test("a message's image reaches Claude Code as stream-json -- the words, then the image's own bytes -- and the chat shows it", async () => {
    const created = await chat();
    await settled(created.id);
    const bytes = pngOf(16, 16);
    const image = (await upload(bytes)).body;
    const before = runs().length;
    const sent = await h.send("POST", `/api/sessions/${created.id}/messages`, { text: "What is in this screenshot?", images: [image.id] });
    assert.equal(sent.status, 202, JSON.stringify(sent.body));
    await settled(created.id);
    const run = runs()[before];
    assert.ok(run);
    assert.equal(after1(run.call.args, "--input-format"), "stream-json");
    const message = JSON.parse(stdinOf(run.child).trim()) as UserMessage;
    assert.equal(message.type, "user");
    assert.deepEqual(message.message.content.map((c) => c.type), ["text", "image"]);
    assert.deepEqual(message.message.content[0], { type: "text", text: "What is in this screenshot?" });
    const block = message.message.content[1] as Extract<UserMessage["message"]["content"][number], { type: "image" }>;
    assert.deepEqual([block.source.type, block.source.media_type], ["base64", "image/png"]);
    assert.deepEqual(Buffer.from(block.source.data, "base64"), bytes);

    const detail = (await h.get(`/api/sessions/${created.id}`)).body as SessionDetail;
    const mine = detail.messages.find((m) => m.role === "user");
    assert.deepEqual(mine?.images?.map((i) => i.id), [image.id]);
    const shown = await fetch(`${h.url}/api/sessions/${created.id}/images/${image.id}`);
    assert.equal(shown.status, 200);
    assert.deepEqual(Buffer.from(await shown.arrayBuffer()), bytes);
    assert.equal(shown.headers.get("content-type"), "image/png");
    assert.equal(shown.headers.get("x-content-type-options"), "nosniff");
    assert.equal(shown.headers.get("content-security-policy"), "default-src 'none'");

    // A shared link's snapshot keeps the words: the images stay in the chat (a link opens none), and so do their ids.
    const link = await h.send("POST", `/api/sessions/${created.id}/share`, {});
    assert.equal(link.status, 200, JSON.stringify(link.body));
    const snapshot = await h.get(`/api/shared/${(link.body as { token: string }).token}`);
    assert.equal(snapshot.status, 200);
    assert.ok(JSON.stringify(snapshot.body).includes("What is in this screenshot?"));
    assert.equal(JSON.stringify(snapshot.body).includes(image.id), false);

    // The journal keeps a reference -- never the bytes.
    const db = new DatabaseSync(join(h.config.data.app, "orbit-web.db"), { readOnly: true });
    try {
      const journal = (db.prepare("SELECT data FROM events WHERE session_id = ?").all(created.id) as { data: string }[]).map((r) => r.data).join("\n");
      assert.ok(journal.includes(image.id));
      assert.equal(journal.includes(block.source.data.slice(0, 40)), false);
    } finally {
      db.close();
    }
  });

  test("an image goes with one message, and only the account that uploaded it may send it; another reads none", async () => {
    const created = await chat();
    await settled(created.id);
    const image = (await upload(pngOf(4, 4))).body;
    assert.equal((await h.send("POST", `/api/sessions/${created.id}/messages`, { text: "once", images: [image.id] })).status, 202);
    await settled(created.id);
    const again = await h.send("POST", `/api/sessions/${created.id}/messages`, { text: "twice", images: [image.id] });
    assert.deepEqual([again.status, (again.body as { error: { code: string } }).error.code], [409, "image_sent"]);

    const other = (await upload(pngOf(4, 4))).body;
    await as(BOB);
    try {
      const bobs = await chat();
      await settled(bobs.id);
      const taken = await h.send("POST", `/api/sessions/${bobs.id}/messages`, { text: "mine?", images: [other.id] });
      assert.equal(taken.status, 404, "somebody else's image is not found");
      assert.equal((await fetch(`${h.url}/api/sessions/${created.id}/images/${image.id}`)).status, 404, "nor is a chat Bob may not read");
    } finally {
      await as(ALICE);
    }
  });

  test("a new chat's first message may be an image alone; deleting the chat removes its images", async () => {
    const image = (await upload(pngOf(6, 6))).body;
    const before = runs().length;
    const created = await chat({ images: [image.id] });
    await eventually(() => runs().length, (n) => n > before);
    await settled(created.id);
    const message = JSON.parse(stdinOf((runs()[before] as { child: FakeChild }).child).trim()) as UserMessage;
    assert.deepEqual(message.message.content.map((c) => c.type), ["image"], "no empty words beside it");
    const file = join(h.config.data.app, "images", image.id);
    assert.equal(existsSync(file), true);
    assert.equal((await h.send("DELETE", `/api/sessions/${created.id}`)).status, 204);
    assert.equal(existsSync(file), false);
  });

  test("an upload no chat claims is swept after a day, with its file", async () => {
    const image = (await upload(pngOf(3, 3))).body;
    const file = join(h.config.data.app, "images", image.id);
    const images = h.app.get(ImagesService);
    assert.equal(await images.sweep(Date.now()), 0, "a fresh upload stays");
    assert.equal(existsSync(file), true);
    await images.sweep(Date.now() + UNCLAIMED_MS + 60_000);
    assert.equal(existsSync(file), false);
  });
});
