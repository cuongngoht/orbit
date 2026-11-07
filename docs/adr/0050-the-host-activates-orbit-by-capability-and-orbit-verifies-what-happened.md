# ADR 0050 — The host activates Orbit by capability; Orbit suggests, bounds and verifies what happened

## Status

**Accepted (0.5.0; backlog B21, B22 and B23), 2026-11-07,** once every milestone had landed on `release/0.5.0` with its
tests: M0's measurement ([0.5.0-activation-baseline.md](../audit/0.5.0-activation-baseline.md)); M1 and M2 with B5 --
trigger-first descriptions, `via`, the strategy table, router v3 and its corpus; M3 -- the bounded lifecycle and the
activation fold; M4 -- the `activation` benchmark kind and its suite, below; B21's relevance, verified references,
sufficiency and the `constraint` requirement kind; and B23's three arms in the benchmark harness. It was proposed on
2026-11-05, before any of them, and nothing of it changed runtime behaviour until its milestone landed. The design
behind it, with the full inventory and the per-component review, is
[docs/backlog/0.5.0-proactive-orchestration.md](../backlog/0.5.0-proactive-orchestration.md). The proof is
[docs/backlog/0.5.0-activation-benchmark.md](../backlog/0.5.0-activation-benchmark.md).

It builds on:

- ADR 0017: a coordinator dispatches to owners and proves nothing itself.
- ADR 0022: a plan is a graph revised on evidence.
- ADR 0023 (`0023-orbit-goal-domain-and-spec-persistence.md`): the goal domain, and the persistence of its
  specification.
- ADR 0030: a declared playbook runs through the doors that exist.
- ADR 0041: Satellite.
- ADR 0042: autonomous by default, with protected boundaries.
- ADR 0044: run identity and attribution.
- ADRs 0046 to 0049: the Docker benchmark and the release that rests on it.

It changes:

- what the prompt router answers: RouteDecision v3, with a strategy word;
- one column of `catalog/components.json` (`via`);
- the lifecycle: one session-start line, one line after an Agent returns or an Orbit command fails, and a bounded Stop
  hold;
- the context package: relevance and sufficiency;
- the goal's requirement kinds (`constraint`);
- the benchmark: a new case kind, `activation`.

Every contract change is an addition, so it belongs in a minor release.

**2026-11-05 — M4 landed: the benchmark kind `activation`.** The case kind, its seed round, its judge, its scripted
controls, the activation metrics and the `orbit-activation` suite (the activation cases and the grounding cases, in
English and Vietnamese, on three arms) are in `benchmark/`. The suite's controls are required by the release policy;
its model-carried rows are recorded, never required, until the owner promotes them. Its cases and their truths are the
harness's own: no plugin a host is handed carries them.

## Context

1. **0.4.0 proves Orbit only when the host is told what to use.** Every benchmark prompt names the skill and its
   commands (`benchmark/lib/source/brief.mjs`, `benchmark/lib/qa/round.mjs`). Nothing shows that Claude Code picks the
   right Orbit capability unprompted, or leaves Orbit alone when it does not help.
2. **The host picks from descriptions, and Orbit's overflow.**
   - Claude Code chooses a skill from its `description` and a subagent from its own.
   - The skills listing has a budget: 1 % of the context window, at most 1,536 characters per entry. When the listing
     overflows, the least-used skills lose their descriptions.
   - Orbit's 25 skill descriptions total 17,924 characters, with the triggers last.
   - This session's listing shows `orbit:satellite` with no description.
   - The 20 agent descriptions add 12,180 characters to every session.
3. **No hook can make the model call a tool.** A plugin can add context beside a prompt or after a tool, refuse a call,
   and keep a turn going once with a reason. It cannot invoke a skill or dispatch an agent. Activation is the model's
   act, or it does not happen.
4. **The 0.4.0 router suggests noisily.**
   - It uses 15 English keyword intents, and one cue is enough to show a suggestion.
   - It adds an "Orbit coordinates a task by default" line to every prompt it routes.
   - Host-generated notifications reach it as prompts. In the session that drafted this ADR, three background-task
     notifications were routed as `investigation (high confidence)`, and the design request itself as `qa`, with six
     wrong suggestions.
