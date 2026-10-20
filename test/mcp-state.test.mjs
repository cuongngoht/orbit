// Current MCP state: explicit schemas, managed ownership and non-mutating reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogFile, readCatalog } from "../src/catalog.mjs";
import { Refused } from "../src/errors.mjs";
import { mcpCatalog } from "../src/mcp/catalog.mjs";
import { managedProblems, managedRecord } from "../src/mcp/managed.mjs";
import { checkedAs, createMcpState, MCP_STATE_SCHEMA, observedAs, withServer } from "../src/mcp/state.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = mcpCatalog(readCatalog(realIo(), catalogFile(REPO, "mcp")));
const AT = "2026-09-24T08:00:00.000Z";

function store(t) {
  const base = mkdtempSync(join(tmpdir(), "orbit-mcp-current-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return { base, rooms: stateRooms(base) };
}

const stateOf = (rooms) => createMcpState(rooms, realIo());
const json = (file) => JSON.parse(readFileSync(file, "utf8"));

// ---- the rooms -------------------------------------------------------------------

test("MCP configuration and MCP runtimes are separate rooms under storeBase -- never under the plugin", (t) => {
  const { base, rooms } = store(t);
  assert.equal(relative(base, rooms.mcp), join("control", "resources", "mcp"));
  assert.equal(relative(base, rooms.mcpReceipts), join("control", "resources", "mcp", "receipts"));
  assert.equal(relative(base, rooms.mcpRuntimes), join("runtimes", "mcp"));
  assert.equal(relative(base, rooms.toolRuntimes), join("runtimes", "tools"));
  assert.equal(relative(base, rooms.activity), join("control", "activity"));
  assert.equal(rooms.runtimes, undefined);
  assert.equal(rooms.receipts, undefined);
  for (const room of Object.values(rooms)) assert.equal(room.startsWith(REPO), false, `${room} is inside the plugin`);
  for (const room of Object.values(rooms)) assert.equal(relative(base, room).startsWith(".."), false, `${room} left the store`);
});

// ---- no secret, ever --------------------------------------------------------------------

test("a managed definition NAMES its secrets and never holds one: values, userinfo, secret query keys and secret-looking args are refused", () => {
  assert.deepEqual(managedProblems({ id: "docs", transport: "http", url: "https://d.example/mcp?region=eu", requiredHeaders: [{ name: "Authorization", env: "DOCS_TOKEN" }] }), []);
  assert.deepEqual(managedProblems({ id: "srv", transport: "stdio", command: "npx", args: ["-y", "pkg"], requiredEnv: ["API_KEY"] }), []);
  assert.deepEqual(managedProblems({ id: "rt", transport: "stdio", commandRef: "managed-runtime", args: ["stdio"] }), []);
  const said = (d) => managedProblems(d).join(" | ");
  assert.match(said({ id: "a", transport: "http", url: "https://d/mcp", requiredHeaders: [{ name: "Authorization", env: "T", value: "Bearer x" }] }), /never holds a secret value/);
  assert.match(said({ id: "a", transport: "http", url: "https://user:pw@d/mcp" }), /no user name, password/);
  assert.match(said({ id: "a", transport: "http", url: "https://d/mcp?api_key=zzz" }), /no user name, password or secret query/);
  assert.match(said({ id: "a", transport: "stdio", command: "srv", args: ["--api-key", "sk-live-1"] }), /none may be a secret/);
  assert.match(said({ id: "a", transport: "stdio", command: "srv", args: ["--token=abc123"] }), /none may be a secret/);
  assert.match(said({ id: "a", transport: "stdio", command: "srv", commandRef: "managed-runtime" }), /one of them/);
  assert.match(said({ id: "a", transport: "http", url: "https://d/mcp", requiredHeaders: ["Authorization"] }), /header 1: a header name.*header 1's variable: name the environment variable/);
});

test("a header row that is wrong is named and explained -- and a secret pasted where a variable's NAME belongs is never repeated back", () => {
  const pasted = '"Bearer acme_mcp__PASTED-token-4242"';
  const problems = managedProblems({ id: "Test", transport: "http", url: "https://d.example/mcp", requiredHeaders: [{ name: '"Authorization"', env: pasted }] });
  assert.deepEqual(problems.length, 2);
  assert.match(problems[0], /^header 1: a header name .* no quotes, spaces or colon, e.g\. Authorization$/);
  assert.match(problems[1], /^header 1's variable is not an environment variable NAME .* If you pasted the secret itself: Orbit never stores a value/);
  assert.equal(problems.join(" ").includes("acme_mcp"), false, "the pasted value never comes back in a message");
  assert.deepEqual(managedProblems({ id: "Test", transport: "http", url: "https://d.example/mcp", requiredHeaders: [{ name: "Authorization", env: "" }] }), ["header Authorization's variable: name the environment variable that holds the value, e.g. MY_SERVICE_TOKEN"]);
  assert.deepEqual(managedProblems({ id: "Test", transport: "stdio", command: "srv", requiredEnv: ["OK_NAME", "not ok"] }), [`variable 2 is not an environment variable NAME (letters, digits and _, not starting with a digit). If you pasted the secret itself: Orbit never stores a value -- put it in an environment variable and give that variable's name here`]);
  assert.deepEqual(managedProblems({ id: "Test", transport: "http", url: "https://d.example/mcp", requiredHeaders: [{ name: "Authorization", env: "ACME_MCP_TOKEN" }] }), []);
});

test("what is persisted for a managed server is the normalised definition, and nothing that came in unasked", (t) => {
  const { rooms } = store(t);
  const record = managedRecord({ id: "docs", transport: "http", url: "https://d.example/mcp", requiredHeaders: [{ name: "Authorization", env: "DOCS_TOKEN" }], token: "sk-should-not-land", provides: ["Documentation.Search"] }, { origin: "custom", at: AT });
  stateOf(rooms).change("managed", (doc) => withServer(doc, "docs", record));
  const text = readFileSync(join(rooms.mcp, "managed.json"), "utf8");
  assert.equal(text.includes("sk-should-not-land"), false);
  assert.deepEqual(json(join(rooms.mcp, "managed.json")).servers.docs.definition, { transport: "http", url: "https://d.example/mcp", requiredHeaders: [{ name: "Authorization", env: "DOCS_TOKEN" }] });
  assert.deepEqual(json(join(rooms.mcp, "managed.json")).servers.docs.provides, ["documentation.search"]);
});

// ---- receipts ------------------------------------------------------------------------------

test("a receipt is believed only as far as it can be checked: a known room, relative paths, schema 3 -- corruption is refused; escaping receipts remain ineligible", (t) => {
  const { rooms } = store(t);
  const state = stateOf(rooms);
  const good = { mcp: "company-docs", version: "1.2.0", platform: "linux", arch: "x64", home: "mcpRuntimes", dir: join("company-docs", "1.2.0-linux-x64"), entrypoint: join("bin", "server.js"), installedAt: AT, source: "https://example.test/x.tgz", checksum: "sha256:abc" };
  state.saveReceipt(good);
  mkdirSync(rooms.mcpReceipts, { recursive: true });
  writeFileSync(join(rooms.mcpReceipts, "escape-1-linux-x64.json"), JSON.stringify({ ...good, mcp: "escape", dir: "../../../etc", schema: MCP_STATE_SCHEMA }));
  writeFileSync(join(rooms.mcpReceipts, "absolute-1-linux-x64.json"), JSON.stringify({ ...good, mcp: "absolute", entrypoint: "/usr/bin/evil", schema: MCP_STATE_SCHEMA }));
  writeFileSync(join(rooms.mcpReceipts, "tools-home-1-linux-x64.json"), JSON.stringify({ ...good, mcp: "tools-home", home: "runtimes", schema: MCP_STATE_SCHEMA }));
  writeFileSync(join(rooms.mcpReceipts, "broken-1-linux-x64.json"), "{ nope");
  assert.throws(() => state.receipts(), /corrupt Orbit state/);
  assert.equal(readFileSync(join(rooms.mcpReceipts, "broken-1-linux-x64.json"), "utf8"), "{ nope");
  rmSync(join(rooms.mcpReceipts, "broken-1-linux-x64.json"));
  assert.deepEqual(state.receipts().map((r) => [r.mcp, r.checksum, r.schema]), [["company-docs", "sha256:abc", MCP_STATE_SCHEMA]]);
  assert.equal(readFileSync(join(rooms.mcpReceipts, "company-docs-1.2.0-linux-x64.json"), "utf8").includes(rooms.mcpRuntimes), false, "no absolute path");
});

test("fresh MCP store reads empty without touching historical paths or creating files", (t) => {
  const { rooms } = store(t);
  const io = realIo();
  const read = io.read;
  const guarded = { ...io, read: (file) => { assert.ok(!/\/(desired|custom|observed)\.json$/.test(file)); return read(file); } };
  const state = createMcpState(rooms, guarded);
  assert.deepEqual(state.read("managed"), { schema: MCP_STATE_SCHEMA, servers: {} });
  assert.equal(existsSync(rooms.mcp), false);
  state.change("managed", (doc) => doc);
  assert.deepEqual(stateOf(rooms).read("managed"), { schema: MCP_STATE_SCHEMA, servers: {} });
});

test("unsupported, corrupt and historical MCP documents are refused without modifying them", (t) => {
  const { rooms } = store(t);
  mkdirSync(rooms.mcp, { recursive: true });
  const file = join(rooms.mcp, "managed.json");
  for (const text of ['{ broken', '{"schema":2,"servers":{}}', '{"schema":99}', JSON.stringify({ schema: MCP_STATE_SCHEMA, servers: {}, legacy: {} }), JSON.stringify({ schema: MCP_STATE_SCHEMA, servers: [] })]) {
    writeFileSync(file, text);
    assert.throws(() => stateOf(rooms).read("managed"), Refused);
    assert.throws(() => stateOf(rooms).change("managed", (doc) => doc), Refused);
    assert.equal(readFileSync(file, "utf8"), text);
  }
  assert.deepEqual(readdirSync(rooms.mcp), ["managed.json"]);
});
