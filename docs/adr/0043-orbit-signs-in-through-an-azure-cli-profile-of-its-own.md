# ADR 0043 — Orbit signs in through an Azure CLI profile of its own

## Status

Accepted (0.2.1). Builds on ADR 0042: fetching a pinned tool, asking for a token and signing in are actions no Protected
Boundary holds, so they are AUTO. Amends two rules of AGENTS.md: a connection's credential is no longer the only way a
connection gets in, and a private tool runtime is no longer installed only because a person asked.

## Context

1. Reading Azure DevOps (a project report, a work item for `orbit-requirements`) needed a personal access token: a
   long-lived secret a person creates, pastes into Orbit Control once and rotates. Microsoft's own guidance is to prefer
   Microsoft Entra tokens where a tool supports them, and an organization may restrict who creates personal access tokens,
   with which scopes and for how long.
2. The Azure CLI signs a person in with their Microsoft account and gives a short-lived Azure DevOps access token
   (`az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798`, the documented way to issue an Entra
   token for Azure DevOps). But the Azure CLI is a tool that keeps IDENTITY STATE: a login, a token cache, a default
   subscription, a configuration and its extensions, in one directory (`~/.azure`, or where `AZURE_CONFIG_DIR` points) that
   every `az` a person runs shares. If Orbit used that login it would act as an account the person never chose for Orbit,
   and every `az login`, `az logout` or `az account set` it ran would be done to the person's own session. A developer can
   be signed in as account A in a terminal and need account B in Orbit.
3. A directory of Orbit's own is not, by itself, an isolated profile. Two defaults of the Azure CLI (read in its 2.91.0
   source) put a session where a profile directory does not reach:
   - **The Windows account broker.** `_create_identity_instance` in `azure/cli/core/_profile.py` reads
     `enable_broker_on_windows` with `fallback=True`, so on Windows `az login` goes through the operating system's account
     broker unless it is told otherwise, and what it signs in lives in Windows, not in the config directory. That session is
     the OS user's: every profile and the developer's own `az` share it, so Orbit could find it, use it and sign it out.
   - **The token cache's keystore.** `should_encrypt_token_cache` in `azure/cli/core/util.py` is on by default on Windows
     only (`fallback = sys.platform.startswith('win32')`). Where it is turned on elsewhere, `build_persistence` in
     `azure/cli/core/auth/persistence.py` keeps the cache in a macOS Keychain item or a Linux libsecret entry whose service,
     account, schema and attribute names are fixed strings, so every profile on the machine would share one entry. On
     Windows it is a DPAPI-protected file inside the profile, which is isolated.
4. Orbit still needs an `az` that runs. A machine may have none, or one that is too old; installing one machine-wide needs
   administrator rights, a package manager or the system Python, none of which Orbit may use. ADR 0042 made everything that
   crosses no Protected Boundary autonomous, and fetching a pinned runtime into Orbit's own store crosses none, but the rule
   that a runtime is installed by a person still stood in the way.

## Decision

### A connection says how it gets in

A connection record gains `auth: { strategy, ...options }`. The strategies a provider offers are rows of its descriptor
(`authentication.strategies` in `skills/orbit-report/providers.json`): `kind: "credential"` reads a reference to a secret,
and `kind: "broker"` uses a session a tool holds and keeps no credential at all. Azure DevOps offers `azure-cli` (a Microsoft
sign-in, the default for a new connection, with the options `tenant` and `deviceCode`) and `credential`; GitHub offers
`credential` only. A record with no `auth` is a credential connection and is never rewritten.

`src/connections/auth.mjs` is the one contract every reader, collector and probe asks, so none of them knows whether a person
pasted a token or signed in. It names no tool: how a connection signs in is an adapter's
(`skills/orbit-report/auth/azure-cli.mjs`), bound together with the tools port by the composition roots.

A person signs in with `node <engine>/cli/project-report.mjs sign-in <connection-id> [--tenant=<id>] [--device-code]` and out
with `sign-out <connection-id>`, or in Orbit Control's Connections page, which also shows the connection's state
(`POST /api/v1/connections/:id/auth/check`, `.../auth/sign-in`, `.../auth/sign-out`). `connect` takes
`--auth=azure-cli|credential`.