5. **Nothing decides how much Orbit a request needs.**
   - orbit-help's first route (`src/help/vocab.mjs`) coordinates every task a workflow fits.
   - Satellite is reached only by name.
   - No module chooses between one specialist, a coordinated workflow and a mission.
   - Five skills (`orbit`, `orbit-reverse-engineer`, `orbit-security-audit`, `orbit-improve`, `satellite`) are
     unreachable by the router.
   - Two parent-only agents can be suggested straight from a prompt.
6. **The parts that answer the question already exist:**
   - one Effective Resource Registry;
   - a deterministic resolver;
   - a session trail that records every routing decision and every Skill and Agent call without the prompt's text;
   - a per-turn `followed` fold;
   - three engines that compose owners (automation, goal, Satellite);
   - owner-verified evidence throughout.

## Decision

### The host decides; Orbit suggests, bounds and verifies

Orbit never tries to invoke anything on the host's behalf. It has two levers on selection:

- the metadata the model reads;
- the context a hook adds beside a prompt.

It has three on follow-through:

- one line after an `orbit:*` agent returns, or after an Orbit command fails;
- a bounded hold at Stop for this session's own running workflow;
- the engines' own `context` and `step` answers.

Everything else is Orbit observing and verifying what the host did. Five links are kept apart, each from its own
source:

1. **Suggested.** The router named it (`prompt.submitted`).
2. **Model-selected.** A Skill or Agent tool use named it (`skill.invoked`, `agent.invoked`; HOST_OBSERVED).
3. **Host-dispatched.** The call passed the component switch, and the agent launched (`agent.launched`,
   `agent.started`; HOST_OBSERVED).
4. **Orbit-executed.** An owner record was created or moved for this session (RUNTIME_BOUND).
5. **Owner-verified.** The owner's own word: a task COMPLETED by its completion rows, an investigation's outcome, a
   frozen snapshot, an acceptance criterion verified, a mission VERIFIED, or the work view's `verified`.

Selection is not execution, and execution is not verification. Only the fifth link is ever called verified.

### One registry, one new catalog column

Discovery stays the Effective Resource Registry, and its two readers stay the router and Orbit Control. A component
that is installed, generated, enabled or disabled shows on the next read, through its own provider, with no code per
component.

`catalog/components.json` gains one optional column on agent rows: `via`. It lists the shipped skills whose playbook
dispatches that agent. With no `via`, the main session may dispatch the agent directly.

| Proposed | Agents |
|---|---|
| Direct | `orbit-engineering-agent`, `orbit-qa-agent`, `orbit-failure-analyst`, `orbit-dsl-doctor`, `orbit-engineering-observer` |
| Via a parent | the other fifteen: the architecture scanner, the reverse-engineering agent, the security auditor, the map healer and recorder, the QA case writer, the five requirement roundtable agents, and the four Satellite agents |

Three things read the column:

- **The resolver.** A `via` agent is selectable only as a transitive provider pulled in by one of its parents.
- **The formatter.** A parent's line names the agents it dispatches.
- **A catalog test.** Every `via` names a skill whose SKILL.md names the agent, and every agent a SKILL.md names is
  direct or lists that skill.

No other column is added. `requiresSignal` already means "only when named", and what an agent may touch or which record
proves its work already has an owner: its `tools:` allowlist, the step kinds' `domains`, and the work view.

Satellite's roles, templates and workflows stay mission data, carried by the four `satellite-*` agents. They never
become registry members.

### Descriptions are the activation contract

- **Trigger-first.** Every skill and agent description says when to use it in its first sentence, and points to the
  component it is most often confused with.
- **Within budget.** A skill description is at most 300 characters, and the 25 together at most 7,500; the drafted set
  is 6,564. Agent descriptions total 4,112, down from 12,180.
