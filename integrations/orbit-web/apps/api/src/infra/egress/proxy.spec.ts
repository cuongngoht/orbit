// THE EGRESS PROXY: CONNECT, and plain HTTP to port 80 asked as an absolute request; only from the agent's network, only
// where the decision allows -- and never to the control plane's own host or off the public internet, whatever the
// decision says. An employee's run is held closer: ports 80 and 443, no installation-named range, its connections
// logged and counted, and its account policy's limits.
import assert from "node:assert/strict";
import { createServer, connect, type AddressInfo, type Server, type Socket } from "node:net";
import { createServer as createHttpServer, request as httpRequest, type IncomingHttpHeaders, type Server as HttpServer } from "node:http";
import { after, before, describe, test } from "node:test";
import type { NetworkLimits } from "@orbit-web/governance-core";
import { allowedPrivate, forbiddenAddress, forbiddenForEmployee, isMetadataAddress, startEgressProxy, tokenOf, type ConnectionReason, type ConnectionSink, type ConnectionVerdict, type EgressAsk, type EgressRun, type ProxyOptions } from "./proxy.js";

const listen = (server: Server | HttpServer): Promise<number> => new Promise((r) => server.listen(0, "127.0.0.1", () => r((server.address() as AddressInfo).port)));

// Sends a CONNECT and returns the proxy's status line, and whether bytes then pass both ways.
function connectThrough(proxy: number, target: string, auth?: string): Promise<{ status: string; echoed: string }> {
  return new Promise((resolve) => {
    const s = connect(proxy, "127.0.0.1");
    let data = "";
    let sent = false;
    s.on("data", (d) => {
      data += d.toString();
      if (data.includes("200 Connection Established") && !sent) {
        sent = true;
        s.write("ping");
      }
      if (sent && data.endsWith("ping")) s.end();
    });
    s.on("error", () => undefined);
    s.on("close", () => resolve({ status: data.split("\r\n")[0] ?? "", echoed: data.endsWith("ping") ? "ping" : "" }));
    s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth ? `Proxy-Authorization: Basic ${Buffer.from(`run:${auth}`).toString("base64")}\r\n` : ""}\r\n`);
  });
}

describe("the egress proxy", () => {
  let echo: Server;
  let echoPort: number;
  let proxy: HttpServer;
  let proxyPort: number;
  const asked: EgressAsk[] = [];
  before(async () => {
    echo = createServer((s) => s.pipe(s));
    echoPort = await listen(echo);
    proxy = await startEgressProxy(0, {
      decide: (ask) => {
        asked.push(ask);
        return ask.token === "good" && ask.host === "allowed.test" ? { allow: true, reason: "" } : { allow: false, reason: "not allowed" };
      },
      admit: () => true,
      resolve: async () => "127.0.0.2",
      own: new Set(["10.9.9.9"]),
    }, "127.0.0.1");
    proxyPort = (proxy.address() as AddressInfo).port;
  });
  after(() => {
    echo.close();
    proxy.close();
  });

  test("a connection the decision refuses gets a 403 and reaches nothing; the decision is asked as the run's token", async () => {
    const r = await connectThrough(proxyPort, `denied.test:${echoPort}`, "good");
    assert.match(r.status, /403/);
    assert.equal(r.echoed, "");
    assert.deepEqual(asked.at(-1), { host: "denied.test", port: echoPort, token: "good", from: "127.0.0.1" });
    const nobody = await connectThrough(proxyPort, `allowed.test:${echoPort}`);
    assert.match(nobody.status, /403/);
    assert.equal(asked.at(-1)?.token, null);
  });

  test("nothing off the public internet is reached whatever the decision: loopback, private, shared, link-local, multicast, the host's own", async () => {
    // allowed.test resolves (here) to 127.0.0.2: allowed by the decision, refused as loopback.
    const r = await connectThrough(proxyPort, `allowed.test:${echoPort}`, "good");
    assert.match(r.status, /403/);
    const own = new Set(["203.0.114.7"]);
    const refused = ["127.0.0.1", "127.9.9.9", "169.254.169.254", "0.0.0.0", "10.1.2.3", "172.17.0.1", "172.31.250.2", "192.168.65.254", "100.64.0.1", "224.0.0.1", "255.255.255.255", "::1", "::", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "fd00::1", "fe80::1", "ff02::1", "203.0.114.7", "not-an-address"];
    for (const a of refused) assert.equal(forbiddenAddress(a, own), true, a);
    // An IPv4 address carried inside an IPv6 one (IPv4-compatible, NAT64, 6to4) is never reached that way.
    for (const a of ["::7f00:1", "::a9fe:a9fe", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b::5db8:d70e", "2002:7f00:1::1", "2002:5db8:d70e::1"]) assert.equal(forbiddenAddress(a, own), true, a);
    for (const a of ["160.79.104.10", "93.184.215.14", "2606:4700:4700::1111"]) assert.equal(forbiddenAddress(a, own), false, a);
    // An internal range the installation named is reachable (and still only where the decision allows); loopback never.
    const named = allowedPrivate(["10.20.0.0/16"]);
    assert.equal(forbiddenAddress("10.20.3.4", own, named), false);
    assert.equal(forbiddenAddress("10.21.3.4", own, named), true);
    assert.equal(forbiddenAddress("127.0.0.1", own, allowedPrivate(["127.0.0.0/8"])), true);
  });

  test("plain HTTP is not proxied; a garbled target is refused", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/`, { headers: { host: "example.com" } });
    assert.equal(res.status, 405);
    const garbled = await connectThrough(proxyPort, "no-port-given");
    assert.match(garbled.status, /403/);
  });

  test("the run's token is read from the proxy credential", () => {
    assert.equal(tokenOf(`Basic ${Buffer.from("run:abc").toString("base64")}`), "abc");
    assert.equal(tokenOf(undefined), null);
    assert.equal(tokenOf("Bearer abc"), null);
  });
});

