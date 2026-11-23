// THE ALLOCATOR'S PROTOCOL (ADR 0061): the typed operations Orbit Web may ask of the allocator -- the one process that
// holds the container runtime's socket -- and nothing else. Every operation names IDS and VALUES (an account, an
// employee, an assignment, an attempt's dispatch key, a quota, a command's argument list); none takes a host path, an
// image, a mount, a privilege or a capability: the allocator works those out itself. Each request is checked here,
// whole, before anything is done -- by the HTTP server for a request from the network, and by the allocator itself for
// a call made in process -- and every request on the wire is signed with the shared secret (HMAC-SHA256 over the method,
// the path, a timestamp, a single-use nonce and the body's digest).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { posix } from "node:path";
import { checkDeskClean, checkResourceProfile, type UsageView } from "@orbit-web/contracts";
import type { AreaState, AttemptEvidence, AttemptSpec, DeskCleaned, DeskCleanOrder, DeskListing, DeskRead, ExecRequest, ExecResult, FileEntry, HostCapabilities, ProvisionResult, SandboxIds } from "../../application/sandbox.port.js";
import { checkDispatchKey, checkEmployeeIds, checkId, connectionSubpath, SandboxInputError, type SessionPlaces } from "./ids.js";

// ---- the operations ------------------------------------------------------------------------------------------------

// Read-only inputs on the wire: the bytes themselves (Orbit Web reads them from its own store; the allocator never
// reaches that store).
export interface WireInput {
  name: string;
  base64: string;
}

export type AllocatorAttemptSpec = Omit<AttemptSpec, "inputs"> & { inputs: WireInput[] };
export type AttestSpec = Omit<AttemptSpec, "inputs">;

export interface PlaneRecord {
  id: string;
  name: string;
}

export interface AttemptRecord {
  dispatchKey: string;
  runId: string;
  toolPlane: PlaneRecord | null;
  // The runner listens on `port`; `ip` is its address on the model network (for a caller that cannot resolve names).
  modelPlane: (PlaneRecord & { ip: string | null; port: number }) | null;
  createdAt: string;
  // As the model plane sees them (the port's AttemptHandle carries the same three).
  modelPlaneHome: string;
  modelPlaneCwd: string;
  bridgeCommand: { command: string; args: string[] };
}

export interface AttemptStatusRecord extends AttemptRecord {
  toolPlaneRunning: boolean;
  modelPlaneRunning: boolean;
  oomKilled: { modelPlane: boolean; toolPlane: boolean };
}

export interface AttestProbes {
  // An address on the internet a direct connection to must fail, and a public name that must not resolve.
  egress: { host: string; port: number };
  dnsName: string;
  // The control plane's database: a connection to it must fail from the tool plane (null: not told -- a failed check).
  database: { host: string; port: number } | null;
}

export interface AttestRequest {
  spec: AttestSpec;
  probes: AttestProbes;
  // The operator accepts SOFT_MONITORED areas while host protection is HARD (ORBIT_WEB_ACCEPT_SOFT_STORAGE).
  acceptSoftStorage: boolean;
}

// How many of a publish's changed paths its answer -- and the desk's version record -- names: the first ones, by path,
// with how many there were. A work tree is the employee's and has no bound (a repository, its dependencies), while
// every answer and record crosses a bounded channel (the storage helper's 4 MiB, a storage worker's 16 MiB).
export const CHANGED_PATHS = 500;

export interface PublishResult {
  published: boolean;
  deskVersion: number;
  // The first CHANGED_PATHS changed paths, by path; `changedTotal` is how many there were.
  changed: string[];
  changedTotal: number;
  reason: string | null;
}

// A chat's or a research session's run in a sandbox of its own: ids and switches, nothing else (the allocator works out
// the image, the mounts and the limits).
export type SessionSpec = SessionPlaces;

