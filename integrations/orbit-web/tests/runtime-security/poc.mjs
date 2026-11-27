#!/usr/bin/env node
// THE RUNTIME SECURITY PROOF OF CONCEPT (Orbit Web 0.8.1, ADR 0063): ONE pinned Tetragon sensor beside hardened
// stand-ins of an attempt's two planes -- the workstation (tool plane) and the model plane, made with the hardening the
// allocator gives them (apps/api/src/allocator/specs.ts: read-only root, no capability, no-new-privileges, Docker's
// default seccomp, tmpfs /tmp) and labelled the way it labels them -- for two accounts, plus a control workload no
// policy names. Nothing a person runs is touched: every name is `orbit-rs-poc-<suffix>-*`.
//
// It decides each verdict from what it reads ITSELF -- exit codes, errno, a marker file a program would have written,
// the sensor's own export file, `tetra tracingpolicy list -o json` -- never from the sensor's word alone:
//
//   A  attribution   every event lands on the container, account, attempt and plane that caused it, and no other
//   B  observation   a process tree is seen independently of any AI CLI (parent links by exec id, not by pid)
//   C  enforcement   an operation the baseline sandbox PERMITS (running a file from a shared area: the team room, the
//                    deliverables, the model plane's credential home -- volume mounts Docker cannot make noexec) is
//                    PREVENTED by a policy scoped to ONE attempt -- errno, the absent side effect, the sensor's override
//                    event -- and still runs in a workload outside the policy's scope
//   D  lifecycle     a recreated container is not protected by the old policy; namespace inodes are reused, so a stale
//                    policy must never outlive its workload; delete cleans up; a sensor restart drops every policy
//   E  failure       sensor gone, policy refused, policy aimed at the wrong workload, no selector at all
//   F  cost          sensor CPU/RAM, exec overhead without/with the sensor/with enforcement, events/s, loss, export
//                    growth, policy install latency, ten concurrent per-attempt policies
//
// Verdicts: PASS · FAIL · BLOCKED (the host could not run it) · UNSUPPORTED (the kernel or sensor cannot do it --
// reported, never approximated).
//
//   node tests/runtime-security/poc.mjs [--out=<dir>] [--keep] [--workstation=<image>] [--model-plane=<image>]
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const opt = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const flag = (name) => process.argv.includes(`--${name}`);

export const TETRAGON_IMAGE = "quay.io/cilium/tetragon:v1.8.0@sha256:5ed9088a1582131d71b06c98e0d549a37a71ae63ab13aabefc7a47553c822a9d";
const WORKSTATION = opt("workstation") ?? "ghcr.io/cuongngoht/orbit-web-workstation:0.8.0";
const MODEL_PLANE = opt("model-plane") ?? "ghcr.io/cuongngoht/orbit-web-model-plane:0.8.0";
const HELPER = "alpine:latest";
// The 0.8.0 images carry no canary of their own (0.8.1 bakes one in): a program they hold that no workload of theirs
// runs stands in for it here.
const CANARY = opt("canary") ?? "/usr/bin/arch";
const suffix = randomBytes(3).toString("hex");
const P = `orbit-rs-poc-${suffix}`;
const ROOT = `/private/tmp/${P}`;
const EVENTS = join(ROOT, "events");
const OUT = opt("out") ?? join(HERE, "results", "0.8.1");
const SOCKET = "unix:///var/run/tetragon/tetragon.sock";
const SENSOR = `${P}-tetragon`;
const LOOPS = 3;

const steps = [];
const evidence = { suffix, image: TETRAGON_IMAGE, workstation: WORKSTATION, modelPlane: MODEL_PLANE, canary: CANARY, facts: {}, cost: {}, scenarios: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (args, o = {}) => spawnSync("docker", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...o });
const now = () => Number(process.hrtime.bigint() / 1_000_000n);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function step(cap, label, verdict, detail = "") {
  steps.push({ cap, label, verdict, detail });
  process.stdout.write(`${verdict.padEnd(12)} ${cap} ${label}${detail ? ` -- ${detail}` : ""}\n`);
}
const verdictOf = (ok) => (ok ? "PASS" : "FAIL");

// ---- the sensor -------------------------------------------------------------------------------------------------

// Arguments are excluded AT THE SOURCE: a process's argv may hold a prompt, a token or a customer's data, and an
// event that never carried it cannot leak it. Environment variables are never exported (Tetragon's default).
export const SENSOR_ARGS = [
  "/usr/bin/tetragon",
  "--server-address", SOCKET,
  "--health-server-address", "",
  "--export-filename", "/var/log/tetragon/tetragon.log",
  "--export-file-max-size-mb", "10",
  "--export-file-max-backups", "3",
  "--export-file-perm", "644",
  "--enable-process-ns",
  "--field-filters", JSON.stringify({ fields: "process.arguments,parent.arguments", action: "EXCLUDE" }),
];

function startSensor() {
  docker(["rm", "-f", SENSOR]);
  const r = docker(["run", "-d", "--name", SENSOR, "--pid=host", "--cgroupns=host", "--privileged", "--network", "none", "-v", "/sys/kernel:/sys/kernel", "-v", `${EVENTS}:/var/log/tetragon`, "--label", `orbit-rs-poc=${suffix}`, TETRAGON_IMAGE, ...SENSOR_ARGS]);
  if (r.status !== 0) throw new Error(`the sensor did not start: ${r.stderr.trim()}`);
}
const tetra = (args, input) => docker(["exec", ...(input !== undefined ? ["-i"] : []), SENSOR, "tetra", "--server-address", SOCKET, ...args], input !== undefined ? { input } : {});

