#!/usr/bin/env node
// THE REAL ACCEPTANCE RUN: the built image, the real Claude Code CLI with the real Orbit plugin and a real Claude
// model, real git, real Orbit -- one capped Sonnet turn on a fixture repository, a container restart, and one resumed
// turn. Only GitHub is stood in for (tests/acceptance/fake-gh.mjs, mounted and named by ORBIT_WEB_GH_BIN): its sign-in,
// listing and clone of a real repository need a person, so those steps are reported BLOCKED, never passed.
//
// Orbit Web keeps its records in PostgreSQL: the run starts the pinned pgvector image beside it, on a network of the
// run's own, and removes both at the end.
//
// Signing in is Orbit Web's own (ADR 0061): the run sets the first administrator up with the one-time code the
// container's terminal prints, then connects Claude Code for that account, the two ways a person does:
//   --api-key-env=<NAME>  the person's own Claude Console API key, read from that variable of THIS shell (never printed,
//                         never written into the evidence) and given to Orbit Web as an API-key connection;
//   otherwise             a subscription, signed in with Claude Code's own sign-in IN THIS TERMINAL (`docker exec -it …
//                         connect.js <id>`): the URL and the code are the CLI's and the person's. Without a terminal it
//                         is BLOCKED and the run stops there.
//
//   node tests/acceptance/real-run.mjs [--api-key-env=ANTHROPIC_API_KEY] [--image=orbit-web:<version>] \
//     [--budget=2] [--ca-file=<pem>] [--out=<dir>] [--keep]
//
// Every step is PASS, FAIL, BLOCKED (needs a person) or STAND-IN (GitHub replaced by the fixture), with its evidence.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_REPOSITORY, makeFixture } from "./fixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const opt = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const flag = (name) => process.argv.includes(`--${name}`);

const VERSION = JSON.parse(readFileSync(join(HERE, "..", "..", "package.json"), "utf8")).version;
const IMAGE = opt("image") ?? `orbit-web:${VERSION}`;
const API_KEY_ENV = opt("api-key-env");
const BUDGET = opt("budget") ?? "2";
const PROMPT = "Fix the incorrect addition in sum.mjs so the existing test passes. Do not modify the test.";
const FOLLOW_UP = "In one sentence, what did you change and why?";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = opt("out") ?? join("/tmp", "orbit-web-acceptance", stamp);
const suffix = randomBytes(4).toString("hex");
const NAME = `orbit-web-acceptance-${suffix}`;
const VOLUME = `orbit-web-acceptance-${suffix}`;
const NETWORK = `orbit-web-acceptance-${suffix}`;
const DATABASE = `orbit-web-acceptance-db-${suffix}`;
const DB_IMAGE = "pgvector/pgvector:0.8.1-pg17-trixie@sha256:137f044b0efe3d57f39b972b9b53641b1f2045b99d879e298bbf514a25787dcf";
const DB_PASSWORD = randomBytes(12).toString("hex");

const steps = [];
const evidence = { image: IMAGE, budgetUsdPerTurn: Number(BUDGET), startedAt: new Date().toISOString(), runs: [] };

function step(n, label, status, detail = "") {
  steps.push({ n, label, status, detail });
  process.stdout.write(`${String(n).padStart(2)}. ${status.padEnd(8)} ${label}${detail ? ` -- ${detail}` : ""}\n`);
}

const docker = (args, o = {}) => spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...o });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

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

