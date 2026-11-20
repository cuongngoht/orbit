// An Orbit Web API for a test: a temporary data directory, the real module tree with the process port replaced by a
// FakeProcessPort (git and Orbit's own CLIs run for real; claude and gh are scripted), listening on a free port.
import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MUTATION_HEADER, OPERATOR_CSRF_HEADER, type GovernanceState } from "@orbit-web/contracts";
import { AppModule } from "../app.module.js";
import { configureApp, NEST_OPTIONS } from "../bootstrap.js";
import { DEFAULT_LIMITS, loadConfig, type AppConfig } from "../config/config.js";
import { ensureDataDirs } from "../config/data-dirs.js";
import { PROCESS_PORT } from "../core/tokens.js";
import { NodeProcessPort } from "../infra/process/node-process.js";
import { BOOTSTRAP_ANNOUNCER, type BootstrapAnnouncer } from "../modules/governance/bootstrap-code.js";
import { OPERATOR_COOKIE } from "../modules/governance/operator.service.js";
import { FakeProcessPort, program, type Call } from "./fake-process.js";

// The repository's own Orbit plugin: the nearest directory above this file whose manifest names "orbit".
export function orbitPluginDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    const manifest = join(dir, ".claude-plugin", "plugin.json");
    if (existsSync(manifest) && (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name === "orbit") return dir;
    dir = dirname(dir);
  }
  throw new Error("the Orbit plugin was not found above the test");
}

export interface Reply {
  status: number;
  body: unknown;
  headers: Headers;
}

// A person signed in to governance in a test: every request carries the session's cookie and, for a change, its CSRF
// token -- what the web app sends.
export interface OperatorClient {
  cookie: string;
  csrf: string;
  state: GovernanceState;
  get(path: string, headers?: Record<string, string>): Promise<Reply>;
  send(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Reply>;
}

export const OWNER = { username: "owner", password: "correct horse battery staple", displayName: "Olivia Owner", organizationName: "Acme" };

export interface Harness {
  url: string;
  app: NestExpressApplication;
  fake: FakeProcessPort;
  config: AppConfig;
  dataDir: string;
  // What Orbit Web announced as the first owner's code (its log, in production): the last one, or null.
  bootstrapCode(): string | null;
  // The first owner, enrolled with that code (once) -- or signed in again when already enrolled.
  owner(): Promise<OperatorClient>;
  signIn(username: string, password: string): Promise<OperatorClient>;
  get(path: string, headers?: Record<string, string>): Promise<Reply>;
  send(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Reply>;
  events(path: string, o: { lastEventId?: number; until: (events: Record<string, unknown>[]) => boolean; timeoutMs?: number }): Promise<{ frames: SseFrame[]; events: Record<string, unknown>[] }>;
  // Opens a stream and returns once the server holds the subscription (its headers arrived), so what the test does
  // next is seen on it -- the app stream sends nothing on connect.
  stream(path: string): Promise<OpenStream>;
  close(keepData?: boolean): Promise<void>;
}

export interface OpenStream {
  // Each frame's data, in order, as it arrives.
  events: Record<string, unknown>[];
  until(cond: (events: Record<string, unknown>[]) => boolean, timeoutMs?: number): Promise<Record<string, unknown>[]>;
  close(): void;
}

export async function openStream(url: string): Promise<OpenStream> {
  const controller = new AbortController();
  const res = await fetch(url, { headers: { accept: "text/event-stream" }, signal: controller.signal });
  const events: Record<string, unknown>[] = [];
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  void (async () => {
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
          const frame = parseFrame(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
          if (frame) events.push(frame.data);
        }
      }
    } catch {
      // aborted by close()
    }
  })();
  return { events, until: (cond, timeoutMs = 10_000) => eventually(() => [...events], cond, timeoutMs), close: () => controller.abort() };
}

export interface SseFrame {
  id: string | null;
  data: Record<string, unknown>;
}

export interface HarnessOptions {
  dataDir?: string;
  fake?: FakeProcessPort;
  env?: Record<string, string>;
  // Providers replaced for this test (a research URL fetch's address policy, say), as [token, value].
  overrides?: [unknown, unknown][];
}

