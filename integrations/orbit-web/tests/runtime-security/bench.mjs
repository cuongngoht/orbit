#!/usr/bin/env node
// THE RUNTIME SECURITY BENCHMARK (Orbit Web 0.8.1, ADR 0063): what the security plane costs an AI employee's ordinary
// work, measured on this host -- never estimated. A hardened stand-in of an attempt's tool plane (the allocator's
// hardening, the workstation image, its uid, its writable areas) runs the same developer workloads in three modes:
//
//   off       no sensor at all (Orbit Web 0.8.0)
//   observe   the pinned sensor, and the attempt's own policy installed in monitor mode
//   enforce   the same policy in enforce mode
//
// and four attempts at once, each with its own enforced policy. It reports, per mode, the median wall time of each
// workload (timed inside the container, so `docker exec` itself is not counted), the exec events the sensor exported
// for it, the export's growth, the sensor's CPU and memory, and how long a policy takes to be installed and read back
// enabled, and to be removed and read back gone. None of the workloads executes from a shared area: what is measured is
// the cost of being watched and protected, not of being refused.
//
// Nothing a person runs is touched: every name is `orbit-rs-bench-<suffix>-*`, removed at the end (`--keep` keeps it).
//
//   node tests/runtime-security/bench.mjs [--workstation=<image>] [--runs=3] [--out=<dir>] [--keep]
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { attemptPolicy, SENSOR_ARGS, TETRAGON_IMAGE } from "./poc.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const opt = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const WORKSTATION = opt("workstation") ?? "orbit-web-workstation:sandbox-test";
const RUNS = Number(opt("runs") ?? 3);
const OUT = opt("out") ?? join(HERE, "results", "0.8.1");
const HELPER = "alpine:latest";
const CANARY = "/usr/local/libexec/orbit-web/runtime-canary";
const SOCKET = "unix:///var/run/tetragon/tetragon.sock";
const suffix = randomBytes(3).toString("hex");
const P = `orbit-rs-bench-${suffix}`;
const ROOT = `/private/tmp/${P}`;
const EVENTS = join(ROOT, "events");
const SENSOR = `${P}-tetragon`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (args, o = {}) => spawnSync("docker", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...o });
const now = () => Number(process.hrtime.bigint() / 1_000_000n);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const say = (line) => process.stdout.write(`${line}\n`);

// ---- the workloads: what an employee does all day, timed inside the container ----------------------------------------

const PKG = JSON.stringify({ name: "bench-pkg", version: "1.0.0", scripts: { postinstall: "node -e \"require('fs').writeFileSync('installed', '1')\"" } });
const APP = JSON.stringify({ name: "bench-app", version: "1.0.0", private: true });
const MAKEFILE = "OBJS := $(patsubst %.c,%.o,$(wildcard *.c))\nall: $(OBJS)\n%.o: %.c\n\tcc -O1 -c $< -o $@\n";

export const WORKLOADS = {
  "exec loop (2,000 short-lived processes)": "i=0; while [ $i -lt 2000 ]; do /bin/true; i=$((i+1)); done",
  "node startup x30": "for i in $(seq 30); do node -e 0; done",
  "python3 startup x30": "for i in $(seq 30); do python3 -c pass; done",
  "git: 50 commits": "rm -rf /work/g && mkdir /work/g && cd /work/g && git init -q && git config user.email b@example.com && git config user.name bench && for i in $(seq 50); do echo $i > f$i; git add -A; git commit -qm c$i; done",
  "C build: 40 files, make -j4": "rm -rf /work/c && mkdir /work/c && cd /work/c && for i in $(seq 40); do echo \"int f$i(int x){return x+$i;}\" > f$i.c; done && cp /work/Makefile.bench Makefile && make -s -j4",
  "npm install (offline, a postinstall script)": "rm -rf /work/n && mkdir -p /work/n/pkg /work/n/app && cp /work/pkg.json /work/n/pkg/package.json && cp /work/app.json /work/n/app/package.json && cd /work/n/app && npm install --offline --no-audit --no-fund --loglevel=error ../pkg && test -e node_modules/bench-pkg/installed",
};

