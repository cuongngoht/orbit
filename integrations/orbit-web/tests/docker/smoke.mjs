#!/usr/bin/env node
// THE DOCKER SMOKE TEST: the real image, started the way a person starts it, checked from outside. No credential is
// used: it proves the image builds and starts, serves the web app and the API, holds the four programs and a loadable
// Orbit plugin, runs as a non-root user, opens on the Claude sign-in when nobody signed in -- every other route refused
// -- and keeps its state (Settings, and a research workspace with a source it read and indexed in the container's own
// worker) across a restart and across re-creating the container from the same volume. That last part
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

const MUTATE = { "content-type": "application/json", "x-orbit-web": "1" };
const succeeded = (r) => r.status >= 200 && r.status < 300;
const RESEARCH_TEXT = "Smoke test notes. Orbit Web keeps research sources on its own data volume; a restart keeps them.";

// A research workspace and one pasted source, waited for until it is read and indexed.
async function researchSeed(port) {
  const made = await http(port, "/api/research/workspaces", { method: "POST", headers: MUTATE, body: JSON.stringify({ name: "Smoke research", description: "made by the Docker smoke test" }) });
  if (!succeeded(made)) return { ok: false, detail: `create workspace: HTTP ${made.status} ${made.text.slice(0, 200)}` };
  const workspace = made.body.id;
  const added = await http(port, `/api/research/workspaces/${workspace}/sources/text`, { method: "POST", headers: MUTATE, body: JSON.stringify({ title: "Smoke notes", text: RESEARCH_TEXT }) });
  // 202: a source is accepted and queued; it is read and indexed after the answer.
  if (!succeeded(added)) return { ok: false, workspace, detail: `add text: HTTP ${added.status} ${added.text.slice(0, 200)}` };
  const ready = await sourceState(port, workspace, added.body.id, 30);
  return { ok: ready === "ready", workspace, source: added.body.id, detail: `source ${ready}` };
}

async function sourceState(port, workspace, source, seconds) {
  let state = "missing";
  for (let i = 0; i < seconds; i += 1) {
    const list = await http(port, `/api/research/workspaces/${workspace}/sources`);
    state = Array.isArray(list.body) ? (list.body.find((s) => s.id === source)?.state ?? "missing") : `HTTP ${list.status}`;
    if (state === "ready" || state === "failed") return state;
    await sleep(1000);
  }
  return state;
}