test("a tunnel the decision allows carries bytes both ways", async () => {
  const echo = createServer((s) => s.pipe(s));
  const echoPort = await listen(echo);
  // The echo server is on loopback, which the proxy never reaches by default: here only, that rule is set aside.
  const proxy = await startEgressProxy(0, { decide: () => ({ allow: true, reason: "" }), admit: () => true, resolve: async () => "127.0.0.1", forbidden: () => false }, "127.0.0.1");
  try {
    const r = await connectThrough((proxy.address() as AddressInfo).port, `partner.test:${echoPort}`, "t");
    assert.match(r.status, /200 Connection Established/);
    assert.equal(r.echoed, "ping");
  } finally {
    echo.close();
    proxy.close();
  }
});

test("a connection from outside the agent's network is dropped unanswered", async () => {
  const proxy = await startEgressProxy(0, { decide: () => ({ allow: true, reason: "" }), admit: () => false }, "127.0.0.1");
  try {
    const r = await connectThrough((proxy.address() as AddressInfo).port, "example.com:443", "t");
    assert.equal(r.status, "");
  } finally {
    proxy.close();
  }
});

// ---- an employee's run, plain HTTP, counting and limits -----------------------------------------------------------

const basic = (token: string): string => `Basic ${Buffer.from(`run:${token}`).toString("base64")}`;

const employeeRun = (limits: NetworkLimits | null = null, id = "run-1", accountId = "acc-1"): EgressRun => ({ id, accountId, employee: true, limits });
const chatRun = (id = "chat-run"): EgressRun => ({ id, accountId: "acc-1", employee: false, limits: null });

interface Entry {
  id: string;
  run: string;
  target: string;
  verdict: ConnectionVerdict;
  reason: ConnectionReason | null;
  bytesIn?: number;
  bytesOut?: number;
  cut?: string | null;
}

// A sink that keeps what it is told, as the run's network log would.
class MemorySink implements ConnectionSink {
  readonly entries: Entry[] = [];
  downloaded = 0;
  failing: "allowed" | "all" | null = null;

  async opened(run: EgressRun, host: string, port: number, verdict: ConnectionVerdict, reason: ConnectionReason | null): Promise<string | null> {
    if (this.failing === "all" || (this.failing === "allowed" && verdict === "allowed")) throw new Error("the log cannot be written");
    const id = String(this.entries.length + 1);
    this.entries.push({ id, run: run.id, target: `${host}:${port}`, verdict, reason });
    return id;
  }

  async closed(id: string, bytesIn: number, bytesOut: number, cut: string | null): Promise<void> {
    Object.assign(this.entries.find((e) => e.id === id) as Entry, { bytesIn, bytesOut, cut });
  }

  async downloadedSince(): Promise<number> {
    return this.downloaded;
  }
}

