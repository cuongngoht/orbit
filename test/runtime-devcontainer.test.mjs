// The Dev Container provider's lifecycle, through the Process port and nothing else:
// a fixed wrapper that never reads a value as script, labels that are the only way a
// container is called Orbit's, and a stop that is honest about what it did not reach.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { devcontainer, EXEC_OVERHEAD_MS, HANDED_OVER, labelsOf, MARKED, SESSION_MARKER } from "../src/runtime/providers/devcontainer.mjs";
import { SHIPPED_CATALOG } from "./fakes/runtime.mjs";
import { boundProviders, PROVIDERS, providerOf } from "../src/runtime/providers/index.mjs";
import { providerProblems } from "../src/runtime/providers/contract-v1.mjs";
import { Refused } from "../src/errors.mjs";
import { fakeProcess } from "./fakes/process.mjs";
import { sealed } from "./home.mjs";

const world = { checkout: "c".repeat(64), envId: "env-abc123abc123" };
const deps = (process, extra = {}) => ({ process, root: "/work/shop", env: { PATH: "/usr/bin", SECRET_TOKEN: "x" }, logs: { out: "/l/out", err: "/l/err" }, now: () => "2026-10-03T10:00:00.000Z", sleep: () => {}, ...extra });

test("both providers meet the contract, and a malformed one is refused with a sentence", () => {
  assert.deepEqual(PROVIDERS.map((p) => providerProblems(p)), [[], []]);
  assert.equal(boundProviders().length, 2);
  assert.throws(() => boundProviders([{ id: "Bad Id", doc: "x" }]), (e) => e instanceof Refused && /cannot bind the runtime providers/.test(e.message));
  assert.match(providerProblems({ id: "x", doc: "y" }).join(), /has no compatibility\(\)/);
  assert.equal(providerOf("native").id, "native");
  assert.equal(providerOf("nope"), null);
});

test("start is `devcontainer exec` with the labels and a FIXED wrapper: the component's argv rides after it as positional parameters", () => {
  const process = fakeProcess();
  devcontainer.start({}, { argv: ["npm", "run", "dev; rm -rf /"], cwd: "apps/web" }, world, deps(process));
  const [launch] = process.launches;
  assert.equal(launch.file, "devcontainer");
  assert.deepEqual(launch.args.slice(0, 7), ["exec", "--workspace-folder", "/work/shop", "--id-label", `orbit.checkout=${world.checkout}`, "--id-label", `orbit.env=${world.envId}`]);
  assert.deepEqual(launch.args.slice(7), ["--", "sh", "-c", HANDED_OVER, "sh", "apps/web", "npm", "run", "dev; rm -rf /"], "a value with ; is a positional argument and never part of the script");
  assert.deepEqual(Object.keys(launch.opts.env), ["PATH"], "the host's secrets are not handed to the container's client");
  assert.equal(launch.opts.input, undefined, "no variable was listed, so nothing is handed over");
});

test("an environment is up only when a container carrying THIS environment's labels is running -- labels, never a name", () => {
  const ps = (out, ok = true) => fakeProcess({ docker: (args) => (ps.last = args, { ok, out, error: ok ? undefined : "daemon down", status: ok ? 0 : 1 }) });
  const up = ps("abc123\n");
  assert.equal(devcontainer.ready(world, deps(up)).ok, true);
  assert.deepEqual(up.calls[0].args, ["ps", "-q", "--filter", `label=orbit.env=${world.envId}`, "--filter", `label=orbit.checkout=${world.checkout}`]);
  assert.match(devcontainer.ready(world, deps(ps("", false))).because, /could not be asked \(daemon down\)/);
});

