# ADR 0045 — A reusable definition improves itself only on independent evidence, through its owner's doors

## Status

Accepted (0.3.0). Builds on ADR 0017 (a coordinator dispatches to owners and proves nothing itself), ADR 0025 (learning
on by default, bounded), ADR 0030 (a declared playbook runs through the doors that exist), ADR 0041 (Satellite is a
mission journal above Orbit's owners), ADR 0042 (autonomous by default, protected boundaries) and ADR 0044 (a run knows
its identity, and a call is attributed only by evidence).

## Context

1. Orbit already records what a reusable definition DID. A declared playbook's runs are `skillrun`, `skillstep` and
   `invocation` receipts in the coordinator task that carried them, each bound by the engine as it made the call. A
   Satellite agent run is an `agentrun.*` line naming the role pin its mission bound, and the outcome the mission
   concluded on its owners' records.
2. `skill-factory review` reads those runs and PROPOSES a successor, but never writes one. Nothing closed the loop.
   Nothing noticed that one definition kept failing in the same way across sessions, drafted the smallest successor,
   compared it with the version it would replace, chose it for future work, watched it, or put the old version back.
3. A system that rewrites its own instructions can also learn to grade itself. The design question is less how to
   improve and more what may NEVER be the evidence for an improvement. That includes an agent's own report, one lucky
   session, a test made easier, or a permission quietly widened.

## Decision

### One domain that keeps decisions, and owners that keep their truths

`src/improvement/` keeps one thing: an append-only journal per CAMPAIGN under `<storeRoot>/improvement/campaigns/<imp>/`,
plus one opportunity file per fingerprint and the time detection last ran. Every line kind declares its fields
(`KINDS`). Free text is scrubbed and bounded, and the phase is a fold read on every look (`model.mjs`), never stored.
Everything else stays with its owner and is referenced by id, pin and digest.

| Truth | Owner | How a campaign reaches it |
|---|---|---|
| a playbook's versions, its contract, which version runs | the skill factory | `improvementSubject` (`skills/orbit-help/factory.mjs`): `scaffoldSuccessor`, `stage`, `content`, `validate`, `select` |
| a declared playbook's runs | the coordinator tasks' journals | `recentOf` + `skillRunsOf`, read by `cli/improve.mjs` |
| an evaluation's runs | an evaluation TASK (provider `improvement`) through the task's door | the coordinator's own `skillRun`, pinned with `dispatch.pin` |
| a role's versions, which one is offered | Satellite's definitions and its registry | `improvementPorts` (`satellite/cli/improvement.mjs`) |
| a role's runs | Satellite's mission journals | the same port; a mission the host LINKS to an evaluation |
| a lesson | learn | `promote` (`src/learn/promote.mjs`): two independent sessions or nothing |
| who may decide | a person in Orbit Control | `person()` behind the door `control` only |

`src/improvement/` imports only leaves (`errors`, `hash`, `scrub`, `printable`, `learn/args`, `memory/session`,
`project/boundary`, `store/{atomic,id,lock}`). It reads no environment, spawns nothing and calls no model.
`cli/improve.mjs` is its composition root. `cli/live.mjs` and `control-server/src/core.mjs` are the only other modules
that import it (`test/improvement-boundary.test.mjs`).

### The lifecycle, as the engine carries it

| Stage | What happens | Owner reached | Satellite mode word |
|---|---|---|---|
| OBSERVE | owners' run records, read only | coordinator tasks, missions | — |
| DETECT | records → signals → one opportunity per fingerprint, `ELIGIBILITY` | — | ANALYZING |
| DIAGNOSE | `DIAGNOSIS` over what the evidence demonstrates | — | DIAGNOSING |
| PROPOSE | the cause, the failing steps, the measurable change expected | — | DESIGNING |
| GENERATE | a successor draft, written by the host, staged as a candidate nobody is offered | skill factory, Satellite | SKILL_GENERATING |
| VALIDATE | `SAFETY`, then the owner's own contract on the staged pin | skill factory, Satellite | SKILL_VALIDATING |
| EVALUATE | baseline and candidate on the same frozen inputs, in independent sessions | an evaluation task, linked missions | TESTING |
| GATES | `PROMOTION_GATES`, in order | — | VERIFYING |
| PROMOTE | the owner's version-selection door | skill factory, Satellite | REUSING |
| MONITOR | ordinary work's runs after the promotion, `MONITOR` | coordinator tasks, missions | VERIFYING |
| ROLLBACK | the same door, back to the version it replaced | skill factory, Satellite | RECOVERING |
| LEARN | one finding, learn's own ladder | learn | RECALLING |

`STEPS` (`loop.mjs`) maps each phase to exactly one step. `improve step` runs one, and `improve resume` runs steps until
the campaign needs the host, a person or another session.