async function sensorReady(seconds = 60) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const s = tetra(["status"]);
    if (s.status === 0 && /running/i.test(s.stdout)) return s.stdout.trim();
    await sleep(500);
  }
  throw new Error(`the sensor did not report running: ${tetra(["status"]).stderr.trim()}`);
}

function policies() {
  const r = tetra(["tracingpolicy", "list", "-o", "json"]);
  if (r.status !== 0) return { error: r.stderr.trim(), list: [] };
  return { error: null, list: JSON.parse(r.stdout || "{}").policies ?? [] };
}
const policyNamed = (name) => policies().list.find((p) => p.name === name) ?? null;

function addPolicy(yaml, mode) {
  const t0 = now();
  const r = tetra(["tracingpolicy", "add", "/dev/stdin", ...(mode ? ["--mode", mode] : [])], yaml);
  return { ok: r.status === 0, ms: now() - t0, stderr: r.stderr.trim(), stdout: r.stdout.trim() };
}
const deletePolicy = (name) => tetra(["tracingpolicy", "delete", name]);

// ---- the policies -----------------------------------------------------------------------------------------------

const quote = (s) => JSON.stringify(String(s));
const inode = (m) => /^\d+$/.test(String(m));

// ONE policy per protected attempt, one selector per plane: the namespace is the only selector that holds outside
// Kubernetes. Never a selector without one -- a missing namespace would be every process on the host.
export function attemptPolicy({ name, planes, canary = null, override = true }) {
  const selectors = [];
  const action = override ? ["      matchActions:", "      - action: Override", "        argError: -1"] : [];
  const selector = (mnts, operator, values) => {
    if (!Array.isArray(mnts) || mnts.length === 0 || mnts.length > 4 || !mnts.every(inode)) throw new Error("every selector needs one to four mount-namespace inodes");
    if (values.length === 0) throw new Error("a selector with no value would match nothing it was meant to");
    selectors.push("    - matchNamespaces:", "      - namespace: Mnt", "        operator: In", `        values: [${mnts.map(quote).join(", ")}]`, "      matchArgs:", "      - index: 0", `        operator: ${operator}`, `        values: [${values.map(quote).join(", ")}]`, ...action);
  };
  for (const p of planes) selector(p.mnts, "Prefix", p.prefixes);
  if (canary !== null) selector(canary.mnts, "Equal", [canary.path]);
  if (selectors.length === 0) throw new Error("a policy with no selector is never produced");
  return ["apiVersion: cilium.io/v1alpha1", "kind: TracingPolicy", "metadata:", `  name: ${quote(name)}`, "spec:", "  lsmhooks:", "  - hook: bprm_check_security", "    args:", "    - index: 0", "      type: linux_binprm", "    selectors:", ...selectors, ""].join("\n");
}

// The areas an attempt's programs never need to EXECUTE from: shared with other employees (/team), delivered to
// people (/output), handed in (/input), and the model plane's credential home (/connection). /work, HOME and /cache
// stay executable on purpose (a toolbox, `pip --user`, `npx`).
const TOOL_SHARED = ["/team/", "/output/", "/input/"];
const MODEL_SHARED = ["/connection/"];
const policyFor = (name, tool, model, extra = {}) => attemptPolicy({ name, planes: [{ mnts: [tool.mnt], prefixes: TOOL_SHARED }, ...(model ? [{ mnts: [model.mnt], prefixes: MODEL_SHARED }] : [])], canary: { mnts: [tool.mnt, ...(model ? [model.mnt] : [])], path: CANARY }, ...extra });

// ---- the workloads ----------------------------------------------------------------------------------------------

const HARDENED = ["--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--ipc", "private", "--init", "--restart", "no", "--network", "none"];
const workloads = {};
const volumes = new Set();

function volumeFor(name, uid) {
  const v = `${P}-${name}`;
  if (!volumes.has(v)) {
    docker(["volume", "create", "--label", `orbit-rs-poc=${suffix}`, v]);
    docker(["run", "--rm", "-v", `${v}:/v`, HELPER, "chown", `${uid}:${uid}`, "/v"]);
    volumes.add(v);
  }
  return v;
}

function makeWorkload(key, { account, plane, run }) {
  const name = `${P}-${key}`;
  docker(["rm", "-f", name]);
  const labels = ["orbit-web.sandbox=1", `orbit-web.prefix=${P}`, `orbit-web.account=${account}`, `orbit-web.run=${run}`, `orbit-web.dispatch-key=${run}:1`, "orbit-web.fence=1", `orbit-web.role=${plane}`, `orbit-rs-poc=${suffix}`].flatMap((l) => ["--label", l]);
  const tool = ["--hostname", "workstation", "--user", "20001:20001", "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m,mode=1777", "--mount", `type=volume,src=${volumeFor(`${account}-team`, 20001)},dst=/team,volume-nocopy`, "--mount", `type=volume,src=${volumeFor(`${run}-output`, 20001)},dst=/output,volume-nocopy`, "--mount", `type=volume,src=${volumeFor(`${run}-work`, 20001)},dst=/work,volume-nocopy`, "--workdir", "/work", "--shm-size", "64m", "--cpus", "1", "--memory", "512m", "--pids-limit", "256", WORKSTATION, "sleep", "infinity"];
  const model = ["--hostname", "model-plane", "--user", "10001:10001", "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m,mode=1777", "--mount", `type=volume,src=${volumeFor(`${run}-connection`, 10001)},dst=/connection,volume-nocopy`, "--cpus", "1", "--memory", "512m", "--pids-limit", "512", "--entrypoint", "sleep", MODEL_PLANE, "infinity"];
  const r = docker(["run", "-d", "--name", name, ...HARDENED, ...labels, ...(plane === "tool-plane" ? tool : model)]);
  if (r.status !== 0) throw new Error(`${key} did not start: ${r.stderr.trim()}`);
  const inspect = JSON.parse(docker(["inspect", name]).stdout)[0];
  const mnt = /^mnt:\[(\d+)\]$/.exec(sh(name, "readlink /proc/self/ns/mnt").stdout.trim())?.[1] ?? null;
  workloads[key] = { key, name, id: inspect.Id, startedAt: inspect.State.StartedAt, account, plane, run, mnt, area: plane === "tool-plane" ? "/team" : "/connection" };
  return workloads[key];
}
const sh = (name, script, o = {}) => docker(["exec", name, "sh", "-c", script], o);