### One profile, owned by Orbit

- Every Azure CLI process Orbit starts is given `AZURE_CONFIG_DIR=<storeBase>/control/auth/azure-cli`: the `authSessions`
  room (`src/store/control.mjs`). It is machine-wide, because a sign-in belongs to the person and not to a project; mode
  0700; created by the first sign-in and never by a read; and never inside a repository.
- ONE owner builds a child's environment: `launcherOf` in `src/tools/launch.mjs`, from data in the catalog row. `profile`
  names the variable (`env`) and the profile (`name`, the same for every row that serves the tool, so switching between a
  private copy and the machine's program never changes whose sign-in it is). `launch` carries `env` pins, `platformEnv`
  pins for `win32` and `posix`, the names the child may inherit (`inherit`) and the leading `args`. The code names no
  variable, pin or product.
- The child's environment is `BASE_ENV`, then the names the row lets through (`inherit`: proxy variables, CA bundles,
  display and browser variables), then the row's pins, and the profile variable LAST. A name the row does not declare is
  never copied, so no other `AZURE_*` of the developer's ever arrives, and a row cannot let the profile variable itself
  through.
- The pins, in the catalog row and applied to every child:

  | Variable | Value | Why |
  |---|---|---|
  | `AZURE_CORE_ENABLE_BROKER_ON_WINDOWS` | `false` | The Windows account broker keeps a session outside the profile, shared with the developer's own `az`. A profile alone does not isolate there. |
  | `AZURE_CORE_ENABLE_BROKER_ON_MAC` | `false` | The CLI's own fallback is already `false` (`enable_broker_on_mac`); pinned so a release that changes the default cannot move a profile onto the system broker. |
  | `AZURE_CORE_ENCRYPT_TOKEN_CACHE` | `true` on Windows, `false` elsewhere | On Windows the cache is a DPAPI-protected file inside the profile. Elsewhere a keystore entry has fixed names every profile shares, so the cache stays a file inside Orbit's profile. |
  | `AZURE_CORE_LOGIN_EXPERIENCE_V2` | `off` | No interactive subscription picker at sign-in. |
  | `AZURE_CORE_COLLECT_TELEMETRY` | `false` | No telemetry. |

- **A consequence on Windows.** Orbit's sign-in is the browser flow (or a device code), not the account broker: no Windows
  Hello and no single sign-on from the Windows account. A tenant that requires a compliant device through the broker may
  refuse it; for such a tenant a personal access token is the way in.
- **Probes and install verification run in a scratch profile.** `az --version` alone writes nine files into whatever config
  directory it is given. A version probe, or the verification of an install, therefore gets a directory made for that one
  question and removed after it. Looking creates no session directory, and nothing a probe writes is ever seen by a sign-in.
- **WSL behaves as Linux, with its own Orbit state.** `detection.native` makes a candidate a program of THIS operating
  system: a Windows `az` reached through WSL interop (a path under the Windows mount, `/mnt/<drive>` unless `/etc/wsl.conf`
  names another root, or a file that is a Windows executable) is refused, because it would read Windows' own state. A
  profile directory on a Windows drive is refused too (`AUTH_PROFILE_LOCATION`): it would be shared with Windows and carries
  no POSIX modes.

### Which Azure CLI runs: two layers

The RUNTIME, the program, is preferred to be Orbit's own. The STATE, whose sign-in it is, is always Orbit's profile,
whichever program runs it.

The order (`ensureOne`, `src/tools/ensure.mjs`, one table for every caller):

1. a private copy Orbit installed before, found from its receipt and nowhere else (an `az` on PATH is not it);
2. otherwise the machine's own `az`, as a PROGRAM only: its sign-in is never used;
3. otherwise Orbit installs a private copy itself (below);
4. otherwise BLOCKED (exit 3), naming every candidate, what each said and how a person would install one.

