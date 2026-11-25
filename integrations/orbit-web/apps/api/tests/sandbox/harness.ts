// THE SANDBOX LAB: a real container runtime, and everything an attempt needs around it, made for one test run and
// removed after it -- Orbit Web's data volume with two connections' homes, a tiny egress proxy of the lab's own standing
// in for Orbit Web's container (the allocator connects it to each attempt's own networks; the run's token is its
// credential, one stand-in origin behind it), and a database stand-in on a network no attempt joins. Every name carries
// the run's prefix, so nothing a person runs is touched.
//
// Images: the `workstation` and `storage-helper` targets of docker/Dockerfile are built (cached by the runtime), and
// the model plane is a light image with the runner as this tree compiled it -- unless ORBIT_WEB_SANDBOX_TEST_MODEL_PLANE
// names a model-plane image built from the Dockerfile's own target. ORBIT_WEB_SANDBOX_TEST_BUILD=0 uses what is there.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Allocator } from "../../src/allocator/allocator.js";
import { execIn, runOnce, text } from "../../src/allocator/containers.js";
import { DockerEngine } from "../../src/allocator/docker/engine.js";
import { loadSandboxConfig, type SandboxConfig } from "../../src/config/sandbox-config.js";
import { ContainerSandboxProvider, DNS_PROBE, EGRESS_PROBE } from "../../src/contexts/execution/infrastructure/sandbox/container-provider.js";
import type { AllocatorApi } from "../../src/contexts/execution/infrastructure/sandbox/allocator-protocol.js";

export const SOCKET = process.env.ORBIT_WEB_DOCKER_SOCKET ?? "/var/run/docker.sock";
const WEB = fileURLToPath(new URL("../../../../../", import.meta.url));
const REPO = join(WEB, "..", "..");
const COMPILED = fileURLToPath(new URL("../../src/", import.meta.url));

export const IMAGES = {
  workstation: "orbit-web-workstation:sandbox-test",
  storageHelper: "orbit-web-storage-helper:sandbox-test",
  modelPlane: process.env.ORBIT_WEB_SANDBOX_TEST_MODEL_PLANE ?? "orbit-web-model-plane:sandbox-test",
  // A chat's or research run's own sandbox: the Orbit Web image (its runner) -- one built here, or the one named.
  session: process.env.ORBIT_WEB_SANDBOX_TEST_SESSION ?? "ghcr.io/cuongngoht/orbit-web:0.8.0",
};

// Null when a runtime answers here; else why the suite is skipped.
export async function dockerUnavailable(): Promise<string | null> {
  if (!existsSync(SOCKET)) return `no container runtime socket at ${SOCKET}`;
  return (await new DockerEngine(SOCKET).ping()) ? null : `the container runtime at ${SOCKET} does not answer`;
}

function docker(args: string[], cwd = REPO): void {
  const r = spawnSync("docker", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DOCKER_BUILDKIT: "1" } });
  if (r.status !== 0) throw new Error(`docker ${args.slice(0, 6).join(" ")} failed: ${(r.stderr || r.stdout).slice(-3000)}`);
}

// Behind a proxy (the variables this process has), builds go through it, and its CA is a build secret.
function buildArgs(): string[] {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  const ca = process.env.ORBIT_WEB_TEST_BUILD_CA ?? process.env.NODE_EXTRA_CA_CERTS;
  return [...(proxy ? ["--network", "host", "--build-arg", `HTTPS_PROXY=${proxy}`, "--build-arg", `https_proxy=${proxy}`] : []), ...(ca && existsSync(ca) ? ["--secret", `id=ca,src=${ca}`] : [])];
}

export async function ensureImages(): Promise<void> {
  const engine = new DockerEngine(SOCKET);
  const build = process.env.ORBIT_WEB_SANDBOX_TEST_BUILD !== "0";
  for (const [target, tag] of [["workstation", IMAGES.workstation], ["storage-helper", IMAGES.storageHelper]] as const) {
    if (build || (await engine.imageInspect(tag)) === null) docker(["build", "-q", "-f", "integrations/orbit-web/docker/Dockerfile", "--target", target, "-t", tag, ...buildArgs(), "."]);
  }
  if (process.env.ORBIT_WEB_SANDBOX_TEST_MODEL_PLANE) {
    if ((await engine.imageInspect(IMAGES.modelPlane)) === null) throw new Error(`no image ${IMAGES.modelPlane}`);
    return;
  }
  // The light model plane: the runner exactly as this tree compiled it, on the workstation's base, no managed settings.
  const ctx = mkdtempSync(join(tmpdir(), "model-plane-ctx-"));
  try {
    cpSync(join(COMPILED, "runner"), join(ctx, "dist/runner"), { recursive: true });
    cpSync(join(COMPILED, "infra/process"), join(ctx, "dist/infra/process"), { recursive: true });
    writeFileSync(join(ctx, "package.json"), '{"type":"module"}\n');
    writeFileSync(
      join(ctx, "Dockerfile"),
      [`FROM ${IMAGES.workstation}`, "USER root", "COPY dist/ /opt/orbit-web/apps/api/dist/", "COPY package.json /opt/orbit-web/apps/api/package.json", "RUN chmod -R a+rX /opt/orbit-web && mkdir -p /connection /workdir /home/orbit && test ! -e /etc/claude-code", "USER 10001:10001", "WORKDIR /workdir", 'CMD ["node", "/opt/orbit-web/apps/api/dist/runner/main.js"]', ""].join("\n"),
    );
    docker(["build", "-q", "-t", IMAGES.modelPlane, "."], ctx);
  } finally {
    rmSync(ctx, { recursive: true, force: true });
  }
}