- **The prose moves into the body.** That is where the playbook already lives.
- **Agents say how they are dispatched.** A direct agent says "Use proactively when …". A `via` agent opens with
  "Only from the X skill".
- **A test holds it:** the lengths, and that each first sentence carries a cue or signal that reaches the component.
- **Every component stays model-invocable.** None gets `disable-model-invocation`, because each is eligible somewhere.
  Over-use is held back by the router and by the benchmark's negative cases, not by hiding a skill from the host.

### How much Orbit: one word, from one table

A new leaf, `src/routing/strategy.mjs`, holds one ordered table. The first matching row wins and the last row always
matches. Its facts are handed in by the composition root: the classification, the RouteDecision, automation's own
`workflowOf` answer as data, the host row, this checkout's open work, and the automation settings. It answers one word,
with its row and a reason:

| Word | When (in table order) |
|---|---|
| **NONE** | A host envelope; an opt-out cue ("without orbit", "không dùng orbit"); intent `general`; or nothing selected but implicit providers and builtins |
| **RESUME** | An open governed work of this checkout whose ref the prompt names, or this session's open work and a continue cue |
| **SATELLITE** | `mission.orchestration` is selected, which means the person asked for a mission or a multi-agent run. It is never inferred from words that sound complex. |
| **COORDINATED** | A workflow fits, and either the prompt is a specification (an acceptance-criteria cue, or at least 3 list items: `how: goal`), or its matched intents span a change and a work item or a verification owner (`how: automation`) |
| **DIRECT** | Anything is selected: the one specialist skill, or the one directly dispatchable agent. For a trivial edit, the host's own tools are an accepted answer. |

**orbit-help keeps its contract**, as the coordinator's entry and the navigator. A person who invokes it with a task
still gets a coordinated workflow. What changes is that the router stops sending single-owner requests to it, and its
"coordinates by default" line appears only for COORDINATED. `orbit-engineer` is selected for "autonomously" or "until
verified", never for every change.

### The router says less, and says it right

RouteDecision v3 adds `strategy`, `activation` (`path`, `id`, `how`, `invoke`) and `synthetic` to v2.

- NONE adds no text at all.
- A low-confidence suggestion is shown only when a signal-gated provider's own signal hit.
- Cues in the first 2,000 characters outrank a pasted tail.
- Vietnamese cues, a `security` intent, and refinements that reach the five unreachable skills are rows of data.
- The Claude adapter marks a host-generated envelope as `synthetic`, and the router answers nothing for it.
- A routing corpus of at least 100 English and 60 Vietnamese prompts holds intent, strategy and top selection.
- The hook stays fail-open, five seconds, at most 2 KB, and keeps no prompt text. The trail gains the strategy word,
  the activation path and id, and the synthetic flag: table words and ids only.

### Intent is the goal analysis; context carries its evidence

**No new intent contract.** The goal domain already reads a specification into:

- requirements of kind `explicit · derived · assumption · unknown · conflict · decision`, each citing the persisted
  spec by line;
- acceptance criteria with their verification;
- unknowns and conflicts;
- a typed intent.

`constraint` joins those kinds. Which owner reads a request depends on what the request is:

| The request | Who reads it |
|---|---|
| A specification | The goal domain |
| One objective needing several owners | Automation, with the host's declared routing intent, never classified again from keywords |
| A work item | The requirements domain, which is its authority |

A guess never becomes an accepted requirement. A hook never stores a prompt's text; the original request is kept only
where an owner already keeps one, which is the goal spec.

**The context package gains `relevant` and `sufficiency`.**

- **Candidates** come from the owners that hold evidence: architecture facts and their scopes, the system graph,
  intelligence integrations, knowledge claims, engineering recall, the working set, `impact.mjs` reach and
  `obligations.mjs` checks.
- **References the host proposes** are kept only if the tracked tree holds them. Anything else is refused by name, so
  nothing invented is ever listed.
- **Each item** carries a class (`direct · dependency · downstream · verification · unknown`), its evidence, its
  freshness from its own scope fingerprint, and who found it. At most 40 items.
