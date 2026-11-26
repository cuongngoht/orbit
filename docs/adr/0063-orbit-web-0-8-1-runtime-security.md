# ADR 0063 — Orbit Web 0.8.1: runtime security, an independent plane that knows what an AI employee's programs actually did, prevents what the account's policy forbids, and proves it

## Status

Accepted (Orbit Web 0.8.1), 2026-11-26 to 2026-11-27, the owner's decisions -- the specification "Orbit 0.8.1 --
governed autonomous AI workforce with kernel-level runtime security" and the answers given while 0.8.1 was built
("work on Release-0.8.1; the data needs no migration and can be wiped and run again") -- stated here once. Numbers in
parentheses name sections of the Decision.

For Orbit Web only: nothing of the plugin changes, and its archive is unchanged (`integrations/` is export-ignored).
It amends ADR 0061 (Orbit Web 0.8.0), section 8 (the virtual office) and its "Said plainly":

- **Added**: a security plane beside the allocator (2), a runtime security section in the account's policy (1), a
  non-cooperative gate before an attempt's untrusted code starts (6), a watchdog that contains an attempt whose proof
  is lost (7), runtime events kept per account (8), incidents with a person's review (9), and a page and a tab that
  show what was proven (11).
- **Kept**: every 0.8.0 control of an attempt -- two containers made by the allocator alone, read-only root
  filesystems, every capability dropped, `no-new-privileges`, Docker's default seccomp, the HMAC-signed allocator
  protocol, the egress proxy, the tool door, run bindings, the audit chains, admission and the one-run-per-employee rule.
  Runtime security adds to them and replaces none: with it off, an attempt runs exactly as in 0.8.0.

## Context

1. In 0.8.0 an AI employee's attempt is a tool plane (a shell for the employee, uid 20001) and a model plane (the AI CLI
   and Orbit's runner, uid 10001), hardened by Docker. Orbit Web knew what an employee was ALLOWED to do (its account's
   policy), what it SAID it did (its tool calls and hand-in) and what its connections were (the egress log). It did not
   know what its programs DID inside the containers, and nothing prevented a program that the sandbox lets run.
2. The owner asked for an independent security plane: one policy authority (the account's governance policy, composed
   by governance-core) and several enforcement points; observation that does not depend on the employee's cooperation;
   prevention verified rather than assumed; containment when protection is lost; incidents and a person's review;
   telemetry isolated per tenant and bounded; and no claim -- in the UI, the docs or a report -- that was not proven on
   the host it is about.
3. What a kernel can do here was established first, by a proof of concept run on this machine before any Orbit code
   (`integrations/orbit-web/tests/runtime-security/poc.mjs`, results in `tests/runtime-security/results/0.8.1/`): 45
   checks PASS and 1 UNSUPPORTED on Docker Desktop 29.9.3, kernel 7.0.14-linuxkit aarch64, with BPF LSM active
   (`capability,bpf,landlock`), `CONFIG_BPF_KPROBE_OVERRIDE=y` and BTF. Its findings shaped every decision below:
   - the LSM hook `bprm_check_security`, scoped by mount-namespace inode (`matchNamespaces`, at most four values per
     selector) and matched on the program's path, refuses an exec with EPERM in exactly the attempt it is installed for;
     the same program runs in another account's attempt and in an unrelated container;
   - Docker's tmpfs is `noexec` by default, so `/tmp`, `/dev/shm` and `/var/tmp` already refuse an exec in both planes;
     a volume mount does not, and Docker cannot make one subpath of it `noexec`;
   - a program executed from memory (`memfd_create` then `execveat`) reaches the hook with no path: it can be
     detected (the exec event names `/proc/self/fd/N`) but not prevented by a path rule;
   - in monitor mode Tetragon still reports `KPROBE_ACTION_OVERRIDE` on the event, so whether an operation was
     prevented can never be read from the event's own action;
   - namespace inodes are reused at once after a container goes, a sensor restart drops every policy, and a policy
     installed for the wrong inode is silent -- only a probe catches it;
   - while the sensor is down nothing is enforced: Tetragon fails open by construction.