A "verified Orbit-compatible executable" is not a fourth source. It is the gate every candidate passes, the private copy and
the machine's `az` alike: it starts, it names a version at or above the row's `minimum` (2.61.0), and it is a program of this
operating system. A candidate that fails says why and the walk goes on. Looking never installs: `findOne` is the same walk
without the third step, and a status or a sign-out uses it.

A person who wants the private copy to win although the machine has an `az` installs it from Orbit Control's Tools page; step
1 finds it from then on.

### What Orbit installs

Two catalog rows, both `install.autonomous`:

- **`azure-cli-private-win`, Windows x64:** Microsoft's official ZIP, `azure-cli-2.91.0-x64.zip` (SHA-256
  `c0c49639a96d8c0dfb9973cfe08c97c5eeb69be050102138ede806285e6fcf1f`, 91,095,515 bytes), unpacked into Orbit's own
  directory and started as `python.exe -IBm azure.cli`, never through its `.cmd` wrapper and never a shell. `-I` ignores
  `PYTHON*` variables and the user's site-packages; `-B` writes no bytecode.
- **`azure-cli-private`, macOS and Linux (x64 and arm64):** a Python of Orbit's own (the pinned `python` row) and the
  official `azure-cli` 2.91.0 wheels from PyPI, every distribution pinned and every SHA-256 locked
  (`catalog/locks/azure-cli-2.91.0-<platform>.lock`, 150 distributions each), in a virtual environment started the same way.
  About 200 MB is downloaded and about 700 MB used on disk.

Both go to `<storeBase>/runtimes/tools/<tool>/<version>-<platform>-<arch>/`, staged beside the final directory, verified the
way they will be run, promoted by one rename and receipted last. Nothing is put on PATH, no privilege is asked for, and the
machine's own Python is never the fallback.

### Platforms

| Platform | Private copy | Machine `az`, as a program |
|---|---|---|
| Windows x64 | the official ZIP | yes |
| Windows ARM64 | none: Microsoft publishes no ARM64 build, and Orbit makes no claim about emulation | an x64 `az` already installed, found through its `az.cmd` wrapper (`wbin\az.cmd` in an MSI install) to the `python.exe` one directory above it, never through a shell; otherwise BLOCKED. A lock for this platform resolves (with `cryptography` 46.0.3) and is not shipped. |
| macOS arm64 and x64 | the locked environment (on x64 the lock pins `cryptography` 48.0.1 and `pyOpenSSL` 26.2.0, because 50.x ships no Intel-macOS wheel) | yes |
| Linux x64 and arm64 (glibc) | the locked environment | yes |
| WSL | as Linux, with its own Orbit state | a Linux `az`; a Windows `az` reached through interop is refused |
| Alpine (musl) | none: the pinned Python is a glibc build and cannot run, so verification fails and nothing is installed | a usable `az` already there |

### The lock

A lock (`src/tools/lock.mjs`) is one requirement per line, `name==version --hash=sha256:<64 hex> ...`, with blank lines and
`#` comments and nothing else: no option, index, link page, URL, path, environment marker or continuation. The installer
(`src/tools/pylock.mjs`) holds the file to that grammar before anything runs and requires it to pin the row's own package
(`install.package`) to the row's own version. It then builds a virtual environment of Orbit's own interpreter (the row
`install.python` names) and runs pip with `--isolated --require-hashes --only-binary=:all: --no-deps`: no environment
variable or configuration of anybody's, no file the lock does not hash, no code built or run to install anything, and the
lock IS the dependency graph.

`skills/orbit-release/pin-python-lock.mjs` writes the locks, and only a release runs it. pip resolves the platform it runs
on (a dry run that installs nothing). uv resolves each other platform, because pip evaluates environment markers against its
own interpreter and cannot answer for another operating system; it is seeded with the host's picks, so a version is kept
wherever the platform allows and re-picked only where the platform needs another release. Each re-pick is recorded in the
lock's header (`# re-picked for this platform: ...`), and a pre-release nobody asked for is refused for a person to look at.
PyPI's own record is asked for the SHA-256 of EVERY wheel that could be installed on that platform, not only the one pip
picked, because another operating-system version may pick another wheel of the same release; a source distribution is never
accepted.

