// A whole Satellite world in memory: Orbit's own fake filesystem (test/fakes/io.mjs), a store root nothing on disk
// holds, a person's default limits, and OWNERS a test scripts -- engineering tasks, QA investigations, the checkout's
// git, the providers a spawned Orbit command would be. Nothing here touches the disk, the network or a clock.
import { effectiveOf } from "../../../src/automation/settings.mjs";
import { fakeIo } from "./io.mjs";
import { hostRowOf } from "../../src/hosts/matrix.mjs";
import { definitionsPort } from "../../src/store/port.mjs";
import { defaultsOf } from "../../src/store/policy.mjs";
import { roomsOf } from "../../src/store/rooms.mjs";

export const FIXED_AT = "2026-10-22T08:00:00.000Z";

export const SESSION = "0123456789abcdef";

const policyOf = (limits = {}, revoked = []) => ({ limits: { ...defaultsOf(), ...limits }, revoked, exists: false, revision: null });

const tree = (head = "a".repeat(40), digest = "d".repeat(64)) => ({ head, dirty: 0, digest });

// A clock that moves one second each time it is read, from FIXED_AT: two missions started one after the other are
// two instants, as they are on a real machine.
const ticking = () => ((t) => () => new Date((t.ms += 1000)).toISOString())({ ms: Date.parse(FIXED_AT) });

// opts: { now, host, passed, policy, tasks, investigations, files, tree, providers, liveness, values }
export function satelliteWorld(opts = {}) {
  const io = fakeIo({ now: opts.now ?? ticking(), host: "laptop-a", pid: 4242, nowMs: opts.nowMs ?? Date.parse(FIXED_AT) });
  const rooms = roomsOf(opts.storeRoot ?? "/orbit-store/repo-satellite-test");
  const policy = opts.policy ?? policyOf(opts.limits, opts.revoked);
  const state = { tree: opts.tree === undefined ? tree() : opts.tree, tasks: opts.tasks ?? {}, investigations: opts.investigations ?? {}, files: opts.files ?? {}, started: [], asked: [], invoked: [] };
  return { io, rooms, policy, state, definitions: definitionsPort(io, rooms, policy), limits: opts.values ? { values: opts.values } : effectiveOf([]), project: { key: "repo-satellite-test", checkout: "c".repeat(64), root: "/checkout" }, session: opts.session === undefined ? SESSION : opts.session, hostId: opts.host ?? "claude", hostRow: hostRowOf(opts.host ?? "claude", new Set(opts.passed ?? ["claude:agent-dispatch", "claude:agent-parallel"])), acceptance: { passed: new Set(opts.passed ?? []), receipts: 0, stale: 0, digest: null }, now: () => io.now(), nowMs: () => io.nowMs(), host: io.host, pid: io.pid, pidStartedAt: () => 1700000000, roots: { orbit: "/orbit", satellite: "/orbit/satellite" }, liveness: opts.liveness ?? (() => false), owners: ownersOf(state, opts), checkout: { snapshot: () => state.tree }, providers: providersOf(state, opts), invoker: invokerOf(state, opts), ...(opts.capabilities ? { resolve: resolverOf(opts) } : {}), input: { input: () => "", file: () => "" } };
}

const ownersOf = (state, opts) => ({ task: (id) => state.tasks[id] ?? null, tasksSince: (at) => Object.entries(state.tasks).filter(([, v]) => (v.createdAt ?? "") >= at).map(([id, v]) => ({ id, objective: v.objective ?? null, createdAt: v.createdAt })), investigation: (id) => state.investigations[id] ?? null, file: (p) => (state.files[p] ? { exists: true, digest: state.files[p] } : { exists: false }), ...(opts.owners ?? {}) });

const providersOf = (state, opts) => ({ engineering: { start: async (spec) => (opts.startFails ? { error: "it could not be started" } : (state.started.push(spec.objective), { task: opts.startedTask ?? "tsk-0123456789ab", created: true })) }, context: async (text) => (state.asked.push(["context", text]), { ok: true, answer: { status: { word: "UNDERSTOOD" }, sections: ["architecture"], text } }), knowledge: async (text) => (state.asked.push(["knowledge", text]), { ok: true, answer: { claims: [] } }), ...(opts.providers ?? {}) });

// A completed engineering task as Orbit's taskView would show it.
export const completedTask = (verification = [{ subject: "test", obligation: "the declared tests pass", evidence: "check:chk-1", state: "satisfied" }], extra = {}) => ({ lifecycle: "COMPLETED", terminal: true, revision: 12, stopReason: null, verification, receipts: [{ domain: "check", ref: "chk-1", outcome: "PASSED" }], ...extra });

export const runningTask = () => ({ lifecycle: "EXECUTING", terminal: false, revision: 4, stopReason: null, verification: [], receipts: [] });

// One decision, with the defaults every test would otherwise repeat.
export const decided = (id, revision, action, extra = {}) => ({ schemaVersion: 1, decisionId: id, expectedRevision: revision, action, observed: "the context shows what the next step needs", ...extra });

export const reportOf = (run, extra = {}) => ({ schemaVersion: 1, agentRunId: run, executionState: "reported", findings: [{ say: "the timeout comes from the retry loop in the client", refs: ["file:src/client.mjs"] }], evidenceRefs: ["file:src/client.mjs"], remainingUnknowns: [], summary: "found where the timeout comes from", ...extra });

// The resolver's answer for each capability a test scripts; anything else is a gap nothing here provides.
const resolverOf = (opts) => (cap) => opts.capabilities[cap] ?? { capability: cap, outcome: "gap", gap: true, remedy: "prepare", status: "unprovided", provider: null, why: "nothing here provides it" };

// A capability the resolver picked, as Orbit's resolver would answer it.
export const providedBy = (capability, provider = { kind: "mcp", id: "runbooks", key: "managed:runbooks", ownership: "orbit-managed" }, status = "selected") => ({ capability, outcome: "provided", gap: false, status, provider, why: `${provider.id} provides it` });

// What Orbit's invokeBound answers for a call that read: a receipt of digests, the scrubbed answer, and the operation.
export const readAnswer = (answer = { cause: "the retry loop", file: "src/client.mjs" }) => ({ receipt: { provider: "managed:runbooks", tool: "search", queryDigest: "a".repeat(64), resultDigest: "b".repeat(64), sourceRefs: ["runbook:nightly"], outcome: "ok", why: null }, answer, operation: "read", error: null });

// The door a capability is asked through, recording every ask: bound by the provider the resolver picked.
const invokerOf = (state, opts) => ({ bind: (r) => (r?.provider ? { provider: r.provider, fingerprint: "f".repeat(16), connection: opts.connection ?? null } : null), call: async (binding, ask) => (state.invoked.push({ provider: binding.provider.key, ...ask }), opts.answer ?? readAnswer()) });
