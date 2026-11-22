// HOW ORBIT WEB ASKS A REMOTE MCP SERVER (Streamable HTTP): a session of its own for each ask -- initialize, the
// initialized notification, then the ask with the session's id -- the credential on every request, an answer read
// as JSON or out of an event stream, and nothing reached that the address policy does not allow.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startFakeMcp, type FakeMcp } from "../../testing/fake-mcp.js";
import { callMcpTool, listMcpTools, mcpAddressPolicy, McpError, type McpOptions, type McpTarget } from "./mcp-client.js";

const TOOLS = [
  { name: "search", description: "Search the knowledge base.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, annotations: { readOnlyHint: true } },
  { name: "create_page", description: "Create a page.", inputSchema: { type: "object" }, annotations: { readOnlyHint: false } },
  { name: "fetch", description: "Fetch a page by id." },
];

const optionsFor = (port: number, over: Partial<McpOptions> = {}): McpOptions => ({ policy: { allows: (address, p) => address === "127.0.0.1" && p === port }, timeoutMs: 5000, maxBytes: 1024 * 1024, ...over });

describe("a remote MCP server, asked as JSON", () => {
  let kb: FakeMcp;
  let target: McpTarget;
  before(async () => {
    kb = await startFakeMcp({ tools: TOOLS, page: 2, credential: { header: "Authorization", value: "Bearer s3cret" }, call: (name, args) => ({ content: [{ type: "text", text: `${name}: ${String(args.query)}` }] }) });
    target = { url: kb.url, credential: { header: "Authorization", value: "Bearer s3cret" } };
  });
  after(() => kb.close());

  test("its tools, every page of them, each with what it says of itself", async () => {
    const tools = await listMcpTools(target, optionsFor(kb.port));
    assert.deepEqual(
      tools.map((t) => [t.name, t.description, t.readOnly]),
      [
        ["search", "Search the knowledge base.", true],
        ["create_page", "Create a page.", false],
        ["fetch", "Fetch a page by id.", null],
      ],
    );
    assert.deepEqual(tools[0]?.inputSchema, TOOLS[0]?.inputSchema);
    assert.deepEqual(tools[2]?.inputSchema, { type: "object" }, "a tool that declares no input takes an object");
  });

  test("a call: its own session, initialized, the session's id and the credential on every request", async () => {
    kb.asked.length = 0;
    const answer = await callMcpTool(target, "search", { query: "export" }, optionsFor(kb.port));
    assert.deepEqual(answer, { content: [{ type: "text", text: "search: export" }], isError: false });
    assert.deepEqual(
      kb.asked.map((a) => a.method),
      ["initialize", "notifications/initialized", "tools/call"],
    );
    for (const a of kb.asked) assert.equal(a.headers.authorization, "Bearer s3cret");
    assert.equal(kb.asked[2]?.headers["mcp-protocol-version"], "2025-06-18");
    assert.match(String(kb.asked[0]?.headers.accept), /application\/json.*text\/event-stream/);
  });

  test("a refusal says what it was, never the credential", async () => {
    const wrong = { url: kb.url, credential: { header: "Authorization", value: "Bearer wrong-token" } };
    await assert.rejects(listMcpTools(wrong, optionsFor(kb.port)), (err: Error) => err instanceof McpError && /401/.test(err.message) && !err.message.includes("wrong-token"));
  });
});

describe("a remote MCP server, asked over an event stream", () => {
  let kb: FakeMcp;
  before(async () => {
    kb = await startFakeMcp({ tools: TOOLS, stream: true, call: (name) => (name === "boom" ? { error: { code: -32000, message: "the index is rebuilding" } } : { content: [{ type: "text", text: "found it" }], isError: false }) });
  });
  after(() => kb.close());

  test("the answer is read out of the stream, a notification before it read past", async () => {
    assert.equal((await listMcpTools({ url: kb.url, credential: null }, optionsFor(kb.port))).length, 3);
    assert.deepEqual(await callMcpTool({ url: kb.url, credential: null }, "search", { query: "x" }, optionsFor(kb.port)), { content: [{ type: "text", text: "found it" }], isError: false });
  });

  test("an error the server answers is said as its own", async () => {
    await assert.rejects(callMcpTool({ url: kb.url, credential: null }, "boom", {}, optionsFor(kb.port)), (err: Error) => err instanceof McpError && err.message.includes("the index is rebuilding"));
  });

  test("an answer larger than the bound is refused", async () => {
    await assert.rejects(listMcpTools({ url: kb.url, credential: null }, optionsFor(kb.port, { maxBytes: 64 })), (err: Error) => err instanceof McpError && /larger/.test(err.message));
  });
});

describe("what Orbit Web never reaches", () => {
  test("this machine, or another address that is not on the public internet, by its own policy", async () => {
    const kb = await startFakeMcp({ tools: TOOLS });
    try {
      await assert.rejects(listMcpTools({ url: kb.url, credential: null }, { policy: mcpAddressPolicy([]), timeoutMs: 5000, maxBytes: 65536 }), (err: Error) => err instanceof McpError && /not on the public internet/.test(err.message));
    } finally {
      await kb.close();
    }
  });

  test("a redirect is never followed", async () => {
    const kb = await startFakeMcp({ tools: TOOLS, redirect: "http://169.254.169.254/latest/meta-data" });
    try {
      await assert.rejects(listMcpTools({ url: kb.url, credential: null }, optionsFor(kb.port)), (err: Error) => err instanceof McpError && /redirect/i.test(err.message));
    } finally {
      await kb.close();
    }
  });
});
