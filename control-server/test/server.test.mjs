// The HTTP surface, end to end over a real socket: the route table and
// nothing else, the page and nothing beside it, one error shape, and the
// boundary this server keeps with Orbit core.
//
// Requests go through node:http rather than fetch, because fetch normalises a
// path and refuses to set Host -- and those are exactly the requests to send.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createControlServer, listen } from "../src/server.mjs";
import { ROUTES } from "../src/router.mjs";
import { supported } from "../src/runtime.mjs";
import { TOKEN_HEADER } from "../src/security.mjs";
import { fixture, link, skillText, TOKEN } from "./fixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..");
const REPO = join(SERVER, "..");

async function started(t, ctx) {
  const server = createControlServer(ctx);
  const port = await listen(server, 0);
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  return port;
}

function send(port, { method = "GET", path = "/", headers = {}, body } = {}) {
  const all = { host: `127.0.0.1:${port}`, ...headers };
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: all }, (res) => collect(res, resolve));
    req.on("error", reject);
    req.end(body);
  });
}

function collect(res, resolve) {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
}

const jsonOf = (r) => JSON.parse(r.text);
const mutation = (port, extra = {}) => ({ origin: `http://127.0.0.1:${port}`, [TOKEN_HEADER]: TOKEN, "content-type": "application/json", ...extra });
const put = (port, id, payload, headers = mutation(port)) => send(port, { method: "PUT", path: `/api/v1/skills/${id}`, headers, body: JSON.stringify(payload) });

test("health says the server is up, on which Node, and how many skills — and nothing about paths", async (t) => {
  const { root, ctx } = fixture(t);
  const port = await started(t, ctx);
  const r = await send(port, { path: "/api/v1/health" });
  assert.equal(r.status, 200);
  assert.deepEqual(jsonOf(r), { status: "ok", node: "24.15.0", engine: "0.0.0-test", skills: 2 });
  assert.equal(r.text.includes(root.base), false);
  assert.equal(r.headers["cache-control"], "no-store");
});

test("list and read answer JSON, and an unknown skill is a 404 in the one error shape", async (t) => {
  const { ctx } = fixture(t);
  const port = await started(t, ctx);
  assert.deepEqual(jsonOf(await send(port, { path: "/api/v1/skills" })).skills.map((s) => s.id), ["alpha", "beta"]);
  const alpha = jsonOf(await send(port, { path: "/api/v1/skills/alpha" }));
  assert.equal(alpha.content, skillText("alpha"));
  const gone = await send(port, { path: "/api/v1/skills/nope" });
  assert.equal(gone.status, 404);
  assert.deepEqual(Object.keys(jsonOf(gone).error).sort(), ["code", "message"]);
  assert.equal(jsonOf(gone).error.code, "SKILL_NOT_FOUND");
});

test("a change without the token, with a wrong one, or from another origin is 403 and changes nothing", async (t) => {
  const { root, ctx } = fixture(t);
  const port = await started(t, ctx);
  const payload = { content: skillText("alpha", "Hijacked.") };
  const refusals = [
    [put(port, "alpha", payload, { "content-type": "application/json" }), "MUTATION_TOKEN_REQUIRED"],
    [put(port, "alpha", payload, mutation(port, { [TOKEN_HEADER]: "wrong" })), "MUTATION_TOKEN_REQUIRED"],
    [put(port, "alpha", payload, mutation(port, { origin: "https://evil.example" })), "ORIGIN_NOT_ALLOWED"],
    [send(port, { method: "DELETE", path: "/api/v1/skills/alpha" }), "MUTATION_TOKEN_REQUIRED"],
    [send(port, { method: "DELETE", path: "/api/v1/skills/alpha", headers: mutation(port, { host: `evil.example:${port}` }) }), "HOST_NOT_ALLOWED"],
  ];
  for (const [pending, want] of refusals) {
    const r = await pending;
    assert.equal(r.status, 403, want);
    assert.equal(jsonOf(r).error.code, want);
  }
  assert.equal(readFileSync(join(root.skills, "alpha", "SKILL.md"), "utf8"), skillText("alpha"));
});

test("a valid save is 200 with the fresh skill; an invalid one is 400 with every problem and no damage", async (t) => {
  const { root, ctx } = fixture(t);
  const port = await started(t, ctx);
  const saved = await put(port, "alpha", { content: skillText("alpha", "Saved over HTTP.") });
  assert.equal(saved.status, 200);
  assert.equal(jsonOf(saved).description, "Saved over HTTP.");
  const bad = await put(port, "alpha", { content: "---\nname: beta\n---\n" });
  assert.equal(bad.status, 400);
  assert.equal(jsonOf(bad).error.code, "INVALID_SKILL");
  assert.equal(jsonOf(bad).error.details.length, 2);
  assert.equal(readFileSync(join(root.skills, "alpha", "SKILL.md"), "utf8"), skillText("alpha", "Saved over HTTP."));
});