async function until(check: () => boolean, what: string, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`waited ${ms} ms for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface Tunnel {
  status: string;
  socket: Socket;
  first: Buffer;
}

// A CONNECT through the proxy: its status line and, for a tunnel, the socket and what came after the headers.
function openTunnel(proxy: number, target: string, token?: string): Promise<Tunnel> {
  return new Promise((resolve, reject) => {
    const s = connect(proxy, "127.0.0.1");
    let buf = Buffer.alloc(0);
    const onData = (d: Buffer): void => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf("\r\n\r\n");
      if (end === -1) return;
      s.off("data", onData);
      s.pause();
      resolve({ status: buf.subarray(0, buf.indexOf("\r\n")).toString(), socket: s, first: buf.subarray(end + 4) });
    };
    s.on("data", onData);
    s.on("error", reject);
    s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${token ? `Proxy-Authorization: ${basic(token)}\r\n` : ""}\r\n`);
  });
}

// Everything that still arrives on a tunnel, until it ends.
function drain(t: Tunnel): Promise<Buffer> {
  return new Promise((resolve) => {
    const parts = [t.first];
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(parts));
    };
    t.socket.on("data", (d: Buffer) => parts.push(d));
    t.socket.on("end", finish);
    t.socket.on("close", finish);
    t.socket.on("error", finish);
    t.socket.resume();
  });
}

interface Running {
  port: number;
  dials: string[];
  asked: EgressAsk[];
  sink: MemorySink;
  close: () => Promise<void>;
}

// A proxy whose every dial lands on `upstream` (a server of the test on loopback), saying which address it was given.
async function proxyWith(upstream: number, o: Partial<ProxyOptions> & Pick<ProxyOptions, "decide">): Promise<Running> {
  const dials: string[] = [];
  const asked: EgressAsk[] = [];
  const sink = (o.sink as MemorySink | undefined) ?? new MemorySink();
  const server = await startEgressProxy(
    0,
    {
      admit: () => true,
      resolve: async () => "93.184.215.14",
      own: new Set(),
      dial: (address, port) => {
        dials.push(`${address}:${port}`);
        return connect({ host: "127.0.0.1", port: upstream });
      },
      ...o,
      sink,
      decide: (ask) => {
        asked.push(ask);
        return o.decide(ask);
      },
    },
    "127.0.0.1",
  );
  return { port: (server.address() as AddressInfo).port, dials, asked, sink, close: () => new Promise((r) => server.close(() => r())) };
}

// A server that sends `n` bytes to each connection and then ends it, keeping count of what it was sent.
async function sender(n: number): Promise<{ port: number; received: () => number; close: () => void }> {
  let received = 0;
  const server = createServer((s) => {
    s.on("data", (d: Buffer) => void (received += d.length));
    s.on("error", () => undefined);
    s.end(Buffer.alloc(n, 0x61));
  });
  const port = await listen(server);
  return { port, received: () => received, close: () => server.close() };
}

// A server that holds every connection open until the test lets it go.
async function holder(): Promise<{ port: number; release: () => void; close: () => void }> {
  const held: Socket[] = [];
  const server = createServer((s) => {
    s.on("error", () => undefined);
    held.push(s);
  });
  const port = await listen(server);
  return { port, release: () => held.splice(0).forEach((s) => s.destroy()), close: () => server.close() };
}

const allowAs = (run: EgressRun | null) => () => ({ allow: true, reason: "", run });