async function researchKept(port, seeded) {
  if (!seeded.workspace || !seeded.source) return { ok: false, detail: "nothing was made to keep" };
  const listed = await http(port, "/api/research/workspaces");
  const found = Array.isArray(listed.body) && listed.body.some((w) => w.id === seeded.workspace && w.sourceCount === 1);
  const state = await sourceState(port, seeded.workspace, seeded.source, 1);
  const content = await http(port, `/api/research/sources/${seeded.source}/content`);
  const text = JSON.stringify(content.body);
  return { ok: found && state === "ready" && text.includes("own data volume"), detail: `workspace ${found ? "listed" : "missing"}, source ${state}, content HTTP ${content.status}` };
}

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
  // Claude Code's Python: the pinned CPython on PATH, with pip and venv, usable by the image's own (non-root) user.
  const python = exec("python3", "-c", "import sys, venv, ensurepip; print(sys.version.split()[0])");
  const venv = exec("sh", "-c", "python3 -m venv /tmp/smoke-venv && /tmp/smoke-venv/bin/python -m pip --version && rm -rf /tmp/smoke-venv");
  check("   Python is installed for Claude Code (optional component: the pinned CPython, with pip and venv)", python.status === 0 && /^3\.\d+\.\d+$/.test(python.stdout.trim()) && venv.status === 0, `${python.stdout.trim()} ${venv.stdout.trim().split("\n").at(-1) ?? venv.stderr.trim().slice(0, 200)}`);

  const validate = exec("claude", "plugin", "validate", "/opt/orbit/plugin");
  check("8. the Orbit plugin is present and loadable (claude plugin validate)", validate.status === 0, validate.stdout.trim().split("\n").at(-1));
  const shipped = exec("sh", "-c", "test -f /opt/orbit/plugin/.claude-plugin/plugin.json && test ! -e /opt/orbit/plugin/evaluator && test ! -e /opt/orbit/plugin/integrations && echo ok");
  check("   ...as git archive made it (no evaluator/, no integrations/)", shipped.stdout.trim() === "ok");
  check("   ...and the API reads it", health.body.orbitPlugin?.ok === true, JSON.stringify(health.body.orbitPlugin));

  const id = exec("id", "-u");
  check("   the container runs as a non-root user", id.status === 0 && id.stdout.trim() !== "0", `uid ${id.stdout.trim()}`);
  // Everything Orbit Web and the plugin ship can be read by that user, whatever mode a file had in the checkout the
  // image was built from (a deploy under umask 077 once shipped a package.json only root could read: a crash loop).
  const unreadable = exec("sh", "-c", "find /opt/orbit-web /opt/orbit \\( -name node_modules -prune \\) -o ! -readable -print | head -5");
  check("   that user can read everything Orbit Web and the plugin ship", unreadable.status === 0 && unreadable.stdout.trim() === "", unreadable.stdout.trim().replace(/\n/g, ", ") || unreadable.stderr.trim().slice(0, 200));
  const perms = exec("stat", "-c", "%a %U", "/data/claude", "/data/github", "/data/azure", "/data/app", "/data/research");
  check("   the persistent directories are private to that user", perms.stdout.trim().split("\n").every((l) => l.startsWith("700 ")), perms.stdout.trim().replace(/\n/g, ", "));
  // What Claude Code runs as: it creates, edits, renames and deletes in a chat's workspace, and cannot write the
  // image's programs or the plugin (whatever its permission rules then allow is Claude Code's to decide).
  const rights = exec("sh", "-c", 'd=/data/workspaces/smoke-rights/repository && mkdir -p "$d/sub" && echo a > "$d/f" && echo b >> "$d/f" && mv "$d/f" "$d/sub/g" && rm -r /data/workspaces/smoke-rights && ! touch /opt/orbit/plugin/x 2>/dev/null && ! touch /opt/claude/bin/x 2>/dev/null && ! touch /opt/orbit-web/x 2>/dev/null && echo ok');
  check("   that user creates, edits, renames and deletes in /data/workspaces, and cannot write the programs or the plugin", rights.stdout.trim() === "ok", rights.stderr.trim().slice(0, 200));
  const helper = exec("sh", "-c", 'test -x /opt/orbit-web/docker/git-credential-azure-cli.mjs && printf "protocol=https\\nhost=github.com\\n\\n" | /opt/orbit-web/docker/git-credential-azure-cli.mjs get; echo "exit=$?"');
  check("   the Azure Repos credential helper is there, and answers nothing for another host", helper.stdout.trim() === "exit=0", (helper.stdout + helper.stderr).trim().slice(0, 200));

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
  // Research keeps its workspaces in the database and its documents under /data/research: one of each, made now, read
  // back after the restart and after the new container. A pasted text is read and indexed without any model.
  const research = await researchSeed(port);
  check("   a research workspace and a pasted source are kept (read and indexed, no model asked)", research.ok, research.detail);
  docker(["restart", name]);
  await healthy(port);
  const afterRestart = await http(port, "/api/settings");
  check("10. a restart keeps the state", afterRestart.body.defaultModel === "opus" && afterRestart.body.theme === "dark", JSON.stringify(afterRestart.body));
  const researchAfterRestart = await researchKept(port, research);
  check("   ...and the research workspace with its source, still ready", researchAfterRestart.ok, researchAfterRestart.detail);
  docker(["rm", "-f", name]);
  start(port, { signedIn: true });
  await healthy(port);
  const afterRecreate = await http(port, "/api/settings");
  check("   a new container on the same volume keeps it too", afterRecreate.body.defaultModel === "opus", JSON.stringify(afterRecreate.body));
  const researchAfterRecreate = await researchKept(port, research);
  check("   ...research included", researchAfterRecreate.ok, researchAfterRecreate.detail);
  const objects = exec("sh", "-c", 'find "/data/research/workspaces/$1/objects" -type f | wc -l', "sh", research.workspace ?? "none");
  check("   the source's bytes are in /data/research, kept by their hash", objects.status === 0 && Number(objects.stdout.trim()) >= 1, `${objects.stdout.trim() || objects.stderr.trim().slice(0, 200)} file(s)`);

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