4. Costs measured there (2,000 short-lived processes): 470 ms with no sensor, 583 ms with the sensor, 613 ms with a
   policy installed; 0 of 6,000 events lost; about 1.25 KB of export per process; a policy installed and enabled in
   about 0.75-0.85 s and about 3.5 MB of kernel memory; the sensor about 107 MB idle and 300 MB with ten policies.

## Alternatives considered

| | what it gives | why not, or why |
|---|---|---|
| **A. The sandbox alone** (0.8.0, hardened further) | no new component; Docker's own controls | no record of what ran, and nothing per account: a mount option or a seccomp profile is the image's, not a department's policy. It stays the base layer. |
| **B. seccomp / AppArmor profiles per attempt** | prevention by the kernel with no daemon | seccomp sees syscalls, not paths (`execve` of a relative path, `execveat` through a descriptor); AppArmor is not available on every host (Docker Desktop's LinuxKit kernel has no AppArmor), a profile must be loaded on the host by root, and neither reports what ran. |
| **C. Tetragon, one sensor per host** (chosen) | process lifecycle, exec, namespaces and LSM hooks in one eBPF agent; `Override` refuses an operation in the kernel; scoping by namespace outside Kubernetes; a JSON export; a CLI for policies | a privileged agent joins the host's trusted base; outside Kubernetes the only scoping is namespaces, so identity must be bound and proven per attempt (3, 5). |
| **D. Orbit's own eBPF programs** | exactly what Orbit needs | a kernel program, a loader and its BTF handling to maintain and prove on every kernel Orbit runs on -- the part Tetragon already proves -- and a GPL program in a repository that ships none. |
| **E. Kubernetes with Tetragon's pod-level policies, or Cilium** | per-pod selectors, a mature operator | Orbit Web deploys with Docker Compose on one host; moving the allocator to Kubernetes is a new product, not a release. |

## Decision

### 1. One policy authority: a runtime security section in the account's policy

- The account's policy (`orbit.governance/v2`, governance-core `runtime.ts`) gains `runtimeSecurity: { mode, controls }`
  with `mode` one of `disabled`, `observe` or `enforce`, and `controls` from a closed catalog
  (`RUNTIME_CONTROLS`). A new account's policy says `disabled`: 0.8.0's behaviour until its owner decides otherwise.
- A department may only tighten: a higher mode, more controls; a department mode below the company's is refused.
- What holds an attempt is composed, never merged: the strictest mode of the deployment's floor
  (`ORBIT_WEB_RUNTIME_SECURITY_FLOOR`), the company's and the department's, with the union of controls, and the source
  of the mode named (`from`; a tie goes to the higher authority). The floor is read by the API, which composes, and
  again by the allocator, which applies `max(requested, floor)` itself -- an attempt asked for less than the floor is
  held to the floor whatever the API said.
- Lowering the mode or removing a control is a weakening in the policy's risk (`runtimeSecurityChanges`), published only
  with the owner's acknowledgment like every other weakening. A published change applies to NEW attempts; a running
  attempt keeps the requirement it was proven under.
- AI employees never change any of it: no tool, endpoint or role an employee holds reaches the policy, the floor, the
  sensor or a review.

### 2. The security plane: one pinned sensor, reached only by the allocator

- One Tetragon container per host, `quay.io/cilium/tetragon:v1.8.0@sha256:5ed9088a…c822a9d` (amd64 and arm64), added
  by an optional override (`docker/compose.runtime-security.yaml`); without it nothing of Tetragon runs. It is
  privileged in the host's PID and cgroup namespaces with `/sys/kernel` mounted -- that is what loading eBPF programs
  takes -- and gets **no network** (`network_mode: none`) and **no Docker socket**.
- Management is `tetra` run inside the sensor's own container against its unix socket, by the allocator -- the one
  existing holder of the Docker socket -- through its own `docker exec`. No new listener, client library or credential.
- Telemetry is the sensor's JSON export (rotated, 10 MiB x 3), on a volume only the sensor and the allocator mount,
  read-only for the allocator. A process's arguments are excluded at the source (`--field-filters` EXCLUDE
  `process.arguments,parent.arguments`): an event that never carried a prompt, a token or a file's contents cannot leak
  one. No environment, file content or payload is ever captured.