describe("plain HTTP through the proxy", () => {
  let web: HttpServer;
  let webPort: number;
  let proxy: Running;
  const seen: { method: string; url: string; headers: IncomingHttpHeaders; body: string }[] = [];

  before(async () => {
    web = createHttpServer((req, res) => {
      const parts: Buffer[] = [];
      req.on("data", (d: Buffer) => parts.push(d));
      req.on("end", () => {
        const body = Buffer.concat(parts).toString();
        seen.push({ method: String(req.method), url: String(req.url), headers: req.headers, body });
        if (req.url === "/redirect") res.writeHead(302, { location: "http://elsewhere.test/landing" }).end();
        else res.writeHead(200, { "content-type": "text/plain", "x-upstream": "yes" }).end(req.method === "POST" ? `echo:${body}` : "hello");
      });
    });
    webPort = await listen(web);
    proxy = await proxyWith(webPort, { decide: allowAs(employeeRun()) });
  });
  after(async () => {
    web.close();
    await proxy.close();
  });

  const send = (path: string, o: { method?: string; body?: string; headers?: Record<string, string>; port?: number } = {}): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> =>
    new Promise((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port: o.port ?? proxy.port, method: o.method ?? "GET", path, headers: { "proxy-authorization": basic("tok"), "proxy-connection": "keep-alive", ...(o.headers ?? {}) } }, (res) => {
        const parts: Buffer[] = [];
        res.on("data", (d: Buffer) => parts.push(d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts).toString() }));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end(o.body);
    });

  test("an absolute http:// request is decided as the run, resolved once, and forwarded to exactly that address -- without the run's token", async () => {
    const r = await send("http://web.test/page?x=1", { headers: { host: "web.test" } });
    assert.deepEqual([r.status, r.body, r.headers["x-upstream"]], [200, "hello", "yes"]);
    assert.deepEqual(proxy.asked.at(-1), { host: "web.test", port: 80, token: "tok", from: "127.0.0.1" });
    assert.deepEqual(proxy.dials, ["93.184.215.14:80"]);
    const got = seen.at(-1);
    assert.deepEqual([got?.method, got?.url, got?.headers.host], ["GET", "/page?x=1", "web.test"]);
    assert.equal(got?.headers["proxy-authorization"], undefined, "the run's token never leaves the proxy");
    assert.equal(got?.headers["proxy-connection"], undefined);
    await until(() => proxy.sink.entries.at(-1)?.bytesIn !== undefined, "the end of the request");
    assert.deepEqual(proxy.sink.entries.at(-1), { id: "1", run: "run-1", target: "web.test:80", verdict: "allowed", reason: null, bytesIn: 5, bytesOut: 0, cut: null });
  });

  test("a redirect is handed back as it is, never followed: following it is the client's next request, decided again", async () => {
    const before = seen.length;
    const asked = proxy.asked.length;
    const r = await send("http://web.test/redirect");
    assert.deepEqual([r.status, r.headers.location], [302, "http://elsewhere.test/landing"]);
    assert.equal(seen.length, before + 1, "the upstream was asked once");
    assert.deepEqual(proxy.asked.slice(asked).map((a) => a.host), ["web.test"], "nothing was decided for the place it points to");
  });

  test("a request's body goes up and its answer comes down, each counted", async () => {
    const r = await send("http://web.test/echo", { method: "POST", body: "twelve bytes" });
    assert.deepEqual([r.status, r.body], [200, "echo:twelve bytes"]);
    await until(() => proxy.sink.entries.at(-1)?.bytesOut === 12, "the count of the request");
    assert.deepEqual([proxy.sink.entries.at(-1)?.bytesIn, proxy.sink.entries.at(-1)?.bytesOut], [17, 12]);
  });

  test("an answer a download limit cuts short ends as a broken answer, never as one that looks whole", async () => {
    const limited = await proxyWith(webPort, { decide: allowAs(employeeRun({ downloadBytesPerRun: 3 })) });
    try {
      await assert.rejects(send("http://web.test/page", { port: limited.port }));
      await until(() => limited.sink.entries[0]?.cut !== undefined, "the cut answer's end");
      assert.deepEqual([limited.sink.entries[0]?.bytesIn, /reached 3 downloaded bytes/.test(limited.sink.entries[0]?.cut ?? "")], [3, true]);
      assert.equal((await send("http://web.test/page", { port: limited.port })).status, 429, "the next request is refused, with why");
    } finally {
      await limited.close();
    }
  });

  test("plain HTTP goes to port 80 only, and nothing but an http:// request is forwarded", async () => {
    const asked = proxy.asked.length;
    assert.equal((await send("http://web.test:8080/page")).status, 403);
    assert.equal((await send("https://web.test/page")).status, 405);
    assert.equal((await send("http://[bad/")).status, 400);
    assert.equal(proxy.asked.length, asked, "none of them was even decided");
  });
});