- **Sufficiency** is `ENOUGH`, `DISCOVER` (targeted reads only) or `ASK` (one question through the existing question
  flow, answered only by a person), chosen by an ordered table.
- **Matching** is lexical, splitting identifiers, plus the host's verified proposals. There are no embeddings and no
  dependency. File-level import graphs belong to language packs, never to `src/`.

### The lifecycle holds a governed workflow to its next step, boundedly

**SessionStart** adds one line of at most 300 bytes: what Orbit can do here and the project's STATUS word. On `resume`
and `compact`, it also says which of this session's works is open and its next step.

**PostToolUse on an `orbit:*` Agent** adds one line for the parent: which owner record settles the agent's work, and
its state. The agent's words are a report.

**PostToolUseFailure on an Orbit command** under a governed task adds its owner's recovery row: read back with
`reconcile`, never resend.

**Stop** holds the turn (`decision: "block"`) with the next ready step of this session's own workflow or goal. It holds
only when every one of these is true:

1. `trigger.holdOnStop` is on: an automation setting, default on, changed only through Control's door.
2. `stop_hook_active` is false.
3. The trail can count this prompt's holds, and there were fewer than two.
4. The workflow is running, has ready steps and has no question waiting for a person.
5. The workflow is not PAUSED, CANCELLED, WAITING_APPROVAL or BLOCKED.
6. This turn ran one of the workflow's commands.
7. The prompt carried no halt cue.

Each hold is written as `turn.held`.

No hook ever creates work from conversation, restarts a settled task, resends an unsettled write, overrides a person's
stop, or grants anything. A subagent's last message is never read (ADR 0044).

### Composition reuses the three engines

The model decomposes; the engines validate dependencies, permissions, revisions and evidence.

| Strategy | Who carries it |
|---|---|
| DIRECT | The host, with the one skill or agent |
| COORDINATED | `automation.mjs start`, or `orbit.mjs goal start` for a specification |
| SATELLITE | `satellite mission start` |
| RESUME | The owner's own `resume` |

One request keeps one work identity, through `track` and the starts that join it. No new workflow engine, mission
engine or registry is added.

### The activation chain is a fold over what is already recorded

`src/trace/projections/activation.mjs` is a pure fold over the trail, with a work-view reader handed in. It joins the
five links for each turn and each work. Its verdict extends the `followed` fold with `over-delegated`: agents the
strategy did not account for, or one agent type dispatched twice for one work outside a mission.

`trace.mjs activation` and Control read it, and it stores nothing.

### What is measured, and how

A benchmark case kind `activation` runs natural-language prompts, in English and Vietnamese and never naming a skill,
through the real Claude Code CLI in the existing runner.

- **Arms.** Each case runs in three arms: no plugin, the plugin at `v0.4.0`, and the release. Same model, frozen
  inputs and limits.
- **Evidence.** The controller captures the host's stream outside the container. Selection is judged from its Skill and
  Agent tool uses, cross-checked against the trail; a disagreement fails as `INSUFFICIENT_EVIDENCE`.
- **Outcome.** Hidden checks and owners' records decide it, never Orbit's internal state alone.
- **Controls.** Every case carries idle, over-eager, forging, half and escalating scripted hosts, which must fail, and
  a reference host, which must pass.
- **Release policy.** The suite's controls are held like every suite's. Its model-carried rows start recorded, and are
  promoted by the backlog's rule.
- **Targets.** KPI targets are proposals, never gates until the owner promotes them.

Model-carried runs happen only in Claude Code cloud sessions (B8). The 0.4.0 gates are unchanged.

### Hosts

Claude Code gets everything above. The contracts (RouteDecision v3, the strategy table, the activation fold) are
host-neutral, and a host's limit is a row in `docs/hosts.md`, never a branch in `src/`.

| Host | What it gets |
|---|---|
| Codex | The router and the strategy; DIRECT and COORDINATED run serially in the session; no Stop hold until verified |
| Antigravity CLI | No prompt event, so explicit routing (`resources.mjs route --task-stdin`) and `/orbit-help`'s loop |
| Grok Build | It drops a hook's prompt output, so the trail only |

