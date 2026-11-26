# Orbit Web 0.8.1 -- runtime security threat model

What an AI employee's attempt could do that the account's policy forbids, what stood in the way in 0.8.0, what 0.8.1
adds (ADR 0063), what each mitigation assumes, what is left, and which test or run shows it. A row names a test only
where that test fails when the mitigation is removed; "not verified" is said where nothing does.

**Trusted computing base.** The host's kernel, the Docker engine, the allocator (the one holder of the Docker socket),
the Tetragon sensor (privileged, in the host's PID and cgroup namespaces) and whoever operates the host. Nothing below
holds against any of them: a compromised kernel, allocator or sensor, or a malicious operator, defeats every control.

**Where it was verified.** One host: Docker Desktop 29.9.3, kernel 7.0.14-linuxkit aarch64, BPF LSM active. "Real
kernel" means `apps/api/tests/sandbox/runtime-security.spec.ts` (the real allocator, a real sensor, real attempts) or
the proof of concept (`tests/runtime-security/poc.mjs`, results in `tests/runtime-security/results/0.8.1/`); "unit" and
"integration" are the deterministic tiers of `scripts/ci.mjs` (integration runs on PostgreSQL with the allocator
stood in for).

## Execution

| # | threat | 0.8.0 | 0.8.1 adds | assumes | remaining risk | verified by |
|---|---|---|---|---|---|---|
| E1 | A program dropped into a shared area (`/team`, `/output`, `/input`; the model plane's `/connection`) is executed -- an artifact another employee handed in, a prompt-injected download | nothing: volume mounts are executable | `exec.shared-areas` under enforce: the LSM hook refuses the exec (EPERM, exit 126) for this attempt's two mount namespaces only; under observe it is reported `VIOLATION_DETECTED` | BPF LSM in the kernel's active list; the hook sees the program's resolved path | an interpreter reading the script (`sh /team/x.sh` executes `/bin/sh`), or a copy of it made in `/work` and run there, is not prevented | real kernel: "enforce: proven before it opens; nothing runs before; then a script in /output is PREVENTED, and only for this attempt"; PoC capability C (in scope prevented, out of scope still runs) |
| E2 | A program is executed from a scratch area (`/tmp`, `/dev/shm`, `/var/tmp`) | Docker's tmpfs is `noexec` | nothing new (a kernel rule would duplicate it; `exec.scratch` dropped) | Docker keeps its tmpfs default | an image or a compose change that removes `noexec` | PoC (asserted in both planes) |
| E3 | A program runs from memory (`memfd_create` + `execveat`) | nothing | detected: `exec.fileless`, HIGH; under enforce the attempt is stopped (E9) | the exec event names `/proc/<pid>/fd/<n>` | it runs before it is detected: detection, never prevention (UNSUPPORTED on this kernel by a path rule) | real kernel probe "a fileless exec seen"; rules unit; integration "enforce, proven: … a memory-only exec stops exactly it" |
| E4 | A shell or an interpreter starts in the model plane (a compromised CLI, a malicious MCP server) | the model plane has `/bin/sh` | detected: `exec.model_plane`, HIGH; under enforce the attempt is stopped | the binary's name is what ran | a program renamed to look like the CLI is not recognised by name | rules unit "a memory-only exec and a shell in the model plane are detections of their own" |
| E5 | The employee's code starts before its protection is proven (a worker bug, a race) | the runner token was derivable by the API: only the worker's cooperation held the CLI back | a random runner credential released only by the allocator's `openAttempt` when the gate holds; the tool plane's shell refused before it | the allocator is the only holder of the credential and of the Docker socket | -- | real kernel "nothing runs before"; unit "no credential before the gate"; service unit "then, and only then, the gate opens" |
| E6 | An attempt keeps using a credential after its proof expired | -- | the credential carries `validUntil` under enforce and is refused past it | clocks of the API and the allocator agree within the freshness window (60 s) | -- | unit "an enforced attempt's credential lasts only as long as the proof it was released on" |
| E7 | An attempt whose protection is lost keeps reaching the network until it is contained | the proxy decides by policy only | the egress proxy refuses an enforced attempt whose proof is not fresh, from its next connection | the API's copy of the proof is renewed every few seconds (allocator watch 5 s, API pull 2 s) | a connection opened before the loss stays open until containment | integration "under enforce, an attempt reaches nothing while its runtime protection is not proven fresh" |

## The security plane itself

| # | threat | 0.8.0 | 0.8.1 adds | assumes | remaining risk | verified by |
|---|---|---|---|---|---|---|
| S1 | The sensor is stopped, crashes or restarts (Tetragon fails open: policies are gone) | -- | the watchdog sees the sensor's generation change or its absence: protection LOST at once (the gate shuts, egress refused), both planes of an enforced attempt stopped within the deadline (15 s); an observed one gets its policy back | the allocator runs | up to ~20 s (watch interval + deadline) in which the kernel enforces nothing for an attempt already running | real kernel "a sensor restart drops every policy: an enforced attempt is contained, an observed one gets its policy back"; PoC D (sensor restart) and E (sensor stopped) |
| S2 | The sensor is down when an attempt starts | -- | the attempt is never opened, and never quietly observed instead | -- | -- | real kernel "with the sensor down, an enforced attempt is never opened" |
| S3 | An attempt's policy is deleted or changed behind the allocator's back | -- | policy drift is LOST at once and contained after the deadline | `tetra tracingpolicy list` tells the truth | the same window as S1 | real kernel "policy drift: … both planes contained after the deadline" |
| S4 | A policy that loads but binds nothing (a wrong inode, a typo) passes for protection | -- | the canary must be refused (enforce) or reported (observe) in BOTH planes before the gate opens; the host canaries prove scope every 30 s | the canary file in the images is the one compiled into policies | -- | service unit "a policy that loads and lists but binds nothing is caught by the canary"; PoC E (wrong namespace) |
| S5 | A stale policy holds a reused namespace inode and restricts another tenant's new container | -- | a policy is removed BEFORE its containers; a new attempt's inodes are checked against every installed policy and a stale holder removed before binding | the allocator removes attempts (not a person by hand) | a container removed outside the allocator leaves its policy until the watchdog reaps it (only while the sensor is healthy) | unit "before binding, every other policy holding the same namespace inode is found"; service unit "a stale policy … is removed before the attempt is bound"; PoC D (namespace inodes re-used) |
| S6 | A plane restarts in place with new namespaces that its policy no longer selects | -- | a restart (new start time) is LOST protection and contained, never a stale binding | Docker reports the new start time | -- | unit and service unit "a plane that restarted …" |
| S7 | Orbit's own policies, or a policy Orbit did not make, are removed by the reaper | -- | only `orbit-a-*` policies no live attempt owns are reaped, never the canary's and never another's | names are Orbit's | -- | unit "a policy that is not Orbit's is never touched" |
| S8 | A substituted or drifting sensor image | -- | the image pinned by digest; a test holds the compose file's image and command line to the code's | the registry serves the digest | a new Tetragon version must be re-proven (THIRD_PARTY.md) | unit "the compose override runs the sensor image the code pins, by digest" |

## Identity and telemetry

| # | threat | 0.8.0 | 0.8.1 adds | assumes | remaining risk | verified by |
|---|---|---|---|---|---|---|
| T1 | An event is attributed to the wrong account (a forged label, a process argument, an environment variable) | -- | identity only from the labels of containers the allocator made, and each attempt's mount namespace read by the allocator AND by the sensor and required to agree; an event from any other container belongs to nobody | labels cannot be set from inside a container | -- | unit "an event is attributed by the container it came from … else to nobody"; service unit "identity bound by the plane AND the sensor" |
| T2 | One account reads another's events, attempts or incidents | -- | every read names the account first; an employee of another account is 404 | the session's account is the API's | -- | integration "one account never sees another's" |
| T3 | A secret reaches telemetry (a prompt, a token in an argument, an environment variable, a file's contents) | -- | arguments excluded at the source (`--field-filters`); no environment, file content or payload captured; the parser keeps named fields only, bounded | the sensor honours its field filter | a secret in a program's PATH or file name is kept as a path | unit "never a process's arguments"; drift test on the filter |
| T4 | A flood of events fills the database or hides what matters | -- | the allocator's ring is bounded (20,000) and an overflow is said LOST; the API keeps up to a cap per run of information and, apart, of notable events, counts the rest on a gap marker, and prunes by age (14 days); raw events never enter the audit chain | -- | the API pulls at most 500 events per 2 s, so a sustained flood is lost (said) rather than kept | integration "telemetry is bounded per run" and "a flood of notable events is bounded too"; service unit "an overflow is said" |
| T5 | The export is truncated or rotated while read | -- | the reader follows rotation by inode and offset, and says a gap when it cannot resume | -- | events in a rotated file that was deleted before it was read are lost (said) | not verified by a test of its own (exercised by the real-kernel tier) |
| T6 | One bad event stalls the security plane: an event of an account this database does not hold (what an allocator remembers of a database that was reset) fails the pull's transaction, which is then replayed forever | -- | each pull's events are kept only for accounts this database holds; the rest are dropped and logged, and the cursor moves on | the allocator's account labels are its own | -- | integration "an event of an account this database does not hold is dropped, and never poisons the pull it came in" |

## Response and the people around it

| # | threat | 0.8.0 | 0.8.1 adds | assumes | remaining risk | verified by |
|---|---|---|---|---|---|---|
| R1 | A response stops the wrong attempt (a stale incident about an attempt that ended) | -- | the response names its attempt by dispatch key; another dispatch key, or an attempt that is not here, is never touched | -- | -- | integration "a stale incident never stops a newer attempt" |
| R2 | A response fails, or the API restarts between opening the incident and responding, and the attempt keeps running | -- | the response is kept with the incident in the same transaction and carried out again on every pull until each step is recorded done; a stop counts only when both planes read back stopped, never when the allocator does not answer | the API runs | while the allocator does not answer, the attempt is not stopped by the API (the allocator's own watchdog still holds S1-S3) | integration "a response nobody could read back is never called contained" |
| R3 | An AI employee weakens its own security (lowers the mode, removes a control, suppresses evidence, authorizes its own retry) | employees reach no governance endpoint | the same: the policy, the floor, the sensor and reviews are an owner's or the operator's; a blocking incident refuses Retry until the owner's review naming the version read | the owner's session is not the employee's | -- | integration "only a review lets it run again" (409, 412) |
| R4 | A person lowers the requirement unnoticed | policy weakenings need acknowledgment | lowering the mode or removing a control is a weakening (high risk) | -- | -- | governance-core unit (runtime) |
| R5 | The operator removes the override while policies require enforce | -- | those attempts are refused (`runtime_protection_unavailable`), never run unprotected | -- | an operator who also lowers the floor and every policy can turn it off: they are in the TCB | integration "enforce on a host that has not proven it can prevent: refused before any container" |
| R6 | Business data is deleted in response to an incident | -- | no response deletes data; the response is ending the run token and stopping two containers | -- | -- | rules unit (the only responses are `revoke` and `stop`) |

## Not covered

- **The governed deployment's `orbit-agent`**: not made by the allocator and shared by every account, so nothing it runs
  can be attributed to one account. Its controls are 0.8.0's.
- **Sessions** (chat, research, CEO Chat): observed only when the floor is at least observe; never enforced.
- **Network and file observation in the kernel** (`tcp_connect`, writes to an employee's toolbox): not built in 0.8.1.
- **Other hosts**: a native Linux host, x86_64, a cloud VM, rootless Docker -- not run. The probe decides on each host
  what it proves; nothing is assumed from this one.
