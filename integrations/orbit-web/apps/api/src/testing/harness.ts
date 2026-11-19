// An Orbit Web API for a test: a temporary data directory, the real module tree with the process port replaced by a
// FakeProcessPort (git and Orbit's own CLIs run for real; claude and gh are scripted), listening on a free port.
import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MUTATION_HEADER } from "@orbit-web/contracts";
import { AppModule } from "../app.module.js";
import { configureApp } from "../bootstrap.js";
import { DEFAULT_LIMITS, loadConfig, type AppConfig } from "../config/config.js";
import { ensureDataDirs } from "../config/data-dirs.js";
import { PROCESS_PORT } from "../core/tokens.js";
import { NodeProcessPort } from "../infra/process/node-process.js";
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

export interface Harness {
  url: string;
  app: NestExpressApplication;
  fake: FakeProcessPort;
  config: AppConfig;
  dataDir: string;
  get(path: string, headers?: Record<string, string>): Promise<Reply>;
  send(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Reply>;
  events(path: string, o: { lastEventId?: number; until: (events: Record<string, unknown>[]) => boolean; timeoutMs?: number }): Promise<{ frames: SseFrame[]; events: Record<string, unknown>[] }>;
  close(keepData?: boolean): Promise<void>;
}

export interface SseFrame {
  id: string | null;
  data: Record<string, unknown>;
}

export interface HarnessOptions {
  dataDir?: string;
  fake?: FakeProcessPort;
  env?: Record<string, string>;
}

export async function startHarness(o: HarnessOptions = {}): Promise<Harness> {
  const dataDir = o.dataDir ?? mkdtempSync(join(tmpdir(), "orbit-web-test-"));
  const config = loadConfig({ PATH: process.env.PATH, ORBIT_WEB_DATA_DIR: dataDir, ORBIT_PLUGIN_DIR: orbitPluginDir(), ORBIT_WEB_BUILD_INFO: join(dataDir, "no-build-info.json"), ...o.env });
  config.limits = { ...DEFAULT_LIMITS, loginTimeoutMs: 3_000, stopGraceMs: 300, orbitRefreshMs: 50 };
  ensureDataDirs(config.data);
  const fake = o.fake ?? signedIn(new FakeProcessPort(new NodeProcessPort()));
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(PROCESS_PORT)
    .useValue(fake)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, config);
  await app.listen(0, "127.0.0.1");
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;
  const reply = async (r: Response): Promise<Reply> => {
    const text = await r.text();
    return { status: r.status, body: jsonOr(text), headers: r.headers };
  };
  return {
    url,
    app,
    fake,
    config,
    dataDir,
    get: async (path, headers = {}) => reply(await fetch(`${url}${path}`, { headers })),
    send: async (method, path, body, headers = {}) =>
      reply(
        await fetch(`${url}${path}`, {
          method,
          headers: { [MUTATION_HEADER]: "1", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }),
      ),
    events: (path, opts) => readSse(`${url}${path}`, opts),
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
export const REPOSITORY = "octo/sum-fixture";

const ghApi = (path: string): ((file: string, args: string[]) => boolean) => (file, args) => program("gh", "api")(file, args) && args.some((a) => a === path || a.startsWith(`${path}?`));

// Both accounts signed in, one repository with two branches, and a clone that makes a real repository.
export function signedIn(fake: FakeProcessPort): FakeProcessPort {
  return fake
    .on(program("claude", "--version"), { run: { stdout: "2.1.328 (Claude Code)\n" } })
    .on(program("gh", "--version"), { run: { stdout: "gh version 2.89.0 (2026-03-26)\n" } })
    .on(program("az", "version"), { run: { stdout: '{\n  "azure-cli": "2.91.0",\n  "azure-cli-core": "2.91.0",\n  "extensions": {}\n}\n' } })
    .on(program("az", "account", "show"), { run: { code: 1, stderr: "Please run 'az login' to setup account.\n" } })
    .on(program("claude", "auth", "status"), { run: { stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" }) } })
    .on(program("gh", "auth", "status"), { run: { stdout: JSON.stringify({ hosts: { "github.com": [{ state: "success", active: true, host: "github.com", login: ACCOUNT.login, tokenSource: "/data/github/hosts.yml", gitProtocol: "https" }] } }) } })
    .on(ghApi("user"), { run: { stdout: JSON.stringify(ACCOUNT) } })
    .on(ghApi("user/repos"), { run: { stdout: [{ full_name: REPOSITORY, name: "sum-fixture", owner: "octo", private: true, default_branch: "main", updated_at: "2026-11-01T00:00:00Z", archived: false, fork: false }, { full_name: "acme/tools", name: "tools", owner: "acme", private: false, default_branch: "trunk", updated_at: "2026-10-01T00:00:00Z", archived: false, fork: false }].map((r) => JSON.stringify(r)).join("\n") } })
    .on(program("gh", "repo", "list"), { run: { stdout: JSON.stringify([{ nameWithOwner: REPOSITORY, isPrivate: true, defaultBranchRef: { name: "main" }, updatedAt: "2026-11-01T00:00:00Z", isArchived: false, isFork: false }]) } })
    .on(ghApi(`repos/${REPOSITORY}/branches`), { run: { stdout: [{ name: "main", protected: true, sha: "a".repeat(40) }, { name: "dev", protected: false, sha: "b".repeat(40) }].map((b) => JSON.stringify(b)).join("\n") } })
    .on(ghApi("repos/acme/tools/branches"), { run: { stdout: JSON.stringify({ name: "trunk", protected: false, sha: "c".repeat(40) }) } })
    .on(program("gh", "repo", "clone"), { run: (call) => fixtureClone(call) });
}

const git = (cwd: string, ...args: string[]) => spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", ...args], { cwd, encoding: "utf8" });

// What `gh repo clone` leaves: a repository with a wrong addition and the test that catches it.
export function fixtureClone(call: Call): { code: number; stderr?: string } {
  const dest = join(call.cwd, call.args[3] as string);
  spawnSync("git", ["init", "-q", "-b", "main", dest]);
  writeFileSync(join(dest, "sum.mjs"), "export const sum = (a, b) => a - b;\n");
  writeFileSync(join(dest, "package.json"), `${JSON.stringify({ name: "sum-fixture", type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
  writeFileSync(join(dest, "sum.test.mjs"), 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { sum } from "./sum.mjs";\n\ntest("adds", () => assert.equal(sum(2, 3), 5));\n');
  writeFileSync(join(dest, "README.md"), "# sum fixture\n");
  git(dest, "add", ".");
  git(dest, "commit", "-qm", "fixture");
  return { code: 0 };
}

export const claudeRun = program("claude", "-p");

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
