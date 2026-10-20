# Connections and credentials

A **connection** is one account's access to one organization: a provider, a host, an
organization, and a **reference** to a credential. Connections are machine-wide (every project
on this machine can bind one); a project's report settings name exactly one, by id. A report
reads through the connection its settings name — never one it guessed, and never a token some
other tool stored on the machine.

## Where a credential lives

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

**Azure DevOps** — a personal access token scoped to ONE organization (global tokens stop working
on 1 December 2026), with read scopes only: **Work Items (Read)**, **Code (Read)**, **Build
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
no secret; changing the connection's host or organization forgets it.
