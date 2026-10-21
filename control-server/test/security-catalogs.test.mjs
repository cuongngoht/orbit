// Security catalogs in Orbit Control, over HTTP -- a real socket, a real store in a temporary
// directory, a Git checkout to be "the project" (ADR 0040). The promises: reading shows Orbit's default
// and writes nothing; a preview writes nothing; a link is fetched only over https, bounded, and what is
// adopted is exactly what was previewed; every change is a person's write that carries the token and
// names the revision it read; and which catalogs a project follows is the checkout's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createControlServer, listen } from "../src/server.mjs";
import { TOKEN_HEADER } from "../src/security.mjs";
import { catalogDigest } from "../src/core.mjs";
import { MAX_CATALOG_BYTES, isPublicAddress } from "../src/security-catalogs/fetch.mjs";
import { contextFor, fixture, TOKEN, worldFor } from "./fixture.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHIPPED_FILE = join(REPO, "skills", "orbit-security-audit", "catalogs", "asvs-5.0.0-l1.json");
const SHIPPED = JSON.parse(readFileSync(SHIPPED_FILE, "utf8"));

const OWN = {
  apiVersion: "orbit.control-catalog/v1",
  catalog: "acme-policy",
  title: "The team's own policy",
  version: "1",
  controls: [
    { id: "acme-1", group: "access", level: 1, summary: "Only the owner reads an invoice.", methods: ["runtime-test"], minimumEvidence: ["positive", "negative"], applies: { role: "interface" }, shapes: ["permission-enforced"] },
    { id: "acme-2", summary: "Access rules are written down.", methods: ["design-review"] },
  ],
};

async function started(t, ctx) {
  const server = createControlServer(ctx);
  const port = await listen(server, 0);
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  const mutation = { origin: `http://127.0.0.1:${port}`, [TOKEN_HEADER]: TOKEN, "content-type": "application/json" };
  return { get: (p) => sent(port, "GET", p), post: (p, b) => sent(port, "POST", p, b, mutation), put: (p, b) => sent(port, "PUT", p, b, mutation), bare: (m, p, b) => sent(port, m, p, b, { "content-type": "application/json" }) };
}

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

// The plugin root a fixture builds is a throwaway: the shipped catalog is copied into it.
function seeded(root) {
  mkdirSync(join(root.plugin, "skills", "orbit-security-audit", "catalogs"), { recursive: true });
  copyFileSync(SHIPPED_FILE, join(root.plugin, "skills", "orbit-security-audit", "catalogs", "asvs-5.0.0-l1.json"));
}

function checkoutWorld(root, extra = {}) {
  seeded(root);
  spawnSync("git", ["init", "-q"], { cwd: root.project });
  const env = { ORBIT_STORE_DIR: root.store, PATH: process.env.PATH ?? "" };
  return { ...worldFor(root, { env }), env, ...extra };
}

// A fetch that answers what a link would, and remembers what it was asked.
// A resolver that answers what a public catalog host would, unless a test says otherwise.
const PUBLIC = async () => [{ address: "93.184.215.14", family: 4 }];

const fetching = (answer) => {
  const asked = [];
  return { asked, fetch: async (url, opts) => (asked.push({ url, redirect: opts.redirect }), answer(url)) };
};

test("the overview: Orbit's default is in effect, nothing is adopted, and reading writes nothing", async (t) => {
  const { root } = fixture(t);
  const api = await started(t, contextFor(root, checkoutWorld(root)));
  const got = await api.get("/api/v1/security/catalogs");
  assert.equal(got.status, 200, got.text);
  assert.equal(got.json.project.effective.by, "default");
  assert.deepEqual(got.json.project.effective.catalogs.map((c) => [c.catalog, c.digest]), [["asvs-5.0.0-l1", catalogDigest(SHIPPED)]]);
  assert.deepEqual([got.json.adopted, got.json.index.revision, got.json.project.revision], [[], null, null]);
  assert.equal(existsSync(join(root.store, "control", "security")), false, "reading created nothing");
  const doc = await api.get(`/api/v1/security/catalogs/${catalogDigest(SHIPPED)}`);
  assert.equal(doc.json.document.controls.length, SHIPPED.controls.length);
  assert.equal((await api.get(`/api/v1/security/catalogs/${"0".repeat(64)}`)).status, 404);
});