- Tetragon's words stay in two adapter files (`allocator/runtime-security/tetragon.ts`, `sensor-events.ts`); the rest
  speaks the backend port (`RuntimeSecurityBackend`: status, policies, apply, remove, read). `DisabledBackend` is what
  runs without the override. A test holds the compose file's image and command line equal to the code's.

### 3. Identity: what the kernel sees is bound to what the allocator made

- Only containers the allocator made are anyone's: their labels (`orbit-web.account|run|assignment|dispatch-key|…`)
  are the allocator's alone, and an event from any other container belongs to no account -- it is counted
  (`unattributed`) and dropped. Nothing an agent, a process argument or an employee's environment says is identity.
- Each attempt's two planes are bound by their mount-namespace inode, read twice: by the allocator (`readlink
  /proc/self/ns/mnt` through its own exec) and by the sensor (the namespace on that very exec's event). The two must
  agree, or the attempt is not protected.
- An attempt's policy is its own: a deterministic name from its dispatch key and its two container ids
  (`orbit-a-<12 hex>-<12 hex>`), selecting exactly its two inodes. Because inodes are reused at once, a policy is
  deleted BEFORE its containers are removed, a new attempt's inodes are checked against every installed policy, and a
  stale one is removed before the binding. A plane that restarted (new namespaces, the same container) is never
  protected by its old binding.
- runc's first exec into a container carries no container id yet; it is attributed by the policy that matched it.

### 4. The controls, and what each does NOT prevent

- **`exec.shared-areas`** (the one enforceable control): no program runs from a shared area -- the tool plane's
  `/team/`, `/output/` and `/input/`, the model plane's `/connection/`. These are volume mounts Docker cannot make
  `noexec` per subpath, and nothing legitimate executes there. `/work`, the home directory and `/cache` stay executable
  (an employee's toolbox, `pip --user`, `npx`). It does not prevent copying a file elsewhere and running it there, an
  interpreter reading a script from a shared area (`sh /team/x.sh` executes `/bin/sh`), or a memory-only program.
- **Fileless execution** -- detection only (Context 3): a HIGH event and an incident; under enforce, the attempt is
  stopped (9).
- **A shell or an interpreter started in the model plane**, where only the AI CLI and Orbit's bridge run -- detection,
  a HIGH event and an incident; under enforce, the attempt is stopped.
- **Process lifecycle** is observed in every mode but `disabled`: each exec and exit, with its parent by `exec_id`
  (safe against PID reuse), its binary and its namespaces.
- `exec.scratch` (no exec under `/tmp`) was dropped: the base layer already refuses it (Context 3), and a kernel rule
  would only duplicate it.

### 5. Proof, never assumption

- **Per attempt, before anything the employee runs may start**: the identity bound (3), the policy installed in the
  attempt's mode (`enforce` for enforce, `monitor` for observe) and read back from the sensor, then a **canary** --
  `/usr/local/libexec/orbit-web/runtime-canary`, a copy of `/bin/true` baked into the workstation and model-plane
  images -- executed in BOTH planes. Every attempt's policy also denies the canary. Under enforce it must fail with
  exit 126 and EPERM AND the sensor must report the hook for it; under observe it must run AND be reported. Only then
  is the attempt VERIFIED (enforce) or OBSERVING (observe). Anything else is UNKNOWN (enforce: refused) or DEGRADED
  (observe: said).
- **Per host**: two allocator-owned canary containers, one inside a canary policy's scope and one outside it, prove
  every 30 s that prevention works AND that it is scoped (the out-of-scope canary must SUCCEED: a host-wide rule would
  break every container). The same probe answers the capability rows a page shows -- `observe.process`,
  `observe.fileless`, `prevent.exec`, `scope.workload` -- each SUPPORTED, UNSUPPORTED, DEGRADED or UNKNOWN, never
  assumed from a kernel version.
- **Proof expires**: evidence carries `freshUntil` (60 s); the allocator renews it while the sensor, the policy and the
  canary still hold. A page shows *protected* only for PROTECTED with fresh evidence; stale evidence is *unknown*,
  never green. Whether an operation was PREVENTED is decided from the mode read back from the sensor plus the override
  event, never from the event's action word.

### 6. A non-cooperative gate before untrusted code

- An attempt's runner credential is random, made by the allocator for the model plane, and no longer derivable by the
  API. A new allocator operation, `openAttempt`, releases it only when the gate holds: the attempt's mode is disabled or
  observe, or it is enforce with protection VERIFIED and fresh. Until then Orbit Web cannot ask the model plane's runner
  to start the AI CLI (the runner accepts only that credential), and the allocator refuses the tool plane's shell
  (`exec`: `runtime_protection_not_established`). The worker's own reads of the team room and `/output` stay allowed,
  because an attempt that never opened is still settled.
- The credential carries `validUntil` under enforce; the API's provider refuses to use it past that and drops it when
  the attempt is removed.
- When enforce is required, the worker refuses an attempt before any container is made if this host has not proven
  prevention, runs no backend, or the sandbox is the development process provider (`runtime_protection_unavailable`,
  audited as `runtime_security.admission.refused`); and it refuses an attempt whose protection is not VERIFIED after
  attestation, before it opens (`runtime_protection_not_established`).
- The egress proxy holds the same rule at the network edge (`protectionHolds`, contracts): an enforced attempt whose
  proof is lost or stale reaches nothing from its next connection, before containment (7). Such a refusal is kept in
  the run's network log; it is not a policy decision and is never recorded as an allow.

### 7. Continuous protection and containment, without the API

- The allocator's watchdog (`watchdog.ts`, a pure decision over a snapshot) runs every 5 s: is the sensor running with
  the same generation (its container's id and start time), is each attempt's policy listed and enabled, are the
  canaries fresh (90 s), did a plane restart. Proof that still holds is renewed. Proof that does not is LOST; an
  enforced attempt that is not proven again within `ORBIT_WEB_RUNTIME_SECURITY_CONTAIN_AFTER_MS` (15 s) is contained:
  the allocator itself stops BOTH its containers and reads them back stopped. An observed attempt is never stopped: its
  observation is said DEGRADED, and after a sensor restart its policy is put back.
- A sensor restart is protection lost for every attempt. Policies no attempt owns are reaped -- only while the sensor
  is healthy, and never the canary's.
- The allocator keeps its records across its own restart (`<state>/runtime-security/records.json`) and stamps the mode
  and controls on each plane's labels; an attempt it cannot prove again after a restart is contained.

### 8. Telemetry: per account, bounded, and never in the audit chain

- The allocator reads the export (rotation-aware, its position kept), attributes each event (3) and keeps a ring of
  20,000 with an epoch and a sequence. Orbit Web pulls from a cursor every 2 s (at most 500 a pull); what the ring no
  longer holds is reported LOST, never skipped in silence; an epoch change (an allocator restart) is a reset.
- Events are kept in `security.events` by account, deduplicated by key, capped per run -- up to
  `ORBIT_WEB_RUNTIME_SECURITY_MAX_EVENTS_PER_RUN` (20,000) of information and, apart, as many notable events, so a flood
  of the one never crowds out the other and neither grows without bound; what is not kept is counted on one gap marker
  per run. They are pruned after `ORBIT_WEB_RUNTIME_SECURITY_RETENTION_DAYS` (14). Every read names the account first.
- Raw events never enter the governance audit chain; decisions and changes do. On the account's chain:
  `runtime_security.protection.verified`, `.protection.lost` (lost, or contained by the allocator), `.admission.refused`,
  `.incident.opened`, `.incident.reviewed`, `.containment.requested`, `.containment.confirmed`, `.retry.authorized`. On
  the deployment's chain, each only when it changed: `.sensor.changed` (its state or generation, as Orbit Web saw it)
  and `.capability.probed` (what the host's probe proved).

### 9. Incidents, a deterministic response, and a person's review

- One ordered rules table (`contexts/runtime-security/domain/rules.ts`) decides from facts -- the kernel's event and the
  mode the policy was read back in -- what an event is, how severe, whether it is an incident, and what is done. Never a
  model, never the words of a program's output.
- An incident is one per cause per attempt (a repeat raises its count). Under enforce, a fileless exec, a shell in the
  model plane or an identity mismatch opens a blocking incident whose response is: end the attempt's run token (its
  proxy and tool door refuse it at once), then stop exactly ITS two containers -- by its dispatch key, never a newer
  attempt's -- and read them back stopped before saying CONTAINED. An allocator that does not answer verifies nothing.
  The response is kept with the incident in the transaction that opens it and carried out again on every pull until
  each step is recorded done, so a failed step or a restart between the commit and the response never leaves the
  attempt running while the incident says it was handled; owed responses take turns (never tried first), so ones that
  cannot finish never starve a newer one. Under observe nothing is acted on: a match is
  `VIOLATION_DETECTED`, never called prevented.
- A blocking incident holds the work: a person's Retry is refused (409 `security_review_required`) until the account's
  owner reviews it -- `investigate`, `resolve` or `authorize_retry` (which needs a reason) -- naming the version read
  (`If-Match`; a stale one is 412). Nothing deletes business data in response, and nothing publishes a policy from an
  analysis.

### 10. Sessions and the governed agent

- Chat, research and CEO Chat sessions are observed only, and only when the deployment's floor is at least observe;
  they are never enforced and never held to an employee's or a department's policy.
- The governed deployment's shared `orbit-agent` container is not covered: it is not made by the allocator and serves
  every account, so nothing it runs can be attributed to one.

### 11. What a person sees

- Governance → **Runtime security**: what this host proved (the sensor, each capability with its probe, the floor),
  the controls with what each prevents and does not, the attempts and how each is held, the events (prevented and
  detected apart) and the incidents with their review.
- The policy editor's runtime section shows this host's support beside each choice before publishing -- a prediction,
  not evidence. A department's page says what holds its employees and from whom (the floor, the company or the
  department), and its editor offers only modes above the company's. The page takes the host's first look itself on a
  fresh installation, and the probe is read again at every start.
- The operator's terminal says the same from the server (`governance.js runtime-security status`): what the host
  proved, the sensor as last pulled, the telemetry's loss counters, attempts per protection state and open incidents --
  counts, never an account's evidence. An employee's **Runtime security** tab shows what its attempts are held to and, while one runs, its
  planes' identities and checks; with none running it shows an inactive state, because its desk is storage, never a
  process. A run's details show its protection.

### 12. Deployment

- `docker compose -f compose.yaml -f compose.runtime-security.yaml up -d` adds the sensor with an `observe` floor.
  The sensor's CPU and memory limits are taken from the capacity employees may use
  (`ORBIT_WEB_RUNTIME_SECURITY_RESERVE_CPU|MEMORY`, equal to its limits).
- Disabling is safe in one direction only: removing the override while an account's policy or the floor requires
  enforce refuses those attempts (`runtime_protection_unavailable`); it never runs them unprotected.
- Migration 3 (`security.*`, `workforce.capacity.runtime_security`) is additive; 0.8.1 is deployed fresh by the owner's
  decision.

## Consequences

- **What is verified, and where.** Observation, scoping, prevention by `exec.shared-areas`, the gate, the watchdog's
  containment and the sensor-restart and sensor-down cases are verified on ONE host: Docker Desktop 29.9.3, kernel
  7.0.14-linuxkit aarch64 (the real-kernel tier, `apps/api/tests/sandbox/runtime-security.spec.ts`, and the proof of
  concept). A native Linux host, x86_64, a cloud VM and rootless Docker were not run. Whether a host can prevent is
  probed on that host; nothing is claimed from this one for another.
- **Said plainly.** The sensor, the allocator, the kernel and whoever operates the host are the trusted computing
  base: the sensor is privileged and could do anything to the host, and a compromised kernel or allocator defeats every
  control here. Between the sensor's death and containment there is a window -- up to the watch interval plus the
  containment deadline, about 20 s -- in which nothing is enforced in the kernel; the exec gate, the egress proxy and
  the incident response narrow it, they do not close it. Prevention is path-based and covers execution only: a program
  copied out of a shared area, an interpreter reading a script, or a memory-only program is not prevented (the last is
  detected). Telemetry that the ring could not keep is said lost, not recovered. The governed `orbit-agent` and the
  sessions are not enforced.
- **Not built in 0.8.1**: network connection observation in the kernel (`tcp_connect`) and observation of writes to an
  employee's toolbox, which the specification listed as observation templates; per-department controls beyond the
  company's catalog; any enforcement of sessions. Each is a later decision, not a gap this release hides.
