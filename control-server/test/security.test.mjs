// Path security and request admission: an ID never becomes a path outside
// skills/, a symlink is never followed, and nothing changes without the token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { request } from "node:http";
import { ControlError } from "../src/errors.mjs";
import { ROUTES } from "../src/router.mjs";
import { createControlServer, listen } from "../src/server.mjs";
import { admit, hostAllowed, originAllowed, TOKEN_HEADER, tokenMatches } from "../src/security.mjs";
import { listSkills } from "../src/skills/catalog.mjs";
import { readSkill } from "../src/skills/read.mjs";
import { removeSkill } from "../src/skills/remove.mjs";
import { updateSkill } from "../src/skills/update.mjs";
import { contextFor, fixture, link, skillText, TOKEN, worldFor } from "./fixture.mjs";

const code = (want) => (e) => e instanceof ControlError && e.code === want;

const TRAVERSALS = ["..", ".", "../outside", "..\\outside", "../../etc/passwd", "/etc/passwd", "C:\\Windows", "a/b", "a\\b", "%2e%2e", "..%2Fx", ".hidden", "", " alpha", "x".repeat(65), "alpha\0"];

const OPERATIONS = {
  read: (ctx, id) => readSkill(ctx, id),
  update: (ctx, id) => updateSkill(ctx, id, { content: skillText(id) }),
  remove: (ctx, id) => removeSkill(ctx, id),
};

test("an ID that could reach outside skills/ is refused by every operation before any path is built", (t) => {
  const { root, ctx } = fixture(t);
  for (const [name, run] of Object.entries(OPERATIONS)) for (const id of TRAVERSALS) assert.throws(() => run(ctx, id), code("INVALID_SKILL_ID"), `${name} ${JSON.stringify(id)}`);
  assert.throws(() => readSkill(ctx, 42), code("INVALID_SKILL_ID"));
  assert.ok(existsSync(join(root.outside, "victim", "SKILL.md")));
  assert.equal(existsSync(root.backups), false);
});

test("a skill directory that is a symlink OUT of skills/ is never read, written or deleted", (t) => {
  const { root, ctx } = fixture(t);
  if (!link(join(root.outside, "victim"), join(root.skills, "victim"))) return t.skip("this machine cannot make a symlink");
  for (const [name, run] of Object.entries(OPERATIONS)) assert.throws(() => run(ctx, "victim"), code("OUTSIDE_SKILLS_ROOT"), name);
  assert.equal(readFileSync(join(root.outside, "victim", "SKILL.md"), "utf8"), skillText("victim"));
  assert.equal(listSkills(ctx).some((s) => s.id === "victim"), false, "the catalog does not list it either");
});

test("a symlink that stays INSIDE skills/ is still refused — a link is never followed", (t) => {
  const { root, ctx } = fixture(t);
  if (!link(join(root.skills, "alpha"), join(root.skills, "alias"))) return t.skip("this machine cannot make a symlink");
  for (const [name, run] of Object.entries(OPERATIONS)) assert.throws(() => run(ctx, "alias"), code("SYMLINKED_SKILL"), name);
  assert.ok(existsSync(join(root.skills, "alpha", "SKILL.md")));
});

test("a SKILL.md that is a symlink to a file outside is refused", (t) => {
  const { root, ctx } = fixture(t);
  mkdirSync(join(root.skills, "leaky"));
  if (!link(join(root.outside, "secret.txt"), join(root.skills, "leaky", "SKILL.md"), "file")) return t.skip("this machine cannot make a file symlink");
  for (const [name, run] of Object.entries(OPERATIONS)) assert.throws(() => run(ctx, "leaky"), code("OUTSIDE_SKILLS_ROOT"), name);
  assert.equal(readFileSync(join(root.outside, "secret.txt"), "utf8"), "TOP-SECRET\n");
  assert.equal(existsSync(root.backups), false);
});

const req = (headers) => ({ headers });

test("the Host header must name this server — a rebinding name is refused", () => {
  assert.equal(hostAllowed(req({ host: "127.0.0.1:4000" }), 4000), true);
  assert.equal(hostAllowed(req({ host: "localhost:4000" }), 4000), true);
  assert.equal(hostAllowed(req({ host: "LOCALHOST:4000" }), 4000), true);
  assert.equal(hostAllowed(req({ host: "evil.example:4000" }), 4000), false);
  assert.equal(hostAllowed(req({ host: "127.0.0.1:4001" }), 4000), false);
  assert.equal(hostAllowed(req({}), 4000), false);
});

