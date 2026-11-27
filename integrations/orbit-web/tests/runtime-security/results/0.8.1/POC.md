# Orbit Web 0.8.1 -- runtime security proof of concept

Run 2026-11-26T16:01:48.935Z · `node tests/runtime-security/poc.mjs` · sensor `quay.io/cilium/tetragon:v1.8.0@sha256:5ed9088a1582131d71b06c98e0d549a37a71ae63ab13aabefc7a47553c822a9d` · workloads `ghcr.io/cuongngoht/orbit-web-workstation:0.8.0`, `ghcr.io/cuongngoht/orbit-web-model-plane:0.8.0` · host Docker Desktop 29.9.3, kernel 7.0.14-linuxkit (aarch64, 10 CPU)

Every verdict is decided from what the harness reads itself: exit codes and errno, a marker file a program would have written, the sensor's own export file and `tetra tracingpolicy list -o json`. UNSUPPORTED means the kernel or the sensor cannot do it here -- reported, never approximated.

| Cap | Check | Verdict | Evidence |
|---|---|---|---|
| - | host facts | **PASS** | Docker Desktop · kernel 7.0.14-linuxkit · aarch64 · 10 CPU · cgroup v2 · active LSMs capability,bpf,landlock · BPF LSM active · KPROBE_OVERRIDE y · BTF y |
| - | workloads made with the allocator's hardening (read-only root, no capability, no-new-privileges, default seccomp) | **PASS** | a-tool mnt:4026533383 · a-model mnt:4026533517 · b-tool mnt:4026533651 · c-tool mnt:4026533785 |
| C | EXISTING control holds: /tmp is noexec (Docker's tmpfs default) -- nothing to add there | **PASS** | rc 126: sh: 1: /tmp/x-base-tmp.sh: Permission denied |
| C | GAP: the baseline PERMITS running a file from the team room (a volume shared with other employees) | **PASS** | rc 0, marker written |
| C | GAP: the baseline PERMITS running a file from /output (delivered to people) | **PASS** | rc 0 |
| C | GAP: the baseline PERMITS running a file from the model plane's credential home (/connection) | **PASS** | rc 0 |
| C | GAP: the baseline PERMITS fileless execution (memfd) | **PASS** | rc 0 |
| C | the canary runs before any policy | **PASS** |  |
| C | a-tool: no new mount or user namespace can be made, so the namespace selector cannot be escaped | **PASS** | unshare: unshare failed: Operation not permitted rc=1 unshare: unshare failed: Operation not permitted rc=1 |
| C | a-model: no new mount or user namespace can be made, so the namespace selector cannot be escaped | **PASS** | unshare: unshare failed: Operation not permitted rc=1 unshare: unshare failed: Operation not permitted rc=1 |
| - | the pinned sensor runs with no network; policies reach it over its unix socket only | **PASS** | CLI version: v1.8.0 · Health Status: running · ready in 2026 ms |
| A | every exec of each workload is attributed to its own container, and nothing crosses accounts | **PASS** | a-tool: 7 · a-model: 7 · b-tool: 7 · c-tool: 7 · docker id prefix of 31 hex chars, unique among the workloads |
| A | the sensor's mount namespace for a workload equals the one the workload reports (identity cross-check) | **PASS** |  |
| A | account, attempt and plane come from labels only the allocator set, of THAT container | **PASS** |  |
| A | no process argument reaches the export file (field filter at the source) | **PASS** |  |
| B | a child process tree is observed with parent links by exec id (a reused PID cannot confuse it) | **PASS** | /usr/bin/sleep <- /usr/bin/sh <- /usr/bin/sh <- /usr/bin/containerd-shim-runc-v2 <- /oldroot/initd <- <kernel> |
| B | the child's exit is observed | **PASS** |  |
| B | fileless execution is OBSERVED: the executed program is named /proc/self/fd/N | **PASS** | /proc/self/fd/3 |
| C | a policy scoped to ONE attempt's two namespaces is installed and READ BACK | **PASS** | 739 ms · TP_STATE_ENABLED · TP_MODE_ENFORCE · 3500528 B of kernel memory |
| C | IN SCOPE, A's tool plane: running a script from the team room is PREVENTED -- EPERM, exit 126, no marker | **PASS** | rc 126, marker absent, "sh: 1: /team/x-enf.sh: Operation not permitted" |
| C | IN SCOPE, A's tool plane: the same from /output | **PASS** | rc 126 |
| C | IN SCOPE, A's model plane: running a file from the credential home is PREVENTED | **PASS** | rc 126, marker absent |
| C | the canary is refused in BOTH of A's planes (run as the allocator runs it: docker exec) | **PASS** | tool 255 · model 255 · "exec /usr/bin/arch: operation not permitted" |
| C | the sensor's own event says OVERRIDE, for A's container, this policy and this path | **PASS** | KPROBE_ACTION_OVERRIDE /team/x-enf.sh |
| C | OUT OF SCOPE, account B (same image, its own team room): the same operation still runs, the canary too | **PASS** | rc 0, canary 0 |
| C | OUT OF SCOPE, control C: the same operation still runs -- the policy is not host-wide | **PASS** | rc 0, canary 0 |
| C | the policy's own counters read back the overrides it made | **PASS** | {"override":"5"} |
| C | fileless (memfd) execution cannot be PREVENTED by this hook: it reports no path for a memory-only file | **UNSUPPORTED** | rc 0 in scope; a rule on the execve filename would be bypassed by a symlink, and runc re-executes itself through a memfd: detected (B), never claimed prevented |
| C | LIMIT: `sh file` interprets a file (the shell is what runs) and is not prevented -- stated, not claimed | **PASS** | INTERPRETED |
| C | by design /work stays executable (a toolbox, a build) -- the rule names only the shared areas | **PASS** | rc 0 |
| C | OBSERVE (monitor mode): the rule MATCHES and the operation RUNS -- a detection, never called prevention | **PASS** | ran true, mode TP_MODE_MONITOR |
| C | FINDING: in monitor mode the event STILL says KPROBE_ACTION_OVERRIDE -- prevention is never read from an event, only from the policy's mode and a probe | **PASS** | the normalizer derives OPERATION_PREVENTED from (enforce mode read back) AND (override event); monitor mode gives VIOLATION_DETECTED |
| D | namespace inodes are RE-USED: a policy that outlives its container can bind the next one (it must be deleted first) | **PASS** | old 4026533383 = new 4026533383; the stale policy DID refuse the new container |
| D | so a new workload's inode is checked against every installed policy before it is protected | **PASS** | a registry finds 1 installed policy holding inode 4026533383 that is not this attempt's: reap it, then bind |
| D | reaped and bound to the new container: protection is back, the old binding is gone | **PASS** | after reap ran true; after bind rc 126 |
| D | cleanup: delete removes the policy (read back) and its effect | **PASS** | listed after delete false |
| D | events of a removed container still carry its id: a registry keeps tombstones and never re-uses a mapping | **PASS** | 19 late exit event(s) |
| D | a sensor RESTART drops every policy: protection must be re-proven, or the workload contained | **PASS** | policies after restart []; the probe ran |
| E | sensor STOPPED: its enforcement is gone with it (why mandatory protection must fail closed) | **PASS** | the probe ran |
| E | a policy for a hook the kernel does not have is REFUSED (an error, never a silent no-op), and never listed as enabled | **PASS** | add failed: " check if the hook exists or if your kernel supports BTF for lsm hooks, as an alternative, consider switching to kprobes" · listed: TP_STATE_LOAD_ERROR |
| E | a policy aimed at the WRONG namespace loads and lists fine -- only the in-workload canary shows it protects nothing | **PASS** | listed TP_STATE_ENABLED, canary in the workload rc 0 |
| E | a selector with NO workload namespace is never produced (it would be host-wide) | **PASS** | every selector needs one to four mount-namespace inodes |
| F | exec overhead: 2,000 short-lived processes, median of 3 | **PASS** | no sensor 470 ms · sensor 583 ms · sensor + this attempt's policy 613 ms |
| F | event loss under bursts of 2,000 execs | **PASS** | 6000/6000 exec events · export +7351 KiB (1255 B per exec+exit) |
| F | ten concurrent attempt policies: each holds in its own workload, the control stays free | **PASS** | add 738-839 ms each · 33 MiB of kernel memory for all ten · sensor 0.17% 300.3MiB |
| F | sensor CPU/RAM | **PASS** | idle 1.09% 107.2MiB, 0% 107.1MiB, 0% 107.1MiB · after a burst 0.63% 154.1MiB |

PASS 45 · UNSUPPORTED 1
