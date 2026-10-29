# Connections and credentials

A **connection** is one account's access to one organization: a provider, a host, an
organization, and how it gets in: a Microsoft sign-in, or a **reference** to a credential.
Connections are machine-wide (every project on this machine can bind one); a project's report
settings name exactly one, by id. A report reads through the connection its settings name —
never one it guessed, and never a token or a login some other tool stored on the machine (the
person's own Azure CLI login included).

## How a connection gets in

A connection's `auth` is `{ strategy, ...options }`, one of the strategies its provider offers. A
connection with no `auth` is a token connection, as every connection was before sign-in existed.

| Provider | Ways in | A new connection uses |
|---|---|---|
| GitHub | a personal access token, or the name of an environment variable that holds one | the token |
| Azure DevOps | a Microsoft sign-in (`azure-cli`), or a personal access token (`credential`) | the Microsoft sign-in |

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/project-report.mjs connect <id> --provider=azure-devops --organization=<org>
node ${CLAUDE_PLUGIN_ROOT}/cli/project-report.mjs connect <id> --provider=azure-devops --organization=<org> --auth=credential --credential-env=<NAME>
```

## Microsoft sign-in (Azure DevOps)

Orbit's Microsoft sign-in is independent from your normal Azure CLI login. If you already use `az` for development, Orbit does not change that account, subscription, configuration or login session. Orbit keeps a separate Azure CLI profile in the Orbit machine store. You may therefore be logged into account A in your terminal and account B in Orbit at the same time.

A person signs in once per machine, and every project that uses the connection reads with it. The sign-in is the person's:
it opens a browser (`--device-code` shows a code to enter elsewhere; `--tenant=<id>` names the directory when the account
belongs to several), so tell them to run it themselves, at the prompt, with a `!`:

```bash
! node <engine>/cli/project-report.mjs sign-in <id> [--tenant=<id>] [--device-code]
! node <engine>/cli/project-report.mjs sign-out <id>        # Orbit's session only; the person's own `az` login stays
```

`<engine>` is this plugin's real root. Orbit Control → Connections shows whether anybody is signed in and lets the person
check the connection, sign in and sign out. A connection test never starts a sign-in.

- **Orbit's own profile.** Every Azure CLI process Orbit starts is given a profile directory of Orbit's own, in the machine
  store (`control/auth/azure-cli`, readable by this user only, created by the first sign-in), and an environment built from a
  short list: the person's other `AZURE_*` variables never arrive. The Windows account broker is switched off for it (it keeps
  a session outside the profile, shared with the person's own `az`), and so is an encrypted token cache outside Windows (a
  keystore entry has fixed names every profile shares).
- **Which `az` runs.** A private copy Orbit installed; else the machine's own `az`, as a program only (it must start, be 2.61.0
  or newer and belong to this operating system), never its sign-in; else Orbit installs a private copy itself (Windows x64:
  Microsoft's official ZIP; macOS and Linux: a Python of Orbit's own and the official `azure-cli` wheels, every one pinned
  and hash-checked), with no administrator rights and no package manager; else a blocked answer naming every candidate. Windows
  ARM64 has no private copy, because Microsoft publishes no ARM64 build. To make the private copy win over a machine `az`,
  install it from Orbit Control's Tools page.
- **Tokens.** Orbit asks the Azure CLI for a short-lived Azure DevOps token each time one is needed
  (`az account get-access-token`), keeps it in memory only and never reads a token-cache file. It runs `az login` again only
  when the CLI says a person must act, once, never in a loop.
- **On Windows** the sign-in is the browser flow, not the Windows account broker: no Windows Hello or single sign-on, and a
  tenant that requires a compliant device through the broker may refuse it. Use a personal access token there.
- **Scope.** Microsoft Entra authentication is available for Azure DevOps Services only; an Azure DevOps Server collection
  uses a personal access token. The sign-in token is the person's own for Azure DevOps. It is not narrowed to read-only the
  way a personal access token can be: a report only reads, but if the credential itself must be limited to reading, use a
  token with the read scopes below.
- **Never.** Orbit never imports or copies the person's Azure CLI session or asks to, never reads `~/.azure` or
  `%USERPROFILE%\.azure`, never reads the Azure CLI's token-cache files, never changes their subscription, extensions or
  configuration, never installs the Azure DevOps CLI extension and never creates a personal access token.

## Where a credential lives

A credential is for a connection that uses a token; a connection that signs in keeps none.

| Reference | What it is |
|---|---|
| `{ vault: "connection-<id>" }` | an item in this machine's OS secret store, put there once by a person in **Orbit Control → Connections**: the macOS Keychain, or Windows DPAPI (this user only) |
| `"REPORT_GITHUB_PAT"` | the NAME of an environment variable the person sets in their own shell |

A Orbit document never holds a credential's value. It is read from the secret port at the moment
a collector or a connection test uses it; it never reaches a child process, a snapshot, a log, a
report, a response, or the browser. On a machine with no OS secret store (Linux), a stored
credential is refused (503 in Control) — there is no plaintext fallback — and an environment
variable is named instead. The OS store protects a credential at rest; it does not protect it
from other code running as the same user.

## Least privilege: what a report token needs

A report only reads. Never grant a write permission for it.

**GitHub** — a fine-grained personal access token for the owner, limited to the repositories the
report reads, with read-only repository permissions: **Metadata**, **Pull requests**, **Issues**;
**Actions** and **Deployments** if those parts are on; the organization permission **Projects**
(read) only if a Projects board sets the periods. If the organization enforces SSO, authorize the
token for it. Official pages:
<https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>
· <https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens>

**Azure DevOps** (a connection that uses a token instead of signing in) — a personal access token
scoped to ONE organization (global tokens stop working on 1 December 2026), with read scopes only: **Work Items (Read)**, **Code (Read)**, **Build
(Read)**, **Project and Team (Read)**, and **Release (Read)** for classic release deployments.
Deployments of YAML pipelines to environments are NOT read: Azure DevOps offers their records only
with *Environment (read and manage)*, a scope that can also change environments, and a report never
asks for that. Official pages:
<https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate>
· <https://learn.microsoft.com/azure/devops/integrate/get-started/authentication/oauth#scopes>

## What a test checks

Authentication first; then, for this project's scope, each thing the report reads — each
answered `ok`, `forbidden` (with the permission the source named), `not-found`, or `error`. A
permission missing for an optional part of the report makes that part "not available", never a
zero; the rest of the report is read as usual. The last test is kept with the connection, holding
no secret; changing the connection's host, organization or way in forgets it, and so does signing
in or out. A test never starts a sign-in: with nobody signed in it says so and names the `sign-in`
command.