### Autonomous acquisition

Orbit installs a private tool on its own initiative only when all of these hold (`permitted`, `src/tools/ensure.mjs`): the row
says `install.autonomous`; its strategy is in `AUTONOMOUS_STRATEGIES` (`archive` and `python-lock`: a pinned archive or a
pinned lock); an installer serves this platform; and `authorize({ kind: "tool.acquire" })` answers AUTO. No Protected Boundary
holds `tool.acquire`, `auth.token` or `auth.login`, and `test/protected-boundaries.test.mjs` asserts they are AUTO. Never a
package manager, never `sudo`, never the machine's Python. A failed install is BLOCKED with its reason and leaves no receipt
and nothing where detection looks; an install that finishes but does not answer is not believed.

### Tokens and the sign-in sequence

- Orbit asks the CLI for a token each time one is needed: `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798
  --output json --only-show-errors` (with `--tenant` when the connection names one). The token is only ever an answer. It is
  kept in memory until shortly before it expires, shared by every reader waiting on it, and never stored, logged, traced,
  reported, put in an argument or a variable, or handed to a part. Orbit never opens a token-cache file.
- The sequence is never a loop. No profile directory means nobody has signed in here, which is known without starting a
  process. Otherwise: a token; if the CLI says a person must act, ONE `az login --scope
  499b84ac-1321-427f-aa17-267ca6975798/.default --allow-no-subscriptions --output none` (with `--tenant`, or `--use-device-code`,
  when asked), however many readers are waiting; then ONE token. A person who cancelled is told, and nothing retries. A
  service that cannot be reached is not a reason to sign in. Signing in as another account is `az logout` and then `az login`:
  a profile holds one account.
- What the CLI printed decides one thing, by one ordered table: the ok answer, its own "Please run 'az login'" sentence
  (login required), a documented `AADSTS` code that asks a person to do something (interaction required), a network failure,
  and everything else, which is `failed` and never "login required". What it printed is never shown as it came: masked,
  scrubbed, one short line. A refusal is BLOCKED (3) with an `AUTH_*` code and the one thing a person does next.
- Which commands Orbit runs: `--version` (a probe, in a scratch profile), `login`, `account get-access-token`, `logout`, and
  `account list --query "[].tenantId"` only on the way to `AUTH_TENANT_AMBIGUOUS`, when a refused token needs a directory
  named. No command carries `--debug` or `--verbose`. A connection test never starts a sign-in.
- `sign-out` is `az logout` against Orbit's profile only. The developer's own login is untouched.

### The `az devops` hint is removed

The azure-devops provider used to resolve a bare `#123` by running `az devops configure --list`, which read the developer's
`~/.azure/config` and needed the Azure DevOps CLI extension. It is gone: both are the developer's state. A bare `#123` now
resolves only through the project's binding or the connection registry. This is a visible change of behavior.

### The boundary

This governs the Azure CLI processes Orbit starts for its OWN sign-in. A project capability that itself declares `tools:
["az"]`, and `query doctor`, are the project's own declared dependency: they run as the project asked, outside this
isolation.

### What Orbit does not do

Orbit never imports or copies the developer's session and never asks "import this account?". It never reads `~/.azure` or
`%USERPROFILE%\.azure`, never reads the Azure CLI's token-cache files, and never changes the developer's account,
subscription, configuration or extensions. It never installs the Azure DevOps CLI extension and never creates a personal
access token.

## Consequences

- A person signs in once per machine, not once per project, and reads of Azure DevOps need no token created, pasted or
  rotated. A personal access token remains the way in for GitHub, for an Azure DevOps Server collection (Microsoft Entra
  authentication is available for Azure DevOps Services only), and for a tenant that refuses the browser sign-in.
- The Microsoft sign-in token is the person's own for Azure DevOps. It is not narrowed to read-only scopes the way a personal
  access token can be. Orbit's readers only read; a person who needs the credential itself limited to reading uses a token
  with read scopes.
