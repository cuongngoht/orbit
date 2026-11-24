#!/usr/bin/env node
// THE DOCKER SMOKE TEST: the real image, started the way a person starts it -- beside a real PostgreSQL with pgvector
// (the pinned image of docker/compose.yaml, initialised by docker/postgres/init) -- checked from outside. No credential
// of any AI provider is used: it proves the image builds and starts, migrates the database (pgvector enabled, Orbit
// Web's role no superuser, the reserved system account there), refuses to start at all when the database cannot be
// reached (no fallback), serves the web app and the API, holds the four programs and a loadable Orbit plugin, runs as a
// non-root user, opens on Orbit Web's own sign-in when nobody is set up -- every other route refused -- sets the first
// administrator up with the one-time code its terminal prints (used once), signs a browser in with a password, and keeps
// its state (Settings, the browser's session, and a research workspace with a source it read and indexed in the
// container's own worker) across a restart and across re-creating the container. Then the trial: refused at start where
// another machine could reach it, and on this machine `admin` / `123456` signs in. The company: with no AI connection it
// is not activated (409 connection_required, saying where to connect); with a Codex API-key connection holding a
// PLACEHOLDER key -- readiness is the CLI's own status, no provider is asked -- it is activated, empty, when the CLI says
// so, and the line is BLOCKED (never a pass) when it does not. With --browser (Playwright's Chromium on this machine) the
// trial is then walked through in a real browser: the sign-in page, the company waiting for a usable AI connection and
// saying why, a subscription connection added and its terminal command shown, Compute & storage, Employee network
// access, and every page at 320 px without sideways scrolling (screenshots into --out).
//
//   node tests/docker/smoke.mjs [--image=orbit-web:0.8.0] [--build] [--ca-file=<pem>] [--keep] [--browser [--out=<dir>]]
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
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
const network = `orbit-web-smoke-${suffix}`;
const database = `orbit-web-smoke-db-${suffix}`;
const DB_IMAGE = "pgvector/pgvector:0.8.1-pg17-trixie@sha256:137f044b0efe3d57f39b972b9b53641b1f2045b99d879e298bbf514a25787dcf";
const DB_PASSWORD = randomBytes(12).toString("hex");
const PG_PASSWORD = randomBytes(12).toString("hex");
const PASSWORD = `Smoke-${randomBytes(9).toString("base64url")}-pw`;
const DATABASE_URL = `postgres://orbit:${DB_PASSWORD}@${database}:5432/orbit`;
const results = [];

const docker = (args, o = {}) => spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...o });