export interface SessionRecord {
  dispatchKey: string;
  // The container's name on its own network (Orbit Web reaches its runner there), and its address on that network.
  name: string;
  ip: string | null;
  port: number;
  createdAt: string;
}

export interface AllocatorApi {
  probe(force: boolean): Promise<HostCapabilities>;
  provisionEmployee(ids: SandboxIds, quotas: { deskMiB: number; cacheMiB: number }): Promise<ProvisionResult>;
  archiveEmployee(ids: SandboxIds): Promise<void>;
  deleteEmployee(ids: SandboxIds): Promise<{ gone: boolean; detail: string }>;
  measure(ids: SandboxIds): Promise<AreaState[]>;
  prepareWorkspace(ids: SandboxIds, assignmentId: string, scratchMiB: number): Promise<AreaState>;
  publishWorkspace(ids: SandboxIds, assignmentId: string, expectedDeskVersion: number): Promise<PublishResult>;
  removeWorkspace(ids: SandboxIds, assignmentId: string): Promise<{ gone: boolean; detail: string }>;
  listDesk(ids: SandboxIds, dir: string, maxEntries: number): Promise<DeskListing>;
  readDesk(ids: SandboxIds, path: string, maxBytes: number): Promise<DeskRead>;
  cleanDesk(ids: SandboxIds, order: DeskCleanOrder, expectedDeskVersion: number): Promise<DeskCleaned>;
  startAttempt(spec: AllocatorAttemptSpec): Promise<AttemptRecord>;
  findAttempt(dispatchKey: string): Promise<AttemptStatusRecord | null>;
  attest(dispatchKey: string, request: AttestRequest): Promise<AttemptEvidence>;
  exec(dispatchKey: string, req: ExecRequest): Promise<ExecResult>;
  readFile(dispatchKey: string, path: string, maxBytes: number): Promise<Buffer | null>;
  writeFile(dispatchKey: string, path: string, bytes: Buffer): Promise<void>;
  list(dispatchKey: string, dir: string, maxEntries: number): Promise<FileEntry[]>;
  usage(dispatchKey: string): Promise<{ modelPlane: UsageView | null; toolPlane: UsageView | null }>;
  stop(dispatchKey: string, graceMs: number): Promise<void>;
  remove(dispatchKey: string): Promise<{ gone: boolean; detail: string }>;
  startSession(spec: SessionSpec): Promise<SessionRecord>;
  removeSession(dispatchKey: string): Promise<{ gone: boolean; detail: string }>;
  // Every run's sandbox left over (Orbit Web restarted while one ran): removed, with its network.
  sweepSessions(): Promise<{ removed: number }>;
}

export const OPERATIONS = ["probe", "provisionEmployee", "archiveEmployee", "deleteEmployee", "measure", "prepareWorkspace", "publishWorkspace", "removeWorkspace", "listDesk", "readDesk", "cleanDesk", "startAttempt", "findAttempt", "attest", "exec", "readFile", "writeFile", "list", "usage", "stop", "remove", "startSession", "removeSession", "sweepSessions"] as const;
export type Operation = (typeof OPERATIONS)[number];

// An error the allocator says on purpose: a code a caller can act on, and words.
export const ERROR_STATUS = { bad_request: 400, unauthorized: 401, not_found: 404, conflict: 409, file_too_large: 413, shell_refused: 403, unavailable: 503, internal: 500 } as const;
export type AllocatorErrorCode = keyof typeof ERROR_STATUS;

export class AllocatorError extends Error {
  constructor(
    readonly code: AllocatorErrorCode,
    message: string,
  ) {
    super(message);
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

export const toAllocatorError = (err: unknown): AllocatorError => {
  if (err instanceof AllocatorError) return err;
  if (err instanceof SandboxInputError) return new AllocatorError("bad_request", err.message);
  return new AllocatorError("internal", err instanceof Error ? err.message : String(err));
};

// ---- checks ----------------------------------------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (message: string): never => {
  throw new SandboxInputError(message);
};

export function intIn(v: unknown, min: number, max: number, name: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) bad(`${name} must be a whole number from ${min} to ${max}`);
  return v as number;
}