Detection runs by itself in three places: after a coordinated workflow ends (`cli/automation.mjs`), and from the hooks
on `turn-end` and `session-end`. The hooks start a detached `improve analyse --hook` through a lifecycle subscriber. That
run is silent, debounced for ten minutes, and carries a campaign only through `CHEAP` phases. It starts only for a
project that keeps a playbook, a Satellite mission or a campaign, in the system's temporary directory, told its
checkout: on Windows a directory a running process stands in cannot be removed. It never asks a provider,
because an evaluation runs only from a session (`improve step`, `resume` or `evaluate`).

### What counts as evidence, and what never does

- **A signal is its owner's word.** A run's signal is read off the receipts its owner kept (`RUN_SIGNALS`,
  `SATELLITE_SIGNALS`). The text of an answer, a log line or an agent's report is never read. A signal has a
  `category`, and only `definition` may lead to a candidate:
  - a provider that failed belongs to its provider's owner;
  - an environment that blocked a run is a confounder;
  - a person's approval or switch is a person's;
  - extra retries are a provider's cost.
- **Independence is one machine on one UTC day, never a session mark.** This is learn's own definition
  (`src/memory/session.mjs`), and `sessionKeys` uses it. A host's session mark reaches a command as a variable its
  shell can set, so it is never counted: two marks on one machine and one day are one session. The machine's name and
  the clock are not the agent's to choose. Retries inside one sitting count once. Detection needs `minRuns` runs in
  `minSessions` independent sessions, and a problem that more sessions contradict than show is not one.
- **Only the owners' records judge a run.** An evaluation run's outcome is read back off the evaluation task's own
  receipts, which the engine bound as it made each call (RUNTIME_BOUND). A role's run is read back off its mission's
  conclusion. A host or an agent that says "better" adds nothing.
- **One evaluation is an observation.** `AGGREGATE` calls a candidate BETTER only when `minSessions` independent
  sessions found it better and no evaluation said otherwise. One WORSE is enough to reject it.
- **Asking again is never a second vote.** Another evaluation runs only when it would add an independent session to
  the ones kept. Asked again on the same machine and day, under any session mark or none, it starts nothing
  (`evaluatedHere`).

### Generation stays inside the existing factories, and stays instruction-only

- **Playbooks.** `scaffoldSuccessor` copies the pinned version into a draft and stamps `successorOf` and `campaign`. A
  host can never put a manifest, so neither field is ever a host's word. The host writes the changed text with
  `skill-factory put`. `stageCandidate` holds it to the same validation every playbook passes, then keeps it under
  `candidates/` with status `candidate`: pinnable, never offered, with the registry row untouched. `register` refuses a
  successor (`SF_SUCCESSOR`), so no successor is ever registered in place.
- **Roles.** The host proposes a role's whole content (`improve candidate`). Satellite's role rules hold it, and it is
  published HELD: the registry keeps offering the selected version until a selection names the candidate.
- **Nothing executable.** `allowExecutableCode = false` is unchanged, and `improvement.allowExecutableCandidates` is
  FIXED false. `SAFETY` refuses a candidate carrying a file that is not instruction text or declared data
  (`CAND_EXECUTABLE`).

### A candidate is untrusted until every rule holds, before anything runs

`SAFETY` (`safety.mjs`) checks the following before any evaluation:

- the candidate is the digest that was staged, and it changed something;
- it succeeds the version it names, and provides exactly what that version provides;
- it asks for no tool that version never had (`CAND_TOOLS_WIDENED`);
- it carries no file outside instruction text and declared data;
- it does not WEAKEN the acceptance rules;
- it was not already suppressed;
- its owner's own contract holds it.

`oracle.mjs` defines weakening per comparison:
- a lower bound may not drop and an upper bound may not rise;
- a removed rule or required step is a weakening;
- an output whose type changed is a weakening.

A candidate may change WHERE a step reads its answer. It may never change what counts as a pass.

### Evaluation: the same frozen inputs, run beside run, through the doors that exist

`EVALUATORS` says who carries each kind.

**Playbook: the engine carries it.** Each evaluation is a task of its own, with provider `improvement`, door
`improvement`, and a receipt linking it to the campaign.
- Its inputs are frozen when it starts: the objectives of the tasks whose runs showed the problem, kept by digest.
- It runs the BASELINE pin and the CANDIDATE pin `minRuns` times each, run *n* of one beside run *n* of the other.
- Each run goes through the coordinator's own `skillRun`, pinned by `dispatch.pin`. So every call passes the same
  resolver, the MCP broker narrowed to reading only or the capability pipeline with no case, the same approvals and the
  same budgets as ordinary work.
- An evaluation is INVALID when the candidate's digest moved, when the baseline is no longer the version that runs, or
  when its inputs moved.
