// What the benchmark's Docker-free tests share: a small repository of their own with its benchmark cases, and a DOCKER
// DOUBLE -- every container run as a local process with its mounts mapped back to the paths the controller made, so a
// case's probe, the repository's own gates and a candidate's own regression test run for real, each held to the
// deadline its container would have been held to (a candidate that hangs is stopped here exactly as in Docker). The
// runner and the inspection -- a coding host and Orbit's engineering loop -- are played by functions a test names.
// It is harness (test/benchmark-*.mjs): never part of a subject, and it runs nothing when a test runner loads it.
//
//   worldOf(t, files) -> { base, repo, env, storeRoot }      dockerDouble(play) -> { s, deps }
//   ranAs(edits, o) · inspectedAs(view) · VIEW(lifecycle, over) · TASK · runOf(w, double, o) · harnessOf(w, double)
//   closureOf(entries, roots) -> entries   treeOf(t, entries) -> dir   probed(caseDir, spec, entries, o) -> judged
//   ownTest(t, entries, rels) -> { exit, timedOut }
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { carried } from "../benchmark/lib/source/flow.mjs";
import { frozenRun, withSpec } from "../benchmark/lib/core/context.mjs";
import { compared, listed } from "../benchmark/images/runner/inspect.mjs";
import { judgedAll, probeInput } from "../benchmark/lib/source/judge.mjs";
import { sealed } from "./home.mjs";

export const ROOT = join(import.meta.dirname, "..");

export const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@orbit.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@orbit.invalid" };

// ---- a repository of its own ------------------------------------------------------------------------------------------

