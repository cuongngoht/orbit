// The ISOLATION PROFILE and its attestation (ADR 0038): every row is held ALONE -- one fact changed, exactly that row
// fails -- and egress is held to POSITIVE evidence: a probe that ran and said the name does not resolve and the
// address is not reached. A probe that did not run, never answered or said anything else proves nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EGRESS, NETWORK_PROFILE, PREPARED_EGRESS, PROFILE, attestation, attestedNow, egressFrom } from "../src/runtime/sandbox/isolation.mjs";
import { ISOLATION_DEFAULTS, effectivePolicy } from "../src/runtime/sandbox/policy.mjs";
import { fakeIsolation } from "./fakes/isolation.mjs";
import { fakeReach } from "./fakes/reach.mjs";
import { SHIPPED_CATALOG } from "./fakes/runtime.mjs";

const PIN = `sha256:${"a".repeat(64)}`;
const LABELS = { "orbit.task": "tsk-aaaaaaaaaaaa", "orbit.checkout": "c".repeat(64), "orbit.env": "sbx-1" };
const HOME = "/Users/someone";
const ATTEST = { network: "orbit-net", podId: null, labels: LABELS, forbidden: ["/store", HOME, "/work/shop"], pluginTarget: "/orbit" };
const DECLARED = [{ source: `${HOME}/.claude/plugins/orbit`, target: "/orbit", readOnly: true }, { source: "/store/runtime/laptop-a/x/dispatch/r1/in", target: "/work/in", readOnly: true }, { source: "/store/runtime/laptop-a/x/dispatch/r1/out", target: "/work/out", readOnly: false }];
const WORKER = { key: "worker:r1", role: "worker", mounts: DECLARED, allowedEnv: ["PATH", "HOME", "ORBIT_STORE_DIR"] };
const GOOD = { id: "c1", name: "orbit-x-worker", running: true, startedAt: "2026-10-21T10:00:00Z", image: PIN, labels: { ...LABELS, "orbit.role": "worker" }, readOnly: true, mounts: DECLARED.map((m) => ({ type: "bind", ...m })), networks: ["orbit-net"], networkMode: "orbit-net", published: [], privileged: false, devices: 0, hostNamespaces: 0, capDrop: ["ALL"], capAdd: [], securityOpt: ["no-new-privileges"], limits: { cpus: 2e9, memory: 2147483648, pids: 512 }, env: ["PATH", "ORBIT_STORE_DIR"] };
const NETWORK = { exists: true, id: "n1", internal: true, labels: LABELS, containers: [] };
const HELD = { target: { host: "example.com", port: 443, address: "93.184.215.14" }, byName: { ran: true, resolution: "FAILED", transport: "NOT_ATTEMPTED" }, byAddress: { ran: true, resolution: "RESOLVED", transport: "UNREACHABLE" } };

// `egress` is taken as given when named -- undefined included -- so a test can hand exactly what a caller might.
const attested = (over = {}) => attestation({ containers: [{ node: over.node ?? WORKER, facts: "facts" in over ? over.facts : GOOD }], network: over.network ?? NETWORK, egress: "egress" in over ? over.egress : HELD, attest: ATTEST });
const failedIds = (r) => r.failed.map((row) => row.id);

test("a worker that is what it was asked to be holds every row: its profile, the network's, and egress", () => {
  const r = attested();
  assert.equal(r.ok, true, r.failed.map((x) => x.id).join());
  assert.deepEqual(r.rows.map((x) => x.id), [...PROFILE.map((x) => x.id), ...NETWORK_PROFILE.map((x) => x.id), EGRESS.id]);
});