test("an environment that is not up says the ONE step that comes next, by how far it has come", () => {
  const down = () => fakeProcess({ docker: { ok: true, out: "" } });
  const said = (instances) => devcontainer.ready({ ...world, instances }, deps(down())).because;
  assert.match(said([]), /no environment has been adopted for this checkout: `runtime design`.*`runtime adopt <id> --human`/);
  assert.match(said([{ provider: "devcontainer", state: "ADOPTED" }]), /adopted and has not been brought up: `runtime validate --human`/);
  assert.match(said([{ provider: "devcontainer", state: "VALIDATED" }]), /the environment is not up: `runtime prepare --apply --human` brings it up/);
});

test("down stops the containers that are Orbit's and nothing else -- by label, one by one, never a name or a prune", () => {
  const process = fakeProcess({ docker: (args) => (args[0] === "ps" ? { ok: true, out: "aaa\nbbb\n" } : { ok: true, out: "" }) });
  const out = devcontainer.down(world, deps(process));
  assert.deepEqual(process.calls.map((c) => c.args).filter((a) => a[0] !== "inspect"), [["ps", "-q", "--filter", `label=orbit.env=${world.envId}`, "--filter", `label=orbit.checkout=${world.checkout}`], ["stop", "aaa"], ["stop", "bbb"]]);
  assert.deepEqual([out.ok, out.stopped], [true, 2]);
  assert.equal(process.calls.some((c) => ["rm", "prune", "down", "volume", "kill", "system"].includes(c.args[0]) || c.args.includes("-v") || c.args.includes("--volumes")), false, "nothing removed, pruned or taken down, and no volume touched");
  assert.deepEqual(process.calls.map((c) => c.args[0]).filter((a) => !["ps", "inspect", "stop"].includes(a)), [], "it asks, and stops: nothing else");
});

const session = { id: "rs-aaaaaaaaaaaa", env: world.envId, checkout: world.checkout };

test("what a start launches carries the session's MARKER in its environment, and so does everything it starts in turn", () => {
  const process = fakeProcess();
  devcontainer.start({}, { argv: ["npm", "start"], cwd: "." }, world, deps(process, { session: session.id }));
  const { args } = process.launches[0];
  assert.deepEqual(args.slice(7, 10), ["--remote-env", `${SESSION_MARKER}=${session.id}`, "--"]);
});

test("the environment NAMES a person listed reach the container on STDIN, read at launch -- never on a command line; a name not listed, or not set, never does -- and the client's own environment stays the base one", () => {
  const process = fakeProcess();
  const env = { PATH: "/usr/bin", SECRET_TOKEN: "canary-6b1f0c2e", API_URL: "http://api.internal.example:8080" };
  devcontainer.start({}, { argv: ["npm", "start"], cwd: "." }, world, deps(process, { session: session.id, envNames: ["API_URL", "UNSET_NAME"], env }));
  const { args, opts } = process.launches[0];
  assert.equal(opts.input, "API_URL=http://api.internal.example:8080\n\n", "one NAME=VALUE a line, then an empty line");
  assert.equal(args.some((a) => a.includes("api.internal.example")), false, "the value is on no command line: not the exec client's, not the `docker exec` under it");
  assert.deepEqual(args.slice(7, 10), ["--remote-env", `${SESSION_MARKER}=${session.id}`, "--"], "only the session's marker rides --remote-env");
  assert.equal([...args, opts.input].some((a) => a.includes("canary-6b1f0c2e") || a.includes("SECRET_TOKEN") || a.includes("UNSET_NAME")), false, "a value nobody listed, or a name that is not set, never reaches the container");
  assert.deepEqual(Object.keys(opts.env), ["PATH"], "the client itself gets the base environment");
});

test("a value with a line break cannot travel in a line: it is withheld, and the start says which name -- the rest are handed over", () => {
  const process = fakeProcess();
  const env = { PATH: "/usr/bin", CERT: "-----BEGIN-----\nabc\n-----END-----", API_URL: "http://api" };
  const out = devcontainer.start({}, { argv: ["npm", "start"], cwd: "." }, world, deps(process, { envNames: ["CERT", "API_URL"], env }));
  assert.equal(process.launches[0].opts.input, "API_URL=http://api\n\n");
  assert.deepEqual(out.withheld, ["CERT"]);
});