const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
// A token that goes into a proxy URL's user part: URL-safe characters only.
const TOKEN = /^[A-Za-z0-9._~-]{8,512}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const INPUT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// Names the allocator sets on a model plane itself; a caller's environment never overrides them.
const RESERVED_ENV = /^(ORBIT_WEB_RUNNER_|ORBIT_WEB_BRIDGE_|ORBIT_WEB_CONFIG_HOME$)/;

export function checkEnv(v: unknown, name: string, max = 256): Record<string, string> {
  if (v === undefined) return {};
  if (!isRecord(v)) return bad(`${name} must be an object of strings`);
  const entries = Object.entries(v);
  if (entries.length > max) bad(`${name} has more than ${max} variables`);
  for (const [k, val] of entries) {
    if (!ENV_NAME.test(k)) bad(`${name}: ${JSON.stringify(k.slice(0, 40))} is not a variable name`);
    if (typeof val !== "string" || val.length > 32 * 1024 || val.includes("\0")) bad(`${name}.${k} must be a string of at most 32 KiB without NUL`);
  }
  return v as Record<string, string>;
}

const checkHost = (v: unknown, name: string): string => (typeof v === "string" && HOST.test(v) ? v : bad(`${name} must be a host name`));
const checkToken = (v: unknown, name: string): string => (typeof v === "string" && TOKEN.test(v) ? v : bad(`${name} must be 8-512 URL-safe characters`));

function checkUrl(v: unknown, name: string): string {
  if (typeof v !== "string" || v.length > 2048) return bad(`${name} must be an http(s) URL`);
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return bad(`${name} must be an http(s) URL`);
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username !== "" || u.password !== "") bad(`${name} must be an http(s) URL without credentials`);
  return v;
}

export function checkSandboxIds(v: unknown): SandboxIds {
  return checkEmployeeIds(v);
}

// What the desk's program said by its exit code (deskScript), as the allocator's error.
export function deskRefusal(code: number | null, said: string, what: string): AllocatorError {
  const why = said.trim().slice(0, 300);
  if (code === 2 || code === 6) return new AllocatorError("bad_request", `${what}: ${why}`);
  if (code === 3) return new AllocatorError("not_found", `${what}: it is not in the desk`);
  if (code === 4) return new AllocatorError("bad_request", `${what}: a link is in the way (a link in a desk is never followed)`);
  return new AllocatorError("internal", `${what} failed (exit ${code ?? "none"})${why === "" ? "" : `: ${why}`}`);
}

// What a person's clean-up of a desk removes, held to the same rules the API holds the request to.
export function checkDeskOrder(v: unknown): DeskCleanOrder {
  const c = checkDeskClean(v);
  if (!c.ok) throw new AllocatorError("bad_request", c.errors.join("; "));
  return c.value;
}

export function checkQuotas(v: unknown): { deskMiB: number; cacheMiB: number } {
  if (!isRecord(v)) return bad("quotas must be an object");
  return { deskMiB: intIn(v.deskMiB, 16, 4 * 1024 * 1024, "quotas.deskMiB"), cacheMiB: intIn(v.cacheMiB, 0, 4 * 1024 * 1024, "quotas.cacheMiB") };
}

export const checkInputName = (v: unknown): string => (typeof v === "string" && INPUT_NAME.test(v) ? v : bad("an input's name must be a plain file name"));

function checkInputs(v: unknown): WireInput[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 256) return bad("inputs must be a list of at most 256");
  const names = new Set<string>();
  return v.map((i: unknown, n) => {
    if (!isRecord(i) || typeof i.name !== "string" || !INPUT_NAME.test(i.name) || typeof i.base64 !== "string") return bad(`inputs[${n}] must be {name, base64} with a plain file name`);
    if (names.has(i.name)) bad(`inputs[${n}]: ${i.name} is named twice`);
    names.add(i.name);
    return { name: i.name, base64: i.base64 };
  });
}