// One fact at a time, and only its row fails.
const ALONE = [
  ["ROOT_READ_ONLY", { facts: { ...GOOD, readOnly: false } }],
  ["NO_FORBIDDEN_MOUNT", { node: { ...WORKER, mounts: [...DECLARED, { source: "/store", target: "/s", readOnly: true }] }, facts: { ...GOOD, mounts: [...GOOD.mounts, { type: "bind", source: "/store", target: "/s", readOnly: true }] } }],
  ["NO_FORBIDDEN_MOUNT", { node: { ...WORKER, mounts: [...DECLARED, { source: "/var/run/docker.sock", target: "/d", readOnly: true }] }, facts: { ...GOOD, mounts: [...GOOD.mounts, { type: "bind", source: "/var/run/docker.sock", target: "/d", readOnly: true }] } }],
  ["ONLY_DECLARED_MOUNTS", { facts: { ...GOOD, mounts: [...GOOD.mounts, { type: "bind", source: "/opt/data", target: "/data", readOnly: true }] } }],
  ["PLUGIN_READ_ONLY", { node: { ...WORKER, mounts: DECLARED.map((m) => (m.target === "/orbit" ? { ...m, readOnly: false } : m)) }, facts: { ...GOOD, mounts: GOOD.mounts.map((m) => (m.target === "/orbit" ? { ...m, readOnly: false } : m)) } }],
  ["ONLY_TASK_NETWORK", { facts: { ...GOOD, networks: ["orbit-net", "bridge"] } }],
  ["NO_PUBLISHED_PORTS", { facts: { ...GOOD, published: ["8080/tcp"] } }],
  ["NOT_PRIVILEGED", { facts: { ...GOOD, privileged: true } }],
  ["NOT_PRIVILEGED", { facts: { ...GOOD, hostNamespaces: 1 } }],
  ["CAPABILITIES_DROPPED", { facts: { ...GOOD, capAdd: ["NET_ADMIN"] } }],
  ["NO_NEW_PRIVILEGES", { facts: { ...GOOD, securityOpt: [] } }],
  ["LIMITED", { facts: { ...GOOD, limits: { ...GOOD.limits, pids: 0 } } }],
  ["ENV_ALLOWED", { facts: { ...GOOD, env: [...GOOD.env, "UNDECLARED"] } }],
  ["LABELLED", { facts: { ...GOOD, labels: { "orbit.role": "worker" } } }],
  ["NETWORK_INTERNAL", { network: { ...NETWORK, internal: false } }],
  ["NETWORK_LABELLED", { network: { ...NETWORK, labels: {} } }],
];

test("each row of the profile is held alone: one fact changed, exactly that row fails", () => {
  for (const [id, over] of ALONE) assert.deepEqual(failedIds(attested(over)), [id], id);
  assert.deepEqual(failedIds(attested({ facts: null })), PROFILE.filter((r) => r.roles.includes("worker")).map((r) => r.id), "a container that is not there holds nothing");
});

test("a mount under this machine's home or Orbit's store is allowed only when the engine declared it -- never undeclared, never the root itself", () => {
  const stray = { type: "bind", source: `${HOME}/.ssh`, target: "/ssh", readOnly: true };
  assert.deepEqual(failedIds(attested({ facts: { ...GOOD, mounts: [...GOOD.mounts, stray] } })), ["NO_FORBIDDEN_MOUNT", "ONLY_DECLARED_MOUNTS"]);
  assert.equal(attested().ok, true, "the plugin under HOME and the run's rooms under the store are the engine's own, declared");
});

test("which kinds of container a row holds: a service keeps its image's capabilities and a writable root; a component drops capabilities", () => {
  const roles = (role) => PROFILE.filter((r) => r.roles.includes(role)).map((r) => r.id);
  assert.deepEqual(roles("service").includes("CAPABILITIES_DROPPED") || roles("service").includes("ROOT_READ_ONLY"), false);
  assert.deepEqual([roles("component").includes("CAPABILITIES_DROPPED"), roles("component").includes("ROOT_READ_ONLY")], [true, false]);
  assert.deepEqual(PROFILE.filter((r) => r.id === "PLUGIN_READ_ONLY").flatMap((r) => r.roles), ["worker"]);
});