describe("an employee's run through the proxy", () => {
  test("it reaches ports 80 and 443 only, whatever the decision says; a chat's run is decided as before", async () => {
    const up = await sender(10);
    const p = await proxyWith(up.port, { decide: allowAs(employeeRun()) });
    const chat = await proxyWith(up.port, { decide: allowAs(chatRun()) });
    try {
      for (const target of ["web.test:8443", "web.test:22"]) assert.match((await openTunnel(p.port, target, "t")).status, /403/, target);
      assert.deepEqual(p.dials, []);
      assert.deepEqual(p.sink.entries.map((e) => [e.target, e.verdict, e.reason?.cause]), [["web.test:8443", "refused", "port"], ["web.test:22", "refused", "port"]]);
      const t = await openTunnel(p.port, "web.test:443", "t");
      assert.match(t.status, /200/);
      assert.equal((await drain(t)).length, 10);
      const c = await openTunnel(chat.port, "web.test:8443", "t");
      assert.match(c.status, /200/, "a chat's port is its policy's to decide");
      await drain(c);
    } finally {
      up.close();
      await p.close();
      await chat.close();
    }
  });

  test("a refusal of its decision is kept in its log with what the agent was told; one that cannot be kept still stands", async () => {
    const p = await proxyWith(1, { decide: () => ({ allow: false, reason: "this connection is refused: not on the allow-list", run: employeeRun() }) });
    try {
      const t = await openTunnel(p.port, "blocked.test:443", "t");
      assert.match(t.status, /403/);
      assert.match((await drain(t)).toString(), /Orbit Web governance: this connection is refused: not on the allow-list/);
      assert.deepEqual(p.sink.entries, [{ id: "1", run: "run-1", target: "blocked.test:443", verdict: "refused", reason: { cause: "policy", message: "this connection is refused: not on the allow-list" } }]);
      p.sink.failing = "all";
      assert.match((await openTunnel(p.port, "blocked.test:443", "t")).status, /403/);
    } finally {
      await p.close();
    }
  });

  test("a connection that cannot be recorded is not made", async () => {
    const up = await sender(10);
    const sink = new MemorySink();
    sink.failing = "allowed";
    const p = await proxyWith(up.port, { decide: allowAs(employeeRun()), sink });
    try {
      const t = await openTunnel(p.port, "web.test:443", "t");
      assert.match(t.status, /502/);
      assert.match((await drain(t)).toString(), /could not be recorded, so it is not made/);
      assert.deepEqual(p.dials, []);
    } finally {
      up.close();
      await p.close();
    }
  });

  test("every connection is counted both ways and its end said once", async () => {
    // It answers once it has read the whole request: 1000 bytes up, then 4096 down.
    let received = 0;
    const upServer = createServer((s) => {
      s.on("error", () => undefined);
      s.on("data", (d: Buffer) => {
        received += d.length;
        if (received >= 1000) s.end(Buffer.alloc(4096, 0x61));
      });
    });
    const upPort = await listen(upServer);
    const p = await proxyWith(upPort, { decide: allowAs(employeeRun()) });
    try {
      const t = await openTunnel(p.port, "web.test:443", "t");
      t.socket.write(Buffer.alloc(1000, 0x62));
      assert.equal((await drain(t)).length, 4096);
      await until(() => p.sink.entries[0]?.bytesIn !== undefined, "the connection's end");
      assert.equal(received, 1000);
      assert.deepEqual(p.sink.entries, [{ id: "1", run: "run-1", target: "web.test:443", verdict: "allowed", reason: null, bytesIn: 4096, bytesOut: 1000, cut: null }]);
    } finally {
      upServer.close();
      await p.close();
    }
  });

  test("its downloads stop at its run's limit, exactly, and the next connection is refused with why", async () => {
    const up = await sender(5000);
    const p = await proxyWith(up.port, { decide: allowAs(employeeRun({ downloadBytesPerRun: 1000 })) });
    try {
      const t = await openTunnel(p.port, "files.test:443", "t");
      assert.equal((await drain(t)).length, 1000, "cut where the limit is");
      await until(() => p.sink.entries[0]?.cut !== undefined, "the cut connection's end");
      assert.equal(p.sink.entries[0]?.bytesIn, 1000);
      assert.match(p.sink.entries[0]?.cut ?? "", /reached 1000 downloaded bytes/);
      const next = await openTunnel(p.port, "files.test:443", "t");
      assert.match(next.status, /429 Too Many Requests/);
      assert.match((await drain(next)).toString(), /this run has downloaded 1000 bytes/);
      assert.deepEqual([p.sink.entries[1]?.verdict, p.sink.entries[1]?.reason?.cause], ["limited", "limit"]);
    } finally {
      up.close();
      await p.close();
    }
  });

  test("the account's day is shared by its runs and starts from what was recorded before", async () => {
    const up = await sender(5000);
    const sink = new MemorySink();
    sink.downloaded = 1000;
    const runs = [employeeRun({ downloadBytesPerDay: 1500 }, "run-a"), employeeRun({ downloadBytesPerDay: 1500 }, "run-b")];
    const p = await proxyWith(up.port, { decide: (ask) => ({ allow: true, reason: "", run: ask.token === "a" ? runs[0] : runs[1] }), sink });
    try {
      assert.equal((await drain(await openTunnel(p.port, "files.test:443", "a"))).length, 500, "1000 of the day were downloaded before this process");
      assert.match((await openTunnel(p.port, "files.test:443", "b")).status, /429/, "another run of the account finds the day spent");
    } finally {
      up.close();
      await p.close();
    }
  });

  test("its open connections are held to its policy's limit, and every run to the installation's cap", async () => {
    const up = await holder();
    const p = await proxyWith(up.port, { decide: allowAs(employeeRun({ concurrentConnectionsPerRun: 1 })) });
    const chat = await proxyWith(up.port, { decide: allowAs(chatRun()), maxConnectionsPerRun: 2 });
    try {
      const a = await openTunnel(p.port, "web.test:443", "t");
      assert.match(a.status, /200/);
      const b = await openTunnel(p.port, "web.test:443", "t");
      assert.match(b.status, /429/);
      assert.match((await drain(b)).toString(), /its account's policy allows at most 1 at once/);
      a.socket.destroy();
      await until(() => p.sink.entries[0]?.bytesIn !== undefined, "the first connection's end");
      const c = await openTunnel(p.port, "web.test:443", "t");
      assert.match(c.status, /200/, "a place given back is taken again");
      c.socket.destroy();

      const held = [await openTunnel(chat.port, "web.test:443", "t"), await openTunnel(chat.port, "web.test:443", "t")];
      assert.deepEqual(held.map((h) => h.status.includes("200")), [true, true]);
      const over = await openTunnel(chat.port, "web.test:443", "t");
      assert.match(over.status, /429/);
      assert.match((await drain(over)).toString(), /the installation allows at most 2 at once/);
      held.forEach((h) => h.socket.destroy());
    } finally {
      up.release();
      up.close();
      await p.close();
      await chat.close();
    }
  });

  test("connections a minute are counted over the last sixty seconds", async () => {
    const up = await sender(1);
    let now = Date.parse("2026-11-21T10:00:00.000Z");
    const p = await proxyWith(up.port, { decide: allowAs(employeeRun({ connectionsPerMinutePerRun: 2 })), now: () => now });
    try {
      for (let i = 0; i < 2; i++) await drain(await openTunnel(p.port, "web.test:443", "t"));
      const third = await openTunnel(p.port, "web.test:443", "t");
      assert.match(third.status, /429/);
      assert.match((await drain(third)).toString(), /opened 2 connections in the last minute/);
      now += 61_000;
      const fourth = await openTunnel(p.port, "web.test:443", "t");
      assert.match(fourth.status, /200/);
      await drain(fourth);
    } finally {
      up.close();
      await p.close();
    }
  });

  test("its bandwidth is throttled to its policy's rate", async () => {
    const up = await sender(200_000);
    const p = await proxyWith(up.port, { decide: allowAs(employeeRun({ bandwidthMbpsPerRun: 1 })) });
    try {
      const started = Date.now();
      assert.equal((await drain(await openTunnel(p.port, "files.test:443", "t"))).length, 200_000);
      const took = Date.now() - started;
      // 1 Mbit/s is 125 000 bytes a second, one second's worth at once: the other 75 000 bytes take 600 ms at least.
      assert.ok(took >= 500, `it took ${took} ms`);
    } finally {
      up.close();
      await p.close();
    }
  });
});

describe("addresses no run reaches", () => {
  test("the cloud metadata service: never, whatever the decision, the run or the installation's named ranges", async () => {
    const named = allowedPrivate(["169.254.0.0/16", "100.64.0.0/10"]);
    const own = new Set<string>();
    for (const a of ["169.254.169.254", "169.254.170.2", "100.100.100.200", "fd00:ec2::254", "::ffff:169.254.169.254"]) {
      assert.equal(isMetadataAddress(a), true, a);
      assert.equal(forbiddenAddress(a, own, named), true, a);
      assert.equal(forbiddenForEmployee(a, own), true, a);
    }
    assert.equal(forbiddenAddress("169.254.10.10", own, named), false, "a named range is still a chat's to reach, the metadata service aside");
    for (const run of [chatRun(), employeeRun()]) {
      const p = await proxyWith(1, { decide: allowAs(run), resolve: async () => "169.254.169.254", privateAllowed: named });
      try {
        const t = await openTunnel(p.port, "metadata.google.internal:80", "t");
        assert.match(t.status, /403/);
        assert.match((await drain(t)).toString(), /the cloud metadata service/);
        assert.deepEqual(p.dials, []);
      } finally {
        await p.close();
      }
    }
  });

  test("an installation's named internal range is a chat's, never an employee's; an IPv4-mapped address is never an employee's", async () => {
    const own = new Set<string>();
    const named = allowedPrivate(["10.20.0.0/16"]);
    assert.equal(forbiddenAddress("10.20.3.4", own, named), false);
    assert.equal(forbiddenForEmployee("10.20.3.4", own), true);
    for (const a of ["::ffff:93.184.215.14", "::ffff:5db8:d70e", "0:0:0:0:0:ffff:5db8:d70e"]) assert.equal(forbiddenForEmployee(a, own), true, a);
    assert.equal(forbiddenAddress("::ffff:93.184.215.14", own), false, "a chat's connection is held to the IPv4 address inside, as before");
    for (const a of ["93.184.215.14", "2606:4700:4700::1111"]) assert.equal(forbiddenForEmployee(a, own), false, a);
    for (const a of ["127.0.0.1", "10.0.0.1", "172.16.5.4", "192.168.1.1", "100.64.0.1", "169.254.1.1", "fd12::1", "fe80::1", "::1", "0:0:0:0:0:ffff:7f00:1"]) assert.equal(forbiddenForEmployee(a, own), true, a);

    const up = await sender(3);
    const employee = await proxyWith(up.port, { decide: allowAs(employeeRun()), resolve: async () => "10.20.3.4", privateAllowed: named });
    const chat = await proxyWith(up.port, { decide: allowAs(chatRun()), resolve: async () => "10.20.3.4", privateAllowed: named });
    try {
      const refused = await openTunnel(employee.port, "intranet.corp:443", "t");
      assert.match(refused.status, /403/);
      assert.match((await drain(refused)).toString(), /resolves to 10\.20\.3\.4, which is not on the public internet/);
      assert.deepEqual(employee.dials, []);
      assert.deepEqual(employee.sink.entries.map((e) => [e.verdict, e.reason?.cause, e.reason?.address]), [["refused", "address", "10.20.3.4"]]);
      const reached = await openTunnel(chat.port, "intranet.corp:443", "t");
      assert.match(reached.status, /200/);
      await drain(reached);
      assert.deepEqual(chat.dials, ["10.20.3.4:443"]);
    } finally {
      up.close();
      await employee.close();
      await chat.close();
    }
  });

  test("a name that answers otherwise the next time is resolved once a connection, and only the address checked is dialed", async () => {
    const up = await sender(2);
    const answers = ["93.184.215.14", "127.0.0.1", "93.184.215.14"];
    let resolved = 0;
    const p = await proxyWith(up.port, {
      decide: allowAs(employeeRun()),
      resolve: async () => answers[resolved++ % answers.length] as string,
    });
    try {
      const first = await openTunnel(p.port, "rebind.test:443", "t");
      assert.match(first.status, /200/);
      await drain(first);
      assert.deepEqual([resolved, p.dials], [1, ["93.184.215.14:443"]]);
      const second = await openTunnel(p.port, "rebind.test:443", "t");
      assert.match(second.status, /403/);
      assert.match((await drain(second)).toString(), /resolves to 127\.0\.0\.1/);
      assert.deepEqual([resolved, p.dials], [2, ["93.184.215.14:443"]], "asked once, and the answer that failed was never dialed");
      const third = await openTunnel(p.port, "rebind.test:80", "t");
      assert.match(third.status, /200/);
      await drain(third);
      assert.deepEqual([resolved, p.dials.at(-1)], [3, "93.184.215.14:80"]);
    } finally {
      up.close();
      await p.close();
    }
  });
});
