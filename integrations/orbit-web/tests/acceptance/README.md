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
node scripts/build-image.mjs --tag=orbit-web:0.8.0 [--ca-file=<proxy CA>]
# at a terminal: the run prints Orbit Web's sign-in URL; a person opens it and pastes the code the page shows
node tests/acceptance/real-run.mjs --budget=2 [--claude-volume=orbit-web-acceptance-claude] [--image=orbit-web:0.8.0] [--ca-file=<pem>] [--out=<dir>] [--keep]
```

Orbit Web keeps its records in PostgreSQL: the run starts the pinned `pgvector/pgvector` image beside the container, on
a network of its own (the role made by the compose files' init script), and removes both at the end.

The Claude account is Orbit Web's own sign-in, finished in a BROWSER (ADR 0061, ADR 0066): no credential variable signs
anything in, and a Claude CLI that is signed in already makes nobody the owner. So the run goes through Orbit Web's
browser sign-in itself -- it starts the flow, prints the URL, takes the code a person pastes at the terminal, and
exchanges the finished flow for its browser session; without a terminal it stops BLOCKED at that step. A volume named by
`--claude-volume` keeps the Claude CLI's own files between runs (mounted at `/data/claude`, never removed); the browser
sign-in is asked every run all the same. The evidence names the sign-in's method and plan, never the account's
address. Each Claude Code turn is capped with `--max-budget-usd` (`--budget`, default $2). GitHub is
stood in for by `fake-gh.mjs`, mounted read-only and named by `ORBIT_WEB_GH_BIN`: it answers the few gh commands Orbit
Web runs about the fixture repository, so the run exercises the real Orbit Web, the real Claude Code with the real
Orbit plugin, real git and real Orbit -- without a GitHub account. It is not in the image.

Every step below is reported as **PASS**, **FAIL**, **BLOCKED** (it needs a person: the Claude browser sign-in without a
terminal, and GitHub's device flow) or **STAND-IN** (GitHub's repository listing served by the fixture). The run writes
`REPORT.md`, `evidence.json` and both turns' event streams to `--out`. The last recorded run is in
[results/0.7.0](results/0.7.0/REPORT.md) (0.7.0, before PostgreSQL and the browser session).

## Manual run (21 steps, then the optional ones)

Needs: Docker, a Claude account, a GitHub account with the fixture repository. Expected time: 10 minutes (20 with the
optional steps).

1. **Start Orbit Web**: `cd integrations/orbit-web/docker`, write the two database passwords into `.env` (README,
   *Run*), `docker compose up -d --build`; `docker compose ps` says `postgres` and `orbit-web` healthy, and
   `curl -s localhost:3000/api/health` says the database ok with pgvector.
2. **Open the application**: http://localhost:3000 shows *Sign in to Orbit Web* and nothing else: no sidebar, no
   chats; `curl -s localhost:3000/api/sessions` answers 401 `claude_sign_in_required`.
3. **Sign in with your Claude account**: *Continue with Claude* → open the link shown → sign in → paste the code the
   page gives you → *Submit code*. The workspace opens at once on *What should Orbit work on?* with the composer at the
   bottom, and your address and plan sit at the bottom of the sidebar (from `claude auth status`). A terminal sign-in
   (`docker exec -it orbit-web claude auth login --claudeai`) signs the CLI in, never a browser: the page still asks
   this browser to finish its own sign-in. Settings → System shows the Claude CLI, GitHub CLI, git, the Azure CLI and
   the Orbit plugin with versions, storage ok, and PostgreSQL with its schema and pgvector versions.
4. **Connect GitHub**: the composer's repository picker (*No repository*) → *GitHub* tab → *Connect GitHub* opens
   Settings → Connectors on GitHub; *Connect GitHub* shows https://github.com/login/device, a one-time code, and
   *Waiting for authorization…*.
5. **Authenticate**: open the URL, enter the code, authorize GitHub CLI. The detail says *Connected as @you*, and the
   table's GitHub row shows ✓ and your login. Close Settings.
6. **Select the fixture repository**: repository picker → *GitHub* → search `sum-fixture` → choose it (a lock marks it
   private; its owner and default branch are under its name).
7. **Select the branch**: the branch chip says `main`; its menu lists the branches, `main` marked default.
8. **Choose the model, effort and mode**: *Sonnet 5.5 · Medium* (the menu lists Opus 5.5, Fable 5.2, Sonnet 5.5,
   Haiku 5.5 and, under *Effort*, Low, Medium *Recommended*, High, Extra, Max) and *Autonomous*.
9. **Create the chat** by sending the first message (next step): the chat opens, and the sidebar shows it under
   *Recents* with a dot while it prepares and works.
10. **Send**: `Fix the incorrect addition in sum.mjs so the existing test passes. Do not modify the test.`
11. **The real Claude CLI runs**: the chat shows *Started Claude Code 2.1.328 · claude-sonnet-… · Medium effort ·
    Autonomous*.
12. **Orbit is active**: the same line shows *Orbit 0.6.0 loaded*.
13. **The source changed**: *Changes* (top right) lists `sum.mjs` (M, +1 −1) and nothing else.
14. **The test passes**: a tool card `$ node --test …` shows `pass 1`, `fail 0` in its output; or
    `docker exec orbit-web sh -c 'cd /data/workspaces/*/repository && node --test'`.
15. **Streaming shows real execution**: the reply appeared word by word; each tool card shows its real output.
16. **Changed files appear** in *Changes* with the branch `orbit-web/<id> from main`.
17. **The diff is accurate**: `sum.mjs`'s diff shows `-  return a - b;` / `+  return a + b;`; compare with
    `docker exec orbit-web git -C /data/workspaces/<id>/repository diff`.
18. **Orbit's status is read correctly**: the *Orbit* tab shows Orbit's words. With no Orbit task in the session it says
    *Unknown*, and the checks Orbit saw (`node`, named like a test, exit ok). Compare with
    `docker exec -w /data/workspaces/<id>/repository orbit-web node /opt/orbit/plugin/cli/live.mjs status`.
19. **Restart**: `docker compose restart`; reload the page: still signed in (the browser's session is in
    PostgreSQL), and the chat, its messages, its status (*Completed*) and its changes are all there.
20. **Continue**: send `In one sentence, what did you change and why?`; the chat shows *Continuing Claude Code …* and
    answers about the earlier fix (the same Claude conversation, resumed).
21. **Sign out** from the account menu at the bottom of the sidebar: this browser's page returns to *Sign in to Orbit
    Web* at once, and the API answers 401 to it again. Settings → Account → *Sign the account out everywhere* ends every
    browser's session and signs the Claude CLI out; while a chat is running it is refused and says to stop it first.

Optional (signed in to Claude again):

22. **A chat without a repository**: *New session*, leave *No repository*, ask `Write hello.mjs that prints hello, and
    run it.` The workspace steps say *Creating an empty workspace…*; Claude writes and runs the file; *Changes* lists
    `hello.mjs`; `docker exec orbit-web git -C /data/workspaces/<id>/repository log --oneline` shows the empty start
    commit.
23. **Plan, then Autonomous**: a new chat on the fixture repository with the mode *Plan*, asking the step-10 prompt:
    a *Plan* card arrives and *Changes* stays empty. *Run it in Autonomous*: the mode chip says *Autonomous*, Claude
    carries the plan out, and *Changes* lists `sum.mjs`.
24. **Model and effort per chat**: in that chat pick *Opus 5.5* and *Effort → Max*, send `Explain the fix in two
    lines.`; the next run's line says *claude-opus-… · Max effort*.
25. **Files in Autonomous**: in a chat on the fixture repository, ask `Create notes/today.md, rename sum.test.mjs to
    sum.spec.mjs, delete package.json, then show git status.` It is done with no *Permission denied*, and
    `git status` (in the chat, or `docker exec … git -C … status`) shows the new, renamed and deleted files.
26. **What a repository brings**: add to the fixture repository `.claude/skills/release-notes/SKILL.md` (a frontmatter
    with `name` and `description`), `.claude/commands/deploy.md` and a `.claude/settings.json` enabling
    `some-plugin@some-marketplace`; start a chat on it. The workspace steps end with *Reading the project's skills and
    plugins…* and the chat says *Loaded from this repository: 1 skill, 1 command, 0 agents · plugins:
    some-plugin@some-marketplace (declared)*. Settings → Skills lists the skill and `/deploy`; Settings → Plugins
    lists the plugin as *Not run* (*Run project plugins* is off).
27. **Connect Azure DevOps**: Settings → Connectors → *Azure DevOps* → *Connect Azure* (a tenant if your organisation
    needs one); the detail shows https://login.microsoft.com/device (or microsoft.com/devicelogin) and a code; sign
    in; it says *Signed in as* your user (from `az account show`).
28. **An Azure DevOps repository**: repository picker → *Azure DevOps* tab lists your organisations' repositories
    (`organisation / project` under each name); choose one, a branch, and ask a question about it. It clones; then
    `docker exec orbit-web git -C /data/workspaces/<id>/repository config --list` shows no credential, no
    `extraheader` and a remote URL without a token.
29. **Azure off by default for Claude**: in a chat, ask Claude to run `az account show`; it is refused (*Permission
    denied: Bash*). Turn on *Let Claude Code use this Azure sign-in*, ask again: it answers with your account.
30. **Sign out** of Azure DevOps in its detail: `az account show` in the container says to run `az login`.

Report each step PASS or FAIL with what you saw. Then *Disconnect* GitHub, sign out of Azure DevOps and of Claude if
you are done.
