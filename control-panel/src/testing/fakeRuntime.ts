// Projects and one checkout's runtime as control-server answers them, in memory. Like the real
// server: identity is in the path, an identity nobody registered is a 404, every change is a POST or
// PUT the page makes with the token, adopting needs `human: true` and a proposal that is still true
// (a stale one is a 409), settings name the revision they read, and starting a component leaves a
// session Orbit can prove is its own. A connectivity target is named by its id and asked from a
// location -- a body naming anything else is a 400 -- and what each location answers is the test's.
import type { ProjectList } from "../features/projects/projects.types";
import type { Connectivity, ConnectivityBlock, Instance, Observation, Observations, Proposal, Provider, ReachState, ReachTarget, ReachTargetSetting, RetryPolicy, RuntimeSettings, RuntimeStatus, Session, SettingsBlock, StartResult } from "../features/runtime/runtime.types";
import { isProvider } from "../features/runtime/runtimeWords";
import type { SandboxList, SandboxPolicy } from "../features/runtime/sandbox.types";
import { reply, type Call } from "./fakeServer";
import { fieldOf, isRecord } from "./required";

export const KEY = "repo-aaaa";
export const CHECKOUT = "c0ffee00c0ffee00c0ffee00c0ffee00";
export const OTHER_CHECKOUT = "deadbeefdeadbeefdeadbeefdeadbeef";
export const PROPOSAL = "ep-0123456789ab";

/** The address of the page, which names both identities. */
export const PAGE_PATH = `/projects/${KEY}/checkouts/${CHECKOUT}/runtime`;

/** The API's address for the same checkout's runtime. */
export const RUNTIME_PATH = `/api/v1${PAGE_PATH}`;

const LIST: ProjectList = {
  projects: [
    {
      key: KEY,
      name: "shop",
      checkouts: [
        { id: CHECKOUT, root: "/work/shop", exists: true, host: "laptop", lastSeen: "2026-10-03T09:00:00.000Z", summary: { understanding: "CURRENT", runtime: "STOPPED", branch: "main" } },
        { id: OTHER_CHECKOUT, root: "/work/shop-review", exists: false, host: "laptop", lastSeen: "2026-09-20T09:00:00.000Z", summary: { understanding: "STALE", runtime: "UNKNOWN", branch: "review" } },
      ],
    },
  ],
};

const PROPOSAL_DOC: Proposal = {
  id: PROPOSAL,
  state: "CREATE",
  status: "open",
  because: "no dev container is defined, and 2 requirement(s) can be provided by a feature",
  files: { create: [{ path: ".devcontainer/devcontainer.json", text: '{\n  "name": "shop"\n}\n' }], patch: [] },
  gaps: [{ id: "node", state: "missing", because: "no feature provides Node.js" }],
  unresolved: [],
  risks: ["the first build downloads an image"],
  notes: [],
  createdAt: "2026-10-03T09:05:00.000Z",
};

const POLICY: RetryPolicy = { attempts: 3, intervalMs: 1000, timeoutMs: 3000 };

/** What the engine fills in for a policy nobody has set. */
export const SANDBOX_DEFAULTS: SandboxPolicy = { enabled: true, strategy: "auto", limits: { active: 3 }, restore: { mode: "approved", trusted: [] }, ports: { mode: "lease", from: 42000, to: 42999 }, trustedDefinitions: [], qa: { modes: [], entry: null, browser: "isolated" }, network: { denyProductionWrites: true } };

/** A restore plan and a definition a person already trusts, for the pages that show the tables full. */
export const TRUSTED_RESTORE = "0123456789abcdef".repeat(4);
export const TRUSTED_DEFINITION = "fedcba9876543210".repeat(4);

const BLOCK: SettingsBlock = { strategy: "auto", reuseExternal: false, components: {}, connectivity: { retry: POLICY, targets: {} }, sandbox: SANDBOX_DEFAULTS };