// Every way the egress evidence can fall short of positive, and the sentence it fails with.
const SHORT = [
  [null, /nothing could be asked/],
  [undefined, /nothing could be asked/],
  [{}, /nothing could be asked/],
  [{ ...HELD, byName: { ran: false, because: "the probe did not run to its end: exit 125" } }, /could not be looked up from inside: the probe did not run/],
  [{ ...HELD, byName: { ran: true, resolution: "UNKNOWN", transport: "NOT_ATTEMPTED" } }, /gave no answer from inside, which proves nothing/],
  [{ ...HELD, byName: { ran: true, resolution: "RESOLVED", transport: "UNREACHABLE" } }, /example\.com resolves from inside/],
  [{ ...HELD, byAddress: { ran: false, because: "no address outside could be named" } }, /nothing outside was tried from inside: no address/],
  [{ ...HELD, byAddress: { ran: true, resolution: "RESOLVED", transport: "REACHABLE" } }, /93\.184\.215\.14:443 is reached from inside/],
  [{ ...HELD, byAddress: { ran: true, resolution: "RESOLVED", transport: "NOT_ATTEMPTED" } }, /was not attempted from inside .* which proves nothing/],
  [{ ...HELD, byAddress: { ran: true, resolution: "UNKNOWN", transport: "UNREACHABLE" } }, /was not attempted from inside/],
];

test("egress holds only on positive evidence: the name refused by a resolver that answered, the address tried and not reached", () => {
  assert.equal(EGRESS.holds(HELD), true);
  assert.match(EGRESS.say(HELD), /from inside, example\.com does not resolve and 93\.184\.215\.14:443 is not reached/);
  for (const [evidence, said] of SHORT) {
    const r = attested({ egress: evidence });
    assert.deepEqual(failedIds(r), ["EGRESS_BLOCKED"], JSON.stringify(evidence));
    assert.match(r.failed[0].say, said);
  }
});

test("only PREPARED_EGRESS leaves the egress row out -- what a dispatch hands, after its gate read that the preparation's row held", () => {
  assert.deepEqual(attested({ egress: PREPARED_EGRESS }).rows.map((r) => r.id).includes("EGRESS_BLOCKED"), false);
  assert.equal(attested({ egress: { prepared: true } }).ok, false, "a look-alike is evidence, and fails as evidence");
});

// ---- the evidence, asked from inside --------------------------------------------------------------------------

const TOPOLOGY = { mode: "aliases", network: { name: "orbit-net", labels: LABELS }, nodes: [] };

const placeWith = (isolation = {}) => ({ names: { envId: "sbx-1" }, paths: { workspace: "/store/workspaces/t/tree" }, catalog: SHIPPED_CATALOG, policy: effectivePolicy({ sandbox: { isolation: { ...ISOLATION_DEFAULTS, mode: "required", workerImage: PIN, ...isolation } } }).policy, attest: ATTEST, specs: [] });

const depsWith = (reachWorld) => ({ reach: fakeReach(reachWorld), now: () => Date.parse("2026-10-21T10:00:00Z") });

test("the egress name is asked as a name and the egress address as a literal, each from a hardened throwaway on the task's network", async () => {
  const iso = fakeIsolation();
  const deps = depsWith({ addresses: { "example.com": "93.184.215.14" } });
  const e = await egressFrom(iso, TOPOLOGY, placeWith(), deps);
  assert.equal(EGRESS.holds(e), true);
  assert.deepEqual(iso.state.probes.map((p) => [p.host, p.port]), [["example.com", "443"], ["93.184.215.14", "443"]]);
  const spec = iso.state.probes[0].spec;
  assert.deepEqual([spec.image, spec.network, spec.readOnly, spec.capDrop, spec.noNewPrivileges, spec.labels["orbit.role"]], [PIN, { mode: "network", name: "orbit-net", alias: null }, true, ["ALL"], true, "probe"]);
  assert.deepEqual(spec.argv.slice(-3), ["example.com", "443", "3000"], "the host, the port and the deadline are arguments of their own");
});