- An evaluation a gone process left open is closed as interrupted and goes on with the runs it never recorded
  (`reconcile`). No run is asked twice.

**Role: the host carries it.** The host runs one goal as a Satellite mission under each version and links each mission
(`improve link`). The runs are read back off the missions. Missions that pursued different goals compare nothing.

**Judging one evaluation.** `COMPARE` decides, in order:

| Condition | Verdict |
|---|---|
| a blocked run | BLOCKED, nothing compared |
| unequal inputs | INCONCLUSIVE |
| a step the candidate newly failed where the baseline met it | WORSE, whatever else improved |
| a baseline that met every run | INCONCLUSIVE: the failure did not reproduce |
| more runs met than the baseline | BETTER |
| fewer runs met | WORSE |
| otherwise | EQUIVALENT |

Cost is measured beside the verdict and never buys one. Calls, retries and time come as deltas, and every ratio carries
its numerator and denominator. Tokens, cost and handoffs are `UNKNOWN`, with the reason none of them is observable, and
are never estimated.

**Isolation.** Both evaluators prove `gated` isolation: owner gates bound every effect. A person who requires `sandbox`
isolation blocks every evaluation with `ISOLATION_UNPROVEN` rather than running one unproven.

### Promotion: twelve gates, then the owner's own door

`PROMOTION_GATES` (`gates.mjs`) is ordered. The first gate that fails decides what happens instead, through its `onFail`
(reject, supersede, wait, block, await, stale):

1. `CANDIDATE_INTACT`
2. `CAPABILITIES_PROVIDED`
3. `PARENT_CURRENT`
4. `EVALUATION_COMPLETE`
5. `EVIDENCE_INDEPENDENT`
6. `REQUIRED_CHECKS`
7. `NO_CRITICAL_REGRESSION`
8. `NO_NEW_PERMISSIONS`
9. `ORACLE_UNCHANGED`
10. `NOT_WITHHELD`
11. `POLICY_ALLOWS`
12. `REVISION_CURRENT`

A person's door passes the policy gate and no other.

**The selection door.** Which version runs for new work changes only through the owner's version-selection door:
`selectVersion` in the skill factory, or `selectDefinition` in Satellite's registry. Both are held to `SELECT_RULES`:
- the door is `improvement` or `control`;
- the door `improvement` needs `improvement.promote`;
- a person's disable, retire, archive or revocation always wins;
- the caller must name the version it read (`expect`), or the move is refused `STALE_REVISION`;
- a quarantined or archived target is never chosen.

**What a promotion keeps.** The version it replaced is kept whole. A pin a task already holds keeps reading exactly that
version, because nothing is ever modified in place.

**Who promotes.** With `improvement.promote` on (the default), the engine promotes through the door `improvement`. With
it off, a qualified candidate waits in AWAITING_AUTHORITY until a person promotes it in Orbit Control. No terminal
command promotes, reverts or rejects.

**After a crash.** The intent is recorded before the owner's door is called, and the result after it. A crash between the
two is read back from the owner and never re-sent. A promotion another door already made is adopted, never made twice.

### Monitoring and rollback

After a promotion, `MONITOR` reads ordinary work's runs of the chosen version, exactly as detection reads them:

| Row | Condition |
|---|---|
| REGRESSED | the definition's own failure is back in `minSessions` independent sessions |
| INSUFFICIENT | too few runs or sessions to say anything |
| CONFOUNDED | most runs were stopped by the environment, which is never a regression |
| STABLE | the version held in `minSessions` independent sessions |

- **On REGRESSED.** The campaign selects the replaced version again through the same door, and the candidate's digest is
  suppressed so the same candidate is never evaluated again for that parent.
- **When a person has withheld the playbook.** If a person disabled it meanwhile, nothing moves. The campaign is BLOCKED
  until the person moves it back, and a person's decision is never undone automatically.
- **Against see-sawing.** A cooldown keeps a subject from being picked up again right after a campaign ends, and
  `maxCandidatesPerSubject` bounds how many candidates a subject may have.

### Learning

An ended campaign hands learn ONE finding (`findingOf`):
- an improvement is supported by the sessions of its BETTER evaluations;
- it is contradicted by the sessions of WORSE or EQUIVALENT evaluations and of a later regression.

Learn's own ladder keeps it only from two independent sessions with nothing against it. A later regression demotes it.

### Settings, a person's alone

`improvement.*` lives in the automation settings. It is written only through Control's door, naming the revision read,
and narrowed machine → project:

| Field | Default | Narrowing |
|---|---|---|
| `detect`, `generate`, `evaluate`, `promote` | true | and |
| `minSessions` (2..10) | 2 | the stricter, so max |
| `minRuns` (2..20) | 3 | max |
| `maxCandidatesPerSubject` (1..10) | 2 | min |
| `maxEvaluationAttempts` (1..10) | 3 | min |
| `maxEvaluationMinutes` (1..1440) | 30 | min |
| `maxConcurrentEvaluations` (1..10) | 1 | min |
| `isolation` (`gated`, `sandbox`) | `gated` | order |
| `cooldownHours` (1..720) | 24 | max |
| `retentionDays` (7..365) | 90 | min |

What the limits bound:
- `maxEvaluationMinutes` bounds the time one step spends evaluating, and the next step resumes where it stopped.
- `maxEvaluationAttempts` ends a campaign whose evaluations never agree.
- `maxConcurrentEvaluations` makes a further evaluation wait.
- `retentionDays` drops an opportunity nobody saw again, and bounds the window a subject's candidates are counted in.
  A campaign's journal is never pruned.

A switch a person turns off is recorded as the reason a campaign waits, and nothing works around it.

### What it can never do

A campaign is not authority:
- No step crosses a Protected Boundary. Choosing a version is an AUTO action of an owner's own door, and
  `authorize()` gives the same verdict whatever run, campaign or attribution word an action names
  (`test/improvement-boundary.test.mjs`).
- No step writes the developer's checkout, pushes, deploys, migrates, enables a disabled MCP provider, or widens a
  playbook's tools or a role's profile.
- No step changes an automation policy, overrides a person's revocation, or edits a receipt to get a better score.
- No prompt, tool argument, answer or secret is kept. A journal holds ids, pins, digests, words and scrubbed sentences
  of at most 240 characters.

### Live, Control and the trail

**Live.** `IMPROVEMENT_SOURCE` is handed to the one feed by the composition roots. A campaign an evaluation task names
reaches a viewer as one `improvement-view` frame, sent whole and replaced, plus its newest lines as named events. The
full-screen viewer and the pane draw an IMPROVE section, and `live status --json` lists campaigns.

**Control.** Advanced → Improvement shows:
- the overview, with the nine metrics, each with its numerator and denominator or "not available";
- the opportunities, with why each is or is not eligible;
- each campaign: why it started, the successor, every evaluation side by side, every gate and its history and events;
- the settings.

A person's promote, revert and reject name the revision read, and a moved revision answers 409.

**The trail.** It gains `improvement.detected`, `improvement.decided`, `improvement.promoted` and
`improvement.rolled_back`, which carry ids and words only.

## Consequences

**Contracts.** These additive contract changes make the release 0.3.0:
- a new CLI, `cli/improve.mjs`;
- new settings fields;
- a receipt domain and a task door named `improvement`;
- a skill-factory status `candidate` and two phases;
- a Satellite selection record;
- new Live frames;
- new Control routes;
- a trail event family;
- a skill, `orbit-improve`, with its switch `skill_improve`.

**Owner extensions.** The skill factory gains a candidates room and one version-selection door. Satellite's registry
gains `registry/selected/<id>.json`. The registry still offers the latest intact, unrevoked version when no selection
names one, a selection outranks only versions published before it, and a revoked selection is void.

**Integration.** The native host acceptance records go stale until they are recorded again on this source.

## Limitations

- **Satellite subjects.** Only roles are Satellite subjects. An agent template is derived from its role, and a workflow
  template is proposed through a mission's own action.
- **Followed playbooks.** A followed (not declared) playbook keeps no run records, so it is never a subject: nothing
  could evaluate it on evidence.
- **Who writes a playbook's successor.** The host writes it. The engine does not call a model, so a GENERATING campaign
  waits for a session to write the text.
- **How a role is evaluated.** A role's evaluation depends on the host running and linking two missions per session. The
  engine prepares nothing more for it.
- **Cost.** Tokens and money are unknown, never estimated, because no owner records them.
- **Isolation.** The only isolation proven is `gated`. A person who requires `sandbox` isolation blocks evaluations until
  an evaluator proves one.
- **What independence trusts.** The machine's name and the clock. An agent that fakes its process's clock, or runs on a
  second machine, can still produce a second session. A person who wants a person's word on every promotion turns
  `improvement.promote` off, and a qualified candidate then waits in Orbit Control. Two people on one machine on one
  day count as one session, which errs toward asking again.
- **What protects a campaign's journal.** It is protected by its door, like every journal in the machine store, and not
  by a signature. The gates judge the runs each evaluation read off its owner when it ran. A line written into the file
  by hand is outside what any Orbit journal can tell apart from its own. A playbook or role changed by hand is different:
  it fails its digest and is never chosen.
- **How hard a host pursues a role's baseline.** The host runs both missions of a role's evaluation. Their outcomes are
  read off the missions' own conclusions and two independent sessions are needed, but the engine cannot make the host
  pursue the baseline as hard as the candidate.