let PORT = 0;
// The browser this run is: the cookies Orbit Web sets (its session) and, with a change, the header and the session's
// CSRF token.
const browser = { cookies: {}, csrf: "" };
const cookieHeader = () => Object.entries(browser.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
function keepCookies(headers) {
  for (const c of headers.getSetCookie()) {
    const [pair] = c.split(";");
    const at = pair.indexOf("=");
    if (pair.slice(at + 1) === "") delete browser.cookies[pair.slice(0, at)];
    else browser.cookies[pair.slice(0, at)] = pair.slice(at + 1);
  }
}
const api = async (path, init = {}) => {
  const change = init.method !== undefined && init.method !== "GET";
  const res = await fetchFresh(`http://127.0.0.1:${PORT}${path}`, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(change ? { "x-orbit-web": "1", "x-orbit-csrf": browser.csrf } : {}), ...(Object.keys(browser.cookies).length > 0 ? { cookie: cookieHeader() } : {}), ...(init.headers ?? {}) } });
  keepCookies(res.headers);
  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, body };
};

async function healthy(seconds = 120) {
  for (let i = 0; i < seconds; i += 1) {
    const state = docker(["inspect", "--format", "{{.State.Health.Status}}", NAME]).stdout.trim();
    if (state === "healthy") return true;
    await sleep(1000);
  }
  return false;
}

// Follows a session's events until one of `endTypes` arrives after `afterSeq`.
async function follow(sessionId, afterSeq, endTypes, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const frames = [];
  try {
    const res = await fetchFresh(`http://127.0.0.1:${PORT}/api/sessions/${sessionId}/events`, { headers: { accept: "text/event-stream", "last-event-id": String(afterSeq), cookie: cookieHeader() }, signal: controller.signal });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const id = /^id: (.*)$/m.exec(raw)?.[1] ?? null;
        const data = raw.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
        if (data) frames.push({ id, event: JSON.parse(data), at: Date.now() });
      }
      if (frames.some((f) => endTypes.includes(f.event.type) && (f.event.seq ?? 0) > afterSeq)) break;
    }
  } catch (err) {
    if (err.name !== "AbortError") throw err;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return frames;
}

const exec = (...args) => docker(["exec", NAME, ...args]);

const parsed = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// The pinned PostgreSQL with pgvector, its role made by the compose files' own init script.
async function startDatabase() {
  docker(["network", "create", NETWORK]);
  const run = docker(["run", "-d", "--name", DATABASE, "--network", NETWORK, "-e", "POSTGRES_USER=postgres", "-e", `POSTGRES_PASSWORD=${randomBytes(12).toString("hex")}`, "-e", "POSTGRES_DB=postgres", "-e", `ORBIT_DB_PASSWORD=${DB_PASSWORD}`, "-v", `${join(HERE, "..", "..", "docker", "postgres", "init")}:/docker-entrypoint-initdb.d:ro`, DB_IMAGE]);
  if (run.status !== 0) return { ok: false, detail: run.stderr.trim() };
  for (let i = 0; i < 90; i += 1) {
    if (docker(["exec", DATABASE, "pg_isready", "-h", "127.0.0.1", "-U", "orbit", "-d", "orbit", "-q"]).status === 0) return { ok: true, detail: DB_IMAGE.split("@")[0] };
    await sleep(1000);
  }
  return { ok: false, detail: "PostgreSQL was not ready in 90 s" };
}

function startContainer(fixture) {
  const ca = opt("ca-file");
  const args = [
    "run", "-d", "--name", NAME, "--hostname", "orbit-web", "--network", NETWORK,
    "-p", `127.0.0.1:${PORT}:3000`,
    "-v", `${VOLUME}:/data`,
    "-v", `${fixture.served}:/fixture:ro`,
    "-v", `${join(HERE, "fake-gh.mjs")}:/acceptance/fake-gh.mjs:ro`,
    "-e", "ORBIT_WEB_GH_BIN=/acceptance/fake-gh.mjs",
    "-e", `ORBIT_WEB_DATABASE_URL=postgres://orbit:${DB_PASSWORD}@${DATABASE}:5432/orbit`,
    "-e", `ORBIT_WEB_MAX_BUDGET_USD=${BUDGET}`,
    ...(ca ? ["-v", `${ca}:/etc/orbit-web-ca.pem:ro`, "-e", "NODE_EXTRA_CA_CERTS=/etc/orbit-web-ca.pem", "-e", "SSL_CERT_FILE=/etc/orbit-web-ca.pem"] : []),
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    IMAGE,
  ];
  return docker(args);
}