export async function startHarness(o: HarnessOptions = {}): Promise<Harness> {
  const dataDir = o.dataDir ?? mkdtempSync(join(tmpdir(), "orbit-web-test-"));
  const config = loadConfig({ PATH: process.env.PATH, ORBIT_WEB_DATA_DIR: dataDir, ORBIT_PLUGIN_DIR: orbitPluginDir(), ORBIT_WEB_BUILD_INFO: join(dataDir, "no-build-info.json"), ...o.env });
  config.limits = { ...DEFAULT_LIMITS, loginTimeoutMs: 3_000, stopGraceMs: 300, orbitRefreshMs: 50 };
  ensureDataDirs(config.data);
  const fake = o.fake ?? signedIn(new FakeProcessPort(new NodeProcessPort()));
  const codes: string[] = [];
  const announcer: BootstrapAnnouncer = { announce: (code) => void codes.push(code) };
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(PROCESS_PORT)
    .useValue(fake)
    .overrideProvider(BOOTSTRAP_ANNOUNCER)
    .useValue(announcer);
  for (const [token, value] of o.overrides ?? []) builder = builder.overrideProvider(token).useValue(value);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ ...NEST_OPTIONS, logger: false });
  configureApp(app, config);
  await app.listen(0, "127.0.0.1");
  const port = (app.getHttpServer().address() as AddressInfo).port;
  // The agent gateway is told where Orbit Web listens: here, the free port it was given.
  config.port = port;
  const url = `http://127.0.0.1:${port}`;
  const reply = async (r: Response): Promise<Reply> => {
    const text = await r.text();
    return { status: r.status, body: jsonOr(text), headers: r.headers };
  };
  const send = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
    reply(
      await fetch(`${url}${path}`, {
        method,
        headers: { [MUTATION_HEADER]: "1", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
  const clientOf = (r: Reply): OperatorClient => {
    if (r.status !== 200 && r.status !== 201) throw new Error(`operator sign-in failed: ${r.status} ${JSON.stringify(r.body)}`);
    const cookie = `${OPERATOR_COOKIE}=${/orbit_web_operator=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? ""}`;
    const state = r.body as GovernanceState;
    const csrf = state.session?.csrfToken ?? "";
    return {
      cookie,
      csrf,
      state,
      get: async (path, headers = {}) => reply(await fetch(`${url}${path}`, { headers: { cookie, ...headers } })),
      send: (method, path, body, headers = {}) => send(method, path, body, { cookie, [OPERATOR_CSRF_HEADER]: csrf, ...headers }),
    };
  };
  const signIn = async (username: string, password: string): Promise<OperatorClient> => clientOf(await send("POST", "/api/operator/login", { username, password }));
  let enrolled = false;
  const owner = async (): Promise<OperatorClient> => {
    if (enrolled) return signIn(OWNER.username, OWNER.password);
    const r = await send("POST", "/api/operator/bootstrap", { code: codes.at(-1) ?? "", ...OWNER });
    enrolled = r.status === 201;
    return enrolled ? clientOf(r) : signIn(OWNER.username, OWNER.password);
  };
  return {
    url,
    app,
    fake,
    config,
    dataDir,
    bootstrapCode: () => codes.at(-1) ?? null,
    owner,
    signIn,
    get: async (path, headers = {}) => reply(await fetch(`${url}${path}`, { headers })),
    send,
    events: (path, opts) => readSse(`${url}${path}`, opts),
    stream: (path) => openStream(`${url}${path}`),
    close: async (keepData = false) => {
      await app.close();
      if (!keepData) rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function jsonOr(text: string): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

// Reads Server-Sent Events until `until` holds for what has arrived (or the time runs out), then hangs up.
export async function readSse(url: string, o: { lastEventId?: number; until: (events: Record<string, unknown>[]) => boolean; timeoutMs?: number }): Promise<{ frames: SseFrame[]; events: Record<string, unknown>[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 10_000);
  const frames: SseFrame[] = [];
  try {
    const res = await fetch(url, { headers: { accept: "text/event-stream", ...(o.lastEventId !== undefined ? { "last-event-id": String(o.lastEventId) } : {}) }, signal: controller.signal });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
        const frame = parseFrame(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (frame) frames.push(frame);
      }
      if (o.until(frames.map((f) => f.data))) break;
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") throw err;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return { frames, events: frames.map((f) => f.data) };
}

function parseFrame(raw: string): SseFrame | null {
  let id: string | null = null;
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("id: ")) id = line.slice(4);
    if (line.startsWith("data: ")) data.push(line.slice(6));
  }
  return data.length > 0 ? { id, data: JSON.parse(data.join("\n")) as Record<string, unknown> } : null;
}

export const ACCOUNT = { login: "octo", id: 42, name: "Octo Cat" };

// What `claude auth status --json` prints for a Claude account sign-in (the fields Orbit Web reads, and two it does not).
export const CLAUDE_SIGNED_IN = { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "octo@example.com", orgName: "Octo Org", subscriptionType: "max", storedClaudeAiLogin: true };
export const CLAUDE_SIGNED_OUT = { loggedIn: false, authMethod: "none", apiProvider: "firstParty" };
export const REPOSITORY = "octo/sum-fixture";

// What the Claude CLI's control protocol answers to `initialize` (claude-models.ts): the signed-in account's models.
// The four aliases take every effort level and auto mode; one dated model takes neither.
const EVERY_EFFORT = ["low", "medium", "high", "xhigh", "max"];
export const MODEL_ENTRIES = [
  { value: "default", resolvedModel: "claude-sonnet-5-5", displayName: "Default (recommended)", supportsEffort: true, supportedEffortLevels: EVERY_EFFORT, supportsAutoMode: true },
  { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5", description: "For complex work and everyday tasks", supportsEffort: true, supportedEffortLevels: EVERY_EFFORT, supportsAutoMode: true },
  { value: "fable", resolvedModel: "claude-fable-5-2", displayName: "Fable 5.2", description: "For your toughest challenges", supportsEffort: true, supportedEffortLevels: EVERY_EFFORT, supportsAutoMode: true },
  { value: "sonnet", resolvedModel: "claude-sonnet-5-5", displayName: "Sonnet 5.5", description: "Most efficient for simpler tasks", supportsEffort: true, supportedEffortLevels: EVERY_EFFORT, supportsAutoMode: true },
  { value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku 5.5", description: "Fastest for quick answers", supportsEffort: true, supportedEffortLevels: EVERY_EFFORT, supportsAutoMode: true },
  { value: "claude-haiku-4-5-20251001", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5", description: "Fastest for quick answers", supportsThinkingOff: true },
];

export const modelsAnswer = (models: object[] = MODEL_ENTRIES): string => `${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: "orbit-web-models", response: { models, account: { email: "octo@example.com" } } } })}\n`;

export const claudeModelsProbe = program("claude", "--input-format");

const ghApi = (path: string): ((file: string, args: string[]) => boolean) => (file, args) => program("gh", "api")(file, args) && args.some((a) => a === path || a.startsWith(`${path}?`));

// What `claude auto-mode defaults` prints, cut to a few entries of its environment.
export const AUTO_MODE_DEFAULTS = {
  allow: ["Local Operations: ..."],
  soft_deny: ["Exfil Scouting: ..."],
  hard_deny: ["Data Exfiltration: ..."],
  environment: ["**Organization**: None configured", "**Network posture**: None configured", "**Host containment**: None configured", "**Sensitive data locations & audiences**: any file or store holding credentials"],
};

// Both accounts signed in (Claude to a Claude account), one repository with two branches, and a clone that makes a real
// repository.
export function signedIn(fake: FakeProcessPort): FakeProcessPort {
  return fake
    .on(program("claude", "--version"), { run: { stdout: "2.1.328 (Claude Code)\n" } })
    .on(program("gh", "--version"), { run: { stdout: "gh version 2.89.0 (2026-03-26)\n" } })
    .on(program("az", "version"), { run: { stdout: '{\n  "azure-cli": "2.91.0",\n  "azure-cli-core": "2.91.0",\n  "extensions": {}\n}\n' } })
    .on(program("az", "account", "show"), { run: { code: 1, stderr: "Please run 'az login' to setup account.\n" } })
    .on(program("python3", "--version"), { run: { stdout: "Python 3.15.2\n" } })
    .on(program("claude", "auth", "status"), { run: { stdout: JSON.stringify(CLAUDE_SIGNED_IN) } })
    .on(claudeModelsProbe, { run: { stdout: modelsAnswer() } })
    .on(program("claude", "auto-mode", "defaults"), { run: { stdout: JSON.stringify(AUTO_MODE_DEFAULTS) } })
    .on(program("gh", "auth", "status"), { run: { stdout: JSON.stringify({ hosts: { "github.com": [{ state: "success", active: true, host: "github.com", login: ACCOUNT.login, tokenSource: "/data/github/hosts.yml", gitProtocol: "https" }] } }) } })
    .on(ghApi("user"), { run: { stdout: JSON.stringify(ACCOUNT) } })
    .on(ghApi("user/repos"), { run: { stdout: [{ full_name: REPOSITORY, name: "sum-fixture", owner: "octo", private: true, default_branch: "main", updated_at: "2026-11-01T00:00:00Z", archived: false, fork: false }, { full_name: "acme/tools", name: "tools", owner: "acme", private: false, default_branch: "trunk", updated_at: "2026-10-01T00:00:00Z", archived: false, fork: false }].map((r) => JSON.stringify(r)).join("\n") } })
    .on(program("gh", "repo", "list"), { run: { stdout: JSON.stringify([{ nameWithOwner: REPOSITORY, isPrivate: true, defaultBranchRef: { name: "main" }, updatedAt: "2026-11-01T00:00:00Z", isArchived: false, isFork: false }]) } })
    .on(ghApi(`repos/${REPOSITORY}/branches`), { run: { stdout: [{ name: "main", protected: true, sha: "a".repeat(40) }, { name: "dev", protected: false, sha: "b".repeat(40) }].map((b) => JSON.stringify(b)).join("\n") } })
    .on(ghApi("repos/acme/tools/branches"), { run: { stdout: JSON.stringify({ name: "trunk", protected: false, sha: "c".repeat(40) }) } })
    .on(program("gh", "repo", "clone"), { run: (call) => fixtureClone(call) });
}

const git = (cwd: string, ...args: string[]) => spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", ...args], { cwd, encoding: "utf8" });

// A repository with a wrong addition and the test that catches it, plus any `extra` files (a project's .claude/...).
export function fixtureRepositoryAt(dest: string, extra: Record<string, string> = {}): { code: number } {
  spawnSync("git", ["init", "-q", "-b", "main", dest]);
  writeFileSync(join(dest, "sum.mjs"), "export const sum = (a, b) => a - b;\n");
  writeFileSync(join(dest, "package.json"), `${JSON.stringify({ name: "sum-fixture", type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
  writeFileSync(join(dest, "sum.test.mjs"), 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { sum } from "./sum.mjs";\n\ntest("adds", () => assert.equal(sum(2, 3), 5));\n');
  writeFileSync(join(dest, "README.md"), "# sum fixture\n");
  for (const [path, text] of Object.entries(extra)) {
    mkdirSync(dirname(join(dest, path)), { recursive: true });
    writeFileSync(join(dest, path), text);
  }
  git(dest, "add", ".");
  git(dest, "commit", "-qm", "fixture");
  return { code: 0 };
}

// What `gh repo clone` leaves (its fourth argument is the destination).
export function fixtureClone(call: Call, extra: Record<string, string> = {}): { code: number; stderr?: string } {
  return fixtureRepositoryAt(join(call.cwd, call.args[3] as string), extra);
}

// What `git clone … -- <url> <destination>` leaves.
export function fixtureGitClone(call: Call, extra: Record<string, string> = {}): { code: number } {
  return fixtureRepositoryAt(join(call.cwd, call.args.at(-1) as string), extra);
}

export const gitClone = (file: string, args: string[]): boolean => (file === "git" || file.endsWith("/git")) && args.includes("clone");

// One Azure DevOps organization with one repository (two branches), the Azure CLI signed in, its clone scripted.
export const AZURE = { organization: "Fabrikam", project: "Fiber", name: "Web", repositoryId: "278d5cd2-584d-4b63-824a-2ba458937249", user: "octo@fabrikam.example" };
export const AZURE_REPOSITORY = `${AZURE.organization}/${AZURE.repositoryId}`;

const azRest = (url: string) => (file: string, args: string[]) => program("az", "rest")(file, args) && args.some((a) => a.startsWith(url));

export function azureSignedIn(fake: FakeProcessPort): FakeProcessPort {
  const repo = { id: AZURE.repositoryId, name: AZURE.name, project: { name: AZURE.project, visibility: "private" }, defaultBranch: "refs/heads/main", remoteUrl: `https://${AZURE.organization}@dev.azure.com/${AZURE.organization}/${AZURE.project}/_git/${AZURE.name}` };
  return fake
    .on(program("az", "account", "show"), { run: { stdout: JSON.stringify({ user: { name: AZURE.user, type: "user" }, tenantId: "tenant-1", name: "Fabrikam Dev", id: "sub-1" }) } })
    .on(azRest("https://app.vssps.visualstudio.com/_apis/profile/profiles/me"), { run: { stdout: JSON.stringify({ id: "d6245f20-2af8-44f4-9451-8107cb2767db", displayName: "Octo", emailAddress: AZURE.user }) } })
    .on(azRest("https://app.vssps.visualstudio.com/_apis/accounts"), { run: { stdout: JSON.stringify({ value: [{ accountName: AZURE.organization }] }) } })
    .on(azRest(`https://dev.azure.com/${AZURE.organization}/_apis/git/repositories?`), { run: { stdout: JSON.stringify({ value: [repo] }) } })
    .on(azRest(`https://dev.azure.com/${AZURE.organization}/_apis/git/repositories/${AZURE.repositoryId}/refs`), { run: { stdout: JSON.stringify({ value: [{ name: "refs/heads/main", objectId: "a".repeat(40) }, { name: "refs/heads/dev", objectId: "b".repeat(40) }] }) } })
    .on(gitClone, { run: (call) => fixtureGitClone(call) });
}

// A chat's Claude Code run, and a research run (restricted, no tool): two profiles, told apart by their own flags.
export const claudeRun = (file: string, args: string[]): boolean => program("claude", "-p")(file, args) && !args.includes("--restricted");
export const researchRun = (file: string, args: string[]): boolean => program("claude", "-p")(file, args) && args.includes("--restricted");

// Waits for a condition, polling.
export async function eventually<T>(read: () => Promise<T> | T, ok: (v: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`condition not met in ${timeoutMs} ms: ${JSON.stringify(v).slice(0, 500)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