// The parts of an attempt both a start and an attestation need.
export function checkAttestSpec(v: unknown): AttestSpec {
  if (!isRecord(v)) return bad("spec must be an object");
  const ids = checkEmployeeIds(v);
  const resources = checkResourceProfile(v.resources);
  if (!resources.ok) return bad(resources.errors.join("; "));
  const mp = isRecord(v.modelPlane) ? v.modelPlane : bad("modelPlane must be an object");
  const eg = isRecord(v.egress) ? v.egress : bad("egress must be an object");
  const br = isRecord(v.bridge) ? v.bridge : bad("bridge must be an object");
  const env = checkEnv(mp.env, "modelPlane.env", 64);
  for (const k of Object.keys(env)) if (RESERVED_ENV.test(k)) bad(`modelPlane.env.${k} is set by the allocator`);
  connectionSubpath(ids.orbitId, mp.connectionHome);
  let teamRoom: AttestSpec["teamRoom"] = null;
  if (v.teamRoom !== null && v.teamRoom !== undefined) {
    const t = isRecord(v.teamRoom) ? v.teamRoom : bad("teamRoom must be an object or null");
    teamRoom = { id: checkId(t.id, "teamRoom.id"), quotaMiB: intIn(t.quotaMiB, 16, 4 * 1024 * 1024, "teamRoom.quotaMiB") };
  }
  return {
    ...ids,
    runId: checkId(v.runId, "runId"),
    dispatchKey: checkDispatchKey(v.dispatchKey),
    fence: intIn(v.fence, 0, Number.MAX_SAFE_INTEGER, "fence"),
    assignmentId: checkId(v.assignmentId, "assignmentId"),
    resources: resources.value,
    modelPlane: { cpuMillis: intIn(mp.cpuMillis, 100, 64_000, "modelPlane.cpuMillis"), memoryMiB: intIn(mp.memoryMiB, 128, 256 * 1024, "modelPlane.memoryMiB"), connectionHome: mp.connectionHome as string, env },
    egress: { proxyHost: checkHost(eg.proxyHost, "egress.proxyHost"), proxyPort: intIn(eg.proxyPort, 1, 65535, "egress.proxyPort"), runToken: checkToken(eg.runToken, "egress.runToken") },
    bridge: { url: checkUrl(br.url, "bridge.url"), runToken: checkToken(br.runToken, "bridge.runToken") },
    teamRoom,
  };
}

const SESSION_FIELDS = ["accountId", "sessionId", "connectionId", "runId", "dispatchKey", "kind", "workspace", "switches"];

// A run's sandbox, whole: a field nobody declared (an image, a mount, an environment) is refused, never ignored.
export function checkSessionSpec(v: unknown): SessionSpec {
  if (!isRecord(v)) return bad("spec must be an object");
  for (const k of Object.keys(v)) if (!SESSION_FIELDS.includes(k)) bad(`${k} is not a field of a run's sandbox`);
  const kind = v.kind === "chat" || v.kind === "research" ? v.kind : bad("kind must be chat or research");
  const workspace = v.workspace === "rw" || v.workspace === "ro" || v.workspace === "none" ? v.workspace : bad("workspace must be rw, ro or none");
  const sw = isRecord(v.switches) && typeof v.switches.github === "boolean" && typeof v.switches.azure === "boolean" ? v.switches : bad("switches must be {github, azure}, each true or false");
  if (kind === "chat" && workspace === "none") bad("a chat's run mounts its workspace (rw or ro)");
  if (kind === "research" && workspace !== "none") bad("a research run has no workspace");
  if (kind === "research" && (sw.github === true || sw.azure === true)) bad("a research run is given no sign-in of GitHub or Azure");
  return {
    accountId: checkId(v.accountId, "accountId"),
    sessionId: checkId(v.sessionId, "sessionId"),
    connectionId: checkId(v.connectionId, "connectionId"),
    runId: checkId(v.runId, "runId"),
    dispatchKey: checkDispatchKey(v.dispatchKey),
    kind,
    workspace,
    switches: { github: sw.github as boolean, azure: sw.azure as boolean },
  };
}