function check(label, ok, detail = "") {
  results.push({ label, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` -- ${detail}` : ""}\n`);
}

// What this machine could not show (a real AI account): said as BLOCKED, with the behaviour left unverified -- never a
// pass, never a failure of the image.
const blockedLines = [];
function blocked(label, detail = "") {
  blockedLines.push({ label, detail });
  process.stdout.write(`BLOCKED  ${label}${detail ? ` -- ${detail}` : ""}\n`);
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

// A keep-alive socket the server closed while this process sat in a synchronous docker command (the event loop could
// not see it close) fails the next request with "other side closed" before the server read it: asked again, on a new one.
async function fetchFresh(url, init) {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err?.cause?.code !== "UND_ERR_SOCKET") throw err;
    return fetch(url, init);
  }
}

async function http(port, path, init = {}) {
  const res = await fetchFresh(`http://127.0.0.1:${port}${path}`, init);
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

// The database: the image docker/compose.yaml pins, initialised by the same script (Orbit Web's role, its database,
// pgvector), on a network of its own the API's container joins.
async function startDatabase() {
  docker(["network", "create", network]);
  const run = docker(["run", "-d", "--name", database, "--network", network, "-e", "POSTGRES_USER=postgres", "-e", `POSTGRES_PASSWORD=${PG_PASSWORD}`, "-e", "POSTGRES_DB=postgres", "-e", `ORBIT_DB_PASSWORD=${DB_PASSWORD}`, "-v", `${join(WEB, "docker", "postgres", "init")}:/docker-entrypoint-initdb.d:ro`, DB_IMAGE]);
  if (run.status !== 0) return { ok: false, detail: run.stderr.trim() };
  for (let i = 0; i < 90; i += 1) {
    if (docker(["exec", database, "pg_isready", "-h", "127.0.0.1", "-U", "orbit", "-d", "orbit", "-q"]).status === 0) return { ok: true, detail: DB_IMAGE.split("@")[0] };
    await sleep(1000);
  }
  return { ok: false, detail: "not ready in 90 s" };
}

const sql = (query) => docker(["exec", "-e", `PGPASSWORD=${DB_PASSWORD}`, database, "psql", "-h", "127.0.0.1", "-U", "orbit", "-d", "orbit", "-tAc", query]);
// As the database's superuser: a second, empty database for the trial (pgvector enabled in it, Orbit Web's role its owner).
const superSql = (db, query) => docker(["exec", "-e", `PGPASSWORD=${PG_PASSWORD}`, database, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", db, "-tAc", query]);

// `databaseUrl`: where the API's database is (another one: what a broken configuration does). `env`: more of its
// environment (the trial's). `data`: its data volume.
function start(port, { databaseUrl = DATABASE_URL, as = name, env = [], data = volume } = {}) {
  return docker(["run", "-d", "--name", as, "--hostname", "orbit-web", "--network", network, "-p", `127.0.0.1:${port}:3000`, "-v", `${data}:/data`, "-e", `ORBIT_WEB_DATABASE_URL=${databaseUrl}`, ...env.flatMap((e) => ["-e", e]), "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", image]);
}

// A browser: the cookies the API sets, and what a page sends with a change (the header, and its session's CSRF token).
const browser = { cookies: {}, csrf: "" };
const cookieHeader = () => Object.entries(browser.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
function keepCookies(headers) {
  for (const c of headers.getSetCookie()) {
    const [pair] = c.split(";");
    const at = pair.indexOf("=");
    browser.cookies[pair.slice(0, at)] = pair.slice(at + 1);
  }
}
async function web(port, path, init = {}) {
  const change = init.method !== undefined && init.method !== "GET";
  const headers = { ...(init.headers ?? {}), ...(Object.keys(browser.cookies).length > 0 ? { cookie: cookieHeader() } : {}), ...(change ? { "x-orbit-web": "1", "x-orbit-csrf": browser.csrf, "content-type": "application/json" } : {}) };
  const res = await fetchFresh(`http://127.0.0.1:${port}${path}`, { ...init, headers });
  keepCookies(res.headers);
  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, headers: res.headers, body, text };
}

// THE FIRST ADMINISTRATOR, as a person sets it up: the one-time code from the container's terminal, then the page's setup.
function setupCode(as = name) {
  const r = docker(["exec", as, "node", "/opt/orbit-web/apps/api/dist/cli/governance.js", "owner", "setup-code"]);
  const code = (r.stdout.match(/^ {4}(\S+)$/m) ?? [])[1] ?? null;
  return { ok: r.status === 0 && code !== null, code, detail: r.status === 0 ? "printed once" : (r.stderr || r.stdout).trim().slice(0, 200) };
}

const SETUP = (code) => ({ code, username: "admin", password: PASSWORD, fullName: "Smoke Admin", companyName: "Smoke Co", timezone: "Asia/Ho_Chi_Minh" });

function signedIn(r) {
  browser.csrf = r.body?.session?.csrfToken ?? "";
  return r.status === 200 && r.body?.state === "signed_in" && browser.csrf !== "";
}

const SIGN_IN_REQUIRED = "sign_in_required";

const succeeded = (r) => r.status >= 200 && r.status < 300;
const RESEARCH_TEXT = "Smoke test notes. Orbit Web keeps research sources on its own data volume; a restart keeps them.";

// A research workspace and one pasted source, waited for until it is read and indexed.
async function researchSeed(port) {
  const made = await web(port, "/api/research/workspaces", { method: "POST", body: JSON.stringify({ name: "Smoke research", description: "made by the Docker smoke test" }) });
  if (!succeeded(made)) return { ok: false, detail: `create workspace: HTTP ${made.status} ${made.text.slice(0, 200)}` };
  const workspace = made.body.id;
  const added = await web(port, `/api/research/workspaces/${workspace}/sources/text`, { method: "POST", body: JSON.stringify({ title: "Smoke notes", text: RESEARCH_TEXT }) });
  // 202: a source is accepted and queued; it is read and indexed after the answer.
  if (!succeeded(added)) return { ok: false, workspace, detail: `add text: HTTP ${added.status} ${added.text.slice(0, 200)}` };
  const ready = await sourceState(port, workspace, added.body.id, 30);
  return { ok: ready === "ready", workspace, source: added.body.id, detail: `source ${ready}` };
}

async function sourceState(port, workspace, source, seconds) {
  let state = "missing";
  for (let i = 0; i < seconds; i += 1) {
    const list = await web(port, `/api/research/workspaces/${workspace}/sources`);
    state = Array.isArray(list.body) ? (list.body.find((s) => s.id === source)?.state ?? "missing") : `HTTP ${list.status}`;
    if (state === "ready" || state === "failed") return state;
    await sleep(1000);
  }
  return state;
}

async function researchKept(port, seeded) {
  if (!seeded.workspace || !seeded.source) return { ok: false, detail: "nothing was made to keep" };
  const listed = await web(port, "/api/research/workspaces");
  const found = Array.isArray(listed.body) && listed.body.some((w) => w.id === seeded.workspace && w.sourceCount === 1);
  const state = await sourceState(port, seeded.workspace, seeded.source, 1);
  const content = await web(port, `/api/research/sources/${seeded.source}/content`);
  const text = JSON.stringify(content.body);
  return { ok: found && state === "ready" && text.includes("own data volume"), detail: `workspace ${found ? "listed" : "missing"}, source ${state}, content HTTP ${content.status}` };
}

async function main() {
  if (flag("build")) {
    const args = ["scripts/build-image.mjs", `--tag=${image}`, ...(opt("ca-file") ? [`--ca-file=${opt("ca-file")}`] : [])];
    check("1. the image builds", spawnSync(process.execPath, args, { cwd: WEB, stdio: "inherit" }).status === 0);
  } else check("1. the image exists", docker(["image", "inspect", image]).status === 0, image);

  const db = await startDatabase();
  check("   PostgreSQL with pgvector starts beside it (the pinned image, Orbit Web's role made by the init script)", db.ok, db.detail);

  // A database that cannot be reached is an error said out loud, never a quiet switch to another store.
  const port = await freePort();
  const broken = `${name}-nodb`;
  start(port, { databaseUrl: `postgres://orbit:${DB_PASSWORD}@${database}-missing:5432/orbit`, as: broken });
  let stopped = "";
  for (let i = 0; i < 60 && !stopped.startsWith("exited"); i += 1) {
    await sleep(1000);
    stopped = docker(["inspect", "--format", "{{.State.Status}} {{.State.ExitCode}}", broken]).stdout.trim();
  }
  const brokenLogs = docker(["logs", broken]);
  const leftovers = docker(["run", "--rm", "-v", `${volume}:/data`, "--entrypoint", "sh", image, "-c", "find /data -name '*.db' -o -name '*.db-wal' | head -3"]);
  docker(["rm", "-f", broken]);
  check("   with no database it does not start -- and keeps nothing anywhere else", stopped.startsWith("exited") && !stopped.endsWith(" 0") && /database/i.test(`${brokenLogs.stdout}${brokenLogs.stderr}`) && leftovers.stdout.trim() === "", `${stopped}; ${(`${brokenLogs.stdout}${brokenLogs.stderr}`.match(/[^\n]*database[^\n]*/i) ?? [""])[0].slice(0, 160)}`);

  const run = start(port);
  check("2. the container starts", run.status === 0, run.stderr.trim());
  check("   ...and reports healthy", await healthy(port));

  const index = await http(port, "/");
  check("3. the web UI responds", index.status === 200 && /<div id="root">/.test(index.text), `HTTP ${index.status}`);
  check("   ...with a strict content security policy", /script-src 'self'/.test(index.headers.get("content-security-policy") ?? ""));
  const health = await http(port, "/api/health");
  check("4. the API responds (GET /api/health)", health.status === 200 && health.body.status === "ok", JSON.stringify(health.body).slice(0, 300));
  check("   ...its database migrated, pgvector enabled", health.body.database?.ok === true && /^\d+\.\d+/.test(health.body.database?.pgvector ?? ""), JSON.stringify(health.body.database));
  check("   ...and the health check names no connection string", !JSON.stringify(health.body).includes(DB_PASSWORD) && !JSON.stringify(health.body).includes("postgres://"));
  const role = sql("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
  check("   Orbit Web's database role is not a superuser", role.stdout.trim() === "f", role.stdout.trim() || role.stderr.trim().slice(0, 120));

  const versions = {
    claude: exec("claude", "--version"),
    codex: exec("codex", "--version"),
    agy: exec("sh", "-c", "HOME=$(mktemp -d) agy --version"),
    gh: exec("gh", "--version"),
    git: exec("git", "--version"),
    node: exec("node", "--version"),
    az: exec("az", "version", "--output", "json"),
  };
  check("5. claude is installed", versions.claude.status === 0, versions.claude.stdout.trim());
  check("   the OpenAI Codex CLI is installed", versions.codex.status === 0 && /\d+\.\d+\.\d+/.test(versions.codex.stdout), versions.codex.stdout.trim() || versions.codex.stderr.trim().slice(0, 200));
  check("   the Google Antigravity CLI (agy) is installed", versions.agy.status === 0 && /\d+\.\d+\.\d+/.test(versions.agy.stdout), versions.agy.stdout.trim() || versions.agy.stderr.trim().slice(0, 200));
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
  const perms = exec("stat", "-c", "%a %U", "/data/connections", "/data/github", "/data/azure", "/data/app", "/data/research", "/data/control", "/data/control/credentials");
  check("   the persistent directories are private to that user", perms.stdout.trim().split("\n").every((l) => l.startsWith("700 ")), perms.stdout.trim().replace(/\n/g, ", "));
  // What Claude Code runs as: it creates, edits, renames and deletes in a chat's workspace, and cannot write the
  // image's programs or the plugin (whatever its permission rules then allow is Claude Code's to decide).
  const rights = exec("sh", "-c", 'd=/data/workspaces/smoke-rights/repository && mkdir -p "$d/sub" && echo a > "$d/f" && echo b >> "$d/f" && mv "$d/f" "$d/sub/g" && rm -r /data/workspaces/smoke-rights && ! touch /opt/orbit/plugin/x 2>/dev/null && ! touch /opt/claude/bin/x 2>/dev/null && ! touch /opt/orbit-web/x 2>/dev/null && echo ok');
  check("   that user creates, edits, renames and deletes in /data/workspaces, and cannot write the programs or the plugin", rights.stdout.trim() === "ok", rights.stderr.trim().slice(0, 200));
  const helper = exec("sh", "-c", 'test -x /opt/orbit-web/docker/git-credential-azure-cli.mjs && printf "protocol=https\\nhost=github.com\\n\\n" | /opt/orbit-web/docker/git-credential-azure-cli.mjs get; echo "exit=$?"');
  check("   the Azure Repos credential helper is there, and answers nothing for another host", helper.stdout.trim() === "exit=0", (helper.stdout + helper.stderr).trim().slice(0, 200));

  const unset = exec("sh", "-c", 'printf %s "${CLAUDE_CONFIG_DIR:-unset}"');
  check("   no Claude login is the image's: CLAUDE_CONFIG_DIR is not set (each Claude process is one AI connection's)", unset.stdout === "unset", unset.stdout);
  const connect = exec("node", "/opt/orbit-web/apps/api/dist/cli/connect.js");
  check("   the terminal sign-in of a connection is there (connect.js), and needs a connection's id", connect.status === 2 && /usage: connect\.js <connectionId>/.test(`${connect.stdout}${connect.stderr}`), `exit ${connect.status}`);
  const status = await http(port, "/api/auth/status");
  check("11. nobody set up: the page opens on Orbit Web's own setup", status.status === 200 && status.body.state === "setup_required" && status.body.session === null && status.body.trial?.enabled === false, `state ${status.body.state}`);
  const gated = await Promise.all(["/api/setup/status", "/api/settings", "/api/github/status", "/api/sessions"].map(async (path) => [path, await http(port, path)]));
  check("   ...and every other route waits for it", gated.every(([, r]) => r.status === 401 && r.body.error?.code === SIGN_IN_REQUIRED), gated.map(([path, r]) => `${path} ${r.status}`).join(", "));
  check("   a foreign Host header is refused", (await rawStatus(port, "/api/health", "attacker.example")) === 421);
  const naked = await http(port, "/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"theme":"dark"}' });
  check("   a change without the Orbit Web header is refused", naked.status === 403);

  // The first administrator: a code the container's terminal prints, used once.
  const wrong = await web(port, "/api/auth/setup", { method: "POST", body: JSON.stringify(SETUP("not-the-code-0000")) });
  check("   a made-up setup code is refused", wrong.status >= 400 && wrong.status < 500 && Object.keys(browser.cookies).length === 0, `HTTP ${wrong.status}`);
  const code = setupCode();
  check("   the server's terminal prints a one-time setup code (governance.js owner setup-code)", code.ok, code.detail);
  const setUp = await web(port, "/api/auth/setup", { method: "POST", body: JSON.stringify(SETUP(code.code)) });
  check("   with it the first administrator is set up, and this browser signed in", signedIn(setUp), `HTTP ${setUp.status} ${setUp.body?.state ?? setUp.text.slice(0, 160)}`);
  const again = await http(port, "/api/auth/setup", { method: "POST", headers: { "content-type": "application/json", "x-orbit-web": "1" }, body: JSON.stringify({ ...SETUP(code.code), username: "intruder" }) });
  check("   ...and the code is used: a second setup with it is refused", again.status >= 400 && again.status < 500, `HTTP ${again.status}`);
  const accounts = sql("SELECT kind || ':' || count(*) FROM app.accounts GROUP BY kind ORDER BY kind");
  check("   one customer account was made, beside the reserved system account", accounts.stdout.trim().split("\n").join(",") === "customer:1,system:1", accounts.stdout.trim().replace(/\n/g, ",") || accounts.stderr.trim().slice(0, 120));
  const hashed = sql("SELECT password_hash LIKE 'scrypt$%' AND password_hash NOT LIKE '%" + PASSWORD + "%' FROM app.users WHERE username = 'admin'");
  check("   the password is kept as a scrypt hash, never as itself", hashed.stdout.trim() === "t", hashed.stdout.trim() || hashed.stderr.trim().slice(0, 120));
  const setup = await web(port, "/api/setup/status");
  check("   the session opens the API", setup.status === 200, `HTTP ${setup.status}`);
  check("   ...which reads the build info", /^[0-9a-f]{40}$/.test(setup.body.versions?.orbitCommit ?? ""), JSON.stringify(setup.body.versions));
  // The company: activated only with an AI connection of the account that can be used now.
  const unconnected = await web(port, "/api/connections");
  const waiting = await web(port, "/api/office/setup", { method: "POST", body: JSON.stringify({ name: "Smoke company" }) });
  check("   with no AI connection the company is not activated: 409 connection_required, saying where to connect", unconnected.body?.activation?.ready === false && waiting.status === 409 && waiting.body?.error?.code === "connection_required" && waiting.body?.error?.details?.where === "#/?settings=ai-connections", `HTTP ${waiting.status} ${waiting.body?.error?.code ?? ""}`);
  const examples = await web(port, "/api/office/setup", { method: "POST", body: JSON.stringify({ name: "Smoke company", departments: ["Accounting", "Legal", "Sales"] }) });
  check("   an older client's example departments are refused (422), never made", examples.status === 422 && examples.body?.error?.code === "departments_not_accepted", `HTTP ${examples.status}`);
  const keyed = await web(port, "/api/connections", { method: "POST", body: JSON.stringify({ runtime: "codex", method: "api_key", label: "Smoke placeholder", apiKey: `sk-proj-smoke-${randomBytes(18).toString("hex")}` }) });
  const usable = (await web(port, "/api/connections")).body?.activation;
  if (keyed.status === 201 && usable?.ready === true) {
    const activated = await web(port, "/api/office/setup", { method: "POST", body: JSON.stringify({ name: "Smoke company" }) });
    const roster = await web(port, "/api/office/roster");
    check("   a Codex API-key connection its CLI reports signed in activates the company -- EMPTY (placeholder key: readiness is the CLI's own status, no provider asked)", activated.status === 200 && roster.body?.office?.name === "Smoke company" && roster.body?.departments?.length === 0 && roster.body?.employees?.length === 0, `HTTP ${activated.status}; uses ${JSON.stringify(usable.uses)}`);
  } else {
    blocked("activating the company with a usable AI connection, in the real image", `the Codex connection with a placeholder key is ${keyed.body?.auth ?? `HTTP ${keyed.status}`} (${keyed.body?.reason ?? keyed.body?.error?.message ?? "no reason"}); the success path needs a real AI connection here -- it is covered with scripted CLIs in office-activation.spec.ts`);
  }
  const change = await web(port, "/api/settings", { method: "PATCH", body: JSON.stringify({ theme: "dark", defaultModel: "opus" }) });
  check("9. state is written to the volume", change.status === 200 && change.body.defaultModel === "opus");
  // Research keeps its workspaces in the database and its documents under /data/research: one of each, made now, read
  // back after the restart and after the new container. A pasted text is read and indexed without any model.
  const research = await researchSeed(port);
  check("   a research workspace and a pasted source are kept (read and indexed, no model asked)", research.ok, research.detail);
  docker(["restart", name]);
  await healthy(port);
  const afterRestart = await web(port, "/api/settings");
  check("10. a restart keeps the state -- and this browser's session", afterRestart.body.defaultModel === "opus" && afterRestart.body.theme === "dark", JSON.stringify(afterRestart.body));
  const researchAfterRestart = await researchKept(port, research);
  check("   ...and the research workspace with its source, still ready", researchAfterRestart.ok, researchAfterRestart.detail);
  docker(["rm", "-f", name]);
  start(port);
  await healthy(port);
  const afterRecreate = await web(port, "/api/settings");
  check("   a new container on the same volume keeps it too", afterRecreate.body.defaultModel === "opus", JSON.stringify(afterRecreate.body));
  const researchAfterRecreate = await researchKept(port, research);
  check("   ...research included", researchAfterRecreate.ok, researchAfterRecreate.detail);
  const objects = exec("sh", "-c", 'find "/data/research/workspaces/$1/objects" -type f | wc -l', "sh", research.workspace ?? "none");
  check("   the source's bytes are in /data/research, kept by their hash", objects.status === 0 && Number(objects.stdout.trim()) >= 1, `${objects.stdout.trim() || objects.stderr.trim().slice(0, 200)} file(s)`);
  const out = await web(port, "/api/auth/logout", { method: "POST", body: "{}" });
  const closed = await web(port, "/api/settings");
  check("   signing out ends this browser's session", out.status === 200 && closed.status === 401, `logout HTTP ${out.status}, then HTTP ${closed.status}`);
  const bad = await web(port, "/api/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "not-the-password" }) });
  const login = await web(port, "/api/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: PASSWORD }) });
  check("   a wrong password is refused, the right one signs the browser in again", bad.status === 401 && signedIn(login), `HTTP ${bad.status}, then HTTP ${login.status}`);
  docker(["rm", "-f", name]);

  // The trial: its password is public, so it starts only where nobody else can reach it.
  const trialPort = await freePort();
  const exposed = `${name}-trial-exposed`;
  start(trialPort, { as: exposed, data: `${volume}-trial`, env: ["ORBIT_WEB_TRIAL=1", "ORBIT_WEB_ALLOWED_HOSTS=orbit.example.com", `ORBIT_WEB_ACCESS_TOKEN=${randomBytes(16).toString("hex")}`] });
  let ended = "";
  for (let i = 0; i < 60 && !ended.startsWith("exited"); i += 1) {
    await sleep(1000);
    ended = docker(["inspect", "--format", "{{.State.Status}} {{.State.ExitCode}}", exposed]).stdout.trim();
  }
  const exposedLogs = docker(["logs", exposed]);
  docker(["rm", "-f", exposed]);
  check("12. a trial another machine could reach refuses to start, saying why", ended.startsWith("exited") && !ended.endsWith(" 0") && /ORBIT_WEB_TRIAL=1 refused/.test(`${exposedLogs.stdout}${exposedLogs.stderr}`), `${ended}; ${(`${exposedLogs.stdout}${exposedLogs.stderr}`.match(/[^\n]*ORBIT_WEB_TRIAL[^\n]*/) ?? [""])[0].slice(0, 200)}`);
  const made = superSql("postgres", "CREATE DATABASE orbit_trial OWNER orbit");
  const vector = superSql("orbit_trial", "CREATE EXTENSION IF NOT EXISTS vector");
  const trial = `${name}-trial`;
  start(trialPort, { as: trial, data: `${volume}-trial`, databaseUrl: `postgres://orbit:${DB_PASSWORD}@${database}:5432/orbit_trial`, env: ["ORBIT_WEB_TRIAL=1"] });
  let trialUp = false;
  for (let i = 0; i < 90 && !trialUp; i += 1) {
    await sleep(1000);
    trialUp = docker(["inspect", "--format", "{{.State.Health.Status}}", trial]).stdout.trim() === "healthy";
  }
  const trialStatus = await http(trialPort, "/api/auth/status");
  check("   on this machine alone the trial starts on an empty database, and says its login", made.status === 0 && vector.status === 0 && trialUp && trialStatus.body?.trial?.enabled === true && trialStatus.body.trial.username === "admin" && trialStatus.body.trial.password === "123456", `healthy ${trialUp}, trial ${JSON.stringify(trialStatus.body?.trial ?? null)}`);
  const trialLogin = await http(trialPort, "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-orbit-web": "1" }, body: JSON.stringify({ username: "admin", password: "123456" }) });
  check("   ...and admin / 123456 signs in", trialLogin.status === 200 && trialLogin.body?.state === "signed_in", `HTTP ${trialLogin.status}`);
  if (flag("browser")) await inBrowser(trialPort);
  docker(["rm", "-f", trial]);

  if (!flag("keep")) cleanUp();
  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} Docker checks passed${blockedLines.length > 0 ? `, ${blockedLines.length} BLOCKED (not passes): ${blockedLines.map((b) => b.label).join("; ")}` : ""}${flag("keep") ? ` (kept ${name}, volume ${volume})` : ""}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

// THE TRIAL IN A REAL BROWSER (Chromium, through Playwright as this machine has it): what a person sees.
async function inBrowser(port) {
  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)("playwright"));
  } catch {
    check("13. a real browser (--browser)", false, "Playwright is not installed on this machine");
    return;
  }
  const out = opt("out");
  if (out) mkdirSync(out, { recursive: true });
  const shot = async (page, file) => out && (await page.screenshot({ path: join(out, file) }));
  const url = `http://127.0.0.1:${port}`;
  const errors = [];
  const browser = await chromium.launch();
  // The page a failure happened on: photographed, so the failure says what the person would have seen.
  let current = null;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    current = page;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(url);
    await page.getByText("Sign in to Orbit Web").first().waitFor({ timeout: 15_000 });
    const signInText = await page.locator("body").innerText();
    await shot(page, "signin.png");
    check("13. a real browser: the sign-in page is Orbit Web's own, the trial's login said in a red bar", /Sign in to Orbit Web/.test(signInText) && /Trial login admin \/ 123456/.test(signInText) && !/Continue with Claude/.test(signInText));
    await page.getByRole("textbox", { name: "Username" }).fill("admin");
    await page.getByRole("textbox", { name: "Password" }).fill("123456");
    await page.getByRole("button", { name: "Sign in" }).click();
    // No company yet: the sidebar's Company section offers Create company (the Office's setup) and no CEO Chat, and CEO
    // Chat's own address goes back to a new session (ADR 0062).
    await page.getByRole("button", { name: "Create company" }).waitFor({ timeout: 15_000 });
    const ceoOffered = await page.getByRole("button", { name: "CEO Chat" }).count();
    await page.goto(`${url}/#/ceo`);
    await page.waitForFunction("window.location.hash === '#/'", null, { timeout: 15_000 }).catch(() => undefined);
    const ceoHash = await page.evaluate("window.location.hash");
    check("   before a company: Create company in the sidebar, no CEO Chat, and #/ceo goes back to a new session", ceoOffered === 0 && ceoHash === "#/", `CEO Chat ${ceoOffered === 0 ? "not offered" : "offered"}, #/ceo -> ${ceoHash}`);
    await page.goto(`${url}/#/office`);
    const activate = page.getByRole("button", { name: "Activate the company" });
    await activate.waitFor({ timeout: 15_000 });
    const why = await page.getByText(/Connect an AI CLI first/).count();
    const link = await page.getByRole("link", { name: "Open Settings → AI Connections" }).count();
    const preselected = await page.getByRole("checkbox").count();
    await shot(page, "office.png");
    check("   with no AI connection the company waits: Activate is disabled, says why and where to connect, and nothing is preselected", (await activate.isDisabled()) && why > 0 && link > 0 && preselected === 0, `activate ${(await activate.isDisabled()) ? "disabled" : "enabled"}, ${preselected} checkbox(es)`);
    await page.goto(`${url}/#/settings/ai-connections`);
    await page.getByRole("button", { name: "Add a connection" }).first().click();
    await page.getByRole("button", { name: "Add connection", exact: true }).click();
    // A subscription is signed in from its card where this installation lets it (the CLI's own sign-in started on the
    // server: its page to open, then its code); the terminal's command is there too, one click away.
    await page.getByText(/Open the sign-in page and sign in|Use the server's terminal instead/).first().waitFor({ timeout: 15_000 });
    const onCard = (await page.getByText("Use the server's terminal instead").count()) > 0;
    if (onCard) await page.getByText("Use the server's terminal instead").first().click();
    const command = page.getByText(/docker compose exec orbit-web node \/opt\/orbit-web\/apps\/api\/dist\/cli\/connect\.js [0-9a-f-]{36}/).first();
    await command.waitFor({ timeout: 15_000 });
    await shot(page, "ai-connections.png");
    check("   a Claude Code subscription connection is added, Disconnected, with the terminal command that signs it in", (await page.getByText("Disconnected").count()) > 0, `${(await command.innerText()).replace(/[0-9a-f-]{36}/, "<id>")}${onCard ? " (signed in from its card, the command one click away)" : ""}`);
    await page.goto(`${url}/#/settings/compute`);
    await page.getByText("Infrastructure capacity").waitFor({ timeout: 15_000 });
    const compute = await page.getByRole("dialog").first().innerText();
    await shot(page, "compute.png");
    check("   Compute & storage says the capacity, how it was obtained, the budget and each storage level", /Detected from this host|Configured/.test(compute) && /Account budget/.test(compute) && /Measured only|Hard limit|Not enforced/.test(compute));
    await page.goto(`${url}/#/governance/policy`);
    await page.getByText("Employee network access").first().waitFor({ timeout: 15_000 });
    const policy = await page.locator("body").innerText();
    check("   Governance offers Employee network access: Autonomous or Restricted, private addresses never", /Autonomous/.test(policy) && /Restricted/.test(policy) && /private, loopback, link-local and cloud-metadata addresses are refused/.test(policy));
    await context.close();
    const small = await browser.newContext({ viewport: { width: 320, height: 720 }, storageState: undefined });
    const p = await small.newPage();
    current = p;
    p.on("pageerror", (e) => errors.push(`320 px: ${e.message}`));
    await p.goto(url);
    await p.getByRole("textbox", { name: "Username" }).fill("admin");
    await p.getByRole("textbox", { name: "Password" }).fill("123456");
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.waitForTimeout(1500);
    const wide = [];
    for (const hash of ["#/office", "#/office/work", "#/office/inbox", "#/office/schedule", "#/settings/ai-connections", "#/settings/compute", "#/governance/policy"]) {
      await p.goto(`${url}/${hash}`);
      await p.waitForTimeout(1500);
      // Evaluated in the page (a string: this file runs in Node, where neither global exists).
      const w = await p.evaluate("document.documentElement.scrollWidth - window.innerWidth");
      if (w > 0) wide.push(`${hash} +${w}px`);
      await shot(p, `320-${hash.replace(/[#/]+/g, "-").replace(/^-|-$/g, "")}.png`);
    }
    check("   at 320 px no page of the Office, Settings or Governance scrolls sideways", wide.length === 0, wide.join(", ") || "7 pages");
    await small.close();
  } catch (err) {
    // Playwright's first line says what timed out; its call log says which locator it was waiting for, and where.
    const lines = String(err.message ?? err).split("\n");
    const waiting = lines.find((l) => /waiting for/.test(l))?.trim() ?? "";
    if (current !== null) await shot(current, "failure.png").catch(() => undefined);
    check("   the browser walk-through", false, `${lines[0]}${waiting ? ` -- ${waiting}` : ""}${current !== null ? ` (at ${current.url()})` : ""}`.slice(0, 400));
  } finally {
    await browser.close();
  }
  check("   ...and the page reported no error", errors.length === 0, errors.slice(0, 3).join(" | ").slice(0, 300));
}

function cleanUp() {
  docker(["rm", "-f", name, `${name}-trial`, `${name}-trial-exposed`]);
  docker(["rm", "-f", "-v", database]);
  docker(["volume", "rm", volume, `${volume}-trial`]);
  docker(["network", "rm", network]);
}

main().catch((err) => {
  // fetch() says only "fetch failed"; what happened to the connection is its cause.
  process.stdout.write(`FAIL  the smoke test itself: ${err.stack ?? err}${err.cause ? `\n  cause: ${err.cause.stack ?? err.cause}` : ""}\n`);
  // What the container was doing, before it is removed.
  const state = docker(["inspect", "--format", "{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} started={{.State.StartedAt}}", name]);
  process.stdout.write(`  container: ${(state.stdout || state.stderr).trim()}\n`);
  const logs = docker(["logs", "--tail", "40", name]);
  process.stdout.write(`  its last log lines:\n${`${logs.stdout}${logs.stderr}`.trim().split("\n").map((l) => `    ${l}`).join("\n")}\n`);
  cleanUp();
  process.exit(1);
});
