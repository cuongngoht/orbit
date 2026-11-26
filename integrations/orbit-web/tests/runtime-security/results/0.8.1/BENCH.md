# Orbit Web 0.8.1 -- runtime security benchmark

Run 2026-11-26T17:59:55.689Z · `node tests/runtime-security/bench.mjs --runs=3` · host Docker Desktop, kernel 7.0.14-linuxkit (aarch64), 10 CPU, Docker 29.9.3 · tool plane `orbit-web-workstation:sandbox-test` with the allocator's hardening (2 CPU, 2 GiB) · sensor `quay.io/cilium/tetragon:v1.8.0@sha256:5ed9088a1582131d71b06c98e0d549a37a71ae63ab13aabefc7a47553c822a9d`

Each workload is timed inside the container (median of 3 runs, after one warm-up run), in three modes: **off** (no sensor: Orbit Web 0.8.0), **observe** (the sensor and the attempt's policy in monitor mode) and **enforce** (the same policy in enforce mode; the canary was refused before anything was measured). None of the workloads executes from a shared area: this is the cost of being watched and protected, not of being refused.

| workload | off (ms) | observe (ms) | enforce (ms) | exec events per run | export per run (KiB) |
|---|---|---|---|---|---|
| exec loop (2,000 short-lived processes) | 377 | 574 (+52%) | 629 (+67%) | 2004 | 5844 |
| node startup x30 | 402 | 414 (+3%) | 441 (+10%) | 35 | 104 |
| python3 startup x30 | 232 | 235 (+1%) | 237 (+2%) | 35 | 104 |
| git: 50 commits | 158 | 170 (+8%) | 186 (+18%) | 160 | 470 |
| C build: 40 files, make -j4 | 150 | 164 (+9%) | 145 (-3%) | 129 | 381 |
| npm install (offline, a postinstall script) | 152 | 158 (+4%) | 164 (+8%) | 12 | 35 |

Each run is short and the host is shared: a difference of about ten percent or less is within this host's run-to-run spread (every run is in `bench.json`). What stands out is the cost per process started -- the exec loop -- which is the sensor's per-exec work; ordinary developer workloads start far fewer processes.

**Four attempts at once** (each its own container running the exec loop; in enforce, each its own policy): off 534 ms, enforce 740 ms (+39%).

**Policy lifecycle** (installed, then read back enabled; removed, then read back gone): observe 874 ms / 500 ms, enforce 790 ms / 353 ms; kernel memory per policy 3418 KiB. Sensor ready 1386 ms after it was started.

**Sensor** (`docker stats`, one sample each): idle 1.14% 116.2MiB · after the observe runs 0% 185.5MiB · after the enforce runs 0% 248.7MiB · after four at once 65.27% 339.9MiB. Export written in all: 33190 KiB (arguments excluded at the source).

What this does not measure: Orbit's own protect sequence end to end (identity, policy, read-back and canary in both planes -- the real-kernel tier exercises it, `apps/api/tests/sandbox/runtime-security.spec.ts`), the API's ingestion and database growth under a sustained flood (bounded by design: 500 events per pull, a cap per attempt), and any host but this one.
