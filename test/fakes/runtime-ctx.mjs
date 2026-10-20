// A runtime context for the tests: every port a runtime command talks through,
// bound to a fake, over one in-memory machine store.
//
// What a test varies is the REPOSITORY (`files`, edited between calls with
// `source.write`, which moves exactly the scopes that contain the file, as a
// commit does), the working tree (`tree`), the machine (`world`: which tools
// answer with which version), and the processes and sockets (`process`, `probe`).
// What it never has to build is the plumbing -- the checkout's rooms, the guarded
// io, the catalog -- so a test reads as the scenario it is.
import { builtinEcosystems } from "../../src/ecosystems/builtin.mjs";
import { durableRoom, instancesRoom, liveRoom, proposalsRoom, settingsFile, understandingRoom } from "../../src/runtime/rooms.mjs";
import { createRuntimeStore } from "../../src/runtime/store.mjs";
import { createInstances } from "../../src/runtime/instances.mjs";
import { createProposals } from "../../src/runtime/proposal.mjs";
import { createSessions } from "../../src/runtime/sessions.mjs";
import { PROVIDERS } from "../../src/runtime/providers/index.mjs";
import { readSettings, writeSettings } from "../../src/runtime/settings.mjs";
import { instanceId } from "../../src/runtime/instances.mjs";
import { createRegistry } from "../../src/store/registry.mjs";
import { stateRooms } from "../../src/store/control.mjs";
import { fakeMachine } from "./machine.mjs";
import { fakeIo } from "./io.mjs";
import { fakeProbe } from "./probe.mjs";
import { fakeReach } from "./reach.mjs";
import { createObservations } from "../../src/runtime/connectivity/observations.mjs";
import { fakeProcess } from "./process.mjs";
import { SHIPPED_CATALOG } from "./runtime.mjs";
import { memorySource } from "./source.mjs";
import { fakeWorktree } from "./worktree.mjs";

export const STORE_ROOT = "/store/repo-aaaa";
export const CHECKOUT = "c".repeat(64);
export const ROOT = "/work/shop";
export const HOST = "laptop-a";
export const NOW = "2026-10-03T10:00:00.000Z";

export function fakeRuntime(files = {}, opts = {}) {
  const clockState = { ms: Date.parse(opts.now ?? NOW) };
  const io = fakeIo({ host: HOST, now: () => opts.now ?? NOW });
  const source = opts.source ?? memorySource(files, { branch: opts.branch ?? "main" });
  const tree = opts.tree ?? fakeWorktree(opts.worktree ?? {});
  const process = opts.process ?? fakeProcess({}, opts.processWorld);
  const probe = opts.probe ?? fakeProbe(opts.probeWorld);
  const reach = opts.reach ?? fakeReach(opts.reachWorld);
  const store = createRuntimeStore(understandingRoom(STORE_ROOT, CHECKOUT), io);
  const rooms = { durable: durableRoom(STORE_ROOT, CHECKOUT), instances: instancesRoom(STORE_ROOT, CHECKOUT), live: liveRoom(STORE_ROOT, HOST, CHECKOUT), proposals: proposalsRoom(STORE_ROOT, CHECKOUT), settings: settingsFile(STORE_ROOT, CHECKOUT) };
  const instances = createInstances(rooms.instances, io);
  const proposals = createProposals(rooms.proposals, io);
  const sessions = createSessions(rooms.live, io);
  const observations = createObservations(rooms.live, io);
  const fake = fakeMachine(opts.tools ?? {}, { platform: opts.platform ?? "darwin" });
  const registry = createRegistry(stateRooms("/store"), io);
  const settingsOf = () => readSettings(rooms.settings, io, HOST);
  const capabilities = () => opts.capabilities ?? { sql: { can: false, because: "no sql.command is configured" } };
  const ctx = { workspaces: opts.workspaces?.port ?? null, capabilities, project: { storeKey: "repo-aaaa" }, io, raw: io, source, tree, process, probe, reach, store, rooms, instances, proposals, sessions, observations, registry, providers: PROVIDERS, machine: fake.machine, storeBase: "/store", storeRoot: STORE_ROOT, checkout: CHECKOUT, host: HOST, root: ROOT, name: opts.name ?? "shop", envId: instanceId({ checkout: CHECKOUT, kind: "human", name: "native" }), owner: { kind: "human" }, ecosystems: opts.ecosystems ?? builtinEcosystems(), catalog: opts.catalog ?? SHIPPED_CATALOG, env: opts.env ?? { PATH: "/usr/bin" }, now: () => new Date(clockState.ms).toISOString(), clock: () => clockState.ms, sleep: async (ms) => { clockState.ms += ms; }, readSettings: settingsOf, writeSettings: (w) => writeSettings(rooms.settings, io, { host: HOST, now: new Date(clockState.ms).toISOString(), ...w }) };
  return { ctx, io, source, tree, process, probe, reach, store, machine: fake, clockState };
}