export function checkAttemptSpec(v: unknown): AllocatorAttemptSpec {
  const spec = checkAttestSpec(v);
  return { ...spec, inputs: checkInputs((v as Record<string, unknown>).inputs) };
}

export function checkProbes(v: unknown): AttestProbes {
  if (!isRecord(v)) return bad("probes must be an object");
  const eg = isRecord(v.egress) ? v.egress : bad("probes.egress must be an object");
  const db = v.database === null || v.database === undefined ? null : isRecord(v.database) ? v.database : bad("probes.database must be an object or null");
  return {
    egress: { host: checkHost(eg.host, "probes.egress.host"), port: intIn(eg.port, 1, 65535, "probes.egress.port") },
    dnsName: checkHost(v.dnsName, "probes.dnsName"),
    database: db === null ? null : { host: checkHost(db.host, "probes.database.host"), port: intIn(db.port, 1, 65535, "probes.database.port") },
  };
}

// A working directory: relative to /work, never above it.
export function checkCwd(v: unknown): string {
  if (v === undefined || v === "" || v === ".") return "/work";
  if (typeof v !== "string" || v.length > 4096 || v.includes("\0") || v.startsWith("/")) return bad("cwd must be a path relative to /work");
  const joined = posix.normalize(`/work/${v}`);
  if (joined !== "/work" && !joined.startsWith("/work/")) bad("cwd must stay inside /work");
  return joined;
}

export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

export function checkExecRequest(v: unknown): ExecRequest & { cwd: string } {
  if (!isRecord(v)) return bad("the request must be an object");
  const argv = v.argv;
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > 4096) return bad("argv must be a list of 1 to 4096 arguments");
  let total = 0;
  for (const a of argv) {
    if (typeof a !== "string" || a.includes("\0") || a.length > 128 * 1024) bad("every argument must be a string of at most 128 KiB without NUL");
    total += (a as string).length;
  }
  if (total > 1024 * 1024) bad("the arguments are longer than 1 MiB together");
  if (typeof argv[0] !== "string" || argv[0] === "") bad("argv[0] must name a program");
  if (v.stdin !== undefined && (typeof v.stdin !== "string" || v.stdin.length > MAX_FILE_BYTES)) bad("stdin must be a string of at most 64 MiB");
  return {
    argv: argv as string[],
    cwd: checkCwd(v.cwd),
    env: checkEnv(v.env, "env"),
    ...(typeof v.stdin === "string" ? { stdin: v.stdin } : {}),
    timeoutMs: intIn(v.timeoutMs, 1, 24 * 3_600_000, "timeoutMs"),
    maxOutputBytes: intIn(v.maxOutputBytes, 1, MAX_OUTPUT_BYTES, "maxOutputBytes"),
  };
}

// ---- tool-plane paths ------------------------------------------------------------------------------------------------

// The places the file operations reach in a tool plane. /toolbox is the desk's toolbox inside the work tree.
export const FILE_ROOTS = ["/work", "/output", "/team"] as const;

// An absolute path inside one of the roots, or null. A relative path is relative to /work. Symlinks are resolved -- and
// held to the same roots -- inside the tool plane itself, by the program that touches the file.
export function toolPath(p: unknown): string | null {
  if (typeof p !== "string" || p.length === 0 || p.length > 4096 || p.includes("\0")) return null;
  let abs = posix.normalize(p.startsWith("/") ? p : `/work/${p}`);
  if (abs.length > 1 && abs.endsWith("/")) abs = abs.slice(0, -1);
  if (abs === "/toolbox" || abs.startsWith("/toolbox/")) abs = `/work${abs}`;
  return FILE_ROOTS.some((r) => abs === r || abs.startsWith(`${r}/`)) ? abs : null;
}