// The reader the container runs, for REAL: `sh` reads what it is handed and exports each value as one
// quoted word -- so a value that looks like shell stays a value -- and then runs the declared command.
test("what the container's reader is handed becomes the command's environment, and nothing in a value is read as shell", { skip: process.platform === "win32" ? "the reader runs inside a Linux container; this proves it with the POSIX sh here" : false }, () => {
  const value = '$(echo injected) ; `id` "quoted" \\back';
  const got = spawnSync("sh", ["-c", HANDED_OVER, "sh", ".", "printenv", "ORBIT_TEST_VALUE"], { input: `ORBIT_TEST_VALUE=${value}\nOTHER=x\n\n`, encoding: "utf8", env: sealed({}) });
  assert.equal(got.stdout, `${value}\n`);
  const none = spawnSync("sh", ["-c", HANDED_OVER, "sh", ".", "printenv", "ORBIT_TEST_VALUE"], { input: "", encoding: "utf8", env: sealed({}) });
  assert.deepEqual([none.status, none.stdout], [1, ""], "handed nothing, the command still runs -- and the variable is simply absent");
});

test("stopping a container session ends the exec client, then -- as the user it started as -- exactly what carries the session's marker inside", async () => {
  const process = fakeProcess({ docker: { ok: true, out: "abc\n" }, devcontainer: { ok: true, out: "5 0\n" } });
  const { pid } = process.launch("devcontainer", []);
  const out = await devcontainer.stop({ ...session, pid }, deps(process));
  assert.deepEqual([out.ok, out.residual, out.inside], [true, null, 5]);
  assert.deepEqual(process.signals[0], { pid, sig: "SIGTERM", tree: true });
  const inside = process.calls.find((c) => c.file === "devcontainer");
  assert.deepEqual(inside.args.slice(0, 8), ["exec", "--workspace-folder", "/work/shop", ...labelsOf(world), "--"], "`devcontainer exec` again: the container's root may not read another user's processes");
  assert.deepEqual([inside.args.slice(8, 10), inside.args[10], inside.args.slice(11)], [["sh", "-c"], MARKED, ["sh", session.id]], "the session is a positional parameter");
  assert.equal(MARKED.includes("rs-"), false, "and never spliced into the script");
  assert.equal(Object.keys(inside.opts.env).includes("SECRET_TOKEN"), false);
});