export function worldOf(t, files) {
  const base = mkdtempSync(join(tmpdir(), "orbit-bench-flow-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  for (const [rel, text] of Object.entries(files)) (mkdirSync(dirname(join(repo, rel)), { recursive: true }), writeFileSync(join(repo, rel), text));
  for (const a of [["init", "-q"], ["add", "-A"], ["commit", "-qm", "repo"]]) spawnSync("git", a, { cwd: repo, env: sealed(GIT_ENV) });
  const env = sealed({ ...GIT_ENV, ORBIT_STORE_DIR: join(base, "store"), ANTHROPIC_API_KEY: "test-only-not-a-key" });
  const storeRoot = JSON.parse(spawnSync(process.execPath, [join(ROOT, "cli", "query.mjs"), "storage", "--json"], { cwd: repo, env, encoding: "utf8" }).stdout).storeRoot;
  return { base, repo, env, storeRoot };
}

// ---- the docker double ---------------------------------------------------------------------------------------------------

const VALUED = new Set(["--user", "--cpuset-cpus", "--log-driver", "--log-opt", "--name", "--network", "--network-alias", "--label", "--tmpfs", "--cap-drop", "--security-opt", "--mount", "--cpus", "--memory", "--pids-limit", "-e", "--env-file", "-w"]);

function parsedCreate(args) {
  const c = { flags: {}, argv: [], mounts: [], labels: {}, envNames: [] };
  for (let i = 1; i < args.length; i++) i = argOf(c, args, i);
  return c;
}

function argOf(c, args, i) {
  const a = args[i];
  if (c.image) return (c.argv.push(a), i);
  if (!VALUED.has(a)) return a.startsWith("-") ? i : ((c.image = a), i);
  const v = args[i + 1];
  if (a === "--mount") c.mounts.push(Object.fromEntries(v.split(",").map((kv) => (kv === "readonly" ? ["readOnly", true] : kv.split("=")))));
  if (a === "--label") c.labels[v.split("=")[0]] = v.split("=").slice(1).join("=");
  if (a === "-e") c.envNames.push(v);
  return (c.flags[a] = [...(c.flags[a] ?? []), v], i + 1);
}

const rawOf = (c) => ({ Id: c.id, Name: `/${c.flags["--name"][0]}`, Image: c.image, Config: { User: c.flags["--user"][0], Labels: c.labels, Env: ["PATH=/usr/bin", "LANG=C.UTF-8", "LC_ALL=C.UTF-8", ...c.envNames, ...c.envValues] }, HostConfig: { ReadonlyRootfs: true, CapDrop: c.flags["--cap-drop"] ?? [], CapAdd: [], SecurityOpt: c.flags["--security-opt"] ?? [], NanoCpus: 1e9, Memory: 1, PidsLimit: 1, Privileged: false, Devices: [], NetworkMode: c.flags["--network"][0] }, Mounts: c.mounts.map((m) => ({ Type: "bind", Source: m.source, Destination: m.target, RW: !m.readOnly })), NetworkSettings: { Networks: { [c.flags["--network"][0]]: {} } }, State: { ExitCode: c.exit ?? 0, OOMKilled: false } });

export const mapped = (c, p) => ((m) => (m ? join(m.source, p.slice(m.target.length)) : p))(c.mounts.filter((m) => p === m.target || p.startsWith(`${m.target}/`)).sort((a, b) => b.target.length - a.target.length)[0]);

// What a container's process is started with: nothing of this test runner's -- a NODE_TEST_CONTEXT inherited from it
// would make a gate's own `node --test` report to this runner instead of exiting with its result.
const containerEnv = () => Object.fromEntries(Object.entries(sealed({ HOME: tmpdir() })).filter(([k]) => k !== "NODE_TEST_CONTEXT"));

// A container's process, run here -- and stopped at the container's own deadline, as the controller stops a container.
function localRun(c, opts) {
  const argv = c.argv.slice(1).map((a) => mapped(c, a));
  const r = spawnSync(process.execPath, argv, { cwd: c.flags["-w"] ? mapped(c, c.flags["-w"][0]) : tmpdir(), input: opts.input ?? "", env: containerEnv(), encoding: "utf8", timeout: opts.timeoutMs, killSignal: "SIGKILL" });
  c.exit = r.error?.code === "ETIMEDOUT" ? 137 : r.status;
  opts.observe?.("out", Buffer.from(r.stdout ?? ""));
  return r.error?.code === "ETIMEDOUT" ? { ok: false, out: r.stdout ?? "", timedOut: true } : { ok: r.status === 0, status: r.status, out: r.stdout };
}

export function dockerDouble(play) {
  const s = { containers: new Map(), networks: new Map(), calls: [], n: 0 };
  const verbs = {
    info: (a) => ({ ok: true, out: a.includes("{{.NCPU}}") ? "4" : "[]" }),
    image: (a) => ({ ok: true, out: a.includes("--format") ? `sha256:${"c".repeat(64)}` : JSON.stringify([{ Id: a.at(-1), Config: { Env: ["PATH=/usr/bin"], Labels: {} } }]) }),
    create: (a) => ((c) => ((c.id = `c${++s.n}`), (c.envValues = envValues(c)), s.containers.set(c.id, c), { ok: true, out: `${c.id}\n` }))(parsedCreate(a)),
    inspect: (a) => (s.containers.get(a[1]) ? { ok: true, out: JSON.stringify([rawOf(s.containers.get(a[1]))]) } : { ok: false, out: "[]" }),
    network: (a) => networkVerb(s, a),
    rm: (a) => (s.containers.delete(a.at(-1)), { ok: true, out: "" }),
    ps: (a) => ({ ok: true, out: [...s.containers.values()].filter((c) => labelled(c.labels, a)).map((c) => c.id).join("\n") }),
  };
  const process = { run: (file, a) => (s.calls.push(a), (verbs[a[0]] ?? (() => ({ ok: true, out: "" })))(a)), runObserved: async (file, a, opts) => (s.calls.push(a), attached(s.containers.get(a.at(-1)), opts, play)) };
  return { s, deps: () => ({ process, env: {}, scratch: { write: (text) => ((f) => (writeFileSync(f, text), f))(join(mkdtempSync(join(tmpdir(), "orbit-env-")), "x.env")), remove: () => null } }) };
}

const envValues = (c) => (c.flags["--env-file"] ? readFileSync(c.flags["--env-file"][0], "utf8").split("\n").filter(Boolean).map((l) => l.split("=")[0]) : []);

const networkVerb = (s, a) => ({ inspect: () => (s.networks.has(a[2]) ? { ok: true, out: JSON.stringify([{ Id: a[2], Internal: true, Labels: s.networks.get(a[2]), Containers: {} }]) } : { ok: false, out: "[]" }), create: () => (s.networks.set(a.at(-1), Object.fromEntries(a.filter((x, i) => a[i - 1] === "--label").map((l) => l.split("=")))), { ok: true, out: "n1" }), rm: () => (s.networks.delete(a.at(-1)), { ok: true, out: "" }), ls: () => ({ ok: true, out: [...s.networks].filter(([, labels]) => labelled(labels, a)).map(([name]) => name).join("\n") }), connect: () => ({ ok: true, out: "" }) })[a[1]]?.() ?? { ok: true, out: "" };

// What `--filter label=<key>=<value>` keeps: what carries that label with that value.
const labelled = (labels, a) => ((f) => !f || labels?.[f.slice(6).split("=")[0]] === f.slice(6).split("=").slice(1).join("="))(a.find((x, i) => a[i - 1] === "--filter" && x.startsWith("label=")));

async function attached(c, opts, play) {
  if (c.argv[1] === "/bench/entry.mjs") return played(c, await play.runner(c, (p) => mapped(c, p)));
  if (c.argv[1] === "/bench/inspect.mjs") return played(c, play.inspect(c, (p) => mapped(c, p)));
  if (c.argv[1] === "/bench/egress.mjs") return { ok: true, out: "" };
  return localRun(c, opts);
}

const played = (c, r) => ((c.exit = r?.exit ?? 0), r?.timedOut ? { ok: false, out: "", timedOut: true } : { ok: true, out: "", status: c.exit });

// ---- the runner and the inspection, played -------------------------------------------------------------------------------

export const TASK = "tsk-0000000000a1";

const workspaceOf = (at) => join(at("/work/store"), "repo-calc", "workspaces", TASK, "tree");

// A round as a runner plays it: the task started and said (start.json), the workspace made and edited, the host's
// stream written. `o.dies` is the controller dying mid-round -- after what `o.dies` names, nothing more is written.
export function ranAs(edits, o = {}) {
  return async (c, at) => {
    const out = at("/work/out");
    if (o.dies === "before-start") throw new Error("the controller died here");
    writeFileSync(join(out, "start.json"), JSON.stringify({ task: TASK, started: true, egress: { holds: true } }));
    const tree = workspaceOf(at);
    if (!existsSync(tree)) cpSync(at("/work/repo"), tree, { recursive: true, filter: (p) => !p.includes(".git") });
    for (const [rel, text] of Object.entries(edits)) (text === null ? rmSync(join(tree, rel), { force: true }) : (mkdirSync(dirname(join(tree, rel)), { recursive: true }), writeFileSync(join(tree, rel), text)));
    if (o.dies === "after-edits") throw new Error("the controller died here");
    writeFileSync(join(out, "runner.json"), JSON.stringify({ task: TASK, exit: 0, egress: { holds: true } }));
    writeFileSync(join(out, "host.jsonl"), [{ type: "system", subtype: "init", model: "test-double" }, { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit" }] } }, { type: "result", subtype: "success", is_error: false, num_turns: 2, total_cost_usd: o.cost === undefined ? 0.5 : o.cost }].map((e) => JSON.stringify(e)).join("\n"));
    return o.timedOut ? { timedOut: true } : { exit: 0 };
  };
}

// The inspection as inspect.mjs makes it: the task it was named, else the one task the runner store holds (here: the
// one whose workspace a runner made), else none -- and the workspace compared with the subject.
export function inspectedAs(view) {
  return (c, at) => {
    const out = at("/work/out");
    const tree = workspaceOf(at);
    const held = existsSync(tree) ? [{ id: TASK }] : [];
    const task = c.argv[2] !== "-" ? c.argv[2] : (held[0]?.id ?? null);
    const changes = task && existsSync(tree) ? compared(listed(at("/work/repo"), [".claude-plugin/types"]), listed(tree)) : [];
    for (const ch of changes.filter((x) => x.change !== "deleted")) (mkdirSync(dirname(join(out, "files", ch.rel)), { recursive: true }), cpSync(join(tree, ch.rel), join(out, "files", ch.rel)));
    writeFileSync(join(out, "inspect.json"), JSON.stringify({ task, found: c.argv[2] !== "-" ? "start" : task ? "only-task" : null, workspace: Boolean(task) && existsSync(tree), changes: changes.map((ch) => ({ ...ch, copied: ch.change !== "deleted" })) }));
    for (const [name, v] of [["task.json", task ? { exit: 0, json: view } : { exit: null, json: null, why: "no task was started" }], ["tasks.json", { exit: 0, json: { tasks: held } }], ["trace.json", { exit: 0, json: {} }]]) writeFileSync(join(out, name), JSON.stringify(v));
    return { exit: 0 };
  };
}

export const VIEW = (lifecycle, over = {}) => ({ task: { id: TASK, provider: "autonomous-engineering" }, lifecycle, terminal: ["COMPLETED", "FAILED"].includes(lifecycle), stopReason: null, stage: "REVIEWING", attempts: [{ id: "att-1" }], receipts: [], approvals: [], changes: { files: 1 }, ...over });

export const NEVER = { runner: () => { throw new Error("no runner was asked for"); }, inspect: () => { throw new Error("no inspection was asked for"); } };

// What run.mjs hands every command, for a world of its own and a double.
export const harnessOf = (w, double) => ({ root: w.repo, engine: ROOT, env: w.env, taskEnv: w.env, credential: null, caFile: null, storeRoot: w.storeRoot, storeBase: dirname(w.storeRoot), dockerDeps: double.deps });

export const IMAGES = { verifier: `sha256:${"a".repeat(64)}`, runner: `sha256:${"b".repeat(64)}`, claudeCode: "double" };

export async function runOf(w, double, o) {
  const h = harnessOf(w, double);
  const ctx = { ...(await withSpec(frozenRun(h, { caseId: o.caseId ?? "CALC-001", variant: o.variant ?? "real", repair: o.repair === true, host: o.host, rounds: o.rounds, seed: 3, images: IMAGES, dockerVersion: "double" }))), heldEveryMs: o.heldEveryMs };
  return { h, ctx, result: await carried(ctx), view: ctx.rec.show(ctx.task) };
}

// ---- a case's checks, run here: only the files a probe or a test imports, written to a tree of their own ------------------

const IMPORT = /\b(?:import|export)\b[^"'`]*?\bfrom\s*["'`]([^"'`]+)["'`]|\bimport\s*["'`]([^"'`]+)["'`]/g;

const relativeImports = (rel, text) => [...String(text).matchAll(IMPORT)].map((m) => m[1] ?? m[2]).filter((spec) => spec.startsWith(".")).map((spec) => posix.normalize(posix.join(posix.dirname(rel), spec)));

// Every file the roots import, and what those import, out of the entries -- the subject a check needs.
export function closureOf(entries, roots) {
  const byRel = new Map(entries.map((e) => [e.rel, e]));
  const seen = new Set();
  const visit = (rel) => (seen.has(rel) || !byRel.has(rel) ? null : (seen.add(rel), relativeImports(rel, byRel.get(rel).bytes.toString("utf8")).forEach(visit)));
  roots.forEach(visit);
  return [...seen].map((rel) => byRel.get(rel));
}

export function treeOf(t, entries) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-bench-tree-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const e of entries) (mkdirSync(dirname(join(dir, e.rel)), { recursive: true }), writeFileSync(join(dir, e.rel), e.bytes));
  return dir;
}

// The case's own probe, run as a child over a tree, judged by its frozen spec and the harness judge -- or stopped at a
// deadline, as its container would be.
export function probed(t, caseDir, spec, entries, o = {}) {
  const cases = spec.cases(o.seed ?? 4242, o.samples ?? 48);
  const r = spawnSync(process.execPath, [join(caseDir, "verifier", "probe.mjs"), treeOf(t, entries)], { input: probeInput(cases), env: sealed(), encoding: "utf8", timeout: o.timeoutMs, killSignal: "SIGKILL" });
  return r.error?.code === "ETIMEDOUT" ? { timedOut: true } : judgedAll(cases, r.stdout, spec);
}

// A candidate's own test, run as a child over a tree: how it ended.
export function ownTest(t, entries, rels) {
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...rels], { cwd: treeOf(t, entries), env: containerEnv(), encoding: "utf8", timeout: 120000 });
  return { exit: r.status, timedOut: r.error?.code === "ETIMEDOUT" };
}