test("a preview of a pasted file says what adopting would do, and writes nothing", async (t) => {
  const { root } = fixture(t);
  const api = await started(t, contextFor(root, checkoutWorld(root)));
  const got = await api.post("/api/v1/security/catalogs/preview", { text: JSON.stringify(OWN), name: "acme.json" });
  assert.equal(got.status, 200, got.text);
  assert.deepEqual([got.json.preview.ok, got.json.preview.controls, got.json.preview.digest, got.json.source.kind], [true, 2, catalogDigest(OWN), "file"]);
  assert.deepEqual(got.json.preview.diff.added, ["acme-1", "acme-2"]);
  assert.equal((await api.post("/api/v1/security/catalogs/preview", { text: "{ not json" })).status, 400);
  assert.equal(existsSync(join(root.store, "control", "security")), false);
});

test("a link is fetched over https alone, with no credentials, bounded -- and what is adopted is exactly what was previewed", async (t) => {
  const { root } = fixture(t);
  const link = fetching(() => ({ status: 200, text: async () => JSON.stringify(OWN) }));
  const api = await started(t, contextFor(root, checkoutWorld(root, { fetch: link.fetch, lookup: PUBLIC })));
  assert.equal((await api.post("/api/v1/security/catalogs/preview", { url: "http://catalogs.example/acme.json" })).json.error.code, "SECURITY_CATALOG_URL");
  assert.equal((await api.post("/api/v1/security/catalogs/preview", { url: "https://me:secret@catalogs.example/acme.json" })).json.error.code, "SECURITY_CATALOG_URL");
  const preview = await api.post("/api/v1/security/catalogs/preview", { url: "https://catalogs.example/acme.json" });
  assert.equal(preview.json.preview.digest, catalogDigest(OWN));
  assert.deepEqual(link.asked.map((a) => [a.url, a.redirect]), [["https://catalogs.example/acme.json", "error"]]);
  const moved = await api.post("/api/v1/security/catalogs/adopt", { url: "https://catalogs.example/acme.json", digest: "f".repeat(64), revision: null });
  assert.deepEqual([moved.status, moved.json.error.code], [409, "SECURITY_PREVIEW_STALE"]);
  const adopted = await api.post("/api/v1/security/catalogs/adopt", { url: "https://catalogs.example/acme.json", digest: preview.json.preview.digest, revision: null });
  assert.equal(adopted.status, 200, adopted.text);
  assert.deepEqual(adopted.json.adopted.adopted.map((a) => [a.catalog, a.source.kind, a.source.url]), [["acme-policy", "url", "https://catalogs.example/acme.json"]]);
});

test("a link that answers too much, or an error, is the network's answer: 503, and nothing is kept", async (t) => {
  const { root } = fixture(t);
  const huge = fetching(() => ({ status: 200, text: async () => "x".repeat(MAX_CATALOG_BYTES + 1) }));
  const api = await started(t, contextFor(root, checkoutWorld(root, { fetch: huge.fetch, lookup: PUBLIC })));
  const got = await api.post("/api/v1/security/catalogs/preview", { url: "https://catalogs.example/huge.json" });
  assert.deepEqual([got.status, got.json.error.code], [503, "SECURITY_CATALOG_FETCH"]);
  assert.match(got.json.error.message, /larger than/);
  const failing = fetching(() => ({ status: 500, text: async () => "" }));
  const api2 = await started(t, contextFor(root, checkoutWorld(root, { fetch: failing.fetch, lookup: PUBLIC })));
  assert.equal((await api2.post("/api/v1/security/catalogs/preview", { url: "https://catalogs.example/broken.json" })).status, 503);
});

test("adopting is a person's write: the token is required, the revision is named, a stale one is a 409, and the editor validates", async (t) => {
  const { root } = fixture(t);
  const api = await started(t, contextFor(root, checkoutWorld(root)));
  assert.equal((await api.bare("POST", "/api/v1/security/catalogs/adopt", { text: JSON.stringify(OWN), digest: catalogDigest(OWN), revision: null })).status, 403);
  const first = await api.post("/api/v1/security/catalogs/adopt", { text: JSON.stringify(OWN), digest: catalogDigest(OWN), revision: null });
  assert.equal(first.status, 200, first.text);
  const stale = await api.put("/api/v1/security/catalogs/editor", { document: { ...OWN, version: "2" }, revision: null });
  assert.equal(stale.status, 409, stale.text);
  const invalidDoc = await api.put("/api/v1/security/catalogs/editor", { document: { ...OWN, controls: [] }, revision: first.json.adopted.revision });
  assert.deepEqual([invalidDoc.status, invalidDoc.json.error.code], [400, "SECURITY_CATALOG_INVALID"]);
  const saved = await api.put("/api/v1/security/catalogs/editor", { document: { ...OWN, version: "2" }, revision: first.json.adopted.revision });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.json.adopted.adopted.map((a) => [a.version, a.source.kind]), [["1", "file"], ["2", "editor"]]);
});

