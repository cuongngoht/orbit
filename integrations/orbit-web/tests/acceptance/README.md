# Orbit Web acceptance

Two ways to accept Orbit Web against the real Claude Code CLI and a real Claude model: the **automated run**, which
stands in for GitHub with a local fixture repository, and the **manual run**, which a person does end to end with their
own Claude and GitHub accounts. Only these use a model; every other test of Orbit Web is deterministic.

## The fixture

`fixture.mjs` makes, at run time, a repository with `package.json`, `sum.mjs` (an addition that subtracts) and
`sum.test.mjs` (the test that catches it). It is never committed: the plugin's own `node --test` would collect a failing
`sum.test.mjs`. For the manual run, create a private GitHub repository with the same three files (copy them from
`fixture.mjs`) on a `main` branch.

## Automated run

```bash
node scripts/build-image.mjs --tag=orbit-web:0.7.0 [--ca-file=<proxy CA>]
CLAUDE_CODE_OAUTH_TOKEN=<your token> node tests/acceptance/real-run.mjs --image=orbit-web:0.7.0 --budget=2 [--ca-file=<pem>] [--out=<dir>] [--keep]
```

The credential is handed to the container by name only (`docker run -e CLAUDE_CODE_OAUTH_TOKEN`); it is never on a
command line or in a file. Each Claude Code turn is capped with `--max-budget-usd` (`--budget`, default $2). GitHub is
stood in for by `fake-gh.mjs`, mounted read-only and named by `ORBIT_WEB_GH_BIN`: it answers the few gh commands Orbit
Web runs about the fixture repository, so the run exercises the real Orbit Web, the real Claude Code with the real
Orbit plugin, real git and real Orbit -- without a GitHub account. It is not in the image.

Every step below is reported as **PASS**, **FAIL**, **BLOCKED** (it needs a person: the Claude browser sign-in and
GitHub's device flow) or **STAND-IN** (GitHub's repository listing served by the fixture). The run writes
`REPORT.md`, `evidence.json` and both turns' event streams to `--out`. The last recorded run is in
[results/0.7.0](results/0.7.0/REPORT.md).

## Manual run (20 steps)

Needs: Docker, a Claude account, a GitHub account with the fixture repository. Expected time: 10 minutes.

1. **Start Orbit Web**: `cd integrations/orbit-web/docker && docker compose up -d --build`; `docker compose ps` says
   healthy.
2. **Open the application**: http://localhost:3000 shows *Set up Orbit Web*; System Status shows the Claude CLI,
   GitHub CLI, git and the Orbit plugin with versions, and storage ok; both accounts say *Not connected*.
3. **Sign in to Claude Code**: *Connect Claude* → open the link shown → sign in → paste the code the page gives you →
   *Submit code*. The card says *Connected* (from `claude auth status`). Fallback: `docker exec -it orbit-web claude
   auth login`.
4. **Click Connect GitHub**: the card shows https://github.com/login/device and a one-time code, and *Waiting for
   authorization…*.
5. **Authenticate**: open the URL, enter the code, authorize GitHub CLI. The card says *Connected as @you*.
6. **Select the fixture repository**: *Open the chat workspace* → *New chat* → search `sum-fixture` → choose it (it
   shows *Private* and its default branch).
7. **Select the branch**: `main (default)`.
8. **Choose Sonnet** in *Claude model*.
9. **Create the chat** by sending the first message (next step); the sidebar shows it as *Preparing*, then *Running*.
10. **Send**: `Fix the incorrect addition in sum.mjs so the existing test passes. Do not modify the test.`
11. **The real Claude CLI runs**: the chat shows *Started Claude Code 2.1.328 · claude-sonnet-…*.
12. **Orbit is active**: the same line shows *Orbit 0.6.0 loaded*.
13. **The source changed**: the *Changes* tab lists `sum.mjs` (M, +1 −1) and nothing else.
14. **The test passes**: a tool card `$ node --test …` shows `pass 1`, `fail 0` in its output; or
    `docker exec orbit-web sh -c 'cd /data/workspaces/*/repository && node --test'`.
15. **Streaming shows real execution**: the reply appeared word by word; each tool card shows its real output.
16. **Changed files appear** in *Changes* with the branch `orbit-web/<id> from main`.
17. **The diff is accurate**: `sum.mjs`'s diff shows `-  return a - b;` / `+  return a + b;`; compare with
    `docker exec orbit-web git -C /data/workspaces/<id>/repository diff`.
18. **Orbit's status is read correctly**: the *Orbit* tab shows Orbit's words. With no Orbit task in the session it says
    *Unknown*, and the checks Orbit saw (`node`, named like a test, exit ok). Compare with
    `docker exec -w /data/workspaces/<id>/repository orbit-web node /opt/orbit/plugin/cli/live.mjs status`.
19. **Restart**: `docker compose restart`; reload the page: the chat, its messages, its status (*Completed*) and its
    changes are all there.
20. **Continue**: send `In one sentence, what did you change and why?`; the chat shows *Continuing Claude Code …* and
    answers about the earlier fix (the same Claude conversation, resumed).

Optional, with an Azure account:

21. **Connect Azure**: Settings → Azure Account → *Connect Azure* (a tenant if your organisation needs one); the card
    shows https://login.microsoft.com/device (or microsoft.com/devicelogin) and a code; sign in; the card says
    *Connected* with your user and subscription (from `az account show`).
22. **Off by default for Claude**: in a chat, ask Claude to run `az account show`; it is refused (`Permission denied:
    Bash`). Turn on *Let Claude Code use this Azure sign-in*, ask again: it answers with your account.
23. **Sign out** in the card: `az account show` in the container says to run `az login`.

Report each step PASS or FAIL with what you saw. Then *Disconnect* GitHub, sign out of Azure and of Claude if you are
done.