test("a stale save is 409, and a body that is not JSON, too big or mistyped is refused by status", async (t) => {
  const { ctx } = fixture(t);
  const port = await started(t, ctx);
  assert.equal((await put(port, "alpha", { content: skillText("alpha"), revision: "0".repeat(64) })).status, 409);
  const raw = (body, type) => send(port, { method: "PUT", path: "/api/v1/skills/alpha", headers: mutation(port, { "content-type": type }), body });
  assert.equal((await raw("{nope", "application/json")).status, 400);
  assert.equal(jsonOf(await raw("{nope", "application/json")).error.code, "INVALID_JSON");
  assert.equal((await raw("content=x", "application/x-www-form-urlencoded")).status, 415);
  assert.equal((await raw(JSON.stringify({ content: "x".repeat(1024 * 1024 + 1) }), "application/json")).status, 413);
});

test("DELETE backs up, removes the directory, and the list no longer has it", async (t) => {
  const { root, ctx } = fixture(t);
  const port = await started(t, ctx);
  const r = await send(port, { method: "DELETE", path: "/api/v1/skills/alpha", headers: mutation(port) });
  assert.equal(r.status, 200);
  assert.deepEqual(jsonOf(r), { id: "alpha", deleted: true, backup: "2026-09-23T10-15-30-123Z/alpha" });
  assert.equal(existsSync(join(root.skills, "alpha")), false);
  assert.ok(existsSync(join(root.backups, "2026-09-23T10-15-30-123Z", "alpha", "scripts", "run.mjs")));
  assert.deepEqual(jsonOf(await send(port, { path: "/api/v1/skills" })).skills.map((s) => s.id), ["beta"]);
});

test("an encoded or raw traversal in a skill path never reaches outside skills/", async (t) => {
  const { root, ctx } = fixture(t);
  const port = await started(t, ctx);
  for (const id of ["..%2Foutside%2Fvictim", "..%5Coutside", "%2e%2e%2Foutside", "%00", "%E0%A4%A"]) {
    const r = await send(port, { method: "DELETE", path: `/api/v1/skills/${id}`, headers: mutation(port) });
    assert.equal(r.status, 400, id);
    assert.equal(jsonOf(r).error.code, "INVALID_SKILL_ID", id);
  }
  for (const path of ["/api/v1/skills/../../outside/victim", "/api/v1/skills/%2e%2e/%2e%2e/outside"]) assert.equal((await send(port, { method: "DELETE", path, headers: mutation(port) })).status, 404, path);
  assert.ok(existsSync(join(root.outside, "victim", "SKILL.md")));
});

test("the API is its route table: anything else under /api is 404, a wrong method 405, and no CORS", async (t) => {
  const { ctx } = fixture(t);
  const port = await started(t, ctx);
  for (const path of ["/api/files", "/api/bash", "/api/command", "/api/sql", "/api/events", "/api/stats", "/api/v1/skills/alpha/files"]) assert.equal((await send(port, { path })).status, 404, path);
  assert.equal((await send(port, { method: "POST", path: "/api/v1/skills", headers: mutation(port) })).status, 405);
  const preflight = await send(port, { method: "OPTIONS", path: "/api/v1/skills/alpha", headers: { origin: "https://evil.example", "access-control-request-method": "PUT" } });
  assert.equal(preflight.status, 405);
  assert.equal(preflight.headers["access-control-allow-origin"], undefined);
});