// The lab's egress proxy: CONNECT and plain HTTP, only with `run:<token>` as its credential, only to `origin.test`
// (served by itself on 8080). Anything else: 407 or 403.
const PROXY = `
const http = require("http"), net = require("net");
const ok = (h) => typeof h === "string" && h.startsWith("Basic ") && Buffer.from(h.slice(6), "base64").toString() === "run:" + process.env.TOKEN;
http.createServer((q, s) => s.end("origin-ok " + q.url)).listen(8080, "127.0.0.1");
const proxy = http.createServer((req, res) => {
  if (!ok(req.headers["proxy-authorization"])) { res.writeHead(407); return res.end("no run token"); }
  let u; try { u = new URL(req.url); } catch { res.writeHead(400); return res.end(); }
  if (u.hostname !== "origin.test") { res.writeHead(403); return res.end("not allowed"); }
  const up = http.request({ host: "127.0.0.1", port: 8080, path: u.pathname, method: req.method }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  req.pipe(up);
});
proxy.on("connect", (req, sock, head) => {
  if (!ok(req.headers["proxy-authorization"])) return sock.end("HTTP/1.1 407 Proxy Authentication Required\\r\\n\\r\\n");
  if (req.url.split(":")[0] !== "origin.test") return sock.end("HTTP/1.1 403 Forbidden\\r\\n\\r\\n");
  const up = net.connect(8080, "127.0.0.1", () => { sock.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n"); up.write(head); up.pipe(sock); sock.pipe(up); });
});
proxy.listen(3128);
`;

export interface Lab {
  prefix: string;
  secret: string;
  config: SandboxConfig;
  engine: DockerEngine;
  allocator: Allocator;
  provider: (api?: AllocatorApi) => ContainerSandboxProvider;
  runToken: string;
  databaseIp: string;
  orbitA: string;
  orbitB: string;
  // A file of each account's connection home, which no tool plane may see.
  credential: string;
  cleanup(): Promise<void>;
}

const TEST_LABEL = "orbit-web.test";

