// Whether the application an approved environment names is what this checkout's own runtime
// declares -- and whether anything answers there. The runtime's news for an investigation, never
// a verdict about the product.
import { test } from "node:test";
import assert from "node:assert/strict";
import { declaring, loopbackPort, loopbackWhere, originOf } from "../src/runtime/origin.mjs";
import { fakeProbe } from "./fakes/probe.mjs";
import { NODE_AND_DOTNET, UNKNOWN_STACK, viewOf } from "./fakes/runtime.mjs";

const view = () => viewOf(NODE_AND_DOTNET);

test("only an origin on this machine has a port the runtime may speak about", () => {
  assert.equal(loopbackPort("http://localhost:5000"), 5000);
  assert.equal(loopbackPort("http://127.0.0.1:5173/app"), 5173);
  assert.equal(loopbackPort("http://[::1]:3000"), 3000);
  assert.equal(loopbackPort("http://localhost"), 80, "a default port is still a port");
  assert.equal(loopbackPort("https://localhost"), 443);
  for (const elsewhere of ["https://app.example.test", "http://192.168.1.4:5000", "not a url", "", null, undefined]) assert.equal(loopbackPort(elsewhere), null, String(elsewhere));
});

test("a component is the one that declares the port, or there is none", () => {
  assert.equal(declaring(view(), 5000).key, "dotnet:api");
  assert.equal(declaring(view(), 9999), null);
});

test("a declared port nothing answers on is the runtime's news, with the component and what starts it", async () => {
  const probe = fakeProbe();
  const out = await originOf({ view: view(), probe }, "http://localhost:5000");
  assert.deepEqual([out.component, out.port, out.served], ["dotnet:api", 5000, false]);
  assert.match(out.next, /runtime start --component=dotnet:api/);
  assert.deepEqual(probe.calls.map((c) => [c.kind, c.port]), [["tcp", 5000]], "one connection to one port, and nothing else");
});

test("the same port answering is served: nothing is wrong, and the answer still says which component", async () => {
  const out = await originOf({ view: view(), probe: fakeProbe({ tcp: { 5000: true } }) }, "http://localhost:5000");
  assert.deepEqual([out.component, out.served], ["dotnet:api", true]);
});

test("silence for an origin elsewhere, a port no component declares, and a checkout nobody has understood -- and nothing is asked of the machine", async () => {
  const probe = fakeProbe();
  assert.equal(await originOf({ view: view(), probe }, "https://app.example.test"), null);
  assert.equal(await originOf({ view: view(), probe }, "http://localhost:9999"), null);
  assert.equal(await originOf({ view: viewOf({}), probe }, "http://localhost:5000"), null);
  assert.deepEqual(probe.calls, []);
});

test("a port that is only possible -- a container's exposed port -- is not enough to say nothing is where the runtime means it to be", async () => {
  const probe = fakeProbe();
  const stack = viewOf(UNKNOWN_STACK);
  assert.equal(await originOf({ view: stack, probe }, "http://localhost:8080"), null);
  assert.deepEqual(probe.calls, []);
});

test("an origin is asked as itself: an address as that address, localhost as both families", async () => {
  assert.deepEqual(loopbackWhere("http://[::1]:5000"), { host: "::1", port: 5000 });
  assert.deepEqual(loopbackWhere("http://127.0.0.1:5000/x"), { host: "127.0.0.1", port: 5000 });
  assert.deepEqual(loopbackWhere("http://localhost:5000"), { host: "localhost", port: 5000 });
  assert.equal(loopbackWhere("http://example.com:5000"), null);
  const asked = async (origin) => {
    const probe = fakeProbe({ tcp: { 5000: true } });
    await originOf({ view: view(), probe }, origin);
    return probe.calls[0].opts;
  };
  assert.deepEqual(await asked("http://[::1]:5000"), { host: "::1" }, "an IPv6 origin is asked on ::1, where its server is");
  assert.deepEqual(await asked("http://127.0.0.1:5000"), { host: "127.0.0.1" });
  assert.deepEqual(await asked("http://localhost:5000"), {}, "localhost is left to the probe, which asks both");
});
