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
# with your own Claude Console API key in a variable of this shell (never printed, never in the evidence):
node tests/acceptance/real-run.mjs --api-key-env=ANTHROPIC_API_KEY --budget=2 [--image=orbit-web:0.8.0] [--ca-file=<pem>] [--out=<dir>] [--keep]
# or, at a terminal, with your Claude subscription -- Claude Code's own sign-in runs in this terminal:
node tests/acceptance/real-run.mjs --budget=2
```

Orbit Web keeps its records in PostgreSQL: the run starts the pinned `pgvector/pgvector` image beside the container, on
a network of its own (the role made by the compose files' init script), and removes both at the end.

Signing in is Orbit Web's own (ADR 0061): the run sets the first administrator up with the one-time code the container's
terminal prints, then connects Claude Code for that account -- with the API key named by `--api-key-env`, or, without
one, as a subscription signed in by Claude Code's own `auth login` in this terminal (`docker exec -it … connect.js
<id>`), the URL and the code the CLI's and the person's. Without either it stops BLOCKED at that step. The evidence
names how Claude Code was connected, never the identity. Each Claude Code turn is capped with `--max-budget-usd`
(`--budget`, default $2). GitHub is stood in for by `fake-gh.mjs`, mounted read-only and named by `ORBIT_WEB_GH_BIN`: it
answers the few gh commands Orbit Web runs about the fixture repository, so the run exercises the real Orbit Web, the
real Claude Code with the real Orbit plugin, real git and real Orbit -- without a GitHub account. It is not in the
image.

Every step below is reported as **PASS**, **FAIL**, **BLOCKED** (it needs a person: a subscription's sign-in without a
terminal, and GitHub's device flow) or **STAND-IN** (GitHub's repository listing served by the fixture). The run writes
`REPORT.md`, `evidence.json` and both turns' event streams to `--out`. The last recorded run is in
[results/0.7.0](results/0.7.0/REPORT.md) (0.7.0, before PostgreSQL and Orbit Web's own accounts); 0.8.0's has not been
run (no Claude account was available to the session that built it).

## Manual run (21 steps, then the optional ones)

Needs: Docker, a Claude account (a subscription, or a Console API key), a GitHub account with the fixture repository.
Expected time: 10 minutes (20 with the optional steps).

1. **Start Orbit Web**: `cd integrations/orbit-web/docker`, write the two database passwords into `.env`, make
   `allocator.secret` and build the employees' three images (README, *Run it*), `docker compose up -d --build`;
   `docker compose ps` says `postgres`, `orbit-web` and `orbit-allocator` running (the first two healthy), and
   `curl -s localhost:3000/api/health` says the database ok with pgvector.
2. **Open the application**: http://localhost:3000 shows *Set up Orbit Web* and nothing else: no sidebar, no chats;
   `curl -s localhost:3000/api/sessions` answers 401 `sign_in_required`.
3. **Set up, sign in, connect Claude Code**: `docker compose exec orbit-web node
   /opt/orbit-web/apps/api/dist/cli/governance.js owner setup-code` prints a one-time code; on the page, the code, a
   username (`admin`), a password of at least 12 characters, your full name, a company name and a time zone → the
   workspace opens, your full name at the bottom of the sidebar. Using the same code again is refused. Then Settings →
   **AI Connections** → *Claude Code* → add a connection: *Subscription* shows one command -- run it in a terminal
   (`docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/connect.js <id>`), sign in with Claude Code's
   own flow there, and *Re-check*: the card says *Connected*, your identity, Claude Code's version and the models read
   from your account; or *API key*, pasted once, the same. Settings → System shows the Claude CLI, GitHub CLI, git, the
   Azure CLI and the Orbit plugin with versions, storage ok, and PostgreSQL with its schema and pgvector versions.
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
21. **Sign out** from the account menu at the bottom of the sidebar: this browser's page returns to the sign-in at once,
    and the API answers 401 to it again; signing in with the username and password opens it again. Settings → Account
    → *Sign out everywhere* ends every browser's session.

Optional (signed in again):

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

Report each step PASS or FAIL with what you saw. Then *Disconnect* GitHub, sign out of Azure DevOps and disconnect the
Claude Code connection if you are done.

## The Office, by hand (0.8.0, A03-A19 natively)

Needs what the manual run needs, a host whose Docker the allocator can drive, and about 30 minutes. Each step is what
the deterministic suites prove with a scripted CLI in a fake sandbox, done here with the real CLI in real containers --
the native rows of the 0.8.0 acceptance report, which no session without a Claude account could run.

1. **Set up the office**: Office → *Set up the office*; create a department *Finance*.
2. **Hire**: *Hire employee* (enabled only once a connection is connected with its models read from your account) →
   name *Ana*, department *Finance*, role *Analyst* → Claude Code, *Sonnet 5.5*, *Medium* → the *Lightweight* preset,
   the account's budget beside it → *Review & hire* (the network disclosure is there). Ana's sandbox says
   *Provisioning*, then *Ready*; `docker volume ls` shows no new volume per employee (the areas are in the allocator's
   `orbit-web-workforce`), and `docker ps` shows no container for Ana while she is idle.
3. **Give work**: *Assign work* to Ana: goal `Write report.md: the sum of 1,200,000 and 800,000 VND, with the working.`,
   deliverable `report.md`, criterion `The total is right`, *Start now*. *Started*. While it runs, `docker ps` shows the
   attempt's two containers (`…-tool-…` and `…-model-…`); `docker inspect` of the tool plane shows no capability, a
   read-only root, Ana's limits and no mount of `/data/connections`.
4. **The attempt in its sandbox**: the mission's *Last run* says the model, effort and resources as asked, resolved and
   observed; its network log lists what the tool plane reached. From the tool plane (`docker exec <tool plane> sh -c
   'ls /data /run/secrets 2>&1; curl -sS -m 5 http://169.254.169.254/ ; curl -sS -m 5 https://example.com -o /dev/null
   -w "%{http_code}"'`): no Orbit Web data, no secret, the metadata address refused, a public site reached (Autonomous).