/** A task of the checkout has a sandbox, and one lease nobody holds any more. */
export const SANDBOXES: SandboxList = {
  sandboxes: [{ id: "env-0123456789ab", owner: { kind: "task", id: "tsk-0123456789ab" }, workspace: "ws-0123456789ab", state: "READY", tree: "4b825dc642cb6eb9a060e54bf8d69288fbee4904", stale: false, components: 2, leases: [42017], updatedAt: "2026-10-03T10:00:00.000Z" }],
  staleLeases: [{ port: 42033, owner: "tsk-999999999999", component: "node:web" }],
};

/** What the engine calls fresh: an answer older than this is STALE. */
export const FRESH_MS = 300_000;

export const ASKED_AT = "2026-10-03T10:00:00.000Z";

/** A database the web needs, behind a VPN the host is on: checked before a start, from both places. */
export const DB_ID = "orders-db";

export const DB: ReachTargetSetting = { label: "Orders database", host: "db.internal", port: 1433, protocol: "tcp", requiredBy: ["node:web"], checkFrom: ["native", "devcontainer"], beforeStart: true, note: "through the office VPN" };

const reachedBecause = (t: { host: string; port: number }) => `${t.host}:${t.port} accepted a connection`;

// The host reached it ten seconds ago; the dev container did not, two hours ago -- an answer that old is STALE.
const HOST_SAW: Observation = { target: DB_ID, provider: "native", state: "REACHABLE", resolution: "RESOLVED", transport: "REACHABLE", because: reachedBecause(DB), checkedAt: "2026-10-03T09:59:50.000Z", attemptsUsed: 1, configuredAttempts: 1, attempts: [{ number: 1, state: "REACHABLE", because: reachedBecause(DB) }], freshness: { age: 10_000, stale: false } };

const CONTAINER_SAW: Observation = { target: DB_ID, provider: "devcontainer", state: "UNREACHABLE", resolution: "FAILED", transport: "NOT_ATTEMPTED", because: "db.internal did not resolve (ENOTFOUND)", checkedAt: "2026-10-03T08:00:00.000Z", attemptsUsed: 3, configuredAttempts: 3, attempts: [1, 2, 3].map((number) => ({ number, state: "UNREACHABLE" as const, because: "db.internal did not resolve (ENOTFOUND)" })), freshness: { age: 7_200_000, stale: true } };

const notChecked = (id: string, provider: Provider, attempts: number): Observation => ({ target: id, provider, state: "NOT_CHECKED", resolution: "NOT_ATTEMPTED", transport: "NOT_ATTEMPTED", because: "not checked yet", checkedAt: null, attemptsUsed: 0, configuredAttempts: attempts, attempts: [], freshness: { age: null, stale: true } });

// What a check of each location answers, attempt by attempt; the last answer repeats.
const ANSWERS: Record<Provider, ReachState[]> = { native: ["REACHABLE"], devcontainer: ["UNREACHABLE"] };

const AS_SAID: Record<ReachState, Pick<Observation, "resolution" | "transport">> = {
  REACHABLE: { resolution: "RESOLVED", transport: "REACHABLE" },
  UNREACHABLE: { resolution: "RESOLVED", transport: "UNREACHABLE" },
  BLOCKED: { resolution: "NOT_ATTEMPTED", transport: "NOT_ATTEMPTED" },
  UNKNOWN: { resolution: "UNKNOWN", transport: "UNKNOWN" },
  NOT_CHECKED: { resolution: "NOT_ATTEMPTED", transport: "NOT_ATTEMPTED" },
};

const becauseOf = (t: ReachTarget, s: ReachState) => (s === "REACHABLE" ? reachedBecause(t) : s === "BLOCKED" ? "the environment is not up: there is no container to ask from" : `nothing answered on ${t.host}:${t.port} within ${t.retry.timeoutMs / 1000}s`);

// The answers one run takes: as many as the policy allows, stopping at one that settles it.
function walked(script: ReachState[], most: number): ReachState[] {
  const out: ReachState[] = [];
  for (const s of Array.from({ length: most }, (_, i) => script[Math.min(i, script.length - 1)] ?? "UNKNOWN")) {
    out.push(s);
    if (s === "REACHABLE" || s === "BLOCKED") break;
  }
  return out;
}