const summarise = (frames) => {
  const events = frames.map((f) => f.event);
  const count = (t) => events.filter((e) => e.type === t).length;
  const started = events.find((e) => e.type === "session.started")?.data ?? null;
  const end = events.find((e) => ["session.completed", "session.failed", "session.interrupted"].includes(e.type)) ?? null;
  return {
    started,
    end: end ? { type: end.type, data: end.data } : null,
    deltas: count("message.delta"),
    deltasWithoutId: frames.filter((f) => f.event.type === "message.delta" && f.id === null).length,
    durableWithId: frames.filter((f) => f.event.seq !== null && Number(f.id) === f.event.seq).length,
    durable: frames.filter((f) => f.event.seq !== null).length,
    messages: count("message.completed"),
    tools: events.filter((e) => e.type === "tool.started").map((e) => e.data.title),
    toolFailures: count("tool.failed"),
    denials: events.filter((e) => e.type === "permission.denied").map((e) => e.data.toolName),
    firstDeltaMs: frames.find((f) => f.event.type === "message.delta")?.at ?? null,
    endMs: frames.at(-1)?.at ?? null,
  };
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (docker(["image", "inspect", IMAGE]).status !== 0) {
    step(0, "the image to run", "FAIL", `${IMAGE} is not built (node scripts/build-image.mjs)`);
    return finish();
  }
  PORT = await freePort();
  const fixture = makeFixture();
  evidence.fixtureHead = fixture.head;
  try {
    await run(fixture);
  } finally {
    if (!flag("keep")) {
      docker(["rm", "-f", NAME, DATABASE]);
      docker(["volume", "rm", VOLUME]);
      docker(["network", "rm", NETWORK]);
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
  return finish();
}

// ORBIT WEB'S OWN SIGN-IN, then the account's Claude Code connection -- the address of the identity is never written
// into the evidence.
async function signIn() {
  const printed = exec("node", "/opt/orbit-web/apps/api/dist/cli/governance.js", "owner", "setup-code");
  const code = (printed.stdout.match(/^ {4}(\S+)$/m) ?? [])[1] ?? null;
  if (printed.status !== 0 || code === null) return { status: "FAIL", detail: `no setup code: ${(printed.stderr || printed.stdout).trim().slice(0, 200)}` };
  const password = `Acceptance-${randomBytes(12).toString("base64url")}`;
  const setUp = await api("/api/auth/setup", { method: "POST", body: JSON.stringify({ code, username: "admin", password, fullName: "Acceptance Owner", timezone: "UTC" }) });
  browser.csrf = setUp.body?.session?.csrfToken ?? "";
  if (setUp.status !== 200 || browser.csrf === "") return { status: "FAIL", detail: `the first administrator was not set up: HTTP ${setUp.status} ${JSON.stringify(setUp.body).slice(0, 200)}` };
  const key = API_KEY_ENV ? process.env[API_KEY_ENV] : undefined;
  if (API_KEY_ENV && !key) return { status: "BLOCKED", detail: `--api-key-env names ${API_KEY_ENV}, which this shell does not set` };
  if (!key && !process.stdin.isTTY) return { status: "BLOCKED", detail: "a subscription is signed in by a person in a terminal: run this at one, or name an API key's variable with --api-key-env" };
  const made = await api("/api/connections", { method: "POST", body: JSON.stringify(key ? { runtime: "claude", method: "api_key", label: "Acceptance (API key)", apiKey: key } : { runtime: "claude", method: "subscription", label: "Acceptance (subscription)" }) });
  if (made.status !== 201) return { status: "FAIL", detail: `the connection was not made: HTTP ${made.status} ${JSON.stringify(made.body).slice(0, 200)}` };
  const id = made.body.id;
  if (!key) {
    process.stdout.write("\nClaude Code's own sign-in, in this terminal, for the acceptance connection:\n\n");
    spawnSync("docker", ["exec", "-it", NAME, "node", "/opt/orbit-web/apps/api/dist/cli/connect.js", id], { stdio: "inherit" });
  }
  const checked = await api(`/api/connections/${id}/check`, { method: "POST", body: "{}" });
  const c = checked.body;
  if (checked.status !== 200 || c?.auth !== "connected") return { status: "FAIL", detail: `the connection is ${c?.auth ?? `HTTP ${checked.status}`}: ${c?.reason ?? ""}` };
  return { status: "PASS", detail: `signed in to Orbit Web with its own setup code and password; Claude Code connected by ${key ? "an API key" : "its own sign-in in a terminal"}, its models read from the account (${c.catalog?.models?.length ?? 0})` };
}

async function run(fixture) {
  const database = await startDatabase();
  const started = database.ok ? startContainer(fixture) : { status: 1, stderr: `PostgreSQL: ${database.detail}` };
  const up = started.status === 0 && (await healthy());
  step(1, "Start Orbit Web Docker", up ? "PASS" : "FAIL", up ? `${IMAGE} healthy on 127.0.0.1:${PORT}, beside ${database.detail}` : started.stderr.trim());
  if (!up) return;
  const index = await fetchFresh(`http://127.0.0.1:${PORT}/`);
  step(2, "Open the application", index.status === 200 ? "PASS" : "FAIL", `GET / -> ${index.status}`);

  const signedIn = await signIn();
  step(3, "Sign in to Orbit Web, and connect Claude Code", signedIn.status, signedIn.detail);
  if (signedIn.status !== "PASS") return;
  const setup = (await api("/api/setup/status")).body;
  evidence.versions = setup.versions;
  step(4, "Click Connect GitHub", "BLOCKED", "the device flow needs a person at github.com/login/device (the real gh in the image was seen to print a real one-time code)");
  step(5, "Authenticate using GitHub CLI's browser flow", "BLOCKED", `needs a person; GitHub is stood in for by the acceptance fake (connected as ${setup.github.account?.login ?? "?"})`);
  const repos = (await api("/api/repositories?source=github")).body;
  const listed = repos.repositories?.some((r) => r.fullName === FIXTURE_REPOSITORY);
  step(6, "Select the fixture GitHub repository", listed ? "STAND-IN" : "FAIL", `listed through Orbit Web's own code from the stand-in: ${JSON.stringify(repos.repositories?.map((r) => r.fullName))}`);
  const branches = (await api(`/api/repositories/branches?source=github&id=${encodeURIComponent(FIXTURE_REPOSITORY)}`)).body;
  step(7, "Select the branch", branches.branches?.[0]?.name === "main" ? "PASS" : "FAIL", `branches: ${JSON.stringify(branches.branches?.map((b) => b.name))}`);
  step(8, "Choose Sonnet 5.5, Medium effort, Autonomous", "PASS", "model: sonnet, effort: medium, mode: autonomous (--permission-mode auto)");

  const created = await api("/api/sessions", { method: "POST", body: JSON.stringify({ repository: { source: "github", id: FIXTURE_REPOSITORY }, branch: "main", model: "sonnet", effort: "medium", mode: "autonomous", prompt: PROMPT }) });
  step(9, "Create a new chat", created.status === 201 ? "PASS" : "FAIL", `HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
  if (created.status !== 201) return;
  const id = created.body.id;
  evidence.sessionId = id;
  const t0 = Date.now();
  const frames = await follow(id, 0, ["session.completed", "session.failed", "session.interrupted", "workspace.failed"], 15 * 60_000);
  writeFileSync(join(OUT, "turn1-events.jsonl"), frames.map((f) => JSON.stringify({ id: f.id, ...f.event })).join("\n") + "\n");
  const first = summarise(frames);
  evidence.runs.push({ turn: 1, prompt: PROMPT, ms: Date.now() - t0, ...first });
  step(10, "Send the prompt", frames.some((f) => f.event.type === "message.completed" && f.event.data.role === "user" && f.event.data.text === PROMPT) ? "PASS" : "FAIL", PROMPT);
  const realCli = first.started?.claudeCodeVersion && first.end?.type === "session.completed";
  step(11, "The real Claude CLI runs", realCli ? "PASS" : "FAIL", `Claude Code ${first.started?.claudeCodeVersion ?? "?"} (${first.started?.model ?? "?"}); ended ${first.end?.type ?? "never"}; cost $${first.end?.data?.costUsd ?? "?"}; turns ${first.end?.data?.turns ?? "?"}${first.end?.type === "session.failed" ? `; ${first.end.data.message}` : ""}`);
  step(12, "The Orbit plugin is active", first.started?.orbitLoaded ? "PASS" : "FAIL", `init plugins: ${JSON.stringify(first.started?.plugins ?? [])}`);

  const changes = (await api(`/api/sessions/${id}/changes`)).body;
  evidence.changes = changes;
  const paths = (changes.files ?? []).map((f) => `${f.kind}:${f.path}`);
  const onlySum = paths.length === 1 && paths[0] === "modified:sum.mjs";
  const testUntouched = exec("git", "-C", `/data/workspaces/${id}/repository`, "diff", "--quiet", changes.baseCommit ?? "HEAD", "--", "sum.test.mjs").status === 0;
  step(13, "The source really changed", onlySum && testUntouched ? "PASS" : "FAIL", `changed: ${JSON.stringify(paths)}; sum.test.mjs untouched: ${testUntouched}`);
  const test = exec("sh", "-c", `cd /data/workspaces/${id}/repository && node --test 2>&1`);
  evidence.testOutput = test.stdout.slice(-2000);
  step(14, "The test passes", test.status === 0 ? "PASS" : "FAIL", `node --test exit ${test.status}: ${(/ℹ pass (\d+)/.exec(test.stdout)?.[0] ?? "")} ${(/ℹ fail (\d+)/.exec(test.stdout)?.[0] ?? "")}`);
  step(15, "Streaming shows the real execution", first.deltas > 0 && first.deltasWithoutId === first.deltas && first.durableWithId === first.durable ? "PASS" : "FAIL", `${first.deltas} text deltas (none with an SSE id), ${first.durable} durable events each with its seq as SSE id, tools: ${JSON.stringify(first.tools)}`);
  step(16, "The changed files appear", (changes.files ?? []).length > 0 ? "PASS" : "FAIL", `${changes.totals?.files} file(s) +${changes.totals?.additions} -${changes.totals?.deletions} on ${changes.currentBranch} from ${changes.baseBranch}`);
  const apiDiff = (await api(`/api/sessions/${id}/changes/file?path=sum.mjs`)).body;
  const gitDiff = exec("git", "-C", `/data/workspaces/${id}/repository`, "-c", "core.hooksPath=/dev/null", "diff", "--no-ext-diff", "--no-textconv", "--no-color", changes.baseCommit, "--", "sum.mjs");
  evidence.diff = apiDiff.diff;
  step(17, "The Git diff is accurate", apiDiff.diff === gitDiff.stdout && gitDiff.stdout.length > 0 ? "PASS" : "FAIL", apiDiff.diff === gitDiff.stdout ? "the API's diff is byte-identical to git diff in the workspace" : "the API's diff differs from git diff");

  const panel = (await api(`/api/sessions/${id}/verification`)).body;
  evidence.orbitPanel = panel;
  const session = (await api(`/api/sessions/${id}`)).body;
  const direct = exec("sh", "-c", `cd /data/workspaces/${id}/repository && ORBIT_STORE_DIR=/data/orbit ORBIT_SESSION=claude:$(printf %s ${session.claudeSessionId} | sha256sum | cut -c1-16) node /opt/orbit/plugin/cli/live.mjs status --json`);
  const directAssociation = parsed(direct.stdout)?.association ?? null;
  const same = panel.state === "available" && JSON.stringify({ how: directAssociation?.how, task: directAssociation?.task ?? null }) === JSON.stringify({ how: panel.association?.how, task: panel.association?.taskId ?? null });
  step(18, "Orbit's status is read correctly", same ? "PASS" : "FAIL", `panel: ${panel.state}, association ${panel.association?.how}/${panel.association?.taskId ?? "no task"}, verdict ${panel.verdict?.word} (${panel.verdict?.source}); Orbit's own live status: ${directAssociation?.how}/${directAssociation?.task ?? "no task"}`);

  const restarted = docker(["restart", NAME]).status === 0 && (await healthy());
  const after = (await api(`/api/sessions/${id}`)).body;
  const kept = after.status === "completed" && after.messages?.length >= 2 && after.turns === 1;
  step(19, "Restart the container", restarted && kept ? "PASS" : "FAIL", `after restart: status ${after.status}, ${after.messages?.length} messages, turns ${after.turns}, workspace kept: ${exec("test", "-f", `/data/workspaces/${id}/repository/sum.mjs`).status === 0}`);

  const sent = await api(`/api/sessions/${id}/messages`, { method: "POST", body: JSON.stringify({ text: FOLLOW_UP }) });
  const t1 = Date.now();
  const frames2 = sent.status === 202 ? await follow(id, after.lastSeq, ["session.completed", "session.failed", "session.interrupted"], 10 * 60_000) : [];
  writeFileSync(join(OUT, "turn2-events.jsonl"), frames2.map((f) => JSON.stringify({ id: f.id, ...f.event })).join("\n") + "\n");
  const second = summarise(frames2);
  evidence.runs.push({ turn: 2, prompt: FOLLOW_UP, ms: Date.now() - t1, ...second });
  const resumed = second.started?.resumed === true && second.started?.claudeSessionId === session.claudeSessionId && second.end?.type === "session.completed";
  const answer = frames2.filter((f) => f.event.type === "message.completed" && f.event.data.role === "assistant").map((f) => f.event.data.text).join("\n");
  evidence.followUpAnswer = answer.slice(0, 1000);
  step(20, "Reopen and continue the session", resumed ? "PASS" : "FAIL", `resumed ${second.started?.resumed} with the same Claude session (${second.started?.claudeSessionId === session.claudeSessionId}); ended ${second.end?.type}; cost $${second.end?.data?.costUsd ?? "?"}; answer: ${answer.replace(/\s+/g, " ").slice(0, 200)}`);
}

function finish() {
  evidence.finishedAt = new Date().toISOString();
  evidence.steps = steps;
  writeFileSync(join(OUT, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  const counts = steps.reduce((m, s) => ({ ...m, [s.status]: (m[s.status] ?? 0) + 1 }), {});
  const md = [
    `# Orbit Web ${VERSION} -- real acceptance run`,
    "",
    `Image ${IMAGE}; Claude Code ${evidence.versions?.claude ?? "?"}; Orbit ${evidence.versions?.orbit ?? "?"} (${evidence.versions?.orbitCommit ?? "?"}); budget $${BUDGET} per turn.`,
    "",
    "| # | Step | Result | Evidence |",
    "|---|---|---|---|",
    ...steps.map((s) => `| ${s.n} | ${s.label} | ${s.status} | ${s.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`),
    "",
    `Totals: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    "",
  ].join("\n");
  writeFileSync(join(OUT, "REPORT.md"), md);
  process.stdout.write(`\n${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}\nevidence: ${OUT}\n`);
  process.exit(steps.some((s) => s.status === "FAIL") ? 1 : 0);
}

main().catch((err) => {
  step(99, "the acceptance harness itself", "FAIL", err.stack ?? String(err));
  finish();
});