test("a stop SAYS what it could not reach -- no answer, or something still there after the KILL -- and a container that is down leaves nothing to end", async () => {
  const stopped = async (answers) => {
    const process = fakeProcess(answers);
    const { pid } = process.launch("devcontainer", []);
    return devcontainer.stop({ ...session, pid }, deps(process));
  };
  assert.match((await stopped({ docker: { ok: true, out: "abc\n" }, devcontainer: { ok: true, out: "3 1\n" } })).residual, /may continue \(1 of the 3 process\(es\) it started are still running there\); `runtime stop --environment` stops the container, which is labelled as Orbit's/);
  assert.match((await stopped({ docker: { ok: true, out: "abc\n" }, devcontainer: { ok: false, out: '{"outcome":"error","message":"Dev container not found."}\n', error: "x" } })).residual, /may continue \(Dev container not found\.\)/);
  assert.match((await stopped({ docker: { ok: false, error: "Cannot connect to the Docker daemon" } })).residual, /may continue \(Cannot connect to the Docker daemon\)/);
  assert.match((await stopped({ docker: { ok: true, out: "abc\n" }, devcontainer: { ok: true, out: "Usage: sh\n" } })).residual, /the container did not say what it ended/);
  const down = await stopped({ docker: { ok: true, out: "" } });
  assert.deepEqual([down.ok, down.residual, down.inside], [true, null, 0]);
});

// The script itself, for real, wherever there is a /proc to read (Linux, so CI): it ends what carries
// the marker and leaves a LONGER id alone. A TERM it honours keeps this to a moment.
test("the in-container stop script ends exactly the marked processes, counted, and nothing whose id only begins the same", { skip: !existsSync("/proc/self/environ") && "no /proc on this machine" }, async () => {
  const marked = (id) => spawn("sleep", ["30"], { env: sealed({ [SESSION_MARKER]: id }), stdio: "ignore" });
  const mine = [marked("rs-dddddddddddd"), marked("rs-dddddddddddd")];
  const longer = marked("rs-dddddddddddde");
  const done = spawnSync("sh", ["-c", MARKED, "sh", "rs-dddddddddddd"], { encoding: "utf8", env: sealed() });
  assert.equal(done.stdout.trim(), "2 0");
  assert.deepEqual(await Promise.all(mine.map(signalOf)), ["SIGTERM", "SIGTERM"]);
  assert.deepEqual([longer.exitCode, longer.signalCode], [null, null], "a longer id is another session's");
  longer.kill("SIGKILL");
});

const signalOf = (child) => (child.exitCode !== null || child.signalCode !== null ? child.signalCode : once(child, "exit").then(([, signal]) => signal));

test("what came up WITH the environment -- a database in its compose project -- is NAMED and left running: it carries no Orbit label", () => {
  const docker = (args) => {
    if (args[0] === "ps" && args[1] === "-q") return { ok: true, out: "aaa111\n" };
    if (args[0] === "inspect") return { ok: true, out: "shop\n" };
    if (args[0] === "ps") return { ok: true, out: "aaa111 shop-app-1\nccc333 shop-db-1\n" };
    return { ok: true, out: "" };
  };
  const process = fakeProcess({ docker });
  const out = devcontainer.down(world, deps(process));
  assert.deepEqual([out.ok, out.stopped, out.left], [true, 1, ["shop-db-1"]]);
  assert.match(out.because, /1 container\(s\) carrying this environment's labels were stopped; shop-db-1 came up with it \(compose project shop\) and carries no Orbit label, so it is left running — `docker compose -p shop stop` stops it/);
  assert.deepEqual(process.calls.filter((c) => c.args[0] === "stop").map((c) => c.args), [["stop", "aaa111"]], "only the labelled one is stopped");
  assert.deepEqual(process.calls.find((c) => c.args[0] === "ps" && c.args[1] === "--format").args.slice(-2), ["--filter", "label=com.docker.compose.project=shop"]);
  const odd = fakeProcess({ docker: (args) => (args[0] === "inspect" ? { ok: true, out: "; rm -rf /\n" } : args[0] === "ps" ? { ok: true, out: "aaa111\n" } : { ok: true, out: "" }) });
  assert.deepEqual(devcontainer.down(world, deps(odd)).left, [], "a project name that is not one is not asked about");
});

test("status sees the exec client and which labelled containers carry the environment", () => {
  const process = fakeProcess({ docker: { ok: true, out: "abc\n" } });
  const { pid, startedAt } = process.launch("devcontainer", []);
  assert.deepEqual(devcontainer.status({ pid, env: world.envId }, deps(process)), { alive: true, startedAt, containers: ["abc"] });
});

test("validating is `devcontainer up` with the labels, a long deadline and a receipt -- never the output", () => {
  const process = fakeProcess({ devcontainer: { ok: false, out: "SECRET", error: "build failed", status: 1 } });
  const out = devcontainer.validate(world, deps(process));
  assert.deepEqual(process.calls[0].args.slice(0, 2), ["up", "--workspace-folder"]);
  assert.ok(process.calls[0].opts.timeoutMs >= 20 * 60 * 1000);
  assert.deepEqual([out.ok, out.because, out.receipt], [false, "build failed", { at: "2026-10-03T10:00:00.000Z", tool: "devcontainer", ok: false, status: 1 }]);
  assert.equal(JSON.stringify(out).includes("SECRET"), false);
  assert.deepEqual(labelsOf(world), ["--id-label", `orbit.checkout=${world.checkout}`, "--id-label", `orbit.env=${world.envId}`]);
  assert.equal(process.calls[0].args.includes("--log-level"), false, "the CLI accepts info, debug or trace and nothing quieter: a refused argument builds nothing");
});

test("a failed bring-up says why in the CLI's own words: its JSON result's message, else its last line -- never the head of its usage", () => {
  const refused = fakeProcess({ devcontainer: { ok: false, out: "", err: 'devcontainer up\n\nCreate and run dev container\n\nOptions:\n  --log-level  Log level  [choices: "info", "debug", "trace"]\n\nInvalid values:\n  Argument: log-level, Given: "error", Choices: "info", "debug", "trace"\n', error: "devcontainer up", status: 1 } });
  assert.match(devcontainer.validate(world, deps(refused)).because, /Argument: log-level, Given: "error"/);
  const broken = fakeProcess({ devcontainer: { ok: false, out: '{"outcome":"error","message":"Command failed: docker build","description":"An error occurred building the image."}\n', err: "[2026-10-04T03:44:27.499Z] Start: Run: docker build\n", error: "[2026-10-04T03:44:27.499Z] Start: Run: docker build", status: 1 } });
  assert.equal(devcontainer.validate(world, deps(broken)).because, "Command failed: docker build");
});

test("the native provider's own lifecycle: nothing to build, always ready, and a prepare that changes nothing", () => {
  const native = providerOf("native");
  assert.equal(native.validate({}).ok, true);
  assert.equal(native.ready().ok, true);
  assert.equal(native.prepare({ view: { components: [], shared: { requirements: [] } } }, deps(fakeProcess()), { apply: true }).ok, true);
});

// ---- can a server be reached from INSIDE the container? ----------------------------------------

const REACH_TARGET = { id: "corporate-sql", label: "Corporate SQL", host: "sql.internal.example", port: 1433, protocol: "tcp", requiredBy: [], checkFrom: ["devcontainer"], beforeStart: false };
const reachWorld = { ...world, catalog: SHIPPED_CATALOG };
const asked = (process) => devcontainer.reach(REACH_TARGET, reachWorld, deps(process, { timeoutMs: 3000 }));

test("a Dev Containers CLI that cannot be started on THIS machine is said as this machine's, never blamed on the container", async () => {
  const process = fakeProcess({ docker: { ok: true, out: "abc\n" }, devcontainer: { ok: false, out: "", error: "devcontainer could not be started — ENOENT" } });
  const out = await asked(process);
  assert.deepEqual([out.resolution, out.transport], ["UNKNOWN", "NOT_ATTEMPTED"]);
  assert.match(out.because, /the Dev Containers CLI could not be started on this machine/);
  assert.doesNotMatch(out.because, /the container did not answer/);
});

test("an ADDRESS is never said to resolve inside the container -- only whether it accepted a connection", async () => {
  const process = fakeProcess({ docker: { ok: true, out: "abc\n" }, devcontainer: { ok: true, out: "RESOLVED UNREACHABLE\n" } });
  const out = await devcontainer.reach({ ...REACH_TARGET, host: "10.20.30.40" }, reachWorld, deps(process, { timeoutMs: 3000 }));
  assert.equal(out.because, "10.20.30.40:1433 did not accept a connection from inside the container (refused, or nothing answered in time)");
});

test("reach from inside is BLOCKED when no container carrying the environment's labels runs -- and nothing is exec'd", async () => {
  const process = fakeProcess({ docker: { ok: true, out: "" } });
  const out = await asked(process);
  assert.deepEqual([out.blocked, out.resolution, out.transport], [true, "NOT_ATTEMPTED", "NOT_ATTEMPTED"], "nothing was asked: not even the name");
  assert.match(out.because, /no environment has been adopted/);
  assert.equal(process.calls.some((c) => c.file === "devcontainer"), false);
});

test("reach from inside tries the catalog's tools in order, the host, port and deadline arguments of their own: an absent tool falls through, the first that answers wins", async () => {
  const process = fakeProcess({ docker: { ok: true, out: "abc\n" }, devcontainer: (args) => (args.includes("node") ? { ok: false, status: 127, out: "", err: "exec: node: not found", error: "exec: node: not found" } : { ok: true, out: "RESOLVED REACHABLE\n" }) });
  const out = await asked(process);
  assert.deepEqual([out.resolution, out.transport, out.blocked], ["RESOLVED", "REACHABLE", undefined]);
  assert.match(out.because, /sql\.internal\.example:1433 accepts a connection from inside the container/);
  const execs = process.calls.filter((c) => c.file === "devcontainer");
  assert.deepEqual(execs.map((c) => c.args[c.args.indexOf("--") + 1]), ["node", "python3"], "node was not there, python3 answered, and bash was never asked");
  const args = execs[1].args;
  assert.deepEqual(args.slice(0, 7), ["exec", "--workspace-folder", "/work/shop", ...labelsOf(world)]);
  assert.deepEqual(args.slice(-3), ["sql.internal.example", "1433", "3000"]);
  assert.ok(args.indexOf("--") < args.indexOf("sql.internal.example"), "after the end of the exec options");
  assert.equal(execs[1].opts.timeoutMs, 3000 + EXEC_OVERHEAD_MS, "the attempt's deadline, and what exec itself costs");
  assert.deepEqual(Object.keys(execs[1].opts.env), ["PATH"], "nothing of this machine's environment rides along");
});

test("each line a tool can print is said in words, and a name that does not resolve inside is never called a refused port", async () => {
  const said = async (line) => (await asked(fakeProcess({ docker: { ok: true, out: "abc\n" }, devcontainer: { ok: true, out: `${line}\n` } }))).because;
  assert.match(await said("FAILED NOT_ATTEMPTED"), /sql\.internal\.example does not resolve inside the container/);
  assert.match(await said("RESOLVED UNREACHABLE"), /resolves inside the container, and sql\.internal\.example:1433 did not accept a connection from there/);
  assert.match(await said("UNKNOWN UNREACHABLE"), /whether the name resolves there could not be asked/);
  assert.match(await said("UNKNOWN NOT_ATTEMPTED"), /lookup of sql\.internal\.example did not answer within the deadline/);
});

test("no tool inside can ask: UNKNOWN, naming the tools -- and nothing is installed to make one", async () => {
  const process = fakeProcess({ docker: { ok: true, out: "abc\n" }, devcontainer: { ok: false, status: 127, out: "", err: "not found", error: "not found" } });
  const out = await asked(process);
  assert.deepEqual([out.resolution, out.transport], ["UNKNOWN", "NOT_ATTEMPTED"]);
  assert.match(out.because, /no tool in the container can ask \(none of node, python3, bash is there\) — Orbit installs nothing/);
  assert.equal(process.calls.some((c) => /\b(apt|apt-get|apk|yum|dnf|pip|install)\b/.test(c.args.slice(0, c.args.indexOf("--") + 2).join(" "))), false);
  assert.equal(process.calls.filter((c) => c.file === "devcontainer").length, 3, "each tool asked once, then given up on");
});

test("a tool that is there and did not answer the question is said in its own words, not taken for an absent one", async () => {
  const process = fakeProcess({ docker: { ok: true, out: "abc\n" }, devcontainer: (args) => (args.includes("node") ? { ok: false, status: 1, out: "", err: "Segmentation fault", error: "Segmentation fault" } : { ok: false, status: 127, out: "", err: "not found", error: "not found" }) });
  assert.match((await asked(process)).because, /the container did not answer the check \(Segmentation fault\)/);
});