export function checkToolPath(p: unknown): string {
  const abs = toolPath(p);
  if (abs === null) return bad("path must be inside /work, /output, /team or /toolbox");
  return abs;
}

// ---- signing ---------------------------------------------------------------------------------------------------------

export const SIGNATURE_HEADERS = { time: "x-orbit-allocator-time", nonce: "x-orbit-allocator-nonce", signature: "x-orbit-allocator-signature" } as const;
// How far a request's clock may be from the allocator's, and how long a nonce is remembered (twice that).
export const CLOCK_SKEW_MS = 60_000;
const NONCE = /^[a-f0-9]{32,64}$/;

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

export function signature(secret: string, method: string, path: string, time: string, nonce: string, body: Buffer): string {
  return createHmac("sha256", secret).update(`${method.toUpperCase()}\n${path}\n${time}\n${nonce}\n${sha256(body)}`, "utf8").digest("hex");
}

export function signedHeaders(secret: string, method: string, path: string, body: Buffer, now = Date.now()): Record<string, string> {
  const time = String(now);
  const nonce = randomBytes(16).toString("hex");
  return { [SIGNATURE_HEADERS.time]: time, [SIGNATURE_HEADERS.nonce]: nonce, [SIGNATURE_HEADERS.signature]: signature(secret, method, path, time, nonce, body) };
}

// The nonces seen within the window: a request is accepted once.
export class NonceCache {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 2 * CLOCK_SKEW_MS) {}

  // False when the nonce was already used.
  claim(nonce: string, now: number): boolean {
    if (this.seen.size > 10_000) for (const [n, at] of this.seen) if (now - at > this.ttlMs) this.seen.delete(n);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, now);
    return true;
  }
}

const header = (h: Record<string, string | string[] | undefined>, name: string): string | null => {
  const v = h[name];
  return typeof v === "string" ? v : null;
};

// Null when the request is the secret holder's, fresh and not a replay; otherwise why not.
export function verifySigned(secret: string, method: string, path: string, headers: Record<string, string | string[] | undefined>, body: Buffer, nonces: NonceCache, now = Date.now()): string | null {
  const time = header(headers, SIGNATURE_HEADERS.time);
  const nonce = header(headers, SIGNATURE_HEADERS.nonce);
  const given = header(headers, SIGNATURE_HEADERS.signature);
  if (time === null || nonce === null || given === null) return "the request is not signed";
  if (!/^\d{1,16}$/.test(time) || Math.abs(now - Number(time)) > CLOCK_SKEW_MS) return "the request's time is outside the allowed window";
  if (!NONCE.test(nonce)) return "the request's nonce is malformed";
  const expected = Buffer.from(signature(secret, method, path, time, nonce, body), "hex");
  const actual = Buffer.from(/^[a-f0-9]{64}$/.test(given) ? given : "", "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return "the request's signature does not match";
  if (!nonces.claim(nonce, now)) return "the request was already used";
  return null;
}

// The shared secret, from the file the operator created: at least 32 characters, never writable by everybody.
export function readSecret(file: string): string {
  let mode: number;
  try {
    mode = statSync(file).mode;
  } catch (err) {
    throw new Error(`the allocator's secret file ${file} cannot be read (${(err as NodeJS.ErrnoException).code ?? "error"}): create it first (see docker/compose.yaml)`, { cause: err });
  }
  if ((mode & 0o002) !== 0) throw new Error(`the allocator's secret file ${file} is writable by everybody: make it 0640 (or 0600)`);
  const secret = readFileSync(file, "utf8").trim();
  if (secret.length < 32) throw new Error(`the allocator's secret in ${file} is shorter than 32 characters`);
  return secret;
}
