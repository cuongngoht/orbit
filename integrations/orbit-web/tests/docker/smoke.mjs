#!/usr/bin/env node
// THE DOCKER SMOKE TEST: the real image, started the way a person starts it, checked from outside. No credential is
// used: it proves the image builds and starts, serves the web app and the API, holds the four programs and a loadable
// Orbit plugin, runs as a non-root user, opens on the Claude sign-in when nobody signed in -- every other route refused
// -- and keeps its state across a restart and across re-creating the container from the same volume. That last part
// needs the API open, so a Claude account sign-in is stood in for there (claude-signed-in.mjs; a real one needs a
// person), and those checks say so.
//
//   node tests/docker/smoke.mjs [--image=orbit-web:0.8.0] [--build] [--ca-file=<pem>] [--keep]
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { request } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const opt = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const flag = (name) => process.argv.includes(`--${name}`);

const image = opt("image") ?? "orbit-web:smoke";
const suffix = randomBytes(4).toString("hex");
const name = `orbit-web-smoke-${suffix}`;
const volume = `orbit-web-smoke-${suffix}`;
const results = [];

const docker = (args, o = {}) => spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...o });

function check(label, ok, detail = "") {
  results.push({ label, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` -- ${detail}` : ""}\n`);
}

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(port, path, init = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, headers: res.headers, body, text };
}

// fetch() will not send a Host header of our choosing.
const rawStatus = (port, path, host) =>
  new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", () => resolve(0));
    req.end();
  });

async function healthy(port, seconds = 90) {
  for (let i = 0; i < seconds; i += 1) {
    const state = docker(["inspect", "--format", "{{.State.Health.Status}}", name]).stdout.trim();
    if (state === "healthy") return true;
    if (state === "unhealthy") return false;
    await sleep(1000);
  }
  return false;
}

const exec = (...args) => docker(["exec", name, ...args]);

// `signedIn`: the Claude CLI's sign-in is stood in for (mounted read-only and named by ORBIT_WEB_CLAUDE_BIN).
function start(port, { signedIn = false } = {}) {
  const standIn = signedIn ? ["-v", `${join(WEB, "tests", "docker", "claude-signed-in.mjs")}:/smoke/claude-signed-in.mjs:ro`, "-e", "ORBIT_WEB_CLAUDE_BIN=/smoke/claude-signed-in.mjs"] : [];
  return docker(["run", "-d", "--name", name, "--hostname", "orbit-web", "-p", `127.0.0.1:${port}:3000`, "-v", `${volume}:/data`, ...standIn, "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", image]);
}

const SIGN_IN_REQUIRED = "claude_sign_in_required";

async function main() {
  if (flag("build")) {
    const args = ["scripts/build-image.mjs", `--tag=${image}`, ...(opt("ca-file") ? [`--ca-file=${opt("ca-file")}`] : [])];
    check("1. the image builds", spawnSync(process.execPath, args, { cwd: WEB, stdio: "inherit" }).status === 0);
  } else check("1. the image exists", docker(["image", "inspect", image]).status === 0, image);

  const port = await freePort();
  const run = start(port);
  check("2. the container starts", run.status === 0, run.stderr.trim());
  check("   ...and reports healthy", await healthy(port));

  const index = await http(port, "/");
  check("3. the web UI responds", index.status === 200 && /<div id="root">/.test(index.text), `HTTP ${index.status}`);
  check("   ...with a strict content security policy", /script-src 'self'/.test(index.headers.get("content-security-policy") ?? ""));
  const health = await http(port, "/api/health");
  check("4. the API responds (GET /api/health)", health.status === 200 && health.body.status === "ok", JSON.stringify(health.body).slice(0, 300));

  const versions = {
    claude: exec("claude", "--version"),
    gh: exec("gh", "--version"),
    git: exec("git", "--version"),
    node: exec("node", "--version"),
    az: exec("az", "version", "--output", "json"),
  };
  check("5. claude is installed", versions.claude.status === 0, versions.claude.stdout.trim());
  check("6. gh is installed", versions.gh.status === 0, versions.gh.stdout.split("\n")[0]);
  check("7. git is installed", versions.git.status === 0, versions.git.stdout.trim());
  check("   node is installed", versions.node.status === 0, versions.node.stdout.trim());
  check("   the Azure CLI is installed (optional component)", versions.az.status === 0, (/"azure-cli": "([^"]+)"/.exec(versions.az.stdout) ?? [])[1] ?? versions.az.stderr.trim().slice(0, 200));

  const validate = exec("claude", "plugin", "validate", "/opt/orbit/plugin");
  check("8. the Orbit plugin is present and loadable (claude plugin validate)", validate.status === 0, validate.stdout.trim().split("\n").at(-1));
  const shipped = exec("sh", "-c", "test -f /opt/orbit/plugin/.claude-plugin/plugin.json && test ! -e /opt/orbit/plugin/evaluator && test ! -e /opt/orbit/plugin/integrations && echo ok");
  check("   ...as git archive made it (no evaluator/, no integrations/)", shipped.stdout.trim() === "ok");
  check("   ...and the API reads it", health.body.orbitPlugin?.ok === true, JSON.stringify(health.body.orbitPlugin));

  const id = exec("id", "-u");
  check("   the container runs as a non-root user", id.status === 0 && id.stdout.trim() !== "0", `uid ${id.stdout.trim()}`);
  const perms = exec("stat", "-c", "%a %U", "/data/claude", "/data/github", "/data/azure", "/data/app");
  check("   the persistent directories are private to that user", perms.stdout.trim().split("\n").every((l) => l.startsWith("700 ")), perms.stdout.trim().replace(/\n/g, ", "));

  const terminal = exec("claude", "auth", "status", "--json");
  const where = (() => {
    try {
      return JSON.parse(terminal.stdout).configDirectory ?? null;
    } catch {
      return null;
    }
  })();
  check("   a terminal sign-in (docker exec ... claude auth login) lands where Orbit Web reads it", where === "/data/claude", `claude in the container keeps its sign-in in ${where}`);
  const claude = await http(port, "/api/claude/status");
  check("11. missing authentication opens on the Claude sign-in", claude.status === 200 && claude.body.state === "not_connected" && claude.body.account === null, `claude ${claude.body.state}`);
  const gated = await Promise.all(["/api/setup/status", "/api/settings", "/api/github/status", "/api/sessions"].map(async (path) => [path, await http(port, path)]));
  check("   ...and every other route waits for it", gated.every(([, r]) => r.status === 401 && r.body.error?.code === SIGN_IN_REQUIRED), gated.map(([path, r]) => `${path} ${r.status}`).join(", "));
  check("   a foreign Host header is refused", (await rawStatus(port, "/api/health", "attacker.example")) === 421);
  const naked = await http(port, "/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"theme":"dark"}' });
  check("   a change without the Orbit Web header is refused", naked.status === 403);

  // From here the API must be open: the same volume, a new container whose Claude sign-in is stood in for.
  docker(["rm", "-f", name]);
  start(port, { signedIn: true });
  await healthy(port);
  const setup = await http(port, "/api/setup/status");
  check("   a Claude account sign-in (STAND-IN: a real one needs a person) opens the API", setup.status === 200 && setup.body.claude?.account?.email === "smoke@example.com", `HTTP ${setup.status}`);
  check("   ...which reads the build info", /^[0-9a-f]{40}$/.test(setup.body.versions?.orbitCommit ?? ""), JSON.stringify(setup.body.versions));
  const change = await http(port, "/api/settings", { method: "PATCH", headers: { "content-type": "application/json", "x-orbit-web": "1" }, body: JSON.stringify({ theme: "dark", defaultModel: "opus" }) });
  check("9. state is written to the volume", change.status === 200 && change.body.defaultModel === "opus");
  docker(["restart", name]);
  await healthy(port);
  const afterRestart = await http(port, "/api/settings");
  check("10. a restart keeps the state", afterRestart.body.defaultModel === "opus" && afterRestart.body.theme === "dark", JSON.stringify(afterRestart.body));
  docker(["rm", "-f", name]);
  start(port, { signedIn: true });
  await healthy(port);
  const afterRecreate = await http(port, "/api/settings");
  check("   a new container on the same volume keeps it too", afterRecreate.body.defaultModel === "opus", JSON.stringify(afterRecreate.body));

  if (!flag("keep")) {
    docker(["rm", "-f", name]);
    docker(["volume", "rm", volume]);
  }
  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} Docker checks passed${flag("keep") ? ` (kept ${name}, volume ${volume})` : ""}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  // fetch() says only "fetch failed"; what happened to the connection is its cause.
  process.stdout.write(`FAIL  the smoke test itself: ${err.stack ?? err}${err.cause ? `\n  cause: ${err.cause.stack ?? err.cause}` : ""}\n`);
  // What the container was doing, before it is removed.
  const state = docker(["inspect", "--format", "{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} started={{.State.StartedAt}}", name]);
  process.stdout.write(`  container: ${(state.stdout || state.stderr).trim()}\n`);
  const logs = docker(["logs", "--tail", "40", name]);
  process.stdout.write(`  its last log lines:\n${`${logs.stdout}${logs.stderr}`.trim().split("\n").map((l) => `    ${l}`).join("\n")}\n`);
  docker(["rm", "-f", name]);
  docker(["volume", "rm", volume]);
  process.exit(1);
});