5. **Hand in and revise**: when Ana hands in, *Needs me* has the review; open it: the summary, `report.md` (its hash),
   its claims. *Request revision* `Show the working line by line.` → a new attempt by Ana; hand-in revision 2.
6. **Accept**: *Accept…* revision 2 → the mission completes, Ana is free. Give Ana a second piece of work: its workspace
   starts from her desk (her earlier `report.md` and anything in her toolbox are there).
7. **Busy and queued**: while Ana works, *Assign work* to her with *Start now*: refused, nothing created, the dialog says
   what she holds; *Queue it*: queued, and it starts by itself once the first is accepted.
8. **Pause, cancel, a question**: pause a running attempt (its containers go), resume it (a new attempt), cancel it
   (Ana free). Give work that says `Ask me which quarter before you start.`: the work waits on your answer in *Needs me*;
   answer it, and the next attempt has it.
9. **Restricted network**: Governance → Policy → *Employee network access* → *Restricted*, allow `example.com`, publish
   (a high-risk change the other way). A running attempt's next connection to another public host is refused and listed
   in its network log; `example.com` still answers.
10. **Resources**: Settings → Compute & storage shows the host's capacity and how it was obtained, the budget, what is
    reserved now and what is waiting. Lower the account's memory budget below Ana's profile: her next work is
    *unschedulable* with the numbers in *Needs me*; restore it: it starts by itself.
11. **A research mission**: add a PDF to a research workspace; assign work with that source pinned; the attempt reads it
    under `/input`, and a claim it hands in is *supported* only with a quote the PDF holds.
12. **A team**: hire *Mai* as a *Team lead* and *Bao*; give Mai `Split this: Bao collects the numbers into
    /team/data.csv, then you write the summary.` -- the plan gives Bao a part, the *Team room* tab lists who changed what,
    Mai reviews Bao's part and hands the integrated result to you.
13. **Recurring work**: *Schedule* → a monthly schedule for Ana at 09:00 in your time zone; *Preview* lists its next
    runs; its first occurrence makes one mission, delivered to *Needs me* when accepted.
14. **Disconnect**: while Ana works, *Disconnect* the Claude Code connection: the attempt stops, the work is blocked
    saying the connection was disconnected, and a retry starts nothing until it is connected again.
15. **Restart**: `docker compose restart` during an attempt: after the restart the attempt is interrupted (never run
    twice), its containers are gone (`docker ps`), its resources released, and *Retry* starts a new one.

Report each step PASS or FAIL with what you saw, and say BLOCKED for a step you could not do and why.
