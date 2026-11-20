import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer, type AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { FetchError, fetchUrl, publicWebPolicy, type AddressPolicy } from "./url-fetcher.js";

let server: Server;
let base: string;
let port: number;
// For these tests only: this machine's loopback on the test server's port. Orbit Web's own policy never allows it.
const loopback: AddressPolicy = { allows: (address, p) => address === "127.0.0.1" && p === port };
const options = { maxBytes: 1024, timeoutMs: 5_000, policy: loopback };

before(async () => {
  server = createServer((req, res) => {
    const routes: Record<string, () => void> = {
      "/page": () => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<p>Hello</p>"),
      "/hop": () => res.writeHead(302, { location: "/page" }).end(),
      "/to-metadata": () => res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end(),
      "/loop": () => res.writeHead(301, { location: "/loop" }).end(),
      "/big": () => res.writeHead(200, { "content-type": "text/plain" }).end("x".repeat(4096)),
      "/image": () => res.writeHead(200, { "content-type": "image/png" }).end("png"),
      "/gone": () => res.writeHead(404).end(),
      "/cookie": () => res.writeHead(200, { "content-type": "text/plain" }).end(String(req.headers.cookie ?? "") + String(req.headers.authorization ?? "")),
    };
    (routes[req.url ?? ""] ?? routes["/gone"])?.();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));

test("a page is fetched as a bounded snapshot, following a redirect, with no cookie or credential sent", async () => {
  const page = await fetchUrl(`${base}/hop`, options);
  assert.equal(page.finalUrl, `${base}/page`);
  assert.equal(page.bytes.toString(), "<p>Hello</p>");
  assert.match(page.contentType ?? "", /text\/html/);
  assert.equal((await fetchUrl(`${base}/cookie`, options)).bytes.toString(), "");
});

test("every hop is held to the policy again: a redirect into the cloud's metadata address is never followed", async () => {
  await assert.rejects(fetchUrl(`${base}/to-metadata`, options), (e: Error) => e instanceof FetchError && /169\.254\.169\.254/.test(e.message));
  await assert.rejects(fetchUrl(`${base}/loop`, options), /redirected more than five times/);
});

test("a page too large, of a type research does not read, or answering an error, fails with why", async () => {
  await assert.rejects(fetchUrl(`${base}/big`, options), /larger than research reads/);
  await assert.rejects(fetchUrl(`${base}/image`, options), /image\/png, which research does not read/);
  await assert.rejects(fetchUrl(`${base}/gone`, options), /HTTP 404/);
  await assert.rejects(fetchUrl(`http://user:secret@127.0.0.1:${port}/page`, options), /user name or password/);
  await assert.rejects(fetchUrl("ftp://example.com/x", options), /Only http and https/);
});

test("Orbit Web's own policy: the public internet on ports 80 and 443 -- never loopback, link-local, private or this host", async () => {
  const policy = publicWebPolicy();
  for (const [address, p] of [["127.0.0.1", 80], ["169.254.169.254", 80], ["10.1.2.3", 443], ["172.16.0.9", 443], ["192.168.1.1", 80], ["100.64.0.1", 80], ["0.0.0.0", 80], ["::1", 443], ["fe80::1", 443], ["fd00::1", 443], ["::ffff:127.0.0.1", 80]] as const) assert.equal(policy.allows(address, p), false, `${address}:${p}`);
  assert.equal(policy.allows("93.184.215.14", 443), true);
  assert.equal(policy.allows("93.184.215.14", 8080), false, "only the web's own ports");
  await assert.rejects(fetchUrl(`${base}/page`, { ...options, policy }), (e: Error) => e instanceof FetchError && /never fetches it/.test(e.message));
});

test("a name is checked by every address it resolves to, and the connection goes to the one checked (no second lookup)", async () => {
  const twoFaced = (host: string) => Promise.resolve(host === "rebind.example" ? ["93.184.215.14", "10.0.0.5"] : []);
  await assert.rejects(fetchUrl("https://rebind.example/a", { ...options, policy: publicWebPolicy(), resolve: twoFaced }), /10\.0\.0\.5/);
  let lookups = 0;
  const once = (host: string) => {
    lookups += 1;
    return Promise.resolve(host === "docs.local.test" ? ["127.0.0.1"] : []);
  };
  const page = await fetchUrl(`http://docs.local.test:${port}/page`, { ...options, resolve: once });
  assert.equal(page.bytes.toString(), "<p>Hello</p>");
  assert.equal(lookups, 1, "resolved once, by the check; the connection used that answer");
  await assert.rejects(fetchUrl("https://nowhere.invalid/", { ...options, resolve: () => Promise.reject(new Error("ENOTFOUND")) }), /does not resolve/);
});

test("an IPv6 address that carries an IPv4 one (NAT64, 6to4, IPv4-compatible) is never reached", async () => {
  const policy = publicWebPolicy();
  for (const address of ["64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "2002:a00:1::1", "::a9fe:a9fe"]) assert.equal(policy.allows(address, 443), false, address);
  await assert.rejects(fetchUrl("https://nat64.example/", { ...options, policy, resolve: () => Promise.resolve(["64:ff9b::a9fe:a9fe"]) }), /never fetches it/);
});

test("the deadline is absolute: a server that sends its answer's head a byte at a time is cut off when the time is up", async () => {
  const drip = createTcpServer((socket) => {
    socket.write("HTTP/1.1 200 OK\r\n");
    const timer = setInterval(() => socket.write("X"), 50);
    socket.on("close", () => clearInterval(timer));
    socket.on("error", () => clearInterval(timer));
  });
  await new Promise<void>((r) => drip.listen(0, "127.0.0.1", r));
  const dripPort = (drip.address() as AddressInfo).port;
  const started = Date.now();
  try {
    await assert.rejects(fetchUrl(`http://127.0.0.1:${dripPort}/`, { maxBytes: 1024, timeoutMs: 400, policy: { allows: (a, p) => a === "127.0.0.1" && p === dripPort } }), /took too long/);
    assert.ok(Date.now() - started < 2_000, `stopped at its deadline (${Date.now() - started} ms)`);
  } finally {
    drip.close();
  }
});