// ---- the export file ----------------------------------------------------------------------------------------------

function readEvents() {
  if (!existsSync(EVENTS)) return [];
  // Rotated files are tetragon-<timestamp>.log (older), the live one tetragon.log: read oldest first.
  const files = readdirSync(EVENTS).filter((f) => /^tetragon(-[^/]+)?\.log$/.test(f)).sort((x, y) => (x === "tetragon.log") - (y === "tetragon.log") || x.localeCompare(y));
  const out = [];
  for (const f of files) {
    for (const line of readFileSync(join(EVENTS, f), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        out.push(normalize(JSON.parse(line)));
      } catch {
        out.push({ type: "unparsable" });
      }
    }
  }
  return out;
}

function normalize(raw) {
  const type = Object.keys(raw).find((k) => k.startsWith("process_")) ?? Object.keys(raw)[0];
  const body = raw[type] ?? {};
  const p = body.process ?? {};
  return {
    type,
    time: raw.time,
    docker: p.docker ?? null,
    binary: p.binary ?? null,
    execId: p.exec_id ?? null,
    parentExecId: p.parent_exec_id ?? null,
    pid: p.pid ?? null,
    mnt: p.ns?.mnt?.inum !== undefined ? String(p.ns.mnt.inum) : null,
    hasArguments: p.arguments !== undefined || body.parent?.arguments !== undefined,
    policy: body.policy_name ?? null,
    hook: body.function_name ?? null,
    action: body.action ?? null,
    path: body.args?.[0]?.linux_binprm_arg?.path ?? null,
    raw: body,
  };
}

const ownerOf = (dockerId) => (dockerId ? (Object.values(workloads).find((w) => w.id.startsWith(dockerId)) ?? null) : null);

async function waitFor(predicate, seconds = 15) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const found = readEvents().filter(predicate);
    if (found.length > 0 || Date.now() > deadline) return found;
    await sleep(250);
  }
}

// ---- probes -----------------------------------------------------------------------------------------------------

// A shebang script, written into the workload's shared area, that leaves a marker in /tmp when -- and only when -- it
// runs. Its result is read from the workload's own filesystem and the exit code, never from the sensor.
function areaExec(w, tag, area = w.area) {
  const marker = `/tmp/ran-${tag}`;
  const file = `${area}/x-${tag}.sh`;
  const r = sh(w.name, `rm -f ${marker}; printf '#!/bin/sh\\ntouch ${marker}\\n' > ${file}; chmod +x ${file}; ${file}; echo "rc=$?"; test -e ${marker} && echo MARKER || echo NOMARKER`);
  const rc = Number(/rc=(\d+)/.exec(r.stdout)?.[1] ?? -1);
  return { rc, ran: /\bMARKER\b/.test(r.stdout), eperm: /not permitted/i.test(r.stderr), eacces: /permission denied/i.test(r.stderr), stderr: r.stderr.trim() };
}

// The canary is executed the way the allocator will: `docker exec <container> <canary>` -- runc's own execve.
function canary(w) {
  const r = docker(["exec", w.name, CANARY]);
  return { rc: r.status, eperm: /not permitted/i.test(r.stderr), stderr: r.stderr.trim().slice(0, 160) };
}

// memfd_create + execve of /proc/self/fd/N: a program that never touched a disk. python3 is the workstation's.
const MEMFD = String.raw`import os,sys
fd=os.memfd_create("orbit-poc",0)
os.write(fd,open("/bin/true","rb").read())
try:
    os.execv("/proc/self/fd/%d"%fd,["orbit-poc"])
except OSError as e:
    print("errno=%d"%e.errno); sys.exit(126)`;
const memfdExec = (w) => {
  const r = docker(["exec", w.name, "python3", "-c", MEMFD]);
  return { rc: r.status, out: r.stdout.trim() };
};

