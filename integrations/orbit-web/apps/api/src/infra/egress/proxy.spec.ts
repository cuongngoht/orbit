// THE EGRESS PROXY: only CONNECT, only from the agent's network, only where the decision allows -- and never to the
// control plane's own host, whatever the decision says.
import assert from "node:assert/strict";
import { createServer, connect, type AddressInfo, type Server } from "node:net";
import type { Server as HttpServer } from "node:http";
import { after, before, describe, test } from "node:test";
import { forbiddenAddress, startEgressProxy, tokenOf, type EgressAsk } from "./proxy.js";

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

  test("loopback, link-local and the control plane's own addresses are refused whatever the decision", async () => {
    // allowed.test resolves (here) to 127.0.0.2: allowed by the decision, refused as loopback.
    const r = await connectThrough(proxyPort, `allowed.test:${echoPort}`, "good");
    assert.match(r.status, /403/);
    for (const a of ["127.0.0.1", "127.9.9.9", "169.254.169.254", "0.0.0.0", "::1", "::ffff:127.0.0.1", "10.9.9.9"]) assert.equal(forbiddenAddress(a, new Set(["10.9.9.9"])), true, a);
    for (const a of ["160.79.104.10", "93.184.215.14"]) assert.equal(forbiddenAddress(a, new Set(["10.9.9.9"])), false, a);
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