- On a machine with no usable `az`, a token request or a sign-in downloads and installs a private runtime without asking.
  `test/tools-ensure.test.mjs` holds that only a row that says `install.autonomous`, by a pinned archive or lock, is ever
  installed on Orbit's own initiative.
- `test/azure-cli-isolation.test.mjs` holds eight statements over the whole chain, against a fake `az` that keeps state where
  the real one does: the developer's profile is ignored; an existing system login is not reused; Orbit's login leaves theirs
  byte for byte as it was; the two accounts are never mixed; sign-out is Orbit's session only; configuration is Orbit's own
  (no `config set`, no extension, no subscription change); a private copy beats the machine's; and the machine's `az` is a
  program only.
- The hash locks are data shipped with the plugin. A release that moves the pinned version re-pins them
  (`skills/orbit-release/SKILL.md`), and the suite fails when a lock is missing, outside the grammar, or does not pin the
  row's own package to the row's own version.

## Platform evidence

What has been run, and where. `real`: run on that platform. `resolved-only`: the lock was resolved and its hashes taken,
and nothing was installed or run there. `fakes-only`: exercised only through the suite's fakes. `pending`: not yet done.
Nothing is claimed beyond what its row says. The per-platform workflow `.github/workflows/azure-cli-runtime.yml` is how the
rows are filled: dispatch it, paste what each platform did into the table, and move a row only as far as that run went.

| Platform | Private copy | Machine program | How it was verified | Status |
|---|---|---|---|---|
| win32-x64 | official ZIP, `python.exe -IBm azure.cli` | `az.cmd` wrapper to its `python.exe` | The pin was re-checked against the download on 2026-10-29: SHA-256 and the blob's `Content-MD5` matched, and the size is 91,095,515 bytes. The install, the launch and the sign-in flow ran only against the suite's fakes. | `fakes-only` until `azure-cli-runtime` is dispatched |
| win32-arm64 | none (no Microsoft build); a lock resolves with `cryptography` 46.0.3 and is not shipped | the machine's x64 `az` through its wrapper, or BLOCKED | The unsupported answer and the wrapper path ran against the suite's fakes. | `fakes-only`; the unshipped lock `resolved-only` |
| darwin-arm64 | locked environment, 150 distributions | machine `az` as a program | **Private copy:** `skills/orbit-release/azure-cli-runtime-smoke.mjs` ran Orbit's own installer on macOS arm64 (2026-10-29): it fetched the pinned Python and the 150 locked wheels into a temporary store in 117 s; the private `az` reported 2.91.0; asking who is signed in answered "sign in required" without creating a session directory; and a decoy developer profile named in the environment was byte for byte as it was. The "not signed in" text the classification table reads (`ERROR: Please run 'az login' to setup account.`, exit 1) was captured from that runtime. **Machine program:** the Homebrew `az` 2.85.0 was used as a program only, through the real chain, with the developer's actual `~/.azure` named in the environment: the status was "sign in required", no session directory was created, and `~/.azure` was identical afterwards (content, size and modification times). A real sign-in (a person in a browser) was not run. | private copy `real`; machine program `real`; a real sign-in `pending` |
| darwin-x64 | locked environment, 150 distributions (`cryptography` 48.0.1, `pyOpenSSL` 26.2.0) | machine `az` as a program | The lock was resolved. Nothing was installed or run on this platform. | `resolved-only` |
| linux-x64 (glibc) | locked environment, 150 distributions | machine `az` as a program | The lock was resolved. Nothing was installed or run on this platform. | `resolved-only` |
| linux-arm64 (glibc) | locked environment, 150 distributions | machine `az` as a program | The lock was resolved. Nothing was installed or run on this platform. | `resolved-only` |
| WSL | as Linux | a Linux `az`; a Windows `az` refused | The refusals (a Windows-drive path, a Windows executable, a profile on a Windows drive) ran against fakes. | `fakes-only` |
| Alpine (musl) | none | a usable `az` already there | The rule that an install which does not answer is never believed ran against fakes. | `fakes-only` |