function answered(t: ReachTarget, provider: Provider, mode: "check" | "retry", script: ReachState[]): Observation {
  const states = walked(script, mode === "check" ? 1 : t.retry.attempts);
  const last = states[states.length - 1] ?? "UNKNOWN";
  const attempts = states.map((state, i) => ({ number: i + 1, state, because: becauseOf(t, state) }));
  return { target: t.id, provider, state: last, ...AS_SAID[last], because: becauseOf(t, last), checkedAt: ASKED_AT, attemptsUsed: states.length, configuredAttempts: mode === "check" ? 1 : t.retry.attempts, attempts, freshness: { age: 0, stale: false } };
}

// What the engine would read back for a block: each target with the policy that applies to it and
// what each of its locations last observed -- kept while the target still points where it did.
function keptFor(before: Connectivity | null, id: string, t: ReachTargetSetting, attempts: number): Observations {
  const old = before?.targets.find((x) => x.id === id && x.host === t.host && x.port === t.port);
  return Object.fromEntries(t.checkFrom.map((p) => [p, old?.observations[p] ?? notChecked(id, p, attempts)]));
}

function connectivityOf(block: ConnectivityBlock, before: Connectivity | null): Connectivity {
  const policy = { ...POLICY, ...block.retry };
  const targetOf = (id: string, t: ReachTargetSetting): ReachTarget => ({ id, ...t, retry: { ...policy, ...t.retry }, observations: keptFor(before, id, t, policy.attempts) });
  return { retry: policy, freshMs: FRESH_MS, targets: Object.entries(block.targets).map(([id, t]) => targetOf(id, t)) };
}

const WITH_DB: SettingsBlock = { ...BLOCK, connectivity: { retry: POLICY, targets: { [DB_ID]: DB } } };

const SEEN: Connectivity = { retry: POLICY, freshMs: FRESH_MS, targets: [{ id: DB_ID, ...DB, retry: POLICY, observations: { native: HOST_SAW, devcontainer: CONTAINER_SAW } }] };

const settingsOf = (block: SettingsBlock): RuntimeSettings => ({ exists: false, settings: block, others: [], revision: null, unreadable: null });

const ANYWHERE = { win32: { state: "yes" as const, because: null }, linux: { state: "yes" as const, because: null }, darwin: { state: "yes" as const, because: null } };
const WINDOWS_ONLY = { win32: { state: "yes" as const, because: null }, linux: { state: "no" as const, because: ".NET Framework (classic) can only be met on Windows" }, darwin: { state: "no" as const, because: ".NET Framework (classic) can only be met on Windows" } };

const WEB = { key: "node:web", name: "web", kind: "custom-service", ecosystem: "node", evidence: ["web/package.json"], os: ANYWHERE, state: "ready" as const, provider: "native", because: "Node.js 22.1.0: 22.1.0 satisfies >=18", blocking: [], candidates: [{ provider: "native", state: "compatible" as const, because: "Node.js 22.1.0: 22.1.0 satisfies >=18", blocking: [] }, { provider: "devcontainer", state: "unknown" as const, because: "the Docker command could not be asked about", blocking: [] }], command: { declaredAs: "dev", text: "vite", argv: ["npm", "run", "dev"], cwd: "web" } };

const LEGACY = { key: "dotnet:legacy", name: "legacy", kind: "web", ecosystem: "dotnet", evidence: ["legacy/Legacy.csproj"], os: WINDOWS_ONLY, state: "blocked" as const, provider: null, because: ".NET Framework 4.8 needs Windows", blocking: ["the classic .NET Framework runs on Windows only"], candidates: [{ provider: "native", state: "incompatible" as const, because: "needs win32", blocking: [] }], command: null };