test("an Origin, when a browser sends one, must be this server's own", () => {
  assert.equal(originAllowed(req({}), 4000), true, "curl sends none, and the token still guards it");
  assert.equal(originAllowed(req({ origin: "http://127.0.0.1:4000" }), 4000), true);
  assert.equal(originAllowed(req({ origin: "http://localhost:4000" }), 4000), true);
  assert.equal(originAllowed(req({ origin: "https://evil.example" }), 4000), false);
  assert.equal(originAllowed(req({ origin: "null" }), 4000), false);
});

test("the mutation token must be present and exact", () => {
  assert.equal(tokenMatches(req({ [TOKEN_HEADER]: TOKEN }), TOKEN), true);
  assert.equal(tokenMatches(req({ [TOKEN_HEADER]: TOKEN + "x" }), TOKEN), false);
  assert.equal(tokenMatches(req({ [TOKEN_HEADER]: "" }), TOKEN), false);
  assert.equal(tokenMatches(req({}), TOKEN), false);
});

test("admission reads without a token and never changes without one", () => {
  const good = { host: "127.0.0.1:4000", origin: "http://127.0.0.1:4000" };
  assert.doesNotThrow(() => admit(req(good), 4000, TOKEN, false));
  assert.throws(() => admit(req(good), 4000, TOKEN, true), code("MUTATION_TOKEN_REQUIRED"));
  assert.throws(() => admit(req({ ...good, origin: "https://evil.example", [TOKEN_HEADER]: TOKEN }), 4000, TOKEN, true), code("ORIGIN_NOT_ALLOWED"));
  assert.throws(() => admit(req({ ...good, host: "evil.example" }), 4000, TOKEN, false), code("HOST_NOT_ALLOWED"));
  assert.doesNotThrow(() => admit(req({ ...good, [TOKEN_HEADER]: TOKEN }), 4000, TOKEN, true));
});

// ---- every mutating route, over a real socket -------------------------------------

// A route's path with its one parameter filled in, read off the table itself --
// so a route added later is covered by being a row.
const sample = (route) => route.path.source.replace(/^\^|\$$/g, "").replaceAll("([^/]+)", "x").replace(/\\\//g, "/");

function ask(port, method, path, headers) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString("utf8") || "null") }));
    });
    req.on("error", reject);
    req.end(headers["content-type"] ? "{}" : undefined);
  });
}

test("every route that changes something is marked `mutates`, save the one POST that only computes", () => {
  const unguarded = ROUTES.filter((r) => r.method !== "GET" && !r.mutates).map((r) => sample(r));
  assert.deepEqual(unguarded, ["/api/v1/router/resolve"], "a POST that changes nothing is the only exception, and it is named");
});

test("EVERY mutating route refuses without the token, from a foreign Origin, and under a rebinding Host -- before any operation runs", async (t) => {
  const { root } = fixture(t);
  const server = createControlServer(contextFor(root, worldFor(root)));
  const port = await listen(server, 0);
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  const mutating = ROUTES.filter((r) => r.mutates);
  assert.ok(mutating.length >= 20, `${mutating.length} mutating routes`);
  for (const r of mutating) {
    const path = sample(r);
    const json = r.body ? { "content-type": "application/json" } : {};
    assert.equal((await ask(port, r.method, path, { ...json, origin: `http://127.0.0.1:${port}` })).json.error.code, "MUTATION_TOKEN_REQUIRED", `${r.method} ${path}: no token`);
    assert.equal((await ask(port, r.method, path, { ...json, origin: "https://evil.example", [TOKEN_HEADER]: TOKEN })).json.error.code, "ORIGIN_NOT_ALLOWED", `${r.method} ${path}: foreign origin`);
    assert.equal((await ask(port, r.method, path, { ...json, host: "evil.example", [TOKEN_HEADER]: TOKEN })).status, 403, `${r.method} ${path}: rebinding host`);
  }
  assert.equal(existsSync(join(worldFor(root).rooms.mcp, "managed.json")), false, "nothing was written by any refused request");
});