export async function createLab(): Promise<Lab> {
  const engine = new DockerEngine(SOCKET);
  const prefix = `owt${randomBytes(3).toString("hex")}`;
  const labels = { [TEST_LABEL]: prefix };
  const secret = randomBytes(24).toString("hex");
  const runToken = `run_${randomBytes(12).toString("hex")}`;
  const orbitA = `a${randomBytes(4).toString("hex")}`;
  const orbitB = `b${randomBytes(4).toString("hex")}`;
  const credential = randomBytes(16).toString("hex");
  const state = mkdtempSync(join(tmpdir(), "allocator-state-"));
  const net = (n: string) => `${prefix}-${n}`;
  const config = loadSandboxConfig({
    ORBIT_WEB_SANDBOX: "container",
    ORBIT_WEB_ALLOCATOR_URL: "http://127.0.0.1:7171",
    ORBIT_WEB_SANDBOX_PREFIX: prefix,
    ORBIT_WEB_SANDBOX_IMAGE_WORKSTATION: IMAGES.workstation,
    ORBIT_WEB_SANDBOX_IMAGE_MODEL_PLANE: IMAGES.modelPlane,
    ORBIT_WEB_SANDBOX_IMAGE_STORAGE_HELPER: IMAGES.storageHelper,
    ORBIT_WEB_SANDBOX_IMAGE_SESSION: IMAGES.session,
    // The lab's proxy plays Orbit Web's container: connected to each attempt's two networks, under the name attempts use.
    ORBIT_WEB_CONTROL_CONTAINER: net("proxy"),
    ORBIT_WEB_SANDBOX_HOST: "egress",
    // Unset: the runtime's own address pools; set (e.g. 10.231.0.0/24): /28 networks cut from it.
    ORBIT_WEB_ATTEMPT_SUBNETS: process.env.ORBIT_WEB_SANDBOX_TEST_SUBNETS ?? "",
    ORBIT_WEB_DATA_VOLUME: net("data"),
    ORBIT_WEB_WORKFORCE_POOL_SIZE: process.env.ORBIT_WEB_SANDBOX_TEST_POOL ?? "2g",
    ORBIT_WEB_ALLOCATOR_STATE_DIR: state,
    ORBIT_WEB_DOCKER_SOCKET: SOCKET,
  });
  const cleanup = async () => {
    const all = [...(await engine.containerList({ "orbit-web.prefix": prefix })), ...(await engine.containerList({ [TEST_LABEL]: prefix }))];
    await Promise.all(all.map((c) => engine.containerRemove(c.Id, true).catch(() => undefined)));
    await new Allocator({ config, secret, engine }).storage.destroy().catch(() => undefined);
    // An attempt's networks a failed test left: whatever is still connected, disconnected; then removed.
    for (const n of await engine.networkList({ "orbit-web.prefix": prefix }).catch(() => [])) {
      for (const member of Object.keys((await engine.networkInspect(n.Name))?.Containers ?? {})) await engine.networkDisconnect(n.Name, member).catch(() => undefined);
      await engine.networkRemove(n.Name).catch(() => undefined);
    }
    for (const n of ["lab", "db"]) await engine.networkRemove(net(n)).catch(() => undefined);
    await engine.volumeRemove(net("data")).catch(() => undefined);
    for (const v of ["probe-xfs-project", "probe-xfs-loop-pool", "probe-btrfs-qgroup", "probe-loop-per-volume"]) await engine.volumeRemove(`${prefix}-${v}`).catch(() => undefined);
    rmSync(state, { recursive: true, force: true });
  };
  try {
    await engine.networkCreate({ Name: net("lab"), Internal: true, Labels: labels });
    await engine.networkCreate({ Name: net("db"), Internal: true, Labels: labels });
    await engine.volumeCreate({ Name: net("data"), Labels: labels });
    // Two accounts' connection homes, Orbit Web's (10001), each with its login file.
    const seed = await runOnce(engine, prefix, { Image: IMAGES.workstation, User: "0:0", Cmd: ["sleep", "120"], Labels: labels, HostConfig: { NetworkMode: "none", Mounts: [{ Type: "volume", Source: net("data"), Target: "/data" }] } }, ["sh", "-c", 'for o in "$1" "$2"; do mkdir -p "/data/connections/$o/conn-1/claude"; printf %s "$3" > "/data/connections/$o/conn-1/claude/.credentials.json"; done; chown -R 10001:10001 /data/connections; chmod -R go-rwx /data/connections; mkdir -p /data/workspaces/chat-a/repository /data/workspaces/chat-b/repository /data/sessions/chat-a /data/orbit/accounts/$1 /data/control/credentials; echo mine > /data/workspaces/chat-a/repository/mine.txt; echo theirs > /data/workspaces/chat-b/repository/theirs.txt; echo secret > /data/control/credentials/key; chown -R 10001:10001 /data/workspaces /data/sessions /data/orbit /data/control', "seed", orbitA, orbitB, credential], { timeoutMs: 60_000, maxOutputBytes: 65536 });
    if (seed.code !== 0) throw new Error(`seeding the connections room failed: ${text(seed.stderr)}`);
    // The egress proxy (joined to each attempt's networks by the allocator, as `egress`); the database stand-in alone.
    const proxy = await engine.containerCreate(net("proxy"), { Image: IMAGES.workstation, User: "20001:20001", Cmd: ["node", "-e", PROXY], Env: [`TOKEN=${runToken}`], Labels: labels, HostConfig: { NetworkMode: net("lab"), Init: true } });
    const db = await engine.containerCreate(net("db"), { Image: IMAGES.workstation, User: "20001:20001", Cmd: ["node", "-e", "require('net').createServer(s=>s.end('db')).listen(5432)"], Labels: labels, HostConfig: { NetworkMode: net("db"), Init: true } });
    if (proxy === null || db === null) throw new Error("the lab's proxy or database container already exists");
    await engine.containerStart(proxy.id);
    await engine.containerStart(db.id);
    const databaseIp = (await engine.containerInspect(db.id))?.NetworkSettings.Networks?.[net("db")]?.IPAddress ?? "";
    // The proxy listens before an attempt needs it.
    for (let i = 0; i < 50; i += 1) {
      const r = await execIn(engine, proxy.id, ["node", "-e", "require('net').connect(3128,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"], { timeoutMs: 5000, maxOutputBytes: 1024 });
      if (r.code === 0) break;
      await new Promise((res) => setTimeout(res, 100));
    }
    const allocator = new Allocator({ config, secret, engine });
    const provider = (api: AllocatorApi = allocator) =>
      new ContainerSandboxProvider(api, {
        secret,
        prefix,
        modelPlaneAddress: "ip",
        readInput: async (p) => Buffer.from(`input:${p}`),
        probes: { egress: EGRESS_PROBE, dnsName: DNS_PROBE, database: { host: databaseIp, port: 5432 } },
        acceptSoftStorage: false,
      });
    mkdirSync(state, { recursive: true });
    return { prefix, secret, config, engine, allocator, provider, runToken, databaseIp, orbitA, orbitB, credential, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