### Security and failure modes

| Risk | What holds |
|---|---|
| A prompt's text leaks | The hook keeps only a salted fingerprint, a length, shape counts and table words; `synthetic` is a flag. |
| Pasted content steers routing | Cues in the head outrank the tail. A suggestion grants nothing, and protected boundaries, approvals and component switches are unchanged. |
| A hold loops, or overrides a person | `stop_hook_active`; at most two per prompt; only when the trail can count them; never for a paused, cancelled, waiting or blocked workflow; never without a workflow command in the turn; never with a halt cue; a person's setting. |
| A hook fails or is slow | Every hook exits 0. A hold or a line that cannot read its state says nothing. |
| A subagent exceeds its role | `via` agents only from parents; the `tools:` allowlist is the profile; component switches still refuse; M0 checks whether `Bash(<pattern>)` can narrow read-only agents. |
| Selection evidence is forged | Selection metrics are behaviour, cross-checked between the controller's stream and the trail, and never a PASS. A PASS comes from the verifier and the owners. |
| The wrong strategy | DIRECT where coordination was needed leaves the coordinator one prompt away. COORDINATED where it was not costs overhead, which B23 measures. A wrong NONE is a miss the activation recall counts. |
| Context cost | Router text stays at most 2 KB, the new session line at most 300 bytes, and descriptions within budget. |

### Tradeoffs

- **A keyword table, not a model, in the hook.** It is deterministic, free, auditable and fast on every prompt. It
  understands less than a model, which is why the model still decides, and why the corpus and the benchmark measure the
  table.
- **Short descriptions.** They fit the listing and trigger better. They say less, so the body carries the contract.
- **A Stop hold.** It helps a governed workflow reach its evidence, at the risk of continuing when a person wanted a
  pause. Hence the conditions, the halt cue and the setting.
- **No inferred Satellite.** It may miss parallelism, but it never spends a mission on a prompt that only sounds
  complex.

### Rejected

- **A model call in the prompt hook.** It is the hot path, it costs money, its answers are not deterministic, and it
  would be a second reasoner beside the host.
- **A hook that "auto-invokes" a skill.** The host does not allow it, and Orbit's principle is that the host decides.
- **A new orchestrator for multi-skill requests.** Automation, goals and Satellite already compose owners.
- **A request-reading contract of its own.** The goal analysis already distinguishes what B21 asks for.
- **A legacy-router switch for the baseline arm.** The baseline is the previous release, so no old behaviour is kept
  alive in the code.
- **Marking skills explicit-only to save budget.** Every skill is eligible somewhere; the budget is met by shorter
  descriptions.
- **Exposing parent-only agents as skills.** They need their parent's preceding step.

## Consequences

- **Claude Code can use Orbit unprompted, and it is measured.** The activation suite says how often Claude picks the
  right Orbit capability, how often it stays out, and what Orbit adds and costs against no Orbit and against 0.4.0.
- **Every hook gets quieter.** NONE is silent. The routing context names one strategy and its path, and the
  "coordinates by default" line appears only when coordination fits.
- **Parent-only agents cannot be suggested on their own**, and the catalog test stops a skill from naming an agent that
  does not exist.
- **Context grows evidence.** A package names what is relevant, with the evidence and freshness of each item, and says
  whether there is enough to proceed. Nothing invented is listed.
- **One new synchronous Stop hook runs on every turn end.** It returns at once unless this session holds a running
  governed workflow. Its cost is measured with the other hooks.
- **Contracts grow additively:** RouteDecision v3, the `via` column, an `engineering-memory` builtin, the `turn.held`
  event, the `trigger.holdOnStop` setting, the `constraint` requirement kind, the context sections, and the benchmark
  kind. Each needs its row in `docs/agents/extend.md` and its test when it lands.
- **A release that carries the activation suite costs more model budget.** A recorded pass is an estimated $100 to
  $200, and a reliability pass $300 to $600; M0 replaces the estimates with measurements. Its controls cost nothing per
  run.