test("the page: index, a hashed asset, the single-page fallback, and a 404 for a missing asset", async (t) => {
  const { ctx } = fixture(t);
  const port = await started(t, ctx);
  const index = await send(port, { path: "/" });
  assert.equal(index.status, 200);
  assert.match(index.headers["content-type"], /^text\/html/);
  assert.match(index.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(index.text, /Orbit Control/);
  const asset = await send(port, { path: "/assets/app-abc123.js" });
  assert.match(asset.headers["content-type"], /^text\/javascript/);
  assert.match(asset.headers["cache-control"], /immutable/);
  assert.match((await send(port, { path: "/skills/alpha" })).text, /Orbit Control/);
  assert.equal((await send(port, { path: "/assets/gone.js" })).status, 404);
  assert.equal((await send(port, { method: "HEAD", path: "/" })).text, "");
  assert.equal((await send(port, { method: "POST", path: "/" })).status, 405);
});

test("the page never serves a file outside public/, a symlink out of it, or a type it does not know", async (t) => {
  const { root, ctx } = fixture(t);
  const port = await started(t, ctx);
  link(root.outside, join(root.public, "escape"));
  const attempts = ["/../outside/secret.txt", "/assets/..%2f..%2f..%2foutside%2fsecret.txt", "/%2e%2e/%2e%2e/outside/secret.txt", "/..%5c..%5coutside%5csecret.txt", "/escape/secret.txt", "/data.bin", "/assets/app-abc123.js%00.txt"];
  for (const path of attempts) {
    const r = await send(port, { path });
    assert.equal(r.status, 404, path);
    assert.equal(r.text.includes("TOP-SECRET"), false, path);
  }
});

test("a page that was never built says how to build it; an unexpected fault is a generic 500", async (t) => {
  const { root, ctx } = fixture(t);
  const port = await started(t, { ...ctx, publicRoot: join(root.base, "unbuilt") });
  const r = await send(port, { path: "/" });
  assert.equal(r.status, 503);
  assert.equal(jsonOf(r).error.code, "PANEL_NOT_BUILT");
  const logged = [];
  const broken = await started(t, { ...ctx, skillsRoot: join(root.base, "no-such-skills"), log: (l) => logged.push(l) });
  const fault = await send(broken, { path: "/api/v1/skills" });
  assert.equal(fault.status, 500);
  assert.deepEqual(jsonOf(fault), { error: { code: "INTERNAL_ERROR", message: "the server could not complete that request" } });
  assert.equal(logged.length, 1, "the fault is logged on the server, not sent to the page");
});

const sources = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".mjs") ? [join(dir, e.name)] : []));

test("core.mjs is the only door into Orbit core and the plugin's bindings, and nothing here needs a database or a dependency", () => {
  const files = sources(join(SERVER, "src"));
  const reaching = files.filter((f) => /from\s+["'](?:\.\.\/)+(?:src|skills)\//.test(readFileSync(f, "utf8"))).map((f) => relative(SERVER, f).replace(/\\/g, "/"));
  assert.deepEqual(reaching, ["src/core.mjs"]);
  for (const f of files) assert.doesNotMatch(readFileSync(f, "utf8"), /sqlite|from\s+["'](?!node:|\.)/, f);
  const manifest = JSON.parse(readFileSync(join(SERVER, "package.json"), "utf8"));
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.engines.node, ">=24.15");
  const rootManifest = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  assert.equal(rootManifest.dependencies ?? rootManifest.devDependencies, undefined, "the engine stays zero-dependency");
  assert.equal(rootManifest.engines.node, ">=20");
});

test("the Node floor is read from package.json, and main.mjs holds a too-old Node to it", async (t) => {
  assert.equal(supported("24.15.0", ">=24.15"), true);
  assert.equal(supported("v25.0.1", ">=24.15"), true);
  assert.equal(supported("24.14.9", ">=24.15"), false);
  assert.equal(supported("22.23.1", ">=24.15"), false);
  const store = mkdtempSync(join(tmpdir(), "orbit-control-store-"));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const said = await ran(join(SERVER, "src", "main.mjs"), { ...process.env, ORBIT_STORE_DIR: store });
  if (supported(process.versions.node)) return assert.match(said.out, /open {5}http:\/\/127\.0\.0\.1:\d+\/#token=[\w-]{43}\n/);
  assert.equal(said.code, 1);
  assert.match(said.err, /needs Node >=24\.15/);
});

// Started for real, and stopped as soon as it has printed its URL -- or has
// exited, which is what a too-old Node does.
function ran(file, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { env, stdio: ["ignore", "pipe", "pipe"] });
    const said = { out: "", err: "", code: null };
    child.stdout.on("data", (d) => { said.out += d; if (/stop /.test(said.out)) child.kill(); });
    child.stderr.on("data", (d) => { said.err += d; });
    child.on("exit", (code) => resolve({ ...said, code }));
  });
}

test("no route names a command, a shell, an exec or a restart, and every change is a row that says so", () => {
  assert.deepEqual(ROUTES.filter((r) => /command|shell|exec|restart/i.test(String(r.path))).map((r) => `${r.method} ${r.path}`), []);
  const sandbox = ROUTES.filter((r) => /sandbox/.test(String(r.path)));
  assert.deepEqual(sandbox.filter((r) => r.method !== "GET" && r.mutates !== true), [], "a sandbox change is a mutating row: the token and the origin are asked");
  assert.deepEqual(sandbox.filter((r) => r.method !== "GET" && r.method !== "POST"), [], "and a sandbox is only ever stopped, released or trusted -- never put, patched or deleted");
});