test("a person's literal address is tried as it is; one that says nothing about leaving -- a loopback -- is never tried", async () => {
  const iso = fakeIsolation();
  const deps = depsWith({});
  const e = await egressFrom(iso, TOPOLOGY, placeWith({ egress: { host: "example.com", port: 443, address: "198.51.100.7" } }), deps);
  assert.deepEqual([EGRESS.holds(e), deps.reach.calls.length, e.target.address], [true, 0, "198.51.100.7"]);
  const loop = await egressFrom(fakeIsolation(), TOPOLOGY, placeWith(), depsWith({ addresses: { "example.com": "127.0.0.1" } }));
  assert.deepEqual([EGRESS.holds(loop), loop.target.address], [false, null]);
  assert.match(EGRESS.say(loop), /no address outside could be named to try: this machine did not resolve example\.com to one, and no person set sandbox\.isolation\.egress\.address/);
  const offline = await egressFrom(fakeIsolation(), TOPOLOGY, placeWith(), depsWith({ dns: { "example.com": false } }));
  assert.equal(EGRESS.holds(offline), false, "a machine that cannot name an address cannot prove anything about one");
});

test("a probe that did not run, or said something outside its vocabulary, is no answer -- and with no worker image nothing is asked at all", async () => {
  const deps = () => depsWith({ addresses: { "example.com": "93.184.215.14" } });
  const unrun = await egressFrom(fakeIsolation({ probe: () => ({ ok: false, status: 125, out: "", error: "Unable to find image" }) }), TOPOLOGY, placeWith(), deps());
  assert.deepEqual([unrun.byName.ran, unrun.byAddress.ran, EGRESS.holds(unrun)], [false, false, false]);
  assert.match(unrun.byName.because, /did not run to its end: Unable to find image/);
  const babble = await egressFrom(fakeIsolation({ probe: () => "YES NO" }), TOPOLOGY, placeWith(), deps());
  assert.deepEqual([babble.byName.ran, EGRESS.holds(babble)], [false, false]);
  const exitedLying = await egressFrom(fakeIsolation({ probe: () => ({ ok: false, status: 1, out: "FAILED NOT_ATTEMPTED\n" }) }), TOPOLOGY, placeWith(), deps());
  assert.equal(EGRESS.holds(exitedLying), false, "the right words from a probe that did not end well are not its answer");
  const iso = fakeIsolation();
  const none = await egressFrom(iso, TOPOLOGY, placeWith({ workerImage: null }), deps());
  assert.deepEqual([EGRESS.holds(none), iso.state.probes.length], [false, 0]);
});

test("attested NOW: the containers this sandbox runs, its network, and egress -- with the egress evidence kept for the record", async () => {
  const iso = fakeIsolation();
  iso.network.create({ name: "orbit-net", labels: LABELS });
  const ctx = { envId: "sbx-1", owner: { kind: "task", id: "tsk-aaaaaaaaaaaa" }, sessions: { list: () => [] } };
  const r = await attestedNow(ctx, iso, TOPOLOGY, placeWith(), depsWith({ addresses: { "example.com": "93.184.215.14" } }));
  assert.deepEqual([r.ok, r.egress], [true, { held: true, host: "example.com", port: 443, address: "93.184.215.14" }]);
  const resolvesInside = await attestedNow(ctx, fakeIsolation({ probe: (host) => (host === "example.com" ? "RESOLVED REACHABLE" : "RESOLVED UNREACHABLE") }), TOPOLOGY, placeWith(), depsWith({ addresses: { "example.com": "93.184.215.14" } }));
  assert.deepEqual([resolvesInside.ok, resolvesInside.egress.held], [false, false]);
});