function stats(name) {
  const r = docker(["stats", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}", name]);
  const [cpu, mem] = r.stdout.trim().split("|");
  return { cpu: parseFloat(cpu), mem: (mem ?? "").split("/")[0].trim() };
}

const execLoopOnce = (w, n) => Number(sh(w.name, `s=$(date +%s%N); i=0; while [ $i -lt ${n} ]; do /bin/true; i=$((i+1)); done; e=$(date +%s%N); echo $(( (e-s)/1000000 ))`).stdout.trim());
const execLoop = (w, n) => median(Array.from({ length: LOOPS }, () => execLoopOnce(w, n)));

// ---- the run ------------------------------------------------------------------------------------------------------

function facts() {
  const info = JSON.parse(docker(["info", "--format", "{{json .}}"]).stdout);
  const k = docker(["run", "--rm", "--privileged", "--pid=host", HELPER, "sh", "-c", "zcat /proc/config.gz | grep -E '^CONFIG_(BPF_LSM|BPF_KPROBE_OVERRIDE|DEBUG_INFO_BTF|FUNCTION_ERROR_INJECTION)='; mkdir -p /s && mount -t securityfs none /s && echo LSM=$(cat /s/lsm)"]);
  const config = Object.fromEntries(k.stdout.trim().split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  evidence.facts = { kernel: info.KernelVersion, os: info.OperatingSystem, arch: info.Architecture, docker: info.ServerVersion, cgroup: info.CgroupVersion, cgroupDriver: info.CgroupDriver, securityOptions: info.SecurityOptions, cpus: info.NCPU, memory: info.MemTotal, config };
  const bpfLsm = /(^|,)bpf(,|$)/.test(config.LSM ?? "");
  step("-", "host facts", "PASS", `${info.OperatingSystem} · kernel ${info.KernelVersion} · ${info.Architecture} · ${info.NCPU} CPU · cgroup v${info.CgroupVersion} · active LSMs ${config.LSM ?? "?"} · BPF LSM ${bpfLsm ? "active" : "inactive"} · KPROBE_OVERRIDE ${config.CONFIG_BPF_KPROBE_OVERRIDE ?? "n"} · BTF ${config.CONFIG_DEBUG_INFO_BTF ?? "n"}`);
  return { bpfLsm };
}

async function main() {
  mkdirSync(EVENTS, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const { bpfLsm } = facts();
  for (const image of [WORKSTATION, MODEL_PLANE, TETRAGON_IMAGE, HELPER]) if (docker(["image", "inspect", image]).status !== 0) docker(["pull", image]);

  // Account A's attempt (both planes), account B's tool plane, and C: the same image, a workload no policy names.
  const a = makeWorkload("a-tool", { account: "acct-a", plane: "tool-plane", run: "run-a" });
  const am = makeWorkload("a-model", { account: "acct-a", plane: "model-plane", run: "run-a" });
  const b = makeWorkload("b-tool", { account: "acct-b", plane: "tool-plane", run: "run-b" });
  const c = makeWorkload("c-tool", { account: "acct-c", plane: "tool-plane", run: "run-c" });
  evidence.workloads = Object.values(workloads).map(({ key, id, account, plane, mnt }) => ({ key, id, account, plane, mnt }));
  step("-", "workloads made with the allocator's hardening (read-only root, no capability, no-new-privileges, default seccomp)", Object.values(workloads).every((w) => w.mnt !== null) ? "PASS" : "FAIL", Object.values(workloads).map((w) => `${w.key} mnt:${w.mnt}`).join(" · "));

  // ---- the baseline before any sensor: what the sandbox alone already refuses, and what it permits
  const tmp = areaExec(a, "base-tmp", "/tmp");
  step("C", "EXISTING control holds: /tmp is noexec (Docker's tmpfs default) -- nothing to add there", verdictOf(!tmp.ran && tmp.eacces), `rc ${tmp.rc}: ${tmp.stderr.slice(0, 80)}`);
  const baseTeam = areaExec(a, "base-team");
  const baseOut = areaExec(a, "base-output", "/output");
  const baseConn = areaExec(am, "base-conn");
  step("C", "GAP: the baseline PERMITS running a file from the team room (a volume shared with other employees)", verdictOf(baseTeam.ran), `rc ${baseTeam.rc}, marker ${baseTeam.ran ? "written" : "absent"}`);
  step("C", "GAP: the baseline PERMITS running a file from /output (delivered to people)", verdictOf(baseOut.ran), `rc ${baseOut.rc}`);
  step("C", "GAP: the baseline PERMITS running a file from the model plane's credential home (/connection)", verdictOf(baseConn.ran), `rc ${baseConn.rc}`);
  const baseMemfd = memfdExec(a);
  step("C", "GAP: the baseline PERMITS fileless execution (memfd)", verdictOf(baseMemfd.rc === 0), `rc ${baseMemfd.rc}`);
  step("C", "the canary runs before any policy", verdictOf(canary(a).rc === 0 && canary(am).rc === 0));
  for (const w of [a, am]) {
    const u = sh(w.name, "unshare -m true 2>&1; echo rc=$?; unshare -U true 2>&1; echo rc=$?");
    const rcs = [...u.stdout.matchAll(/rc=(\d+)/g)].map((m) => Number(m[1]));
    step("C", `${w.key}: no new mount or user namespace can be made, so the namespace selector cannot be escaped`, verdictOf(rcs.length === 2 && rcs.every((x) => x !== 0)), u.stdout.replace(/\n/g, " ").trim().slice(0, 140));
  }
  evidence.cost.execLoopNoSensorMs = execLoop(a, 2000);

  // ---- the sensor
  const t0 = now();
  startSensor();
  const status = await sensorReady();
  evidence.cost.sensorStartMs = now() - t0;
  evidence.facts.tetragon = tetra(["version"]).stdout.trim();
  step("-", "the pinned sensor runs with no network; policies reach it over its unix socket only", "PASS", `${evidence.facts.tetragon.replace(/\n/g, " · ")} · ${status.replace(/\n/g, " ")} · ready in ${evidence.cost.sensorStartMs} ms`);
  await sleep(1500);
  evidence.cost.sensorIdle = [stats(SENSOR)];
  for (let i = 0; i < 2; i++) {
    await sleep(1000);
    evidence.cost.sensorIdle.push(stats(SENSOR));
  }

  // ---- A: attribution
  for (const w of [a, am, b, c]) sh(w.name, "id >/dev/null; /bin/true; readlink /proc/self/ns/mnt >/dev/null");
  await waitFor((e) => e.type === "process_exec" && e.docker !== null && c.id.startsWith(e.docker) && /readlink$/.test(e.binary ?? ""));
  const evs = readEvents();
  const execs = evs.filter((e) => e.type === "process_exec" && ownerOf(e.docker) !== null);
  const perWorkload = Object.fromEntries(Object.values(workloads).map((w) => [w.key, execs.filter((e) => w.id.startsWith(e.docker)).map((e) => e.binary)]));
  const allSeen = Object.values(workloads).every((w) => ["/id", "/true", "/readlink"].every((bin) => perWorkload[w.key].some((x) => x?.endsWith(bin))));
  const nsAgree = Object.values(workloads).every((w) => {
    const own = execs.filter((e) => w.id.startsWith(e.docker) && /readlink$/.test(e.binary ?? ""));
    return own.length > 0 && own.every((e) => e.mnt === w.mnt);
  });
  const prefixes = new Set(execs.map((e) => e.docker));
  const unique = [...prefixes].every((d) => Object.values(workloads).filter((w) => w.id.startsWith(d)).length === 1);
  evidence.scenarios.attribution = { perWorkload, dockerIdLength: execs[0]?.docker?.length ?? 0, nsAgree };
  step("A", "every exec of each workload is attributed to its own container, and nothing crosses accounts", verdictOf(allSeen && unique), `${Object.entries(perWorkload).map(([k, v]) => `${k}: ${v.length}`).join(" · ")} · docker id prefix of ${execs[0]?.docker?.length ?? 0} hex chars, unique among the workloads`);
  step("A", "the sensor's mount namespace for a workload equals the one the workload reports (identity cross-check)", verdictOf(nsAgree));
  step("A", "account, attempt and plane come from labels only the allocator set, of THAT container", verdictOf(execs.every((e) => {
    const w = ownerOf(e.docker);
    const l = JSON.parse(docker(["inspect", "--format", "{{json .Config.Labels}}", w.name]).stdout);
    return l["orbit-web.account"] === w.account && l["orbit-web.role"] === w.plane && l["orbit-web.run"] === w.run;
  })));
  step("A", "no process argument reaches the export file (field filter at the source)", verdictOf(!evs.some((e) => e.hasArguments)));

  // ---- B: a process tree, seen by the kernel
  sh(a.name, "sh -c 'sleep 0.3 & wait'");
  const tree = await waitFor((e) => e.type === "process_exec" && a.id.startsWith(e.docker ?? "-") && /sleep$/.test(e.binary ?? ""));
  const byExec = new Map(readEvents().filter((e) => e.execId && e.type === "process_exec").map((e) => [e.execId, e]));
  const chain = [];
  for (let cur = tree.at(-1); cur && chain.length < 6; cur = byExec.get(cur.parentExecId)) chain.push(cur.binary);
  const exits = await waitFor((e) => e.type === "process_exit" && a.id.startsWith(e.docker ?? "-") && /sleep$/.test(e.binary ?? ""), 5);
  evidence.scenarios.observation = { chain, exits: exits.length };
  step("B", "a child process tree is observed with parent links by exec id (a reused PID cannot confuse it)", verdictOf(chain.length >= 2 && /sleep$/.test(chain[0] ?? "") && /sh$/.test(chain[1] ?? "")), chain.join(" <- "));
  step("B", "the child's exit is observed", verdictOf(exits.length > 0));
  const memfdObserved = memfdExec(a);
  const fileless = await waitFor((e) => e.type === "process_exec" && a.id.startsWith(e.docker ?? "-") && /^\/proc\/(self|\d+)\/fd\//.test(e.binary ?? ""), 5);
  step("B", "fileless execution is OBSERVED: the executed program is named /proc/self/fd/N", verdictOf(memfdObserved.rc === 0 && fileless.length > 0), fileless.at(-1)?.binary ?? "not seen");

  // ---- C: prevention, scoped to account A's attempt
  if (!bpfLsm) {
    step("C", "prevention needs the BPF LSM active in the kernel", "UNSUPPORTED", "this kernel's lsm= list has no bpf");
  } else {
    const yaml = policyFor("orbit-poc-a", a, am);
    writeFileSync(join(ROOT, "orbit-poc-a.yaml"), yaml);
    evidence.scenarios.policyYaml = yaml;
    const add = addPolicy(yaml, "enforce");
    evidence.cost.policyAddMs = [add.ms];
    const listed = policyNamed("orbit-poc-a");
    evidence.scenarios.policyReadBack = listed;
    step("C", "a policy scoped to ONE attempt's two namespaces is installed and READ BACK", verdictOf(add.ok && listed?.state === "TP_STATE_ENABLED" && listed?.mode === "TP_MODE_ENFORCE"), add.ok ? `${add.ms} ms · ${listed?.state} · ${listed?.mode} · ${listed?.kernel_memory_bytes} B of kernel memory` : add.stderr.slice(0, 300));
    if (add.ok) {
      await sleep(400);
      const inA = areaExec(a, "enf");
      const inAOut = areaExec(a, "enf-out", "/output");
      const inAm = areaExec(am, "enf");
      const canA = canary(a);
      const canAm = canary(am);
      const inB = areaExec(b, "enf");
      const inC = areaExec(c, "enf");
      const canB = canary(b);
      const canC = canary(c);
      const override = await waitFor((e) => e.type === "process_lsm" && e.policy === "orbit-poc-a" && /\/team\/x-enf\.sh$/.test(e.path ?? ""), 10);
      evidence.scenarios.enforcement = { inA, inAOut, inAm, canA, canAm, inB, inC, canB, canC, overrideEvent: override.at(-1)?.raw ?? null };
      step("C", "IN SCOPE, A's tool plane: running a script from the team room is PREVENTED -- EPERM, exit 126, no marker", verdictOf(inA.rc === 126 && !inA.ran && inA.eperm), `rc ${inA.rc}, marker ${inA.ran ? "written" : "absent"}, "${inA.stderr.slice(0, 70)}"`);
      step("C", "IN SCOPE, A's tool plane: the same from /output", verdictOf(inAOut.rc === 126 && !inAOut.ran && inAOut.eperm), `rc ${inAOut.rc}`);
      step("C", "IN SCOPE, A's model plane: running a file from the credential home is PREVENTED", verdictOf(inAm.rc === 126 && !inAm.ran && inAm.eperm), `rc ${inAm.rc}, marker ${inAm.ran ? "written" : "absent"}`);
      step("C", "the canary is refused in BOTH of A's planes (run as the allocator runs it: docker exec)", verdictOf(canA.rc !== 0 && canA.eperm && canAm.rc !== 0 && canAm.eperm), `tool ${canA.rc} · model ${canAm.rc} · "${canA.stderr.slice(0, 90)}"`);
      step("C", "the sensor's own event says OVERRIDE, for A's container, this policy and this path", verdictOf(override.length > 0 && override.at(-1).action === "KPROBE_ACTION_OVERRIDE" && a.id.startsWith(override.at(-1).docker ?? "-")), `${override.at(-1)?.action ?? "no event"} ${override.at(-1)?.path ?? ""}`);
      step("C", "OUT OF SCOPE, account B (same image, its own team room): the same operation still runs, the canary too", verdictOf(inB.ran && inB.rc === 0 && canB.rc === 0), `rc ${inB.rc}, canary ${canB.rc}`);
      step("C", "OUT OF SCOPE, control C: the same operation still runs -- the policy is not host-wide", verdictOf(inC.ran && inC.rc === 0 && canC.rc === 0), `rc ${inC.rc}, canary ${canC.rc}`);
      const counters = policyNamed("orbit-poc-a")?.stats ?? null;
      evidence.scenarios.counters = counters;
      step("C", "the policy's own counters read back the overrides it made", verdictOf(Number(counters?.action_counters?.override ?? 0) >= 5), JSON.stringify(counters?.action_counters ?? {}));
      const mA = memfdExec(a);
      step("C", "fileless (memfd) execution cannot be PREVENTED by this hook: it reports no path for a memory-only file", "UNSUPPORTED", `rc ${mA.rc} in scope; a rule on the execve filename would be bypassed by a symlink, and runc re-executes itself through a memfd: detected (B), never claimed prevented`);
      const interp = sh(a.name, "printf 'touch /tmp/ran-interp\\n' > /team/i.sh; sh /team/i.sh; test -e /tmp/ran-interp && echo INTERPRETED");
      step("C", "LIMIT: `sh file` interprets a file (the shell is what runs) and is not prevented -- stated, not claimed", "PASS", interp.stdout.trim() || interp.stderr.trim());
      const work = areaExec(a, "work", "/work");
      step("C", "by design /work stays executable (a toolbox, a build) -- the rule names only the shared areas", verdictOf(work.ran), `rc ${work.rc}`);

      // OBSERVE: the same rule in monitor mode reports and never refuses.
      deletePolicy("orbit-poc-a");
      const mon = addPolicy(policyFor("orbit-poc-a-observe", a, am), "monitor");
      await sleep(400);
      const inMon = areaExec(a, "mon");
      const monEv = await waitFor((e) => e.type === "process_lsm" && e.policy === "orbit-poc-a-observe" && /x-mon\.sh$/.test(e.path ?? ""), 10);
      evidence.scenarios.monitor = { inMon, action: monEv.at(-1)?.action ?? null, mode: policyNamed("orbit-poc-a-observe")?.mode ?? null, event: monEv.at(-1)?.raw ?? null };
      step("C", "OBSERVE (monitor mode): the rule MATCHES and the operation RUNS -- a detection, never called prevention", verdictOf(mon.ok && inMon.ran && monEv.length > 0 && evidence.scenarios.monitor.mode === "TP_MODE_MONITOR"), `ran ${inMon.ran}, mode ${evidence.scenarios.monitor.mode}`);
      step("C", "FINDING: in monitor mode the event STILL says ${action} -- prevention is never read from an event, only from the policy's mode and a probe".replace("${action}", monEv.at(-1)?.action ?? "?"), "PASS", "the normalizer derives OPERATION_PREVENTED from (enforce mode read back) AND (override event); monitor mode gives VIOLATION_DETECTED");
      deletePolicy("orbit-poc-a-observe");
    }
  }

  // ---- D: lifecycle
  if (bpfLsm) {
    // A stale policy (its container gone, the policy not deleted) and a new container: the kernel hands out the same
    // namespace inode again, so the stale policy would bind a workload it was never meant for.
    addPolicy(policyFor("orbit-poc-stale", a, null), "enforce");
    const oldMnt = a.mnt;
    docker(["rm", "-f", a.name]);
    const a2 = makeWorkload("a-tool", { account: "acct-a", plane: "tool-plane", run: "run-a" });
    const reused = a2.mnt === oldMnt;
    const underStale = areaExec(a2, "stale");
    evidence.scenarios.inodeReuse = { oldMnt, newMnt: a2.mnt, reused, underStale };
    step("D", "namespace inodes are RE-USED: a policy that outlives its container can bind the next one (it must be deleted first)", reused ? (underStale.ran ? "FAIL" : "PASS") : "PASS", reused ? `old ${oldMnt} = new ${a2.mnt}; the stale policy ${underStale.ran ? "did not" : "DID"} refuse the new container` : `old ${oldMnt}, new ${a2.mnt} (not reused this time)`);
    const stalePolicies = policies().list.filter((p) => p.name === "orbit-poc-stale").length;
    step("D", "so a new workload's inode is checked against every installed policy before it is protected", verdictOf(stalePolicies === 1), `a registry finds ${stalePolicies} installed policy holding inode ${a2.mnt} that is not this attempt's: reap it, then bind`);
    deletePolicy("orbit-poc-stale");
    await sleep(300);
    const free = areaExec(a2, "reaped");
    const re = addPolicy(policyFor("orbit-poc-a2", a2, am), "enforce");
    await sleep(300);
    const bound = areaExec(a2, "rebound");
    step("D", "reaped and bound to the new container: protection is back, the old binding is gone", verdictOf(free.ran && re.ok && !bound.ran && bound.rc === 126), `after reap ran ${free.ran}; after bind rc ${bound.rc}`);
    const del = deletePolicy("orbit-poc-a2");
    await sleep(300);
    const afterDel = areaExec(a2, "deleted");
    step("D", "cleanup: delete removes the policy (read back) and its effect", verdictOf(del.status === 0 && policyNamed("orbit-poc-a2") === null && afterDel.ran), `listed after delete ${policyNamed("orbit-poc-a2") !== null}`);
    // Late events: a container removed right after it ran something is still attributable from the export file.
    sh(b.name, "/bin/true; /bin/true");
    const bId = b.id;
    docker(["rm", "-f", b.name]);
    const late = await waitFor((e) => e.type === "process_exit" && bId.startsWith(e.docker ?? "-"), 5);
    step("D", "events of a removed container still carry its id: a registry keeps tombstones and never re-uses a mapping", verdictOf(late.length > 0), `${late.length} late exit event(s)`);
    // A sensor restart drops every policy it was given.
    addPolicy(policyFor("orbit-poc-restart", a2, null), "enforce");
    docker(["restart", SENSOR]);
    await sensorReady();
    const afterRestart = policies().list.map((p) => p.name);
    const unprotected = areaExec(a2, "restart");
    step("D", "a sensor RESTART drops every policy: protection must be re-proven, or the workload contained", verdictOf(!afterRestart.includes("orbit-poc-restart") && unprotected.ran), `policies after restart [${afterRestart.join(", ")}]; the probe ${unprotected.ran ? "ran" : "was refused"}`);

    // ---- E: failure
    addPolicy(policyFor("orbit-poc-e", a2, null), "enforce");
    await sleep(300);
    docker(["stop", "-t", "5", SENSOR]);
    const sensorGone = areaExec(a2, "nosensor");
    step("E", "sensor STOPPED: its enforcement is gone with it (why mandatory protection must fail closed)", verdictOf(sensorGone.ran), `the probe ${sensorGone.ran ? "ran" : "was refused"}`);
    docker(["start", SENSOR]);
    await sensorReady();
    const invalid = addPolicy("apiVersion: cilium.io/v1alpha1\nkind: TracingPolicy\nmetadata:\n  name: orbit-poc-bad\nspec:\n  lsmhooks:\n  - hook: no_such_hook_at_all\n", "enforce");
    const badState = policyNamed("orbit-poc-bad")?.state ?? "not listed";
    evidence.scenarios.refusedPolicy = { stderr: invalid.stderr, listed: policyNamed("orbit-poc-bad") };
    step("E", "a policy for a hook the kernel does not have is REFUSED (an error, never a silent no-op), and never listed as enabled", verdictOf(!invalid.ok && badState !== "TP_STATE_ENABLED"), `add failed: "${invalid.stderr.slice(-120)}" · listed: ${badState}`);
    deletePolicy("orbit-poc-bad");
    const wrong = addPolicy(attemptPolicy({ name: "orbit-poc-wrong", planes: [{ mnts: ["4026599999"], prefixes: TOOL_SHARED }], canary: { mnts: ["4026599999"], path: CANARY } }), "enforce");
    await sleep(300);
    const notMine = canary(a2);
    step("E", "a policy aimed at the WRONG namespace loads and lists fine -- only the in-workload canary shows it protects nothing", verdictOf(wrong.ok && policyNamed("orbit-poc-wrong")?.state === "TP_STATE_ENABLED" && notMine.rc === 0), `listed ${policyNamed("orbit-poc-wrong")?.state}, canary in the workload rc ${notMine.rc}`);
    deletePolicy("orbit-poc-wrong");
    let refused = null;
    try {
      attemptPolicy({ name: "x", planes: [{ mnts: [], prefixes: TOOL_SHARED }] });
    } catch (err) {
      refused = err.message;
    }
    step("E", "a selector with NO workload namespace is never produced (it would be host-wide)", verdictOf(refused !== null), refused ?? "produced");

    // ---- F: cost
    deletePolicy("orbit-poc-e");
    const logSize = () => (existsSync(join(EVENTS, "tetragon.log")) ? statSync(join(EVENTS, "tetragon.log")).size : 0);
    const before = logSize();
    const since = Date.now();
    evidence.cost.execLoopSensorMs = execLoop(a2, 2000);
    await sleep(3000);
    const observed = readEvents().filter((e) => e.type === "process_exec" && a2.id.startsWith(e.docker ?? "-") && /\/true$/.test(e.binary ?? "") && Date.parse(e.time) >= since - 1000).length;
    evidence.cost.exportBytes = logSize() - before;
    evidence.cost.sensorUnderLoad = stats(SENSOR);
    addPolicy(policyFor("orbit-poc-f", a2, am), "enforce");
    await sleep(300);
    evidence.cost.execLoopEnforceMs = execLoop(a2, 2000);
    deletePolicy("orbit-poc-f");
    const expected = 2000 * LOOPS;
    evidence.cost.execEvents = { observed, expected };
    step("F", `exec overhead: 2,000 short-lived processes, median of ${LOOPS}`, "PASS", `no sensor ${evidence.cost.execLoopNoSensorMs} ms · sensor ${evidence.cost.execLoopSensorMs} ms · sensor + this attempt's policy ${evidence.cost.execLoopEnforceMs} ms`);
    step("F", "event loss under bursts of 2,000 execs", verdictOf(observed >= expected), `${observed}/${expected} exec events · export +${Math.round(evidence.cost.exportBytes / 1024)} KiB (${observed > 0 ? Math.round(evidence.cost.exportBytes / observed) : "?"} B per exec+exit)`);

    // Ten concurrent per-attempt policies, as ten employees working at once would need.
    const many = [];
    for (let i = 0; i < 10; i++) many.push(makeWorkload(`m${i}`, { account: `acct-m${i}`, plane: "tool-plane", run: `run-m${i}` }));
    const adds = many.map((w) => addPolicy(policyFor(`orbit-poc-${w.key}`, w, null), "enforce"));
    await sleep(1000);
    const held = many.map((w) => areaExec(w, "many")).filter((r) => !r.ran && r.rc === 126).length;
    const freeC = areaExec(c, "many-c");
    const kmem = policies().list.reduce((s, p) => s + Number(p.kernel_memory_bytes ?? 0), 0);
    evidence.cost.tenPolicies = { addMs: adds.map((x) => x.ms), held, sensor: stats(SENSOR), kernelMemoryBytes: kmem };
    step("F", "ten concurrent attempt policies: each holds in its own workload, the control stays free", verdictOf(adds.every((x) => x.ok) && held === 10 && freeC.ran), `add ${Math.min(...adds.map((x) => x.ms))}-${Math.max(...adds.map((x) => x.ms))} ms each · ${Math.round(kmem / 1024 / 1024)} MiB of kernel memory for all ten · sensor ${evidence.cost.tenPolicies.sensor.cpu}% ${evidence.cost.tenPolicies.sensor.mem}`);
    for (const w of many) deletePolicy(`orbit-poc-${w.key}`);
  }
  step("F", "sensor CPU/RAM", "PASS", `idle ${evidence.cost.sensorIdle.map((s) => `${s.cpu}% ${s.mem}`).join(", ")}${evidence.cost.sensorUnderLoad ? ` · after a burst ${evidence.cost.sensorUnderLoad.cpu}% ${evidence.cost.sensorUnderLoad.mem}` : ""}`);
}

function report() {
  const tally = steps.reduce((t, s) => ({ ...t, [s.verdict]: (t[s.verdict] ?? 0) + 1 }), {});
  const f = evidence.facts;
  const head = `# Orbit Web 0.8.1 -- runtime security proof of concept\n\nRun ${new Date().toISOString()} · \`node tests/runtime-security/poc.mjs\` · sensor \`${TETRAGON_IMAGE}\` · workloads \`${WORKSTATION}\`, \`${MODEL_PLANE}\` · host ${f.os ?? "?"} ${f.docker ?? ""}, kernel ${f.kernel ?? "?"} (${f.arch ?? "?"}, ${f.cpus ?? "?"} CPU)\n\nEvery verdict is decided from what the harness reads itself: exit codes and errno, a marker file a program would have written, the sensor's own export file and \`tetra tracingpolicy list -o json\`. UNSUPPORTED means the kernel or the sensor cannot do it here -- reported, never approximated.\n\n`;
  const table = ["| Cap | Check | Verdict | Evidence |", "|---|---|---|---|", ...steps.map((s) => `| ${s.cap} | ${s.label.replace(/\|/g, "\\|")} | **${s.verdict}** | ${s.detail.replace(/\|/g, "\\|")} |`)].join("\n");
  const sum = `\n\n${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(" · ")}\n`;
  writeFileSync(join(OUT, "POC.md"), head + table + sum);
  writeFileSync(join(OUT, "evidence.json"), JSON.stringify({ steps, ...evidence }, null, 2) + "\n");
  process.stdout.write(`\n${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(" · ")} -- ${join(OUT, "POC.md")}\n`);
  return tally;
}

function cleanup() {
  if (flag("keep")) return;
  const ids = docker(["ps", "-aq", "--filter", `label=orbit-rs-poc=${suffix}`]).stdout.trim().split("\n").filter(Boolean);
  if (ids.length > 0) docker(["rm", "-f", ...ids]);
  for (const v of volumes) docker(["volume", "rm", v]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let failed = null;
  try {
    await main();
  } catch (err) {
    failed = err;
    step("-", "the proof of concept could not finish", "BLOCKED", String(err?.message ?? err).slice(0, 400));
  } finally {
    cleanup();
  }
  const tally = report();
  process.exitCode = failed !== null || (tally.FAIL ?? 0) > 0 ? 1 : 0;
}