const timed = (script) => `s=$(date +%s%N); { ${script}; } >/dev/null 2>&1 || exit 97; e=$(date +%s%N); echo $(( (e-s)/1000000 ))`;
const execIn = (name, script) => docker(["exec", "-e", "HOME=/work", "-e", "npm_config_cache=/work/.npm", name, "sh", "-c", script]);

function runOnce(name, script) {
  const r = execIn(name, timed(script));
  const ms = Number(r.stdout.trim());
  if (r.status !== 0 || !Number.isFinite(ms)) throw new Error(`a workload failed in ${name} (rc ${r.status}): ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return ms;
}

// ---- the stand-ins and the sensor ------------------------------------------------------------------------------------

const HARDENED = ["--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--ipc", "private", "--init", "--restart", "no", "--network", "none"];
const made = [];
const volumes = [];

function volume(name) {
  const v = `${P}-${name}`;
  docker(["volume", "create", "--label", `orbit-rs-bench=${suffix}`, v]);
  docker(["run", "--rm", "-v", `${v}:/v`, HELPER, "chown", "20001:20001", "/v"]);
  volumes.push(v);
  return v;
}

function toolPlane(key) {
  const name = `${P}-${key}`;
  const r = docker(["run", "-d", "--name", name, ...HARDENED, "--label", `orbit-rs-bench=${suffix}`, "--hostname", "workstation", "--user", "20001:20001", "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m,mode=1777", "--mount", `type=volume,src=${volume(`${key}-team`)},dst=/team,volume-nocopy`, "--mount", `type=volume,src=${volume(`${key}-work`)},dst=/work,volume-nocopy`, "--workdir", "/work", "--cpus", "2", "--memory", "2g", "--pids-limit", "512", WORKSTATION, "sleep", "infinity"]);
  if (r.status !== 0) throw new Error(`${key} did not start: ${r.stderr.trim()}`);
  made.push(name);
  for (const [file, text] of [["pkg.json", PKG], ["app.json", APP], ["Makefile.bench", MAKEFILE]]) docker(["exec", "-i", name, "sh", "-c", `cat > /work/${file}`], { input: text });
  const id = JSON.parse(docker(["inspect", name]).stdout)[0].Id;
  const mnt = /^mnt:\[(\d+)\]$/.exec(execIn(name, "readlink /proc/self/ns/mnt").stdout.trim())?.[1] ?? null;
  if (mnt === null) throw new Error(`${key}: its mount namespace could not be read`);
  return { key, name, id, mnt };
}

const tetra = (args, input) => docker(["exec", ...(input !== undefined ? ["-i"] : []), SENSOR, "tetra", "--server-address", SOCKET, ...args], input !== undefined ? { input } : {});

async function startSensor() {
  const r = docker(["run", "-d", "--name", SENSOR, "--pid=host", "--cgroupns=host", "--privileged", "--network", "none", "-v", "/sys/kernel:/sys/kernel", "-v", `${EVENTS}:/var/log/tetragon`, "--label", `orbit-rs-bench=${suffix}`, TETRAGON_IMAGE, ...SENSOR_ARGS]);
  if (r.status !== 0) throw new Error(`the sensor did not start: ${r.stderr.trim()}`);
  made.push(SENSOR);
  const t0 = now();
  while (now() - t0 < 90_000) {
    if (/running/i.test(tetra(["status"]).stdout)) return now() - t0;
    await sleep(250);
  }
  throw new Error("the sensor did not report running within 90 s");
}

const listed = (name) => (JSON.parse(tetra(["tracingpolicy", "list", "-o", "json"]).stdout || "{}").policies ?? []).find((p) => p.name === name) ?? null;

// Installed, then read back ENABLED in the mode asked: the latency Orbit pays before an attempt may open.
async function install(w, mode) {
  const name = `${P}-${w.key}-${mode}`;
  const yaml = attemptPolicy({ name, planes: [{ mnts: [w.mnt], prefixes: ["/team/", "/output/", "/input/"] }], canary: { mnts: [w.mnt], path: CANARY } });
  const t0 = now();
  const r = tetra(["tracingpolicy", "add", "/dev/stdin", "--mode", mode === "observe" ? "monitor" : "enforce"], yaml);
  if (r.status !== 0) throw new Error(`the policy was not installed: ${r.stderr.trim()}`);
  while (now() - t0 < 30_000) {
    const p = listed(name);
    if (p !== null && String(p.state).includes("ENABLED")) return { name, ms: now() - t0, kernelMemoryBytes: Number(p.kernel_memory_bytes ?? 0) };
    await sleep(20);
  }
  throw new Error(`${name} was never read back enabled`);
}

async function remove(name) {
  const t0 = now();
  tetra(["tracingpolicy", "delete", name]);
  while (now() - t0 < 30_000) {
    if (listed(name) === null) return now() - t0;
    await sleep(20);
  }
  throw new Error(`${name} was never read back gone`);
}

// The proof the mode is the one asked: the canary refused (enforce) or run (observe), never assumed.
function canaryRc(w) {
  return docker(["exec", w.name, CANARY]).status;
}

function stats() {
  const r = docker(["stats", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}", SENSOR]);
  const [cpu, mem] = r.stdout.trim().split("|");
  return { cpuPercent: parseFloat(cpu), memory: (mem ?? "").split("/")[0].trim() };
}

function exportBytes() {
  if (!existsSync(EVENTS)) return 0;
  return readdirSync(EVENTS).filter((f) => f.startsWith("tetragon")).reduce((sum, f) => sum + statSync(join(EVENTS, f)).size, 0);
}

// An event's own time (nanoseconds in the export) as milliseconds.
const msOf = (iso) => Date.parse(String(iso).replace(/(\.\d{3})\d+/, "$1"));

// What the sensor exported for one container (its id prefix) between two moments, read from the export itself by each
// event's own time -- the export rotates (10 MiB x 3), so a count of whole files before and after would not hold.
function exportedFor(id, from, to) {
  const out = { execEvents: 0, bytes: 0 };
  if (!existsSync(EVENTS)) return out;
  for (const f of readdirSync(EVENTS).filter((x) => /^tetragon(-[^/]+)?\.log$/.test(x))) {
    for (const line of readFileSync(join(EVENTS, f), "utf8").split("\n")) {
      if (line === "") continue;
      let raw;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      const type = Object.keys(raw).find((k) => k.startsWith("process_"));
      const owner = type === undefined ? undefined : raw[type]?.process?.docker;
      const at = msOf(raw.time);
      if (typeof owner !== "string" || owner.length === 0 || !id.startsWith(owner) || !(at >= from && at <= to)) continue;
      out.bytes += line.length + 1;
      if (type === "process_exec") out.execEvents += 1;
    }
  }
  return out;
}

// ---- the run --------------------------------------------------------------------------------------------------------

async function measure(w, mode, results) {
  for (const [label, script] of Object.entries(WORKLOADS)) {
    const from = Date.now();
    const runs = Array.from({ length: RUNS }, () => runOnce(w.name, script));
    const to = Date.now();
    // The sensor writes its export asynchronously: give it a moment to catch up before reading.
    if (mode !== "off") await sleep(1500);
    const seen = mode === "off" ? null : exportedFor(w.id, from - 250, to + 250);
    const row = (results[label] ??= {});
    row[mode] = { medianMs: median(runs), runs, execEvents: seen === null ? null : Math.round(seen.execEvents / RUNS), exportBytes: seen === null ? null : Math.round(seen.bytes / RUNS) };
    say(`${mode.padEnd(8)} ${label}: median ${row[mode].medianMs} ms (${runs.join(", ")})${row[mode].execEvents !== null ? ` · ${row[mode].execEvents} exec events · ${Math.round(row[mode].exportBytes / 1024)} KiB exported` : ""}`);
  }
}

// Four attempts at once, each its own container (and, in enforce, its own policy), each running the exec loop.
async function concurrently(ws) {
  const script = timed(WORKLOADS["exec loop (2,000 short-lived processes)"]);
  const t0 = now();
  const each = await Promise.all(
    ws.map(
      (w) =>
        new Promise((resolve, reject) => {
          const c = spawn("docker", ["exec", w.name, "sh", "-c", script]);
          let out = "";
          c.stdout.on("data", (d) => (out += d));
          c.on("close", (code) => (code === 0 ? resolve(Number(out.trim())) : reject(new Error(`a concurrent loop failed (${code})`))));
        }),
    ),
  );
  return { wallMs: now() - t0, eachMs: each };
}

async function main() {
  mkdirSync(EVENTS, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  for (const image of [WORKSTATION, TETRAGON_IMAGE, HELPER]) if (docker(["image", "inspect", image]).status !== 0) docker(["pull", image]);
  const info = JSON.parse(docker(["info", "--format", "{{json .}}"]).stdout);
  const host = { os: info.OperatingSystem, kernel: info.KernelVersion, arch: info.Architecture, cpus: info.NCPU, memoryBytes: info.MemTotal, docker: info.ServerVersion };
  say(`host: ${host.os} · kernel ${host.kernel} (${host.arch}) · ${host.cpus} CPU · Docker ${host.docker} · ${RUNS} runs per workload`);
  const w = toolPlane("a");
  const crowd = [w, toolPlane("b"), toolPlane("c"), toolPlane("d")];
  for (const [label, script] of Object.entries(WORKLOADS)) {
    runOnce(w.name, script);
    say(`warm     ${label}`);
  }
  const results = {};
  const out = { host, workstation: WORKSTATION, sensor: TETRAGON_IMAGE, runs: RUNS, results, concurrent: {}, policy: {}, sensorStats: {} };

  await measure(w, "off", results);
  out.concurrent.off = await concurrently(crowd);
  say(`off      4 attempts at once, exec loop each: ${out.concurrent.off.wallMs} ms (${out.concurrent.off.eachMs.join(", ")})`);

  out.sensorStartMs = await startSensor();
  await sleep(2000);
  out.sensorStats.idle = stats();
  say(`sensor ready in ${out.sensorStartMs} ms · idle ${out.sensorStats.idle.cpuPercent}% ${out.sensorStats.idle.memory}`);

  const observed = await install(w, "observe");
  out.policy.observe = { installMs: observed.ms, kernelMemoryBytes: observed.kernelMemoryBytes, canaryRc: canaryRc(w) };
  if (out.policy.observe.canaryRc !== 0) throw new Error(`observe: the canary should run and did not (rc ${out.policy.observe.canaryRc})`);
  await measure(w, "observe", results);
  out.sensorStats.observe = stats();
  out.policy.observe.removeMs = await remove(observed.name);

  const enforced = await install(w, "enforce");
  out.policy.enforce = { installMs: enforced.ms, kernelMemoryBytes: enforced.kernelMemoryBytes, canaryRc: canaryRc(w) };
  if (out.policy.enforce.canaryRc === 0) throw new Error("enforce: the canary ran -- the policy does not hold, nothing measured under it would mean enforce");
  await measure(w, "enforce", results);
  out.sensorStats.enforce = stats();
  const others = [];
  for (const x of crowd.slice(1)) others.push(await install(x, "enforce"));
  out.concurrent.enforce = await concurrently(crowd);
  say(`enforce  4 attempts at once, exec loop each: ${out.concurrent.enforce.wallMs} ms (${out.concurrent.enforce.eachMs.join(", ")})`);
  out.sensorStats.afterConcurrent = stats();
  out.policy.enforce.removeMs = await remove(enforced.name);
  for (const o of others) await remove(o.name);
  out.exportTotalBytes = exportBytes();
  return out;
}

function report(out) {
  const pct = (a, b) => (b > 0 ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%` : "?");
  const rows = Object.entries(out.results).map(([label, r]) => `| ${label} | ${r.off.medianMs} | ${r.observe.medianMs} (${pct(r.observe.medianMs, r.off.medianMs)}) | ${r.enforce.medianMs} (${pct(r.enforce.medianMs, r.off.medianMs)}) | ${r.enforce.execEvents} | ${Math.round(r.enforce.exportBytes / 1024)} |`);
  const s = out.sensorStats;
  const text = `# Orbit Web 0.8.1 -- runtime security benchmark

Run ${new Date().toISOString()} · \`node tests/runtime-security/bench.mjs --runs=${out.runs}\` · host ${out.host.os}, kernel ${out.host.kernel} (${out.host.arch}), ${out.host.cpus} CPU, Docker ${out.host.docker} · tool plane \`${out.workstation}\` with the allocator's hardening (2 CPU, 2 GiB) · sensor \`${out.sensor}\`

Each workload is timed inside the container (median of ${out.runs} runs, after one warm-up run), in three modes: **off** (no sensor: Orbit Web 0.8.0), **observe** (the sensor and the attempt's policy in monitor mode) and **enforce** (the same policy in enforce mode; the canary was refused before anything was measured). None of the workloads executes from a shared area: this is the cost of being watched and protected, not of being refused.

| workload | off (ms) | observe (ms) | enforce (ms) | exec events per run | export per run (KiB) |
|---|---|---|---|---|---|
${rows.join("\n")}

Each run is short and the host is shared: a difference of about ten percent or less is within this host's run-to-run spread (every run is in \`bench.json\`). What stands out is the cost per process started -- the exec loop -- which is the sensor's per-exec work; ordinary developer workloads start far fewer processes.

**Four attempts at once** (each its own container running the exec loop; in enforce, each its own policy): off ${out.concurrent.off.wallMs} ms, enforce ${out.concurrent.enforce.wallMs} ms (${pct(out.concurrent.enforce.wallMs, out.concurrent.off.wallMs)}).

**Policy lifecycle** (installed, then read back enabled; removed, then read back gone): observe ${out.policy.observe.installMs} ms / ${out.policy.observe.removeMs} ms, enforce ${out.policy.enforce.installMs} ms / ${out.policy.enforce.removeMs} ms; kernel memory per policy ${Math.round(out.policy.enforce.kernelMemoryBytes / 1024)} KiB. Sensor ready ${out.sensorStartMs} ms after it was started.

**Sensor** (\`docker stats\`, one sample each): idle ${s.idle.cpuPercent}% ${s.idle.memory} · after the observe runs ${s.observe.cpuPercent}% ${s.observe.memory} · after the enforce runs ${s.enforce.cpuPercent}% ${s.enforce.memory} · after four at once ${s.afterConcurrent.cpuPercent}% ${s.afterConcurrent.memory}. Export written in all: ${Math.round(out.exportTotalBytes / 1024)} KiB (arguments excluded at the source).

What this does not measure: Orbit's own protect sequence end to end (identity, policy, read-back and canary in both planes -- the real-kernel tier exercises it, \`apps/api/tests/sandbox/runtime-security.spec.ts\`), the API's ingestion and database growth under a sustained flood (bounded by design: 500 events per pull, a cap per attempt), and any host but this one.
`;
  writeFileSync(join(OUT, "BENCH.md"), text);
  writeFileSync(join(OUT, "bench.json"), `${JSON.stringify(out, null, 2)}\n`);
  say(`\n${join(OUT, "BENCH.md")}`);
}

function cleanup() {
  if (process.argv.includes("--keep")) return;
  if (made.length > 0) docker(["rm", "-f", ...made]);
  if (volumes.length > 0) docker(["volume", "rm", ...volumes]);
  if (existsSync(ROOT) && ROOT.startsWith("/private/tmp/orbit-rs-bench-")) rmSync(ROOT, { recursive: true, force: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    report(await main());
  } catch (err) {
    process.stderr.write(`bench: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}
