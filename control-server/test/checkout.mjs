// A real Git checkout for the project and runtime routes, and a real socket to ask them through.
// The store, the repository and every file are real and temporary; nothing outside the fixture is
// touched, and the plugin root the runtime binds is the repository's own, so its catalogs are the
// shipped ones.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createControlServer, listen } from "../src/server.mjs";
import { TOKEN_HEADER } from "../src/security.mjs";
import { sealed } from "../../test/home.mjs";
import { contextFor, TOKEN, worldFor } from "./fixture.mjs";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

// files: { "web/package.json": text, ... } -> the directory, committed.
export function gitCheckout(dir, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  for (const args of [["init", "-q", "."], ["add", "-A"], ["commit", "-qm", "init"]]) spawnSync("git", args, { cwd: dir, stdio: "ignore", env: sealed(IDENTITY) });
  return dir;
}

export const gitStatus = (dir) => spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8", env: sealed() }).stdout.trim();

// The machine the routes read: this fixture's store, and the plugin root the runtime binds.
export const runtimeWorld = (root) => {
  const env = { ORBIT_STORE_DIR: root.store, PATH: process.env.PATH ?? "" };
  return { ...worldFor(root, { env, pluginRoot: REPO }), env };
};

function sent(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); resolve({ status: res.statusCode, text, json: text ? JSON.parse(text) : null }); });
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

// A running Control over `root`'s fixture, and the verbs a test asks it with. `post`, `put` carry
// the token a page holds; `bare` carries none, so a test can show what is refused without it; `raw`
// carries exactly the headers a test names -- a forged origin, say.
export async function serve(t, root, world = runtimeWorld(root)) {
  const ctx = contextFor(root, world);
  const server = createControlServer(ctx);
  const port = await listen(server, 0);
  t.after(() => new Promise((done) => { ctx.live.streams.closeAll(); server.closeAllConnections(); server.close(done); }));
  const mutation = { origin: `http://127.0.0.1:${port}`, [TOKEN_HEADER]: TOKEN, "content-type": "application/json" };
  const send = (method, path, body, headers) => sent(port, method, path, body, headers);
  return { port, ctx, get: (p) => send("GET", p), post: (p, b = {}) => send("POST", p, b, mutation), put: (p, b) => send("PUT", p, b, mutation), bare: (m, p, b = {}) => send(m, p, b, { "content-type": "application/json" }), raw: (m, p, b, headers) => send(m, p, b, headers) };
}