function freshStatus(block: SettingsBlock): RuntimeStatus {
  return {
    checkout: { id: CHECKOUT, root: "/work/shop", name: "shop", host: "laptop", branch: "main", commit: "56ff8cf" },
    understanding: { state: "CURRENT", facts: 9, at: "2026-10-03T09:00:00.000Z", commit: "56ff8cf", branch: "main", unknowns: [], gaps: [], stale: [], dirty: [], added: [], removed: [] },
    plan: { overall: "PARTIAL", strategy: "auto", host: { platform: "darwin", arch: "arm64" }, platforms: [{ id: "win32", name: "Windows" }, { id: "linux", name: "Linux" }, { id: "darwin", name: "macOS" }], osEvidence: [{ os: ["linux", "win32"], exclusive: false, source: "ci", evidence: [".github/workflows/ci.yml"] }], components: [WEB, LEGACY] },
    sessions: [],
    services: [],
    instances: [],
    proposals: [{ id: PROPOSAL, state: "CREATE", because: PROPOSAL_DOC.because, createdAt: PROPOSAL_DOC.createdAt }],
    settings: settingsOf(block),
    machine: { platform: "darwin", arch: "arm64", tools: { node: { state: "AVAILABLE", version: "22.1.0", reason: null, checkedAt: "2026-10-03T09:00:00.000Z" }, docker: { state: "UNKNOWN", version: null, reason: null, checkedAt: null } } },
    verification: {
      browser: { state: "BLOCKED", because: "nothing is running: start it first" },
      http: { state: "BLOCKED", because: "nothing is running: start it first" },
      database: { state: "UNKNOWN", because: "whether the project can read its data was not asked" },
      testRunner: { state: "AVAILABLE", because: "1 declared test command(s) can be launched", commands: [{ component: "node:web", declaredAs: "test", text: "vitest run", safe: true }] },
    },
  };
}

const SESSION: Session = { id: "rs-0123456789ab", component: "node:web", provider: "native", state: "RUNNING", ownership: "ORBIT_OWNED", why: "a receipt, a pid and a start time all agree", pid: 4242, startedAt: "2026-10-03T09:10:00.000Z", ports: [], readiness: { state: "READINESS_UNKNOWN", because: "it is running, and no file or setting says how to tell it is ready" } };

const ADOPTED: Instance = { id: "env-0123456789ab", name: "devcontainer", provider: "devcontainer", state: "ADOPTED", validation: null };

// A Response body can be read once, so every answer is made when it is asked for.
const gone = () => reply(404, { error: { code: "PROJECT_UNKNOWN", message: "no project and checkout like that is known on this machine" } });

