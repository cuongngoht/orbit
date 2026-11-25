// THE ACCOUNT'S MCP SERVERS, as a person adds and changes one: a name, an https (or, with no credential, http) URL with
// no user name or password in it, and how Orbit Web signs in to it -- nothing, a bearer token, or a token in a header a
// person names -- and nothing else.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAddMcpServer, checkUpdateMcpServer } from "./mcp-servers.js";

test("a server is a name, a URL and how Orbit Web signs in to it", () => {
  const none = { name: "Team wiki", url: "http://kb.example.com/mcp", auth: { kind: "none" } };
  assert.deepEqual(checkAddMcpServer(none), { ok: true, value: none });
  const bearer = { name: " Docs ", url: "https://docs.example.com/mcp", auth: { kind: "bearer", token: "s3cret" } };
  assert.deepEqual(checkAddMcpServer(bearer), { ok: true, value: { ...bearer, name: "Docs" } });
  const header = { name: "KB", url: "https://kb.example.com:8443/mcp", auth: { kind: "header", header: "X-API-Key", token: "k" } };
  assert.deepEqual(checkAddMcpServer(header), { ok: true, value: header });
});

test("anything else is refused: a credential over plain http or in the URL, a header Orbit Web sets itself, a field nobody declared", () => {
  const ok = { name: "KB", url: "https://kb.example.com/mcp", auth: { kind: "none" } };
  const bad = [
    {},
    { ...ok, name: "" },
    { ...ok, name: "a\nb" },
    { ...ok, url: "ftp://kb.example.com/mcp" },
    { ...ok, url: "https://user:pw@kb.example.com/mcp" },
    { ...ok, url: "https://kb.example.com/mcp#x" },
    { ...ok, url: "not a url" },
    { ...ok, url: "http://kb.example.com/mcp", auth: { kind: "bearer", token: "t" } },
    { ...ok, auth: { kind: "bearer" } },
    { ...ok, auth: { kind: "bearer", token: "a\nb" } },
    { ...ok, auth: { kind: "none", token: "t" } },
    { ...ok, auth: { kind: "header", header: "Host", token: "t" } },
    { ...ok, auth: { kind: "header", header: "Mcp-Session-Id", token: "t" } },
    { ...ok, auth: { kind: "header", header: "X Key", token: "t" } },
    { ...ok, auth: { kind: "oauth" } },
    { ...ok, tools: [] },
  ];
  for (const b of bad) assert.equal(checkAddMcpServer(b).ok, false, JSON.stringify(b));
});

test("a change names what it changes: the name, the tools allowed, or a new credential", () => {
  assert.deepEqual(checkUpdateMcpServer({ allowedTools: ["search", "fetch"] }), { ok: true, value: { allowedTools: ["search", "fetch"] } });
  assert.deepEqual(checkUpdateMcpServer({ name: "Wiki", auth: { kind: "bearer", token: "new" } }), { ok: true, value: { name: "Wiki", auth: { kind: "bearer", token: "new" } } });
  for (const b of [{}, { url: "https://other.example.com" }, { allowedTools: "search" }, { allowedTools: [1] }, { allowedTools: ["a", "a"] }]) assert.equal(checkUpdateMcpServer(b).ok, false, JSON.stringify(b));
});