test("which catalogs a project follows, and the controls marked not applicable, are the checkout's own", async (t) => {
  const { root } = fixture(t);
  seeded(root);
  const outside = await started(t, contextFor(root, { ...worldFor(root, { env: { ORBIT_STORE_DIR: root.store } }), projectRoot: join(root.base, "outside") }));
  const refused = await outside.put("/api/v1/security/project/enabled", { enabled: [], revision: null });
  assert.deepEqual([refused.status, refused.json.error.code], [409, "NOT_IN_CHECKOUT"]);
  const api = await started(t, contextFor(root, checkoutWorld(root)));
  const enabled = await api.put("/api/v1/security/project/enabled", { enabled: [{ catalog: "asvs-5.0.0-l1", digest: catalogDigest(SHIPPED), groups: ["V8 Authorization"] }], revision: null });
  assert.equal(enabled.status, 200, enabled.text);
  const view = (await api.get("/api/v1/security/catalogs")).json;
  assert.equal(view.project.effective.by, "project");
  assert.equal(view.project.effective.catalogs[0].controls, SHIPPED.controls.filter((c) => c.group === "V8 Authorization").length);
  assert.equal((await api.put("/api/v1/security/project/not-applicable", { catalog: "asvs-5.0.0-l1", control: "v5.0.0-8.1.1", revision: view.project.revision })).status, 400, "a mark needs its reason");
  const marked = await api.put("/api/v1/security/project/not-applicable", { catalog: "asvs-5.0.0-l1", control: "v5.0.0-8.1.1", why: "the access rules live in the platform handbook", revision: view.project.revision });
  assert.equal(marked.status, 200, marked.text);
  assert.deepEqual(marked.json.saved.settings.notApplicable.map((m) => m.control), ["v5.0.0-8.1.1"]);
});

// SSRF (security review of 14d84b9): a catalog is fetched only from a PUBLIC address -- every address
// its name resolves to is checked before anything is sent, and the error never repeats the upstream.
test("a link to this machine, a private network or a metadata address is refused before anything is sent", async (t) => {
  const { root } = fixture(t);
  const link = fetching(() => ({ status: 200, text: async () => JSON.stringify(OWN) }));
  const inside = async (host) => (host === "rebind.example" ? [{ address: "93.184.215.14", family: 4 }, { address: "10.0.0.5", family: 4 }] : [{ address: "192.168.1.20", family: 4 }]);
  const api = await started(t, contextFor(root, checkoutWorld(root, { fetch: link.fetch, lookup: inside })));
  for (const url of ["https://127.0.0.1/c.json", "https://169.254.169.254/latest/meta-data", "https://[::1]/c.json", "https://[::ffff:127.0.0.1]/c.json", "https://intranet.example/c.json", "https://rebind.example/c.json"]) {
    const got = await api.post("/api/v1/security/catalogs/preview", { url });
    assert.deepEqual([got.status, got.json.error.code], [400, "SECURITY_CATALOG_URL"], url);
  }
  assert.deepEqual(link.asked, [], "nothing was sent anywhere");
});

test("what the upstream answered is never repeated in an error", async (t) => {
  const { root } = fixture(t);
  const leaky = fetching(() => ({ status: 418, text: async () => "secret internal banner" }));
  const api = await started(t, contextFor(root, checkoutWorld(root, { fetch: leaky.fetch, lookup: PUBLIC })));
  const got = await api.post("/api/v1/security/catalogs/preview", { url: "https://catalogs.example/x.json" });
  assert.equal(got.status, 503);
  assert.equal(/418|banner/.test(got.json.error.message), false);
});

test("which addresses are public: an IPv4-mapped address is held to its IPv4 rule, and NAT64 to a private one is refused", () => {
  for (const a of ["93.184.215.14", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isPublicAddress(a), true, a);
  for (const a of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "100.64.0.1", "172.16.5.4", "192.168.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "64:ff9b::a00:5", "not-an-address"]) assert.equal(isPublicAddress(a), false, a);
});