/** `target`: the machine already has the orders database as a reach target, observed from both places. */
export function fakeRuntime(opts: { target?: boolean; sandboxes?: boolean; trusted?: boolean; at?: { key: string; checkout: string } } = {}) {
  const trusted: SandboxPolicy = { ...SANDBOX_DEFAULTS, restore: { ...SANDBOX_DEFAULTS.restore, trusted: [TRUSTED_RESTORE] }, trustedDefinitions: [TRUSTED_DEFINITION] };
  const start0: SettingsBlock = { ...(opts.target ? WITH_DB : BLOCK), ...(opts.trusted ? { sandbox: trusted } : {}) };
  const state = { list: LIST, status: freshStatus(start0), staleProposal: false, revision: null as string | null, n: 0, connectivity: opts.target ? SEEN : connectivityOf(BLOCK.connectivity, null), answers: { ...ANSWERS }, reused: [] as NonNullable<StartResult["reused"]>, sandboxes: opts.sandboxes ? SANDBOXES : { sandboxes: [], staleLeases: [] } };
  // A mission test reaches this runtime at the address of ITS checkout.
  const root = opts.at ? `/api/v1/projects/${opts.at.key}/checkouts/${opts.at.checkout}/runtime` : RUNTIME_PATH;
  const known = (path: string) => path.startsWith(root);
  const tail = (path: string) => path.slice(root.length);

  const adopt = (call: Call): Response => {
    if (fieldOf(call.body, "human") !== true) return reply(400, { error: { code: "HUMAN_REQUIRED", message: "adopting an environment is a person's" } });
    if (state.staleProposal) return reply(409, { error: { code: "STALE_PROPOSAL", message: "STALE_PROPOSAL: an environment file changed since this was designed — design it again before adopting" } });
    state.status = { ...state.status, instances: [ADOPTED], proposals: [] };
    return reply(200, { instance: { id: ADOPTED.id, state: "ADOPTED" }, files: [{ path: ".devcontainer/devcontainer.json", created: true }] });
  };

  const start = (call: Call): Response => {
    const wanted = fieldOf(call.body, "component");
    if (typeof wanted === "string" && !state.status.plan.components.some((c) => c.key === wanted)) return reply(400, { error: { code: "RUNTIME_OPERATION_FAILED", message: `no component "${wanted}" is known here` } });
    state.status = { ...state.status, sessions: [SESSION] };
    return reply(200, { started: [{ component: WEB.key, session: SESSION.id, pid: 4242, provider: "native", readiness: { state: "NOT_CHECKED" } }], reused: state.reused, skipped: [], blocked: [], notReady: [{ component: LEGACY.key, state: "blocked", because: LEGACY.because }] });
  };

  const stop = (): Response => {
    state.status = { ...state.status, sessions: state.status.sessions.map((s) => ({ ...s, state: "STOPPED" })) };
    return reply(200, { stopped: [{ component: WEB.key, how: "SIGTERM" }], gone: [], refused: [], released: [] });
  };

  const save = (call: Call): Response => {
    const body = call.body;
    if (!isRecord(body) || !isRecord(body.settings)) return reply(400, { error: { code: "RUNTIME_SETTINGS_INVALID", message: "send { settings, revision }" } });
    if (body.revision !== state.revision) return reply(409, { error: { code: "STALE_REVISION", message: "the runtime settings changed since they were read (revision x, not y); read them again and apply the change to what is there now" } });
    state.revision = `rev-${++state.n}`;
    const settings: SettingsBlock = { ...BLOCK, ...body.settings };
    const saved: RuntimeSettings = { exists: true, settings, others: [], revision: state.revision, unreadable: null };
    state.status = { ...state.status, settings: saved };
    state.connectivity = connectivityOf(settings.connectivity, state.connectivity);
    return reply(200, { saved });
  };

  // Like the server: a kind, a fingerprint and the revision the page read -- each the shape it has -- and
  // then the settings, where only the fingerprint lists move. A stale revision is a 409 and changes nothing.
  const trust = (call: Call, revoke: boolean): Response => {
    const body = isRecord(call.body) ? call.body : {};
    const problems = Object.keys(body).filter((k) => !["kind", "fingerprint", "revision"].includes(k)).map((k) => `${k} is not a field of this operation (kind, fingerprint, revision)`);
    const { kind, fingerprint } = body;
    if (kind !== "restore" && kind !== "definition") problems.push("kind must be restore or definition");
    if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) problems.push("fingerprint must be 64 lowercase hexadecimal characters");
    if (problems.length || (kind !== "restore" && kind !== "definition") || typeof fingerprint !== "string") return reply(400, { error: { code: "RUNTIME_BODY_INVALID", message: problems.join("; ") } });
    if (body.revision !== state.revision) return reply(409, { error: { code: "STALE_REVISION", message: "the runtime settings changed since they were read (revision x, not y); read them again and apply the change to what is there now" } });
    const was = state.status.settings.settings.sandbox;
    const held = kind === "restore" ? was.restore.trusted : was.trustedDefinitions;
    const next = revoke ? held.filter((f) => f !== fingerprint) : [...new Set([...held, fingerprint])];
    const sandbox: SandboxPolicy = kind === "restore" ? { ...was, restore: { ...was.restore, trusted: next } } : { ...was, trustedDefinitions: next };
    state.revision = `rev-${++state.n}`;
    const saved: RuntimeSettings = { exists: true, settings: { ...state.status.settings.settings, sandbox }, others: [], revision: state.revision, unreadable: null };
    state.status = { ...state.status, settings: saved };
    return reply(200, { saved });
  };

  // Like the server: the id's shape, then a body that may say WHERE to ask from and nothing else, then
  // the target in the settings -- so a body naming a host is refused before any target is looked for.
  const reach = (call: Call, id: string, mode: "check" | "retry"): Response => {
    const body = isRecord(call.body) ? call.body : {};
    const wrong = Object.keys(body).filter((k) => k !== "provider").map((k) => `${k} is not a field of this operation (provider)`);
    const provider = body.provider;
    if (provider !== undefined && provider !== "native" && provider !== "devcontainer") wrong.push("provider must be native or devcontainer");
    if (wrong.length) return reply(400, { error: { code: "RUNTIME_BODY_INVALID", message: wrong.join("; ") } });
    const target = state.connectivity.targets.find((t) => t.id === id);
    if (!target) return reply(404, { error: { code: "TARGET_UNKNOWN", message: `no connectivity target "${id}" is set for this machine` } });
    const from: Provider[] = typeof provider === "string" && isProvider(provider) ? [provider] : target.checkFrom;
    const results: Observations = Object.fromEntries(from.map((p) => [p, answered(target, p, mode, state.answers[p])]));
    state.connectivity = { ...state.connectivity, targets: state.connectivity.targets.map((t) => (t.id === id ? { ...t, observations: { ...t.observations, ...results } } : t)) };
    const { observations: _seen, ...brief } = target;
    return reply(200, { target: brief, mode, results });
  };

  const operate = (call: Call): Response => {
    const path = tail(call.path);
    if (path === "" && call.method === "GET") return reply(200, state.status);
    if (path === "/discover") return reply(200, { decision: { name: "CURRENT", say: "what is kept still answers this", scan: "none", writes: false, dry: false }, state: "CURRENT", facts: 9, byKind: {}, gaps: [], notes: [] });
    if (path === "/design") return reply(200, PROPOSAL_DOC);
    if (path === `/proposals/${PROPOSAL}` && call.method === "GET") return reply(200, state.status.instances.length ? { ...PROPOSAL_DOC, status: "adopted" } : PROPOSAL_DOC);
    if (path === `/proposals/${PROPOSAL}/adopt`) return adopt(call);
    if (path === "/doctor") return reply(200, { understanding: { state: "CURRENT" }, machine: state.status.machine, plan: { overall: "PARTIAL" } });
    if (path === "/prepare") return reply(200, { apply: false, plans: [{ provider: "native", host: [], environment: [], repository: "no changes" }] });
    if (path === "/validate" && fieldOf(call.body, "human") !== true) return reply(400, { error: { code: "HUMAN_REQUIRED", message: "validate brings an environment up on this machine: it is a person's" } });
    if (path === "/validate") return reply(200, { id: ADOPTED.id, state: "VALIDATED", validation: { state: "VALIDATED", at: "2026-10-03T09:20:00.000Z", because: "the environment came up" } });
    if (path === "/start") return start(call);
    if (path === "/stop") return stop();
    if (path === "/settings" && call.method === "PUT") return save(call);
    if (path === "/sandboxes" && call.method === "GET") return reply(200, state.sandboxes);
    if ((path === "/sandbox/trust" || path === "/sandbox/revoke") && call.method === "POST") return trust(call, path === "/sandbox/revoke");
    if (path === "/connectivity" && call.method === "GET") return reply(200, state.connectivity);
    const asked = /^\/connectivity\/([^/]+)\/(check|retry)$/.exec(path);
    if (asked && call.method === "POST") return reach(call, decodeURIComponent(asked[1] ?? ""), asked[2] === "retry" ? "retry" : "check");
    return reply(404, { error: { code: "NOT_FOUND", message: `no endpoint at ${call.path}` } });
  };

  // A person forgets the checkout whose directory is gone; the one that is there is a 409.
  const forget = (call: Call): Response => {
    if (fieldOf(call.body, "human") !== true) return reply(400, { error: { code: "HUMAN_REQUIRED", message: "forgetting a checkout is a person's" } });
    if (call.path.includes(CHECKOUT)) return reply(409, { error: { code: "CHECKOUT_PRESENT", message: "its directory is still there, and Orbit would know it again the next time it is used from it" } });
    const [project] = state.list.projects;
    state.list = { projects: state.list.projects.map((p) => ({ ...p, checkouts: p.checkouts.filter((c) => c.id !== OTHER_CHECKOUT) })) };
    return reply(200, { project, checkout: project?.checkouts.find((c) => c.id === OTHER_CHECKOUT) });
  };

  const handle = (call: Call): Response | null => {
    if (call.path === "/api/v1/projects") return reply(200, state.list);
    if (call.method === "POST" && call.path.endsWith("/forget")) return forget(call);
    if (!call.path.startsWith("/api/v1/projects/")) return null;
    return known(call.path) ? operate(call) : gone();
  };

  return { handle, state };
}
