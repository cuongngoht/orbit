# Changelog

## 0.5.0

A minor release: Claude Code now uses Orbit by itself, and the benchmark measures how often Orbit's paths work, not only
whether each passed once. Every skill and agent says first when to use it, within the host's listing budget; the prompt
router says in one line how much Orbit a prompt needs, or nothing at all; the context package says what a task touches
and whether that is enough; and a session follows its own work through to its owner's record (ADR 0050, now accepted).
Autonomous QA holds a design, before a draft exists, to what an adapter reads and to what a correct application can
satisfy (ADR 0052). Six new benchmark suites ask what 0.4.0 could not: whether the host uses Orbit by itself
(`orbit-activation`), whether memory makes a second session better (`orbit-sessions`), one request taken through
`/orbit-help` (`orbit-workflow`), a Satellite mission with a real host (`orbit-missions`), tool calls that fail on
purpose (`orbit-tools`) and an application nobody tuned Orbit against (`orbit-heldout`). Their controls are required and
their model-carried rows are recorded, never required (ADR 0051, 0053 to 0056): the catalog is 79 cases of fifteen
suites, and 30 of the 46 rows a cycle the real Claude Code carries are recorded. Repeats, arms and a reliability report
turn single PASSes into rates, and every benchmark run is Sonnet 5.5 at medium effort.

All contract changes are additive: `cli/context.mjs --with-refs` and the package's `relevant` and `sufficiency`;
`cli/trace.mjs activation`; a hook entry for Stop and for a returned agent (`cli/follow-hook.mjs`) and its automation
setting `trigger.holdOnStop`; RouteDecision v3; a goal's `constraint` kind and the counts `goal analyze` answers; more
of what autonomous QA's `context`, `generate` and `step` say, a verification outcome (`INTERRUPTED`) among it; and an
optional `request` table per operation in `orbit.adapter/v1`, under the same apiVersion.

**Claude Code uses Orbit by itself (ADR 0050, accepted; backlog B21, and B22 with B5 inside it).** Every 0.4.0 benchmark
prompt named its skill, and the router's suggestions misfired all through the 0.4.0 release session. The host now picks
Orbit from what a request asks, Orbit says how much of it a prompt needs and follows the session's own work through, and
what happened is read back from the owners' records. What the host lists, and which of its mechanisms hold, were
measured first (`docs/audit/0.5.0-activation-baseline.md`).

- **Skills and agents say first when to use them, within the listing's budget.** Claude Code picks a skill from its
  description, and Orbit's 25 skill descriptions were 17,924 characters with their triggers last: the listing drops
  descriptions when it overflows, and `orbit:satellite` was listed with none. Every `SKILL.md` and `agents/*.md`
  description now says when to use it in its first sentence and names the component it is most often confused with --
  6,777 characters for the 25 skills (none above 300) and 4,128 for the 20 agents (was 12,180). A direct agent says "Use
  proactively"; one only its parent dispatches opens "Only from". What a description said moved into its body, so
  nothing its contract said is lost. Three agent names a playbook gave wrong or by pattern are spelled out
  (orbit-architecture delegated to an `orbit-context-scanner` that does not exist), and orbit-architecture and
  orbit-reverse-engineer, which record facts, say "Never edits source" where they said "Reads only".
  `test/activation-catalog.test.mjs` holds the budget, and that each first sentence carries a word that reaches its
  component.
- **An agent its parent dispatches is reached only through that parent, and every component is reachable.**
  `catalog/components.json` agent rows gain `via`: the skills whose playbook dispatches the agent. Five agents stay
  direct (engineering, QA, the failure analyst, the DSL doctor, the engineering observer); the other fifteen name their
  parents, and the resolver offers one only for a requirement its parent pulled in -- `orbit-map-healer` is never
  suggested from "the locator drifted". A `security` intent (sixteen now) and new refinements reach what no intent asked
  for, and the engine's own `engineering-memory` builtin answers `engineering.context` through `engineering.mjs recall`.
  A test asks the real resolver that every skill and direct agent is selected for some prompt made of the table's own
  words, and that no `via` agent ever is.
- **The prompt router says how much Orbit a prompt needs, in one line or not at all (router v3).** One table,
  `src/routing/strategy.mjs` (eleven ordered rows, the last always matching), answers NONE, DIRECT, COORDINATED,
  SATELLITE or RESUME. NONE adds no text: a prompt the person opened with a slash command (they already chose what
  runs), a host's own notification (Claude Code hands a background task's `<task-notification>` to the hook as a
  prompt), an opt-out, a greeting, a status question that asks for nothing else, or nothing chosen. Anything else opens
  with ONE line -- the word, why, and the skill or agent to invoke or the one command -- and the coordination advice
  follows COORDINATED alone. COORDINATED is a change asked for that several owners take in turn, or a specification for
  `/orbit`'s goal: a question that only names code ("is the orders endpoint protected?") asks for no change. SATELLITE
  is only ever Satellite's own words, and RESUME an open work some owner governs, named by the prompt or continued,
  through that owner's own read -- a work tracked under the requirement a reference was kept for included ("continue
  PBI-482"), found by a lookup that writes nothing. A cue counts only in the first 2,000 characters, so a pasted log
  decides nothing; a one-cue intent is said only when the word is its component's own; Vietnamese cues sit beside the
  English ones in every intent, as data. `resources.mjs route`, Antigravity's explicit routing, answers RouteDecision v3
  over the facts the hook binds, while `route()` stays the planner's v2 that Orbit Control's Router Inspector reads. The
  trail's `prompt.submitted` keeps the strategy's word and row, the activation's path and id, `synthetic` and the
  prompt's marks.
- **A corpus holds the router to what a careful engineer wants (backlog B5).** `test/fixtures/routing/corpus.jsonl` has
  224 prompts, 146 English and 78 Vietnamese -- greetings, status questions ("tới đâu rồi"), chit-chat, read-only
  questions, code changes, QA, reports, releases, runtime, requirements, opt-outs, continues, slash commands, host
  notifications and pasted logs -- each with the intent, the strategy and what it names, written before the router ran
  over it and never changed to match it. `test/routing-corpus.test.mjs` holds intent and strategy to at least 90% in
  each language (91.8% and 93.6% on intent, 94.5% and 98.7% on strategy), what the strategy names to 85%, every
  greeting, chit-chat, status question, notification, opt-out and slash command to no text, and a request read with high
  confidence to never being silenced. What it still misses is kept as the corpus says it, and named in the test's
  diagnostics.
- **A session follows its own work through, a line at a time.** At its start, a checkout the machine knows, with its
  test data in place, gets one capability line of at most 300 bytes -- each family's usable count, what a person
  switched off, the project's STATUS word -- and a resumed or compacted session gets its open work and next step. After
  one of Orbit's agents (`orbit:*`) returns, one line names the owner record that settles its work and where it stands;
  the agent's message and transcript are never read. After an Orbit command fails under the session's governed work, the
  owner's recovery row follows the diagnosis: what did not settle is read back with `reconcile`, never sent again. A
  repository with no ui-tests still gets nothing.
- **A bounded Stop hold keeps this session's own workflow going, in Claude Code.** At Stop, `cli/follow-hook.mjs` holds
  the turn with the ready step of the session's own running coordinated workflow or goal and its one command, or asks
  the model to say in one sentence why it stops -- only when every row of its table allows it: a host that can hold
  (Claude Code alone; Codex and Grok Build carry none until their Stop blocking is verified, and Antigravity's Stop is a
  checkpoint), a turn not just held, fewer than two holds for this prompt, no halt in the prompt, a workflow command in
  the turn, a trail that can count the holds, the work this session's own and running with a step ready, and the new
  automation setting `trigger.holdOnStop` on (on by default, changed only through Orbit Control's door). Its one write
  is the trail's `turn.held`; it starts nothing and grants nothing.
- **`trace.mjs activation`: how a suggestion became an outcome.** `node cli/trace.mjs activation` (with `--days`,
  `--session`, `--limit`, `--json`) folds, per turn and per work, ADR 0050's five links -- suggested, selected,
  dispatched, executed, verified -- each with its source and basis, and verified only ever from the owner's record,
  never from the trail. A turn that dispatched more of Orbit's agents than its strategy accounted for -- a `via` agent
  whose parent skill did not run, an agent no strategy named, one agent type twice for one work -- is `over-delegated`,
  and Orbit Control's Trace page carries the verdict on every turn and marks one that is. A command's documented
  operation (`goal step`) joins its trail line.
- **The context package says what a task touches, checks a host's references, and says whether that is enough (backlog
  B21).** `cli/context.mjs --for` now answers RELEVANT -- at most 40 items, the rest counted, each with its class
  (direct, dependency, downstream, verification or unknown), its evidence, its freshness against its own owner's scopes
  and who found it, from what the owners already hold: architecture, the system graph, intelligence's integrations,
  engineering's recall, knowledge's claims, the working set, impact's reach and the declared checks -- and SUFFICIENCY:
  ENOUGH, DISCOVER naming the targeted reads that can fill the gap (each an Orbit command), or ASK with the question
  already open about the task's own work or goal, never one made up. `--with-refs` reads `{ task, refs }` on stdin: a
  file is checked against the tracked listing and a symbol by one whole-word search of the index, and one the tree does
  not hold is refused by name and never listed. A package writes nothing. An engineering task's CONTEXT stage hands the
  word and the items to the host as advice, and orbit-develop, orbit-engineer and orbit-help read the word before
  choosing a scope: ENOUGH goes on, DISCOVER makes only the reads it names, ASK relays the open question and waits. A
  search that matches nothing is an empty list, and one that could not run is unknown, never the other -- in a project
  of several repositories too.
- **`constraint` joins a goal's requirement kinds, and a row sent with no kind is an assumption.** A constraint --
  something the change must not violate, such as a public API kept or no new dependency -- is a kind of its own beside
  explicit, derived, assumption, unknown, conflict and decision. `goal analyze` answers `kinds`, the count of each, and
  says it ("3 requirements (1 explicit · 1 assumption · 1 constraint)"). A row the host sent with no kind was filled in
  as `explicit`, the one kind a guess must never get; it is now read as `assumption`, keeps `kindDefaulted: true`, and
  is counted apart ("· N sent with no kind, read as assumption"). No rule that plans, verifies or completes a goal reads
  a row's kind, so no plan changes; the `/orbit` playbook asks for a kind on every row.

**Autonomous QA: a design is held, before a draft exists, to what an adapter reads and what a correct application can
satisfy (backlog B7, ADR 0052).** 0.4.0's QA rows on Sonnet missed most of their planted defects, and the first 0.5.0
pre-check ended six of seven as false alarms the clean application contradicted too. Most of it was Orbit's: designs
refused only once a run was spent on them, or accepted though no correct application could satisfy them. With the fixes
below, the seven QA rows on Sonnet 5.5 at medium effort held five at the re-verify, and all seven after the last two
(`NEVER_REDELIVERED`, below, and the leak sentinel's).

- **A second message under a business key is not a second effect, and the tests of one investigation share its
  sandbox.** A real Claude Code QA row (ORBIT-QA-006 on Opus) found its planted defect and raised two false alarms that
  the clean application contradicted too. Its `effect-once-per-key` test published a second message under the first
  one's business key and waited for that message to be `processed`; a correct system settles it in its own word -- the
  clean application recorded the duplicate it was -- and never as a second success. Its `completes-by-deadline` test
  then made the schedule reach the very period whose business key that earlier test had used, in the same sandbox, and
  waited for the period's message to be processed: the clean application settled that one as a duplicate too.
  `effect-once-per-key` now says what `crash-after-effect-before-ack` says, in its own words (`says`, one sentence
  builder for both): a second delivery or publication under the same business key is not a second effect -- observe it
  by the message alone or by its delivery attempt, and rule the obligation on its own slot, the effect count; and
  `competing-workers` says it of the same job received by a second worker. The other shapes with a duplicate control say
  nothing of the kind, each by its own statement: `idempotent-under-repeat`'s repeated request is answered at once and
  its contract may replay the first answer, `overlap-policy`'s policy may let the overlapping occurrence run, and
  `webhook-authenticity` is contract-only. Every test obligation's `template` and `protocol`'s `design` now say that the
  tests of one investigation run one after another in the same sandbox and share its state (`sandbox`): an effect, a key
  or a scheduled occurrence a test used stays there for the next, so a design uses keys, message ids and occurrences no
  earlier test used, none an accepted criterion states for another test, and none its schedule produces on its own once
  the clock reaches them, unless that is what the test observes. And a `generate` step whose design names a literal
  under a word of the backend vocabulary that says which business operation, message or period it is (`businessKey`,
  `correlationId`, `messageId`, `occurrenceId`, anywhere in a step's request) that an earlier frozen version of the same
  investigation named too says so in `result.shared` -- that version, its obligation and shape, the values and the
  words they were named under, and a sentence. It is advice: nothing is written, refused or decided by it, and every
  verdict is the one it was, because a test may observe on purpose what an earlier one left -- of the nine acceptance
  reference designs, sent in order, only the occurrence test on the stack whose clock cannot move is told so, since the
  deadline test before it triggered that period by hand. A version of the same obligation that never started left
  nothing there and is not counted; a value a binding fills (`${…}`) is no literal.
- **An adapter operation declares what its request carries, and a design is held to it where it is made (ADR 0052).**
  `orbit.adapter/v1` gains an optional `request` table per operation -- additive, under the same apiVersion: one row per
  field its helper reads (doc, type, enum, pattern, minimum, maximum, required, and `fields` for an object's own keys),
  what may be sent and never what to send; a row may also say what a match field is compared with (`means`) and what the
  match picks (`selects`). Each call step of a generated design is held to the table of the adapter selection picks: a
  field it does not name is refused, naming the fields it reads; a required one missing is named; each field is held to
  its row -- at the validate stage, as INVALID_TEST, before a draft exists. Before, a field the helper never read (a
  real host's `request.businessKey` on a state read that takes `key` or `match`) became a frozen version, refused only
  once a run was spent on it, and a test hook's `match` on a field the hooks do not answer by was dropped without a
  word. The eight shipped adapters declare a table for every operation, and their conformance receipts were recorded
  again against the real systems in Docker.
- **A design no correct application can satisfy is refused.** A new `contradiction` stage refuses what a design and its
  declarations prove, naming the step: `MATCH_PINS` -- an assertion waits for one value of a field the step's own match
  names with another (a match that picks the answer leaves only the other value; a match whose count ends the wait cuts
  short the window the criterion gives its own value); `SECOND_SETTLED` -- a second message under a business key held to
  the very settlement the first is held to, which a correct worker settles as a duplicate (ORBIT-QA-001, 002 and 003 on
  the pre-check); and `NEVER_REDELIVERED` -- a wait for a second delivery with no step that faults, stops or restarts a
  workload, where the obligation's shape declares no way a delivery comes back (ORBIT-QA-002 on the re-verify, whose
  host had gone past the advice). What a design rests on and a correct application need not do is said beside the answer
  and never refused (`result.advice`): `UNCAUSED_REDELIVERY` where the shape declares a lease, a visibility timeout or
  an ack wait, `UNCAUSED_DECISION` (a schedule's decision with nothing that moves the clock) and `SECOND_SETTLES`. No
  acceptance rule, case truth, verifier or ship policy changed, and no benchmark control, reference design or worked
  design is refused by these rules.
- **One worked design per obligation shape.** The orbit-qa playbook's `references/designs.md` carries a generic worked
  design for each of the 22 shapes the engine designs (the five contract-only shapes are named as gaps): the accepted
  slots it assumes and the `generate` design itself, on an example system whose aliases a host replaces with the ones
  `context` lists. Each is written from the shape's own row and the engine's rules, never from the acceptance designs;
  `test/qa-worked-designs.test.mjs` makes every one a draft through the real generation port and holds that none does
  what a reference design does. 0.4.0's QA rows on Sonnet spent most of their budgets on designs refused before a draft
  existed. The worked designs for occurrence-one-execution and overlap-policy read a schedule's `due` after manual
  triggers alone -- ORBIT-QA-007's host sent the first back renamed -- and now move the clock first.
- **`context.budget` says what each obligation may still spend.** The design and repair budgets per obligation (4 and 2
  by default) and the attempts a frozen version may run (3) were said only by the refusal that spent them.
  `context.budget` now shows the limits (`perObligation`, `perVersion`) and what every obligation with a design has
  spent (`used`, `spent`), and `generate` is refused exactly when context says spent.
- **A scheduler's or a worker's observation binds no observer.** `orbit.scheduler.observe` and `orbit.worker.observe`
  (and the contract-only `orbit.workflow.observe`) listed an `observer` ref, so generation made a draft naming one and
  the sandbox's binder, which binds an observer only to a channel, blocked the run. Those operations read through the
  component's own test hooks, which own no observer: an `observerRef` on them is now an unknown key at the validate
  stage.
- **An interrupted worker is its own outcome.** A worker stopped before its runner finished -- by its deadline, its
  supervisor or a runner that ended without a word -- leaves an envelope with no case digest, which the host called "ran
  another case" and ruled EXECUTION_ERROR: an outcome a host may try again, even when the run had grants and may have
  written. It is now `INTERRUPTED` (a new verification outcome: it could write nothing, so a new attempt may run) or,
  when it had grants, AMBIGUOUS (`INTERRUPTED_WRITE`: read back, never sent again). Its run is recorded BLOCKED, cause
  `interrupted`, proving nothing, and `stopped` says why; reconcile judges a late envelope the same way.
- **A fault never seen earns no PASS.** A fault control with no witness compiles no verdict of its own, so a run whose
  fault never fired could hold every step and be SATISFIED. `FAULT_NOT_SEEN` already ruled a FAILED run INCONCLUSIVE
  when no observation carried `fault:<point>`; it now rules a PASS the same way, and the playbook says to name the
  witness.
- **A key an accepted criterion states for another shape is said at the first design that names it.** 0.4.0 said it only
  when a second design named it again, after the first had already left its effect in the shared sandbox.
  `result.shared` now names it at the first, with the criterion and the shape it is stated for. Advice, like the rest of
  `shared`: nothing is refused or decided by it.
- **Two of B7's fixes are for development.** The Windows trace test that failed once under load -- three hook processes
  racing for one trail's lock -- now delivers its hosts' hooks in turn, and a new test pins what the writer promises
  instead: a line whose writer cannot take the lock is dropped, never thrown, and the next one lands. The module map's
  sandbox section named three modules that do not exist; it names the ones that do, and `test/module-map.test.mjs` holds
  it to `src/runtime/sandbox/` both ways.

**Engineering and coordinated workflows.** Two dead ends a host could not see: a plan it could not widen once its review
said the scope was too narrow, and a QA step left out of a change's plan with nothing said.

- **A plan too narrow for its change can be sent again (ORBIT-E2E-007).** A review that failed on SCOPE because the plan
  left out a path the change needs -- its own regression test -- was a dead end: after `diagnose` no `plan` was allowed,
  `implement` takes no scope, and `finish` refused every stop the host tried, so the pre-check's host started a second
  and a third engineering task. In DIAGNOSING a host may now send `plan` again naming every path the change needs (the
  earlier plan stays in the journal), then `diagnose` `retest`; the SCOPE failure's own reason gives that answer and the
  other one (take the path out, and `diagnose` `fix`). A `finish` refusal names the stops the journal supports now; a
  stop that ends the task closes a change and an attempt it left open as `abandoned`; a step that leaves a field out is
  told what the field must say (`protocol --json` prints it under `says`); and a change that recorded nothing is told to
  make one or end the task.
- **A change's QA step is never left out silently (backlog B1, ADR 0053).** A coordinated workflow that makes a change
  planned its QA step only when something the checkout declared could be started; with nothing to start, the step was
  simply not in the plan, the workflow completed, and nothing anywhere said the change was never QA'd. The `engineering`
  workflow now always plans its QA step. When its turn comes, it is the host's investigation of the running change where
  something can be started; where nothing can, the engine settles it SKIPPED with its reason -- "nothing this checkout
  declares can be started here, so there is no running change to investigate: QA was skipped, not passed" -- its
  verification row `not-verified`. The step answer, `automation.mjs context`, the workflow's ending and Orbit Live's plan
  say it (the plan shows a skipped step's reason where every other step shows why it is planned), and orbit-help tells
  its host to relay it as skipped. A host's word never skips a QA step, and an investigation's QA, which is the work
  itself, is never skipped. A skipped step still counts as done for review and completion, as the omitted one did:
  whether it should block a user-facing change stays the owner's open question. A plan an earlier release wrote with no
  QA step still gets one once discovery finds something to start.

**Memory, measured (backlog B3, ADR 0054).** `orbit-memory` proved that memory keeps its rules; nothing measured whether
it helps a host the next time, or how much a wrong memory hurts.

- **An architecture snapshot is no longer keyed to every commit by a file at the repository root.** A convention
  counting a repeated filename (`*.json`, `*.md`) named each of its files by the folder it sits in, and a file at the
  root sits in `.` -- which every reader of a scope takes for the whole tree. With a root `package.json` and four more
  JSON files anywhere, every commit moved the fact: nearly every real project's snapshot was keyed to HEAD, and each
  look after a commit was INCREMENTAL over the whole tree. A file at the root is now watched as itself. The memory cases
  found it, and ORBIT-MEM-008 plants it back as its controlled fault.
- **Memory first, measured: three source cases.** ORBIT-MEM-007 to 009 join `orbit-memory`, required like its others. A
  second `architecture ensure` on an unchanged checkout is CURRENT -- no file read, no listing, no search, at most four
  git calls, nothing written -- and costs under half the learning look's time; a commit to a note no fact is about
  leaves it CURRENT, a changed declaration is INCREMENTAL over what moved alone, and an uncommitted edit is unknown
  until committed; `knowledge claims` measures every claim's freshness in one look at the index, reading no file. Each
  probe counts the subject's git calls, names every file it reads, compares the store's bytes and times each look.
- **The sessions kind and `orbit-sessions`: does memory make a second session better, and never worse?** A sessions case
  works a QA case's application in two sessions over one checkout and the stores the first left. Session 1 learns, with
  memory on; session 2 is judged as a QA round is, on its memory arm -- `on`, or `off` with `ORBIT_LEARN=off` and
  `ORBIT_HOST_MEMORY=off` in every Orbit process (`run --memory=on|off|all`). The report adds what was offered, the
  poison, and what the second session's work came to (decisions used, designs refused, cost, minutes); `metrics` and
  `reliability` split every row by memory arm, with memory's effect beside it (`--by=memory`). ORBIT-SES-001 and 002
  compare both arms on ORBIT-QA-003's and ORBIT-QA-001's applications; ORBIT-SES-003 plants a poisoned note in the
  host's own memory. The reference control (for the poison, a host that reads it and tests anyway) PASSes; idle, cheat,
  half, `trusts-poison` and `trusts-stale` hosts FAIL. The suite's controls are required; its model-carried rows are
  recorded.

**What the reviews left open, closed.** Six findings the reviews of B3, B7 and B21 left open, each fixed with a
regression test or closed with its reason (`docs/backlog/0.5.0.md`).

- **A convention says how many of its folders it watches, and an incremental look never rewrites its count.** A
  convention fact ("1657 tracked file(s) are named *.mjs") watched the first eight of its folders by name and said
  nothing of the rest, and an incremental look ran the shape analysis over only the scopes that moved, so one folder
  holding five such files rewrote the whole tree's count with its own. It now watches the eight folders holding the most
  of exactly the files it counted (`CONVENTION_SCOPES`; a `*.test.mjs` is no longer one of `*.mjs`'s), its `unknowns`
  say how many of how many, and the shape analysis, which opens no file, is always handed the whole listing, so every
  scan counts again.
- **ENOUGH says it is a place to start.** The context package's sufficiency word can be ENOUGH on names one word of the
  task matched ("public", "api"), and only reading the code tells a meant match from an incidental one. The word is
  unchanged; its reason now ends with the caveat the playbooks already gave -- start from the items, and confirm each in
  the code before it goes in -- so any reader of the word reads it.
- **A goal's analysis never makes a citation up.** A requirement or acceptance row the host sent without a `sourceRef`
  was stamped with an invented line (`#L<i+1>`, `#L<100+i>`), which the benchmark's grounding judge then held the row to.
  A row now keeps the citation it was sent with, or none; `goal analyze` answers `uncited`, the number of rows that cite
  no line, and says it; the benchmark reads a row with no line as the reading of no line.
- **A criterion a host calls optional is still held.** A host's `mandatory: false` on an acceptance criterion is not
  carried into the goal's analysis, so the completion gate still holds that criterion. This is on purpose and is now
  said and pinned: a host's reading is not the specification, and only a new revision of the specification makes a
  criterion stop being held.
- **A store lock waits out a moment's EPERM.** On Windows, making the lock directory while another process is still
  removing it answers EPERM, and every store writer read that as a refused write, so a trail line was dropped. An EPERM
  is now a refusal only when it persists past three attempts (70 ms at most); EACCES and EROFS are refused at once, as
  before.
- **A generated test that had grants is never run again when the host could not believe its worker.** A run-version
  whose worker left no envelope, or one that failed the host's check, was EXECUTION_ERROR, and a new attempt ran even
  when the first may have written. It is now AMBIGUOUS when the version had grants to write -- held back, read back,
  never sent again, as an interrupted run already was -- unless the worker's own receipt says it never ran (rule
  `NEVER_RAN`; a worker removed before it was started now reads as `removed`, never `ended`). Reconcile names the same
  words, and a late envelope it cannot hold to a kept request is AMBIGUOUS too when the version could write.

**The benchmark measures rates, and the paths people use (backlog B1, B2, B4, B9, B22's M4 and B23).** One PASS is not a
rate, and 0.4.0 proved each autonomous capability on its own. Each new suite's controls are required and run in CI's
conformance tier; its model-carried rows are recorded.

- **One PASS is not a rate: repeats and a reliability report (backlog B2).** `run <case> --repeat=N` (with `--suite` and
  `--like` too; at most 10) makes N runs one after another, each in a room and a task of its own, named one repeat group
  in every manifest. `metrics` folds, per row -- one case and variant, on one arm, by one host basis, model and effort
  -- and per model: pass@1, pass@k (the unbiased estimate, `--k`, 3 by default), the median reported cost, cost per
  verified outcome and the median minutes, over the runs a rate may count (blocked, invalid, inconclusive, held,
  unfinished and interrupted runs are left out, each by why); `--by` takes revision, model, arm, memory and language.
  `node benchmark/run.mjs reliability [--revision= --suite= --case= --since= --k=] [--json]` folds the kept rooms in
  scope into one document (`orbit.benchmark.reliability/v1`), and writes nothing.
- **Arms: the same case with no Orbit, the previous release and this one (backlog B23).** A case may declare `arms`,
  each handing the host a different plugin and nothing else different: `none` (no plugin mounted and no `--plugin-dir`,
  so no hook fires and no trail is written; the host changes a writable copy of the target, which only the verifier
  judges), `baseline` (the plugin frozen from a named revision -- the case's `baselinePlugin`, its suite's, else
  `v0.4.0`; a repository without it refuses the run, never another one silently) and `release` (the run's own source,
  which every run was before). `run --arm=<none|baseline|release|all>` picks one; the manifest names the arm and the
  plugin's revision; `metrics --by=arm` and `orbit_overhead` give each Orbit arm's median reported cost, turns and
  tokens minus the none arm's. A goal that must be refused is verified on the none arm only when the host left no
  change. The activation suite declares all three.
- **What the host did is read off the controller's own capture, and held to the trail.** The runner prints the host's
  stream on its stdout as well, and the controller captures it into the run's room (`rounds/<k>/host.stream.jsonl`, each
  chunk timed by its own clock), a file no container mounts. `hostOf` keeps one row per tool call -- its name, the skill
  a Skill call starts, the agent an Agent call dispatches, a file tool's path, its turn, whether its result came back an
  error -- and never a prompt, an input or an output. The agreement rule holds the stream's Skill and Agent calls to the
  trail Orbit's hooks wrote: a call with no trail line, or a line with no call, is CONFLICTING, and one that cannot be
  read is UNDETERMINED, never AGREES. A new failure class, `HOST_DIVERGED`, says Orbit's suggestion was right and the
  host chose otherwise. The inspection keeps the trail's turns and every sandbox the runner store holds (`turns.json`,
  `sandbox.json`).
- **Tool-call failures, counted (backlog B9).** A run's report carries `tools` and a "Tool calls" section: per tool,
  calls, failed calls and unanswered ones, from the controller's capture; recovery, each failed call to the next call of
  its thread that did not fail, with the turns, tokens and apportioned cost spent getting there; per relay subcommand,
  requests, help probes, refusals by reason and the engine's non-zero exits; per sandbox step (prepare, restore,
  container build, start, readiness, release), attempts, failures, the class of each (`SANDBOX_FAILURES`: Docker down, a
  pull refused or rate-limited, a port held, a restore failed, readiness never answered, a teardown unproven), the host
  calls each cost and whether one nothing got past ended BLOCKED. What no record says is null, with its reason.
  `metrics` and `reliability` fold them per host basis, suite and model.
- **`--effort` beside `--model`.** `run --effort=<low|medium|high|xhigh|max>` goes to the host's own argument list in
  every brief and to `doctor --host`; the manifest, the report, `status`, a verified candidate and `--like` keep it, and
  `metrics` and `reliability` count a model at each effort as a host of its own. Every 0.5.0 benchmark run is Sonnet 5.5
  at medium effort, the owner's decision.
- **The activation kind and `orbit-activation` (backlog B22's M4, with B23's arms and B21's grounding cases).** A prompt
  that names no skill and no command is handed to the host with Orbit -- or without it -- and held to a hidden truth:
  does the host use Orbit by itself, and only where it helps? What it did is read off its stream and the trail Orbit's
  hooks wrote, and held to the truth, the owners' records and, for an outcome case, the hidden checks of what it
  delivered; every row is a failure class, `HOST_DIVERGED` where the host chose. A seed round lays a case's seed into
  the runner's store, and the inspection reads back, always with the run's own Orbit. Eighteen cases -- ORBIT-ACT-001 to
  011, ORBIT-NEG-001 to 004 (where Orbit should stay out) and B21's ORBIT-CTX-001 to 003 (grounding: recall, invented
  references, bytes read) -- in English and Vietnamese, each on the three arms, with 86 controls (reference, idle,
  over-eager, forging, half and escalating hosts, among others). `metrics` adds activation precision and recall,
  strategy, skill and agent selection, unnecessary delegation, the router's own accuracy, capability coverage and work
  completion, and `--by=language`.
- **The benchmark's workflow kind and the `orbit-workflow` suite (backlog B1, ADR 0053).** A workflow case hands a host
  ONE request, in a person's words, to take through `/orbit-help`, and holds it to three legs from records: the code
  (the engineering kind's verifier on what the workflow's own engineering task delivered), the QA step, and the path (one
  coordinated workflow, routed as the case asks, the change its own engineering step's, every step settled on its
  owner's record, the workflow completed). Record rows name their leg, a round's outcome and report say which legs held,
  and a control that must fail names the legs it must fail on. `ORBIT-WF-004` asks for ORBIT-E2E-001's fix on the
  orders fixture, which declares nothing it can start: its QA step must be SKIPPED with its reason. Its controls --
  `reference` (PASS), `code-only` (FAIL on the QA leg), `bypass` (FAIL on the path leg) and `idle` (NO_PROGRESS) -- run
  in the conformance tier's scripted job and, without Docker, in `test/benchmark-workflow-cases.test.mjs` over Orbit's
  real commands. The release policy requires the suite's controls and records its model-carried row. The relayed QA leg
  -- an investigation of the change on a sandbox beside the controller, and the three cases that need it -- is designed
  in ADR 0053 and not built; the kind refuses a case that asks for it.
- **The benchmark's mission kind and the `orbit-missions` suite (backlog B4, ADR 0055).** Satellite had been checked at
  source level only: no mission had ever run with a real host. A mission case hands a host a GOAL -- a bug with its
  verification, or a small feature -- to take through Orbit Satellite as its playbook says, and holds it to three legs
  from records: the code (the engineering kind's verifier on what the mission's own engineering task delivered), the
  criteria (the mission COMPLETED as VERIFIED, and every acceptance criterion settled by an independent owner's record --
  an engineering task's own verification, a check its runner ran -- that the inspection reads back from that owner
  itself; never an agent's report) and the privilege (every work unit's run had no wider a profile than its unit's kind
  needs, was carried by an agent the trail saw launched as the agent its profile names, and that agent made no edit or
  command its tools do not carry, nor the session itself any engineering task's step). The inspection reads every mission back through Satellite's own commands
  (`inspect.mjs --mission`), with the session trail's agent events and the tasks its evidence names; a mission round's
  host may not start an engineering task by hand. `ORBIT-MSN-001` (an order line that is not a whole positive quantity
  at a whole price is refused) and `ORBIT-MSN-002` (a shipped order can be marked delivered, and nothing else can) run on
  the orders fixture; their controls -- `reference` (PASS), `half-change` (FAIL on the code leg: the mission VERIFIED on
  its own records, the change half made), `claims` (FAIL on the code and the criteria: a change made by hand, a mission
  that claims it), `over-reach` (FAIL on the privilege leg: a reader's agent that edits and runs a command) and `idle`
  (NO_PROGRESS) -- are played by a scripted host that is a whole Claude Code session, every hook delivered, and run in
  the conformance tier and, without Docker, in `test/benchmark-mission-cases.test.mjs` over Orbit's and Satellite's real
  commands. The release policy requires the suite's controls and records its model-carried rows. A round's legs are now
  one module for the workflow and the mission kinds (`benchmark/lib/core/legs.mjs`), and a control naming a leg its kind
  is not held to is refused. Two gaps the mission kind shared with the workflow kind are closed for both: a later round's
  inspection was handed the first round's task, so it found the task by the controller's word instead of the
  coordinator's (a correct second round of a workflow case failed its own path row), and a PASS of either kind did not
  count as a verified outcome in `metrics`.
- **The QA relay's log says why the engine stopped a request.** A host's request that the engine refused or blocked
  was logged with its exit code and the relay's own `refused`, which is null for it, so in `relay.jsonl` an engine
  refusal read as one with no reason. A real row's second `finish --why=x` exited 2 there with nothing beside it,
  while the engine had answered the host why (`finish` refuses an investigation that is no longer active -- `inv-… is
  already paused` once an earlier `finish` stopped it). The log line now keeps the engine's first line (`why`) --
  printable, scrubbed and bounded -- for every request the relay passed on that did not exit 0.
- **The QA relay answers a `--help` probe with the subcommand's usage (backlog B9).** Every 0.4.0 and early 0.5.0 QA
  row's first relay call was a `--help` -- the probe the engine's own refusals name (`node cli/autonomous-qa.mjs --help
  for the usage`) -- and the relay refused it, so the host spent a failed call learning nothing and then guessed a flag.
  A probe -- `--help` or `-h` anywhere, `help <subcommand>`, or no subcommand at all -- is now answered by the relay
  itself, exit 0, and never reaches the engine: the subcommand's usage line for line as `cli/autonomous-qa.mjs`
  documents it in its own usage header, read from the run's frozen source and never run, and what the relay takes of
  it (the run's investigation, the flags its row allows, what it reads on stdin). A probe of the whole CLI says every
  subcommand the relay carries; one of a subcommand it does not carry says why and what it does carry. The relay's log
  keeps a probe as one (`help: true`) under the subcommand it asked about, and the tool-call facts count help probes
  per relay subcommand; the `HELP` refusal reason stays, for rooms kept from before. The QA playbook now shows every
  subcommand a host runs as one exact call, held to the CLI's usage and to the relay's table by a test.
- **`orbit-tools`: a benchmark suite whose tool calls fail on purpose (backlog B9).** Its first case, `ORBIT-TOOL-001`,
  is a QA case on the invoice application with nothing planted in it, whose request adds an earlier session's runbook:
  two calls the relay refuses as they are written -- another investigation's id, and a flag the subcommand does not
  take -- on the `context` a host needs and the `finish` it is told to make. A QA case may now declare such `refusals`
  (`planted`, and `repeats`: how many times one refused call may be sent again), and the judge holds it besides, read off
  the relay's log and never off what the host says, to two rows: no refused call -- the relay's refusal, or the engine's
  exit 2; never a block, never a help probe -- sent again past the bound, and every call refused for how it was written
  (a flag, its value, a word, stdin, another investigation) corrected by a later request of its subcommand the relay
  admitted. Its controls add three scripted hosts: `recovers` (PASS), `repeats` and `uncorrected` (FAIL), beside the
  reference (which never sends a planted call, and PASSes), idle and false-alarm ones. A scripted host's requests are
  now kept in the round's relay log in the line the mailbox keeps of a coding host's, so a report and the tool-call facts
  count them too. The policy requires the suite's controls and records its model-carried row; the conformance tier runs
  the controls with the QA worker image. The sandbox failures B9 lists are left out: a QA run's sandbox is the
  controller's setup, never a host's call, and the runner has no Docker for a task's sandbox to fail in.
- **A held-out application measures Orbit on what it was not tuned against (B2, ADR 0056).** Every 0.4.0 fix was found
  on the benchmark's own cases, so their rates say how Orbit does on the cases it was fixed against. A new fixture,
  `benchmark/fixtures/lending/` -- a lending service several library systems share, with an asynchronous drop-box
  consumer and every record the system it belongs to -- and its suite `orbit-heldout` (ORBIT-HLD-001 to 005) ask the
  engineering cases' question of it: fines for late returns, holds served when a copy comes back, renewals, one system's
  records kept from another, and a request with no rule refused. They were written under an independence rule (no
  release failure report or diagnosis, no other case's verifier or controls), and the ADR says what reached their
  author all the same; a person confirms it (the backlog's open question 5). Each runs under exactly the tuned
  engineering cases' budget and is proven by a reference, a half, a cheat and an idle host (blocked, inventor and idle
  for the request with no rule). The suite's controls are required; its five model-carried rows are recorded, never
  required. `test/benchmark-heldout.test.mjs` also holds that nothing Orbit ships names the application or a word only
  its domain has, so no fix can be aimed at it alone. `reliability --suite=orbit-heldout` beside
  `--suite=orbit-engineering` gives B2's measure: the held-out suite within 15 points of the tuned one. No held-out QA
  suite yet: the ADR says what one needs.
- **A case's interruption is a moment of its engineering task's progress, never a minute (ORBIT-E2E-007).** Its first
  round was to be cut after four wall-clock minutes, and on Sonnet 5.5 at medium effort the round finished in under
  four: nothing was interrupted, and the case measured nothing of a resumed session. A case now declares
  `interrupt: { round, after }` -- the steps an engineering task must have started -- and ORBIT-E2E-007 cuts at the
  first check after its change was opened (`["implement", "check"]`). The controller reads the runner store as untrusted
  data, asks every second, and stops the container once with no grace, as a crash would; the round keeps its whole
  deadline, and its brief says nothing of the cut. A case that declares an interruption is held to its having happened
  (an `interrupted` record), so a run that finished first never passes it, and the report says the round was CUT. The
  inspection now reads back the engineering task the round's own coordinated workflow names, never just the only one
  there is, and the case holds the run to one goal and one engineering task.
- **A run's cleanup never hides why it stopped, and a sessions case that learns on the clean application reaches its
  second session.** ORBIT-SES-001 to 003's Docker controls crashed with "has no workspace of its own here": a run that
  stops part-way releases every engine's sandbox, and one whose task never got a workspace threw before any promise
  existed, so the release's own error replaced the one that had stopped the run. A release now answers that error as its
  result. Under it, a case that learns on the clean application moved the code under the shared checkout by clearing it
  and asking the acceptance assembly to build there, which refuses a directory that is not empty; the variant is now
  assembled beside the checkout and laid over it, its history kept and the move committed.
- **A run's PASS is never REFUSED for a file that left before the sentinel read it.** ORBIT-QA-005 on Sonnet 5.5 at
  medium effort ended PASS -- its defect found, no false alarm -- and the suite answered REFUSED: the leak sentinel
  listed the run's room, and a sandbox's supervisor removed its own owner file before the sentinel read it. A file gone
  before it is read holds nothing to mask; any other failure to read still stops the sentinel. A QA room with no relay
  log now says why: no host round asked anything, or the room predates 0.5.0.

**The release (ADR 0051; backlog B6 and B8).** 0.4.0 took twelve ships over two days. A ship now runs its model rows
first when asked, resumes without losing what it held or charging what it never saw, diagnoses a failed row from its own
room, and records a new suite's model rows before it requires them.

- **Model-carried runs happen in a Claude Code cloud session only (backlog B8).** The owner decided during 0.4.0 that a
  real coding host never runs in GitHub Actions. `release.yml` is gone, and so is `benchmark.yml`'s autonomous job with
  the inputs only it used; `ci.yml` keeps `ship.mjs --ci`, and `benchmark.yml` keeps its conformance tier -- controls
  and scripted hosts, no credential -- whose controls matrix a test now holds to every suite, `orbit-qa`'s 21 whole-run
  controls among them, on the QA worker image. A test holds that no workflow hands a job a coding host's credential or
  runs the ship beyond `--ci`. `CLAUDE.md` says how a cloud session runs the ship: the coding host's token is mapped,
  for one detached process, to the name Claude Code reads, and never used under its own.
- **`ship.mjs --precheck`: the model-carried rows first, each once.** A ship stops at its first failed row after about
  90 minutes of controls, and 0.4.0 ran its model rows by hand before each ship. A precheck is a ship of mode `precheck`
  -- one task and one room, so `--resume` and `--status` carry it -- that builds the images, asks the host, then runs
  only the catalog's model-carried rows, required and recorded, each once (no `--retries`, one cycle; a run a restart
  interrupted still runs again), and stops at no failure. It ends PRECHECK_HELD (exit 0) or PRECHECK_FAILED (exit 2)
  with every failure's room and diagnosis, fails only on a row a ship would stop on (a recorded row's miss is said,
  "(recorded, not required)"), and never writes evidence.
- **`--status` diagnoses a failed model-carried row from its own room.** A run's report (`report.json`, `report.md`) now
  carries a `diagnosis` read off its own records: how the host's session ended round by round (interrupted, the
  deadline, no session, a round cut, the host's own result subtype), the budget it used against its allowance, and for a
  QA run what the relay refused, what the engine stopped and where a run stopped short (`result.stopped`, the one thing
  the relay log keeps of an answer of 0). `--status` prints it beside the room of every model-carried row of the newest
  cycle that did not hold.
- **Recorded rows: run and reported, never required.** The policy's `recorded: { suites, cases }` names model-carried
  rows a release runs once, under its retries, and reports held or not, with the run's room, in its result, `--status`
  and `evidence.json`; such a row never fails a cycle, never stops another row and never blocks SHIPPABLE, and its
  controls stay required. `--evidence` re-derives it like any row: a required row must be HELD, a recorded one must have
  a record (`UNRECORDED`), and every room must still say what the evidence says. A credential found in a recorded row's
  room still stops the release (`UNEXCUSED`). 0.5.0 records `orbit-sessions`, `orbit-activation`, `orbit-workflow`,
  `orbit-missions`, `orbit-tools` and `orbit-heldout` -- 30 of the 46 model-carried rows a cycle -- and a row becomes
  required only by the backlog's promotion rule, a person's policy change.
- **A resumed ship asks again what blocked it, and charges nothing it did not see (backlog B6).** Each of 0.4.0's resume
  dead ends is fixed, its probe kept as the regression test: images a failed build left unbuilt are built again; a
  refused host check is asked again; the catalog is read before a run is read back, so that run is held to the cycle's
  content digest; rows run in the cycle's testing stage, not ENVIRONMENT; a run a restart interrupted costs what its
  ended rounds reported, never its whole allowance, and what such runs were allowed is said in dollars beside the spend
  (`unknownRuns`, `unknownAllowedUsd`), never added to it; a repair a restart cut short is INTERRUPTED, never UNTRUSTED,
  and neither it nor one the environment blocked spends one of `--attempts`; limits asked on resume are held before
  anything is written and laid over the ship's own; and a controls row a restart cut short is carried on from its own
  room (`controls <case> --run-id`, then `resume`), never started again from the beginning.
- **A limit out of bounds is refused by the flag a person typed.** An out-of-bounds `--retries` was refused as
  `--autonomousRetries is 0..3`, the policy's own key, and only after the ship had created its task, which stayed
  QUEUED. It is now `--retries is 0..3`, before anything is journaled or written.
- **The publish gate never passes rows it cannot see.** `ship.mjs --evidence` re-derives the rows the policy requires
  from what the benchmark lists now; when the listing could not be read, or came back empty, it built an empty catalog
  and said PUBLISHABLE with nothing re-derived. A case the policy names that the listing does not hold now refuses the
  gate (`CATALOG_UNREAD`).
- **`--effort`, frozen and held; a reliability report beside the evidence.** `ship.mjs --effort=<level>` (and
  `--precheck --effort`) names the effort every model-carried row, every repair and the host check run at, beside
  `--model`. It is frozen when the ship begins -- a resume naming another is refused before anything is written --
  recorded in `evidence.json` (`host.effort`, each row's `effort`), and a row or a repair run at another is
  `WRONG_EFFORT`, never that ship's evidence; `--evidence` reads every room again for it. A SHIPPABLE ship keeps the
  benchmark's `reliability --revision=<release commit>` as `reliability.json` beside `evidence.json`, and its result and
  `--status` name it: the release notes quote it, and it is never a gate.

**What the release pre-check's model rows found, fixed.** Each fix below came from a pre-check room on Sonnet 5.5 at
medium effort, carries its regression test, and was pre-checked again.

- **A workflow says how to take its next step, not only what it is.** `automation.mjs start`, `resume` and `context` --
  and every step's and settle's own answer -- print a DO line with the one command and the decision for the next ready
  step (never while a step is open or blocked), and no answer prints `mode undefined`. ORBIT-ACT-007's host resumed the
  seeded workflow through the router's RESUME line, read only WHAT came next, and made the change by hand beside it.
- **The coordination advice and the session-start lines name the plugin's own path.** The advice beside a coordinated
  workflow said `node <engine>/cli/automation.mjs plan`, and the session start said `node <plugin>/cli/architecture.mjs
  ensure` and `node <plugin>/cli/learn.mjs recall` -- placeholders no host was told how to read (ORBIT-ACT-005 and 006
  declined the first). Each now carries the path whenever the composition root knows it.
- **A test plan is written in the turn that asks (orbit-test-plan).** The asking step starts the plan (`qa-plan new`,
  with `--screen=<screen>` or `--no-screen --feature=<feature>`), records every question in it with what it blocks, and
  ends the turn with the plan written -- never promised for after a reply nobody in a headless session gives
  (ORBIT-ACT-003).
- **The failure analyst's shell runs only the engine's read commands it names.** Its Bash is for `query.mjs` and
  `learn.mjs recall`, the engine's path written out; a file is read with Read, a directory listed with Glob, text searched
  with Grep (ORBIT-ACT-010 ran `ls`, `find`, `cat` and `git log` and so could not show it had changed nothing).
- **The activation judge says what it saw.** A read-only breach is "ran N commands its read-only list does not allow",
  never "wrote"; and an ACTIVATION, STRATEGY or SELECTION miss whose router chose right but injected nothing says "the
  router chose <word> -> <id> and said nothing to the host" beside its class, which stays the table's (ORBIT-ACT-002,
  010, 011).
- **An activation case's plugin withholds the router's corpus and tests.** `test/fixtures/routing/corpus.jsonl` held 14
  of the 18 activation prompts with the strategy and the choice each expects, and two router tests asked a third; the
  kind now withholds them from every case's plugin (`ACTIVATION_WITHHELD`, before a case's own `withheld`), and no file
  an activation plugin carries holds any case's prompt (ORBIT-ACT-011's host printed its own prompt's corpus line).
- **A business key an earlier SATISFIED test of the investigation settled is refused (`SETTLED_BEFORE`, ADR 0052
  amendment).** A design that publishes a message under a business key an earlier version of the same investigation
  published another message under -- a version that ran SATISFIED and so saw that message settle -- and waits for its own
  to settle the very same way, in an investigation whose accepted plan holds the system to one effect per business key,
  stops at `contradiction`, naming the earlier version and the key. The two instances seen (ORBIT-QA-006, and the
  pre-check's ORBIT-TOOL-001, whose clean application was ruled against) went through a schedule, whose job composes its
  own business keys: the record cannot show the duplicate there, and it stays `result.shared` advice.
- **A wait the design's own publication satisfies is refused (`SELF_SATISFIED`, ADR 0052 amendment).** ORBIT-QA-007 (the
  clean application, required) and ORBIT-TOOL-001 failed on one false alarm: the completes-by-deadline design published
  by hand the period's reminder request, under the correlation the schedule gives it, awaited that very correlation to
  rule "the period's request exists within 120 seconds of the occurrence being due", then held its own message -- a
  second one under the system's key -- to `processed`; the clean worker settled it `duplicate`. The observer, armed
  before the publication on its channel, sees the design's own message, so that wait holds whatever the application
  does. It now stops at `contradiction`, naming the step, the field, the value and what holds instead (publish none;
  move the clock to the occurrence and await the system's own) -- only where the brokers' declarations show every link:
  a publication's request rows say which field of the message they set (`means`), and the channel drops no duplicate.
  What a link does not show is said, never refused (`SELF_PUBLISHED`). The playbook's completes-by-deadline guidance says
  the same, and that a test which must see a period's message arrive runs before any test whose clock passes it.
- **Which slot rules which step is shown before a design and named in every refusal; a design generation makes, the
  validator takes.** ORBIT-QA-001 on the 0.5.0 ship missed its planted defect twice (bnr-2fc9adb2480f,
  bnr-0bb060ca0431), each time spending its persisted-after-write design budget on refusals that said a criterion must
  rule and never which: the HTTP write that triggered the test was left unruled (a write's answer shows nothing of being
  accepted on its own, and the plan's criterion says what accepted is), the count slot was put on it, the trigger moved
  to a click, and a page design every generation stage made was then refused by the validator -- "does not end with a
  report step" -- on a case the host cannot change. Now one compilation answers all three ways
  (`src/qa/generation/compile.mjs`): the obligation's template in the context carries `ruling` -- each slot of its own
  criterion, its template, what it states and the kinds of step whose declared answer it rules (`UI-AC-2/E3`,
  `value-eq`: `orbit.http.read`, `orbit.http.write`, `api`), the trigger's rule and the steps that must rule; a refusal
  that requires a criterion names the slots that rule that step (`rule it by UI-AC-2/E3 (value-eq: response.status eq
  201)`), where a misplaced or missing slot rules, a click trigger's api witness, or that none exists; and a page design
  that does not end with a report is refused by name at `rules` (`ENDS_REPORT`, the validator's own rule by the same
  verbs), naming the slot a report is ruled by. Only the obligation's own criterion is ever named: another criterion's
  slot states what another interface answers. What compiles, the budgets and the verdicts are unchanged; every
  reference design and worked design made validates, and every design a host gets wrong from one is refused before the
  validator with a refusal a host can act on.

## 0.4.0

A minor release: a release now qualifies only on Docker benchmark evidence carried by the real Claude Code CLI, for
the exact source. One contract a consumer observes is added -- `cli/task.mjs create --parent` -- and none changes.

**Fixes: the two known findings, repaired.** Both were found by the benchmark and are now held by it the other way round:
each case's baseline is PASS, and a controlled-fault variant plants the old defect again.

- **An approval a person gave is not dropped silently (ORBIT-SRC-002).** A successor that removes a step a person had
  approved is now a weakening (`APPROVAL_DROPPED`), like one that renames it or drops its approval.
- **A host can run what it generated.** A `generate` step's answer now names the version it froze (`frozen`), and
  `context` lists the latest frozen versions (`versions`) with the obligation each was designed for -- the
  `<case>@<digest16>` id `run-version` takes. Before, only the journal held it, so a host behind a relay (the
  benchmark's runner) froze a test and could never run it; the first ship's real Claude Code QA row found this. The
  benchmark's scripted host now reads the id the same way.
- **A step says what its action came to.** Every autonomous QA `step` answer now carries `result` -- the word its
  action's owner gave (`GENERATION_FAILED`, `ENVIRONMENT_BLOCKED`, `SATISFIED` …), the stage or rule and why, by
  allow-list. A `run-version` the sandbox could not bind used to answer `done` with nothing else, and a host could not
  tell it had run nothing. A decision may cite a design or a version (`dsg-…`, `ver-…`) as evidence.
- **A refused run says why.** A `run-version` refused or blocked at a step now says where in `result.stopped`: the
  step, its verb and capability as the frozen case has them, and what that step's own stop said (`request.key … or
  request.match`, `request.action is one of …`, `answered 400 unknown-point`) -- by allow-list, never a failure's
  message (which quotes the product's answer), scrubbed by shape and by the value of every secret the dispatch sealed,
  and bounded. A run refused before any step says what its envelope gave, and `reconcile` says the same of a late one.
  The capability's words lived only in the worker's run log, so a real Claude Code QA row (ORBIT-QA-003) saw a bare
  `INVALID_TEST` / `TEST_WRONG` and spent its design budget guessing request shapes and fault points.
- **A fault point is read, never guessed.** A workload node of the system graph may declare the fault points its test
  hooks inject (`attributes.faultPoints`: the names on one line, the flat value a graph fact keeps). An autonomous QA
  `context` lists them beside the workload's alias under `bindings` (`points`: plain names only, each once, at most
  16), and a design whose fault control names a point that the workloads it binds declare and do not include is
  refused before a draft exists (`DECLARED_POINT`, naming the declared points). A workload that declares none keeps
  today's behaviour: unknown is never a refusal. The acceptance system graphs now record the points the invoice
  application declares for `worker` and `relay`. A real Claude Code QA row (ORBIT-QA-003) guessed
  `after-effect-before-ack` for the worker's `after-commit-before-ack`, and the hooks refused every run that named it.
- **A design is read before it is written.** An autonomous QA `protocol` now carries what a `generate` design may
  hold -- each part's fields with their enums (`effectScope`, a trigger's `kind`, a control's `role`), what is required
  and what only the engine stamps, from the very definitions a proposal is held to -- and the assertion template each
  criterion op compiles to (`eq` is `value-eq`). A test obligation's frontier `template` names the controls its shape
  needs and the templates its slots take, and `bindings` lists a state's `address` (its declared table and key
  column). Every design the real Claude Code QA rows proposed was first refused for one of these, each refusal a repair
  spent, and one row guessed `businessKey` for the key column `business_key`.
- **A failed run names the step it failed at.** `result.stopped` now names a FAILED step too (`as: failed`), and says
  nothing: what it read is the product's. A host could not tell a fault's witness failing from the read after it. An
  assertion on a step whose answer declares nothing is refused as that step, no longer as "its declared outputs are
  none" -- which read as if `orbit.http.read` could not be ruled on, and a row gave its obligation up.
- **A design brings back the workload its fault stopped.** A fault stops the workload it is armed in, and nothing a
  workload, an adapter or a family operation declares says that workload comes back by itself (the acceptance
  application keeps it down until a test starts it, so what the fault left can be read first). A design whose fault
  control's witness is followed by a step that asks the faulted workload for more -- an `orbit.worker.observe` of it --
  with no `orbit.workload.control` `start` or `restart` of it in between, or that never brings it back before the test
  ends, is now refused before a draft exists (`RESTORED_AFTER_FAULT`, naming the step to add and the steps it goes
  between). A start of a workload already back changes nothing, so the rule reads no declaration and holds everywhere.
  What it says is shown before a host designs: `protocol`'s `design.rules`, the frontier `template` of an obligation
  whose shape needs a fault control (`rules`), and the control's `point`. A real Claude Code QA row (ORBIT-QA-001 on
  Opus) missed three times: its crash test waited for a redelivery from a worker nothing restarted, the clean
  application contradicted it as well, and the next crash test found the worker still down and never saw its fault.
- **A failed observation says what its match left out of the very thing it observes.** An observation whose `match`
  names WHAT it observes and how it went (`orbit.worker.observe` with `{ messageId, outcome }`) is answered only what
  matched all of it, and an answer of none, complete, read exactly as "it never happened". Which fields of a match name
  the thing is now the declaration's word: a meaning may say it is an `identity` (`message.id`, `message.key`,
  `message.correlation`, `occurrence.id`, `execution.ref`), the adapter facade tells the helper which match fields carry
  one (`subject`, an optional field of the helper request), and the reference hooks helper says what it read of that
  thing and left out. The engine keeps it beside the answer under a field of its own (`excluded`: the list, how many,
  the newest three held to the list's declared item fields), which no output declares -- so no verdict is compiled from
  it and `FAULT_NOT_SEEN` never reads it. A run that stopped at that step says it in `result.stopped.excluded`: the
  match's fields that left them out, the items, and one sentence ("2 of the attempts this step read have the messageId
  its match names and were left out by the rest of it — outcome fault, duplicate where the match asks processed …"),
  scrubbed and bounded. Every verdict is the one it was. What a host reads before it designs says the rest: a test
  obligation's `template` names what its own `expected` slots are to its verdict (`slots`: a run stops at the first
  assertion that fails, so another criterion's slot failing on an earlier step ends the test before the obligation's
  own is read, and its contradiction is the obligation's), and `crash-after-effect-before-ack` says that the delivery
  that comes back after the effect committed is not a second effect -- how it settles is the system's own word, never a
  second success to wait for: observe it by its delivery attempt or by the message alone, and rule the obligation on its
  own slots, the effect count (`says`; `protocol`'s `design.slots` and `design.shapes`). A real Claude Code QA row
  (ORBIT-QA-001 on Opus) raised `crash-after-effect-before-ack` as a false alarm in 3 of 3 runs: it awaited the
  redelivery with `outcome: processed` and ruled the completion criterion's slot on it, and the clean application's
  redelivery -- recorded as a duplicate, its effect already there -- was filtered out of an answer that then read as
  "never redelivered", before the effect count was ever read. Generation still accepts an assertion on a slot its
  criterion states for another shape: four of the nine acceptance reference designs rule one on purpose, a completion
  barrier before the effect count.
- **A model-carried run a restart interrupted is run again -- never evidence, never the model's miss, never the end of
  the release.** A cloud worker restart killed ORBIT-QA-001's run mid-round; resumed, the run read back what the round
  left and came to PASS, but a round's host identity (its Claude Code version and model) is kept only when the
  controller sees the round end, so the ship held the run UNTRUSTED (`WRONG_HOST`) and ended NOT SHIPPABLE after 77 of
  93 rows had held, its `--retries=2` unused. Such a run is now `INTERRUPTED`, read off the run's own report (a round
  whose action closed as interrupted, with no evidence of its own -- never a timestamp): still never evidence, it is run
  again as a new run and holds only on that run's own PASS with its identity. It spends none of `--retries`, and at most
  `INTERRUPTED_RUNS` (2, declared in `ship/diagnose.mjs`) such runs a row a cycle; then the ship BLOCKS on the
  environment with every run kept. A run that says another host -- another basis, or a round reporting another Claude
  Code than the image pins -- stays `WRONG_HOST`, interrupted or not, and is never run again into evidence. A QA run's
  report now says `interrupted` only of a round that began; one whose application never came up had none.
- **`--resume` asks a blocked row again.** A ship blocked on a row (the environment, a credential, the provider, a spent
  interruption bound) blocked again at once on `--resume` and never ran it. The resume is now an action of the ship's
  journal (`release.resume`), and a row blocked before it runs again as a new run -- once per resume, never a loop.
- **A run's room is judged only with its report.** A run writes its ending, tidies (its leak scan among it), and writes
  its report last; a restart between the two left a room the ship judged as it stood -- no host (`WRONG_HOST` for a
  model-carried row) and no leak looked for. Such a room is now carried on by `run.mjs resume`, which does that tail
  again; the run itself is never sent again.
- **`--status` says what the newest cycle held.** It said `0/N held` and nothing failed for every ship whose cycle had
  closed -- one that shipped, stopped on a row or integrated its repairs -- because it folded an open cycle only. It now
  folds the newest cycle, open or closed (`cycleOpen`), lists the rows held (`heldRows`), marks a row that runs again,
  and diagnoses each from its case's own declaration as the ship does, so a repair in flight is named.
- **A generated request never repeats its endpoint's base path.** A path is relative to the endpoint it is sent to, and
  an endpoint the system graph declares under a base path (`/api`) already carries it; a generated `orbit.http.*` step
  whose path starts with that base again (`/api/invoices/…` against `invoice-read` at `/api`) is now refused before a
  draft exists, with the path it should have been. It asked for `/api/api/…`, and the 404 the clean application gave
  too was a false alarm -- three of the real Claude Code QA rows ended that way.
- **A host reads the names it may bind instead of guessing them.** An autonomous QA `context` now lists, by kind
  (endpoint, channel, state, schedule, workload, identity, clock), every alias the task's sandbox binds -- read off the
  frozen system graph by the binder's own rows (`bindableFrom`), with the owning component and an endpoint's base path.
  A real Claude Code QA row spent its design repairs on aliases it guessed from keys (`reminder-worker` for the
  workload `worker`) and never reached the shapes the planted defect was in.
- **A missed model-carried row may run again, when a person allows it.** `ship.mjs --retries=<n>` sets the policy's
  `autonomousRetries` (0 by default, at most 3). A row waiting for that retry no longer counts as failed for good, which
  had kept every model-carried row -- itself included -- from running again.
- **A sandbox supervisor that loses the race for its owner file yields.** Two supervisors started together, or a
  teardown removing the room under one still starting, crashed the run that started it (EEXIST, ENOENT).
- **The release suite gate waits 45 minutes**, and says a suite it stopped was late, not that it printed no count.
- **A benchmark QA case's investigation gets the minutes its brief promises.** The engine was seated with the
  investigation's 20-minute default while the host was told it had the case's runner minutes (120); real hosts stopped
  with most obligations open. The setup now sets `limits.minutes` to the runner minutes, within the setting's bound.
- **`goal resume` and `goal status` read every task again.** Their task summaries handed a raw journal to the task view,
  which threw, so every task read as `unknown` and a goal whose analysis had completed never moved on.
- **One failure is one signature (ORBIT-ORC-006).** A failure's signature masks a UUID whole, wherever it appears, so two
  runs of the same failure no longer read as two failures and `NO_PROGRESS` is reached when it should be.

**The autonomous ship (ADR 0049): a release qualifies only on Docker benchmark evidence carried by the real Claude Code
CLI, for the exact source.** `node skills/orbit-release/ship.mjs` is no longer ten gates and two records: it is one
resumable Orbit task (provider `release`) that takes this checkout's HEAD through PREFLIGHT → BUILD → BENCHMARK →
DIAGNOSE → REPAIR → REBUILD → FULL_RETEST → SHIPPABLE. One additive engine contract: `cli/task.mjs create --parent`.

- **The whole catalog, every time.** `skills/orbit-release/ship/policy.json` names all 46 cases of the nine suites, case
  by case (a case that leaves a suite, or joins one unnamed, is `CATALOG_DRIFT`). Every source case must hold its
  controls and PASS its real source -- the two known findings, ORBIT-SRC-002 and ORBIT-ORC-006, no longer pass by their
  baseline. Every QA and engineering case must hold its controls and PASS with the coding host, and ORBIT-SRC-001's
  planted fault must be repaired by it: sixteen rows a cycle the real Claude Code carries.
- **Claude Code is the one coding host a release needs.** A model-carried row counts only when its run says basis
  `coding-host`, reports the Claude Code version the runner image pins, and names its model; a scripted or session
  host, another host or an endpoint the policy does not name never satisfies it. `doctor --host` asks the runner image's
  Claude Code one question first; no image, no version, no credential or a refused one BLOCKS the ship -- it never falls
  back. Native host acceptance (Grok Build, Antigravity, Codex, Claude Code) and native backend acceptance are now
  optional rows that never block a release.
- **Fresh artifacts.** Each cycle builds the release archive with `git archive` from a pristine checkout of the release
  commit, holds the ARCHIVE itself to what a host refuses, digests it by bytes and by content, and rebuilds every
  benchmark image (`build --rebuild`).
- **Repairs through the benchmark, integrated only in the ship's own workspace.** A source case failing its real
  variant on a cause it declares repairable is repaired with `run.mjs run <case> --repair` -- Claude Code in the runner
  driving one Orbit engineering task, judged by the benchmark's independent verifier. The ship holds a verified candidate
  again (its record, its patch digest, what git says it touches, the scope, the protected paths, no test losing a line),
  applies it AUTO in the ship task's own workspace and commits it there, then runs the whole catalog again on the new
  commit. A QA or engineering failure is never repaired against its hidden truth. A known finding's controls that
  presuppose its defect are reported SUPERSEDED once its real source passes.
- **Evidence, and a publish gate.** SHIPPABLE writes `evidence.json`, bound to the release commit, its tree, the content
  digest every run froze, the protected and policy digests and the artifact. Integrated repairs reach a branch only as
  `release.patch` and `release.bundle` a person applies -- nothing is pushed, tagged or published. `ship.mjs --evidence`
  re-derives everything and exits 0 only for PUBLISHABLE.
- **Resumable, visible, bounded.** `--resume`, `--status`, `--no-repair`, `--usd`, `--minutes`, `--cycles`,
  `--attempts`, `--json`. A run is read back from its room, never sent twice; a person's pause or cancel stops the child
  run and removes its containers. Orbit Live shows a session's ship before the runs it starts, and names a benchmark
  child as one; Mission Control shows each run as part of the ship.
- **The benchmark, for any caller:** `--tree`, `--run-id`, `--parent`, a drifted control as its own row (exit 2), a
  credential block that says its cause, a QA report that says its host basis, and `doctor --host`.
- **CI.** `ci.yml` keeps the fast tier (`ship.mjs --ci`), which now prints the autonomous ship as `wait` -- a green fast
  CI is never qualification. `release.yml` (dispatched, from the `benchmark` environment) runs the autonomous ship and
  the publish gate, and uploads every room. `benchmark.yml` takes `CLAUDE_CODE_OAUTH_TOKEN` by name too.

## 0.3.1

A patch release: one behaviour fix in the goal orchestrator, and the Docker benchmark that found and verified it. No
contract a consumer observes changes.

- **Fixed: a goal moves on past a unit whose task ended.** Before, a goal stayed running and partial after its workflow
  completed, and stepping it found nothing ready. The change came from the benchmark's own repair path (ORBIT-GOAL-001
  with `--repair`, verified independently) and was applied at a person's request.

A Docker benchmark that holds Orbit's own source to independent checks, and repairs a failure only through Orbit
(ADR 0046). This is development tooling under `benchmark/`: export-ignored, imported by nothing of the engine, and
changing no engine contract.

- **Cases are data.**
  - A suite under `benchmark/suites/` holds cases.
  - Each case has a `case.json` held to declared fields, a public request, a spec and probe under `verifier/` that only
    the verifier reads, variants that plant exact faults in the run's own copy (`FIXTURE_DRIFT` when one no longer
    matches), and controls that prove the checks discriminate.
- **Frozen inputs.**
  - The current branch is read through read-only git: HEAD, or HEAD plus the working tree when a person says so. A
    dirty tree with no choice is refused, and nothing in the checkout is reset, stashed or written.
  - The subject becomes a checkout with one fixed commit. The manifest pins the commit, the digests, the case, the
    image ids, the seed and the limits.
- **A run is one Orbit task** (provider `benchmark`), written only through `cli/task.mjs`. Orbit Live and Mission
  Control show its stages, the task's door holds its budget, and a person's pause or cancel stops it with nothing of
  its own left running. `resume` carries it on from its journal: a repair round is read back and never sent again.
- **Containers through Orbit's Docker provider.** Each one is attested to the isolation profile before it starts and
  has:
  - a read-only root, no capability, `no-new-privileges`, an init, and CPU, memory and PID limits;
  - a deadline the controller enforces;
  - cleanup by the run's label only.

  No container gets the Docker socket, a home directory, the developer's store or checkout. The verifier has no
  network, no credential and no model, and its judge never imports candidate code. The runner reaches only the
  model's API, through an egress proxy it checks before the host runs. A credential is passed by name only. When a
  run ends, a sentinel masks the credential's value wherever it appears in the run's room, and names those files.
- **Repair through Orbit.**
  - Claude Code, pinned in the runner image, drives ONE engineering task started with `autonomous-engineering.mjs
    start`.
  - The candidate is read back by an inspection container. `SCOPE` holds it to its scope, the harness, the checks and
    the existing tests.
  - It is verified on the hidden checks, on the repository's gates over the subject's own tests, and on its own
    regression test, before and after the change.
  - `CAUSES` and `NEXT` decide the rest: VERIFIED, NO_PROGRESS, BUDGET_EXHAUSTED, BLOCKED or BENCHMARK_INVALID.
- **The report keeps apart** correct code, work that went through Orbit, autonomy end to end, a blocker and an invalid
  benchmark. A host's numbers are REPORTED, and an unreported one is `unknown`.
- **First suite, `orbit-source`.**
  - **ORBIT-SRC-001** holds `src/improvement/oracle.mjs` and `safety.mjs` to the acceptance oracle's promises. It
    passes on the current source and fails on its planted variant, a partial fix, allow-all and reject-all.
  - **ORBIT-SRC-002** fails on the current source: a removed step that waited for a person goes unreported. It is a real
    finding, kept as its own case.

- **QA cases (ADR 0047): does Orbit's autonomous QA find a planted defect?**
  - A second suite, `orbit-qa`, plants one defect per case in Orbit's own synthetic acceptance application, with that
    application's own ground truth. One case plants nothing, so every contradiction there is a false alarm.
  - Orbit's engine runs from the run's frozen checkout beside the controller. It sets the application up on an
    isolated sandbox of its own and opens one investigation, doing once what a person does in Orbit Control.
  - A real coding host works the investigation from the runner container through a relay of files: requests it
    writes, answers it can only read. The relay admits the subcommands a host uses, about the run's own investigation;
    it never passes a person's approval, a second investigation or a path. The host's plugin withholds the ground
    truth, the reference designs and the application's source, and its `cli/autonomous-qa.mjs` is the relay's client.
  - What the investigation came to is read off the engine's own journal. Each contradicted design is replayed on the
    clean application, and counts as a defect found only when the clean application satisfies it. The verdict table
    ends in BLOCKED, FAIL (a false alarm, a defect missed, too little covered), INCONCLUSIVE or PASS.
  - `controls` proves the verifier live, with no model: a reference host using acceptance's designs must PASS, while
    an idle host and a false-alarm host must FAIL.
  - A QA worker image, built from the official Playwright image pinned by digest, needs no OS package mirror or
    browser CDN. The sentinel also looks for the sandbox's per-run tokens.
- **The self-healing loop, proved without a model, and goals measured end to end (ADR 0048).**
  - **Repair controls.** A source case may declare `repairs[]`: candidate definitions (exact edits, files brought,
    files deleted) carried straight to the judge, or through Orbit's engine by a scripted host that drives the round's
    one engineering task with no model, no network and no credential. A reference repair must be verified; a test
    deleted, weakened or skipped, the harness or a check touched, a process or a new import smuggled in, a path out of
    scope, a missing or non-discriminating regression test, a partial fix, a candidate that hangs and a "success" that
    only prints must each be refused by name; an idle host must make no progress.
  - **Failure classes.** Every cause carries one class of a fixed taxonomy (ORBIT_SOURCE_DEFECT, BENCHMARK_DEFECT,
    VERIFIER_DEFECT, ENVIRONMENT_BLOCKED, PROVIDER_FAILURE, INFRASTRUCTURE_FAILURE, NON_DETERMINISTIC,
    INSUFFICIENT_EVIDENCE, BUDGET_EXHAUSTED, HUMAN_APPROVAL_REQUIRED, UNKNOWN). A candidate that runs out of time is
    rejected as its own failure, never read as an environment that blocked; `controls` refuses a spec that fails its
    own self-test.
  - **NEXT** gains WAITING_FOR_PERSON (a benchmark never approves), REPEATED_CANDIDATE and CUT_SHORT. Each round keeps
    what it regressed and improved and its cost with its basis; a verified candidate is kept in `verified.json` and
    never applied to a checkout. A person's pause or cancel stops a running round's container.
  - **Twenty-nine new source cases** in six suites -- `orbit-governance`, `orbit-memory`, `orbit-improvement`,
    `orbit-orchestration`, `orbit-satellite`, `orbit-verdicts` -- each with a reference model written from its contract,
    a planted fault and verifier controls. A case's `baseline` says what the source as it is comes to; a known finding
    declares `FAIL` with a known-good control.
  - **Engineering cases.** `kind: "engineering"` hands a host a goal about a frozen fixture project
    (`benchmark/fixtures/orders`) with Orbit beside it: the goal entry, the workflow it starts and the engineering task
    that starts, judged by the verifier and by record checks on what Orbit's owners say. Suite `orbit-engineering`,
    ORBIT-E2E-001 to 008: a bug fix, a feature, a change across five modules, a durable write, an idempotent consumer,
    an escaped note, a session cut off mid-work and resumed on its own task, and a goal with no rule that must be
    refused.
  - **Metrics.** `node benchmark/run.mjs metrics` folds kept runs into numerators over denominators, apart by host basis,
    with reproducibility, the verifier's own controls and history by revision; an estimated cost never counts.
  - **CI tiers.** `.github/workflows/benchmark.yml`: conformance on a pull request that touches the benchmark (every
    case's controls in containers, scripted hosts through both loops, no secret); a real coding host only when a person
    dispatches it, inside the budget they give.
  - **Session host.** `run <case> --host=session:<label>`: the operator's own session carries a round through a fresh
    agent that drives Orbit inside the runner with `docker exec`; no credential or network in the container, measured
    apart as host basis `session`.
  - **Generic proof.** `test/benchmark-cases.test.mjs` holds every source and engineering case of every suite to its
    reference model, its baseline and its controls without Docker.
- **Best-practice names.**
  - Benchmark "packs" are SUITES (`suites/<suite>/suite.json`), matching `--suite` and kept apart from Orbit's
    capability packs.
  - A case's directory is its id in lower case. `hidden/` is `verifier/`, and `faults/` is `variants/`.
  - The modules are grouped as `lib/core/`, `lib/source/` and `lib/qa/`, and the tests as `test/benchmark-source-*`
    and `test/benchmark-qa-*`.

## 0.3.0

Autonomous self-improvement on independent evidence (ADR 0045): Orbit now notices when one of this project's reusable
definitions -- a declared playbook the skill factory keeps, a role Satellite keeps -- fails the same way in independent
sessions, drafts the smallest successor through that definition's own factory, compares it with the version it would
replace on the same frozen inputs, chooses it for new work only when twelve gates hold and only through the owner's own
door, watches the runs that follow, and puts the replaced version back when it regresses. A campaign is a journal of
decisions in the machine store; every truth stays with its owner. All contract changes are additive.

- **Detection.** `src/improvement/` reads owners' run records into signals (a contract its definition declares that did
  not hold, an input it could not bind, its own bounds spent, a Satellite run that ended without an owner's proof) and
  keeps one opportunity per fingerprint. A single failure, retries inside one session, a provider's failure, an
  environment that blocked a run and a person's approval never start a campaign; a problem more sessions contradict than
  show is not one. It runs after a coordinated workflow ends and from the hooks (a detached, debounced `improve analyse
  --hook`, which never evaluates).
- **Diagnosis and generation.** `DIAGNOSIS` names the cause from what the evidence demonstrates; only the definition's
  own declaration, with high confidence, gets a candidate. The skill factory gains a SUCCESSOR: `scaffoldSuccessor`
  drafts it from the pinned version (`successorOf`, `campaign`), the host writes the change with `skill-factory put`,
  and `stageCandidate` keeps it under `candidates/` with status `candidate` -- pinnable, never offered; `register`
  refuses a successor (`SF_SUCCESSOR`). A role's successor is published to Satellite HELD.
- **Validation.** `SAFETY` refuses, before anything runs, a candidate that widens a tool, changes what it provides,
  carries anything but instruction text or declared data, or weakens an acceptance rule (a lowered bound, a removed rule
  or required step, a retyped output); its owner's own contract holds it too.
- **Evaluation.** A playbook's candidate and the version it would replace run the same frozen inputs side by side,
  `minRuns` times each, in an evaluation task of their own (provider and door `improvement`), through the coordinator's
  own skill runner pinned by `dispatch.pin` -- the same resolver, gates, approvals and budgets as ordinary work. A role's
  evaluation is the missions the host links. `COMPARE` judges one evaluation (a newly failed step is WORSE whatever else
  improved), `AGGREGATE` all of them (BETTER needs two independent sessions and none saying otherwise). Cost is measured
  beside the verdict, with denominators; tokens, cost and handoffs stay unknown.
- **Promotion, monitoring and rollback.** Twelve ordered `PROMOTION_GATES`, then `selectVersion` (skill factory) or
  `selectDefinition` (Satellite's `registry/selected/<id>.json`): doors `improvement` and `control`, the revision read,
  a person's withholding always winning, the replaced version kept whole and a pin a task holds never moved. With
  `improvement.promote` off a qualified candidate waits for a person. `MONITOR` reads ordinary runs afterwards; a
  regression in independent sessions selects the replaced version again and suppresses the candidate. An ended campaign
  is one finding for learn's own ladder.
- **Settings.** `improvement.*` in the automation settings (schema 3, additive): `detect`, `generate`, `evaluate`,
  `promote`, `minSessions`, `minRuns`, `maxCandidatesPerSubject`, `maxEvaluationAttempts`, `maxEvaluationMinutes`,
  `maxConcurrentEvaluations`, `isolation`, `cooldownHours`, `retentionDays`; `improvement.allowExecutableCandidates` is
  fixed false. Written only through Orbit Control's door.
- **CLI and skill.** `cli/improve.mjs`: `status`, `analyse`, `opportunities`, `candidates`, `show`, `start`, `step`,
  `resume`, `evaluate`, `candidate`, `link`, `reconcile`, `history`, `metrics`, `doctor`, `where` -- none promotes,
  reverts, rejects or changes a setting. `/orbit-improve` (switch `skill_improve`) is the host's playbook.
- **Live, Control, trail.** `IMPROVEMENT_SOURCE` sends a campaign an evaluation task names as one `improvement-view`
  frame and named events; the full-screen viewer and the pane draw an IMPROVE section; `live status --json` lists
  campaigns. Orbit Control's Advanced → Improvement shows the overview with nine metrics, the opportunities, each
  campaign (why, the successor, every evaluation, every gate, history, events) and the settings, with a person's
  promote, revert and reject on the revision read. The trail gains `improvement.detected`, `improvement.decided`,
  `improvement.promoted` and `improvement.rolled_back`.
- **Shared binding.** `skills/orbit-help/invoke.mjs` is the one binding of a declared playbook's door, which
  `cli/automation.mjs` and `cli/improve.mjs` share.
- **Independence is one machine on one UTC day,** learn's own rule (`src/memory/session.mjs`), never a session mark a
  shell can set. Another evaluation runs only when it would add an independent session: asked again on the same
  machine and day, under any session mark or none, it starts nothing. A successor whose text tells its reader to ignore its rules is refused by the factory's own injection rule,
  and no terminal writes a verdict, a qualification or a promotion (`test/improvement-manipulation.test.mjs`).
- **The hook's detached analyse never stands in the checkout, and starts only when there is something to analyse.**
  It starts in the system's temporary directory and is told its checkout (`analyse --hook --checkout=<dir>`), because
  on Windows a directory a running process stands in cannot be removed. A project that keeps no playbook, no Satellite
  mission and no campaign starts no process at all.
- **Tests.** `test/learning-default.test.mjs` waits for the drained session's trail event as well as its facts: the
  drain keeps the facts first, so a busy machine could read the trail in between.
- **Native host acceptance** goes stale with this source and is owed again.

## 0.2.2

Agent and skill run identity, and attribution on evidence (ADR 0044): every agent run, declared skill run and tool call
Orbit can see is identified once, carries its parent as its owner recorded it at the dispatch boundary, and says how
anybody knows which run it belongs to -- `RUNTIME_BOUND`, `HOST_OBSERVED`, `REPORTED`, `UNATTRIBUTED` or `CONFLICTING`
(`src/attribution.mjs`) -- never moved onto the latest skill or the nearest run. Orbit Live, Satellite Live, `trace usage`
and Orbit Control show the same identity, outcome and coverage, and every gap says so. Contract changes, all additive
except Satellite Live's view (version 2, a word renamed): new trail fields and events, two hook events, working-set line
fields, a usage section, a Satellite journal line, two envelope fields, a CLI flag, two JSONL frames.

- **Hooks.** Claude Code's `SubagentStart` and `SubagentStop` reach `cli/learn-hook.mjs` (in the background; the hook
  answers nothing). The adapter keeps a subagent's `agent_id` and `agent_type`, the `agentId` an Agent call answers with,
  and the mission run an Orbit envelope's mark names on an Agent call to a Satellite agent -- every id hashed in
  `src/lifecycle/event.mjs`; the prompt, a subagent's last message and its transcript are never read. New lifecycle
  events `agent-start` and `agent-end`.
- **Session trail.** `tool.used`, `command.ran`, `skill.invoked` and `agent.invoked` gain `call` (the hashed call id) and
  `agent` (the subagent that made it); `agent.invoked` gains `run` (`msn-…/arn-…`). New events `agent.launched`,
  `agent.started`, `agent.ended`. A Claude Code event's id now comes from its call, as protocol 2's always did, so a hook
  delivered twice is one event; a Claude Code event names its host (`agentHost`).
- **Usage.** `trace usage --json` gains `attribution` -- per agent as the host's payload says it (`byAgent`: type, start
  and stop, who launched it, the run, events, distinct calls, failed, not reported, skills), the calls that name no agent
  (`session`), and `coverage` (how many observed tool events named an agent, per host) -- and `skills[].runs` (distinct
  starts). The `skills` heuristic is unchanged and stays labelled as one. Orbit Control's usage page has a "Which agent
  made the calls" card.
- **Working set and Orbit Live.** A line names the subagent that made it; a subagent's start and stop and a finished
  call that started a skill or an agent are kept. `live status --json` gains `session.agents`, `own`, `invocations` and
  `coverage`; the pane's NOW and events view draw an AGENTS block. A subagent's command is no longer closed by its
  parent's turn ending. Work tracking's coverage rows gain `namesAgents`, `agents` and `calls`.
- **Declared skill runs.** A run carries its id qualified by its task, its attempts and `RUNTIME_BOUND`; an approval's
  reason names the step's ref (`<run>.<step> of …`), so two runs never share a waiting request. `live watch --jsonl`
  emits `plan-view` and `skill-view`; the evidence overlay ranks `skillrun`, `skillstep` and `invocation` receipts and
  shows their pin, provider and digests.
- **Satellite.** `agent ack <msn> <arn> --host-agent=<agentId>` records the dispatcher's word as `agentrun.bound`
  (hashed, REPORTED). Satellite Live joins its runs with the session trail at read time: each run's host agent, its word
  and basis, the host's lifecycle of that agent, and its calls direct and through the agents it launched. The live view
  is version 2 (`UNOBSERVED` is now `UNATTRIBUTED`); the Tools view adds per-run counts and a coverage section; the Agents
  view selects a run (`j`/`k`) and inspects it (`enter`, `o`, `esc`). The envelope gains `parentAgentRunId` and
  `attempt`. The host matrix's `toolObservation` notes say what each host proves.
- **Identity is never authority.** No gate, approval or protected boundary reads a run id, an agent id, a mode or an
  attribution word (`test/protected-bypass.test.mjs`).
- **Tests.** `test/skill-lifecycle-e2e.test.mjs` AC-12 listens for its child's exit from the start: the wait no longer
  races a child that ends on its own.
- **Native acceptance on Claude Code 2.1.314.** Headless sessions with this plugin dispatched two Satellite runs at
  once -- in the foreground (`completed`, the agent named when the call returned) and in the background
  (`async_launched`, named at launch) -- acknowledged each with `--host-agent`, reported, interrupted one through
  reconcile and retried its unit as a new run (attempt 2): every run was HOST_OBSERVED to its own agent, eight calls
  each, the dispatcher's word agreeing with the hooks', and the mission ended REPORTED / NOT_VERIFIED. The captures are
  sanitized fixtures (`test/fixtures/hooks/claude/*-2.1.314.json`), and `satellite/acceptance/host-acceptance.json`
  holds a receipt for this source (`claude:agent-dispatch`, `claude:agent-parallel`). Orbit's four-host record
  (`docs/host-acceptance.json`) is owed again for this source, as it was for 0.2.0 and 0.2.1.

## 0.2.1

Microsoft sign-in for Azure DevOps (ADR 0043): a person signs in once with their Microsoft account, and a connection reads
Azure DevOps with a short-lived token, through an Azure CLI profile that Orbit owns. Orbit may use an `az` program the
machine already has, but it never uses the developer's Azure CLI identity state: it never reads, copies, asks about or
changes their login, account, subscription, configuration or extensions, so a person can be signed in as account A in a
terminal and as account B in Orbit. Contract changes: a connection's `auth` field, new catalog row fields and a new
install strategy, two commands and a flag, a trace event, three Control routes and a new store room, all additive; one
changed default, because a NEW Azure DevOps connection now signs in with Microsoft unless `--auth=credential` says
otherwise or the command names the variable a credential is read from (`--credential-env`); and one removal, the azure-devops provider's `az devops configure --list` hint (below).

- **A connection says how it gets in.** A connection record gains `auth: { strategy, ...options }`, and a provider
  descriptor gains `authentication` (`default` and `strategies`, each `kind: "credential"` or `"broker"`). Azure DevOps
  offers `azure-cli` (Microsoft sign-in, options `tenant` and `deviceCode`, the default for a new connection) and
  `credential`; GitHub offers `credential` only. A record with no `auth` is a credential connection and is never rewritten.
  A `broker` connection accepts no credential at all. `src/connections/auth.mjs` is the one contract every reader, collector
  and probe asks for a request's authorization.
- **Commands.** `node <engine>/cli/project-report.mjs sign-in <connection-id> [--tenant=<id>] [--device-code]` and
  `sign-out <connection-id>`; `connect` gains `--auth=azure-cli|credential` (the default for azure-devops is `azure-cli`; naming `--credential-env` on a
  new connection makes it a credential one, and `--auth=azure-cli` changes it back).
  A connection test never starts a sign-in.
- **Orbit Control routes.** `POST /api/v1/connections/:id/auth/check`, `.../auth/sign-in` and `.../auth/sign-out`: the
  connection's state, a sign-in and a sign-out. Control's Connections page shows the state and offers all three.
- **Catalog row fields** (`catalog/tools.json`). A row may declare `profile` (`env`, `name`), `launch` (`env`,
  `platformEnv`, `inherit`, `args`), `detection.native`, `detection.wrapper`, `detection.sources`, `detection.timeoutMs`,
  `install.autonomous`, `install.python` and `install.package`; an asset may carry its own `launch`, and a locked asset names
  its `lock` and `bin`. A new install strategy, `python-lock`, is pinned by a lock under the new `catalog/locks/`. New rows:
  `azure-cli-private` (macOS and Linux) and `azure-cli-private-win` (Windows x64). The `azure-cli` row now says it is used as
  a program only and declares the profile and the pins; the `python` row is `autonomous`.
- **New trace event** `connection.auth`: which phase ran (a token request, a sign-in, a sign-out) and how it ended, from an
  allow-list; never a token, an account or what the CLI printed.
- **New codes.** A sign-in that cannot proceed is BLOCKED (3) with one of `AUTH_TOOL_MISSING`, `AUTH_TOOL_UNSUPPORTED`,
  `AUTH_TOOL_UNVERIFIED`, `AUTH_LOGIN_REQUIRED`, `AUTH_LOGIN_CANCELLED`, `AUTH_LOGIN_FAILED`, `AUTH_TOKEN_FAILED`,
  `AUTH_TENANT_AMBIGUOUS`, `AUTH_REJECTED`, `AUTH_FORBIDDEN`, `AUTH_CREDENTIAL_MISSING` or `AUTH_PROFILE_LOCATION` and the one
  thing a person does next; a tool that cannot be had is `TOOL_MISSING`, `TOOL_UNSUPPORTED`, `TOOL_UNVERIFIED` or
  `TOOL_INSTALL_FAILED`.
- **New store room.** `authSessions`, `<storeBase>/control/auth/`: machine-wide, mode 0700, created by the first sign-in
  and never by a read. The Azure CLI's profile is `<storeBase>/control/auth/azure-cli`.
- **Orbit's own profile.** Every Azure CLI process Orbit starts is given `AZURE_CONFIG_DIR` set to that directory, by one owner
  (`src/tools/launch.mjs`) from the catalog row: the child gets the few names any process needs, the names the row lets
  through (proxy, CA bundle, display) and the row's pins, and no other `AZURE_*` of the developer's. The pins switch off the
  Windows account broker (it keeps a session outside the profile, shared with the developer's own `az`), the macOS broker,
  an encrypted token cache outside Windows (its keystore entry has fixed names every profile shares), the subscription
  picker and telemetry. A version probe or an install's verification runs in a scratch profile that is removed. On Windows
  the sign-in is therefore the browser flow, not the account broker: a tenant that requires a compliant device through the
  broker may refuse it, and a personal access token is the way in there.
- **Which `az` runs.** A private copy Orbit installed, else the machine's own `az` as a program only, else Orbit installs a
  private copy itself, else BLOCKED naming every candidate. Each candidate passes one gate: it starts, names a version of 2.61.0
  or newer, and is a program of this operating system (under WSL a Windows `az` reached through interop is refused). To make
  the private copy win over a machine `az`, a person installs it from Orbit Control's Tools page.
- **What Orbit installs by itself.** On Windows x64, Microsoft's official ZIP (`azure-cli-2.91.0-x64.zip`, SHA-256 checked),
  started as `python.exe -IBm azure.cli`. On macOS and Linux (x64 and arm64), a Python of Orbit's own and the official
  `azure-cli` 2.91.0 wheels from PyPI: every distribution pinned and every SHA-256 locked (150 distributions per lock),
  installed by pip with `--isolated --require-hashes --only-binary=:all: --no-deps` into a virtual environment, staged beside
  the final directory, verified, promoted and receipted last (about 200 MB downloaded, about 700 MB on disk). Windows ARM64
  has no private copy: Microsoft publishes no ARM64 build. Only a pinned archive or a pinned lock is ever fetched on Orbit's own
  initiative (AUTO: `tool.acquire`, `auth.token` and `auth.login` cross no Protected Boundary), never through a package manager,
  `sudo`, PATH, Program Files, Homebrew or the machine's Python.
- **Tokens.** Orbit asks `az account get-access-token` each time, keeps the answer in memory until shortly before it expires
  and never reads a token-cache file. The sign-in is one sequence and never a loop: a token, then `az login` ONCE when the
  CLI says a person must act, then ONE token. `sign-out` is `az logout` against Orbit's profile only.
- **Removed.** The azure-devops provider no longer looks up a default organization with `az devops configure --list`, which
  read the developer's `~/.azure/config` and needed the Azure DevOps CLI extension. A bare `#123` resolves only through the
  project's binding or the connection registry.
- **Release tooling.** `skills/orbit-release/pin-python-lock.mjs` writes a lock for each platform (pip for the host, uv for the
  others, preferring the host's picks and recording every re-pick in the lock's header); `skills/orbit-release/SKILL.md` says
  how to re-pin and how to re-verify the Windows ZIP pin.
- **Platform evidence.** What has really been run, and what is only resolved or faked, is the table at the end of ADR 0043.
  At this release Orbit's own installer has run for real on macOS (arm64 and Intel), Linux (x64 and arm64) and Windows x64
  -- the private copy installed, answered as 2.91.0, and left a decoy developer profile untouched -- and a real Windows ARM64
  runner refused with the unsupported answer; the machine's own `az` as a program has run for real on macOS arm64. The
  Windows `az.cmd` wrapper, WSL and Alpine are `fakes-only`, and a real sign-in (a person in a browser) is `pending`.

## 0.2.0

Autonomous by default, with Protected Boundaries (ADR 0042): everything Orbit does runs on its own, and a person is
asked only where work would leave the autonomous development boundary -- writing the developer's checkout (denied),
a git push, a production deploy, a production database migration (approved once) and destroying production data
(approved once, marked destructive). Contract changes: new engineering actions (`commit`, `push`), new approval fields,
new capability field and effects, runtime commands that no longer ask for `--human`, and `adopt` that only a person's
own act crosses.

- **One table of where a person decides.** `src/protected/` is a leaf every executor and viewer reads: five boundary
  rows over STRUCTURED actions (never command strings), one `authorize(action)`, one fingerprint, declared environments
  read onto one tier (unknown is never production). Anything that is not a boundary -- an unknown action included --
  is AUTO; there is no allow-list.
- **Delivery.** An engineering task commits its verified change on its own branch (`orbit/<task>`), autonomously, and
  pushes exactly that commit only once a person approved exactly that push (repository, remote, URL digest, ref,
  commit, force) in Orbit Control; a changed push, a moved remote or a second use is refused, and an interrupted push is
  read back from the remote. Neither goes through the workspace's own `.git`, which the task writes: the commit is made
  in a bare git directory beside the workspace that only Orbit writes, and the push from one made for that push alone,
  so a hook, a rewritten URL or a `.git` naming the checkout cannot move either. A task workspace keeps no `origin`,
  and a clone whose `.git` is a link or names another repository is never read or written through.
- **Production through what is declared.** A capability declares `environment` and the new effects `deploy`, `migrate`,
  `delete`, `truncate`, `drop`, `purge`, `reset`; the capability pipeline refuses a protected call that carries no
  spent approval of exactly it, from every route (a UI case, a work's need, a playbook step, a mission, a worker), and
  an ordinary production write that declares what it is stays autonomous. The MCP broker refuses a tool a catalog row
  declares protected (the github row: its ref-writing tools), so a push or a merge never goes around the boundary.
- **The existing approval, carrying the boundary.** `request-approval` keeps `boundary`, `destructive` and `shows`; the
  type is the protected kind, the risk sentence says exactly what is approved (DESTRUCTIVE first), and Orbit Control's
  approval card shows it unchanged. One open request per fingerprint, granted only in Control on the revision read,
  consumed before the action starts, its fingerprint derived again just before it runs.
- **Friction removed.** A capability that changes state outside the workspace no longer asks a person; a task's own
  sandbox restores, builds and starts autonomously (a trust list is now a review mark its receipts name -- the one
  exception: a host-side `initializeCommand` the task itself added or changed waits for a mark on that definition); `validate`,
  `prepare --apply` and `forget` ask nobody; autonomous QA is on by default; a task's sandbox opens every mode the
  engine's gates allow and a fixture grant every declared effect -- `qa.modes` and `qa.writes` only narrow.
- **The primary checkout.** `runtime adopt` is the PRIMARY_CHECKOUT_WRITE boundary: refused for any agent, `--human` or
  not, from any terminal; a person adopts in Orbit Control, whose door is the one that proves a person.
- **Live.** Protected approvals are worded from the journal's own fields (waiting for approval, granted, executing,
  completed, failed), and `src/live/protected.mjs` names the transitions (`protected.detected`, `approval.*`,
  `protected.executing|completed|failed`).

## 0.1.1

Orbit Satellite (ADR 0041): any goal taken through an autonomous, multi-agent mission whose every step is journaled,
judged and observable -- a structured intent, an investigated and revisable work graph, reusable roles, agent
templates, skills and workflows, fresh agent runs under least-privilege profiles, and a verdict only an independent
owner's evidence can earn. Additive: `satellite/`, `skills/satellite/` and `agents/satellite-*.md`; nothing else in the
engine changed.

- **A mission journal above the owners.** `satellite/cli/satellite.mjs` keeps one append-only journal per mission under
  `<storeRoot>/satellite/missions/`, folded into its state on every read. The host decides one step at a time; every
  action passes one gateway -- proposal, contract, policy, durable intent, provider, observation, evidence, journal --
  and its mode, operation kind and profile are derived, never sent.
- **Understand first, then plan on evidence.** A goal in any language becomes facts, hypotheses, assumptions,
  constraints, acceptance criteria and unknowns kept apart; criteria freeze after the first analysis. A work graph of
  `explore`, `diagnose`, `design`, `review`, `verify`, `implement`, `build` and `test` units is validated (cycles,
  bounds, effects) and revised only by a trigger, each revision an immutable file naming what it replaced and why.
- **Reuse first, generate only the gap.** Roles are reused, composed or generated and named from their
  responsibilities, and request a profile without granting anything. Agent templates are reused across missions.
  Skills go through Orbit's own skill factory, instruction-only and within its limits, never around a capability a
  person disabled. Workflow templates (`orbit.satellite.workflow/v1`) carry parameters and bounds and never a state.
  Every definition is immutable and pinned by its digest.
- **Owners do the work, and keep the proof.** An implement unit's change is an Orbit autonomous-engineering task in its
  own workspace; a build or test unit drives the task its dependency handed off; a capability is asked once, read only,
  through `invokeBound`, nested on its run's mode. A criterion is VERIFIED only by an engineering task's own
  verification, a declared check or a QA investigation, read back when the run reports.
- **Typed handoffs, honest hosts.** A run's handoff is published immutably and consumed only after scope, freshness and
  contract checks. Claude Code dispatches runs natively and in parallel as `orbit:satellite-reader`, `-designer`,
  `-engineer` and `-verifier`; Codex, Antigravity CLI and Grok Build run them serially and say so. A host capability is
  verified only on a native acceptance receipt for the same source (`satellite/acceptance/`).
- **Recovery never resends.** A worker holds a lease while its provider runs and is fenced if reconcile closed its
  action; reconcile reads every open action back from its owner and leaves a write it cannot prove AMBIGUOUS.
- **Satellite Live.** `live status`, `live watch` (`--plain`, `--jsonl`, `--since=o=<n>`), the full-screen `live tui`
  with nine views, and `live open` beside the session: every line as an `orbit.satellite.event/v1` event, each run in its
  own mode, the viewer's state apart from the mission's, and this session's tool calls beside it.

## 0.1.0

Autonomous test generation and sandbox verification (ADR 0031-0040): from an accepted requirement to a generated test
that runs in an isolated sandbox, earns a verification outcome its host decides, and reaches a frozen assessment and a
report -- for a frontend, a synchronous backend, a scheduler, messaging and security alike.

- **Obligations, derived, never guessed.** An investigation's ACCEPTED plans, read against a frozen System Graph, become
  test obligations (`autonomous-qa derive`): a criterion's structured expectations, the graph node it is about and the
  SHAPE of each kind of property (`src/qa/obligations/shapes.mjs`), with applicability, unknowns and authority derived.
  An obligation's slots are the expectations that state it (`for`), and a design must rule on each of them.
- **Designs, compiled, never trusted.** A host proposes a skeleton; the engine compiles every verdict from an accepted
  criterion into a predicate TREE the evaluator interprets (never `new Function`), every window from that criterion's
  own `within`, and -- for a page -- every wait and reader script from templates that only read the DOM. A skeleton
  carries no `expect`, `js`, `wait` or `status`. Controls are held to what the test can show of them.
- **Runs in an isolated sandbox, judged by the host.** A frozen version runs only in a worker whose isolation is
  attested (Docker: an internal network of the task's own, a read-only root, no capabilities, egress proven to fail),
  with its refs SEALED by the host, its secrets on stdin, identities issued inside the task's network, and every write
  under a grant the engine mints for its fixture (ADR 0037). The worker's envelope is checked and the claim re-derived
  before anything is written; RESULT rows give the word (SATISFIED, CONTRADICTED, INCONCLUSIVE with its reason,
  AMBIGUOUS, FLAKY across attempts …). A dispatch that never settled is read back and reconciled, never resent
  (`autonomous-qa reconcile`).
- **Adapters, not clients.** Backends are reached through family operations (`orbit.<family>.<op>`) answered by the
  adapter a binding selects (`orbit.adapter/v1`); reference adapters ship as packs a project opts into: HTTP
  (`orbit-api-test`), AMQP 0-9-1, NATS JetStream, PostgreSQL state reads and the test-hook protocols for a project's
  scheduler, clock, workloads and identities (`orbit-backend-test`). Support is COMPUTED from conformance-kit receipts on
  real systems (`query adapters --matrix`).
- **Pages in the worker.** A generated UI test drives its own headless browser in the worker, as the identity its
  design approved: one engine-written route carries that identity's credential to the bound origin alone, never along a
  redirect or to another host, and lets a write through only under a page grant this run was minted.
- **Security, from evidence.** The Security Auditor assesses the controls in effect (ASVS 5.0.0 L1 by default, labelled
  with the OWASP Top 10 2025 and the API Security Top 10 2023; catalogs a person adds, adopts and enables in Orbit
  Control) from an investigation's own record (`security-audit assess --investigation=<id>`): verified, a finding with
  what it stands on, inconclusive when a positive control did not hold, pending while a role is owed.
- **The system graph and reverse engineering.** Architecture keeps node and relation facts; `architecture graph`
  projects them with their evidence and freshness; `orbit-reverse-engineer` is a standalone pass.
- **Contract readers.** `qa-plan expects <contract.json>` reads an accepted OpenAPI 3.x, AsyncAPI 2/3 or schedule policy
  into candidate expectations a person puts in a criterion -- stating only what the document states.
- **Live and Control.** `o` in the full-screen viewer inspects the generated tests a viewer follows; Orbit Control shows
  an investigation's generated tests, their designs and frozen cases, and the limits a generation is held to.
- **Native acceptance.** `node acceptance/run.mjs` takes an example project on two stacks (RabbitMQ, NATS JetStream)
  through the real CLIs from nothing, in every planted-defect variant, and holds every generated test and every security
  control to `acceptance/truth.json`, with no container, network, volume or secret left behind.

## 0.0.4

- Reusable, governed skills (ADR 0030). A generated playbook may DECLARE its workflow (`workflow.json`,
  `orbit.skill-workflow/v1`): steps, each a capability the playbook needs, typed input bindings, typed outputs, an output
  contract, evidence, retries, a timeout, an approval -- data the engine interprets, never code. Validation refuses any
  undeclared field, cycles, unsafe bindings, recursion, bounds past their limits and a step no owner gate can serve, and
  a dry run carries the workflow over typed stand-ins.
- The coordinator RUNS a declared playbook at its playbook step: pinned to one version for the whole run, each step
  recorded before it is asked, its provider picked by the resolver at that moment, every call through the MCP broker
  (now reading only for these calls) or the capability pipeline -- `invokeBound`, the door `invokeNeed` uses. A step is
  VERIFIED only by a record its owner proves; a call that answered within its contract is reported. Reconcile closes an
  interrupted read as INTERRUPTED and anything that may have written as AMBIGUOUS, never replayed.
- Goals plan from a validated structured `intent` (category, work kinds, capabilities, verification, dependencies,
  missing prerequisites) instead of English keywords: the same goal in Vietnamese and in English plans the same. Units
  declare their routing intent (`automation start --intent=`) and their goal (`--goal=<goal>:<unit>`, linked back); a
  unit a missing prerequisite blocks is unresolved and never started; planning again writes `plan-2`.
- Skill discovery and review: `skill-factory discover --for=<capability>` (REUSABLE with its pin, or which gap it is --
  a provider present but not ready here is now an ENVIRONMENT_GAP), `workflow <id|pin>`, `runs <id>` and `review <id>`,
  read from the project's coordinated workflows; a review proposes a successor and never writes one.
- Orbit Live draws a declared run nested under its plan step -- the pinned version, each step's word, its tool, the
  provider it went through, how long, its retries and the approval it waits for -- and NOW names the step being
  carried. The feed sends one `skill-view` per pin; `planViewOf` is the one projection of a plan the pane, the Plan view,
  `live status --json` (new `plan` field) and Mission Control share. Mission Control: `GET …/tasks/:id/plan`, a Plan card
  on a workflow's page, and a declared skill's workflow, runs and review on its Automation page.
- Hardening: a coordinated workflow's journal is its engine's alone -- what it reads back (steps, plans, pins, runs,
  goals, a child task) and every non-person line need the coordinator's door or Control's, so a terminal can no longer
  forge them; `automation settle` and `reconcile` load the project's capabilities as `step` does.

## 0.0.3

- Orbit Live's orbit turns the whole time a viewer is open (ADR 0029), in every state of the task -- ORBITING, IDLE,
  WAITING, BLOCKED, COMPLETED, DISCONNECTED -- on the viewer's own monotonic clock, never on evidence. The badge's word
  is still the indicator's, moved only by evidence (ADR 0022); the orbit changes only its satellite's tone, peach while
  the task moves and grey otherwise. `pane.animation: off` keeps it still, and the new `pane.orbitSpeed` (slow,
  normal, fast) sets its pace.
- The orbit is geometry: a planet and a satellite on an ellipse of Braille dots, sampled a dot at a time
  (`src/live/orbit/`), in three sizes -- the header's (5 cells, 3 in a narrow pane), the badge's (3) at the same angle,
  and a 9×3 one in the middle of a viewer waiting for its task. The satellite is brighter in front of the planet than
  behind it, a dim track draws the ring where there is colour, and ASCII has frames of its own.
- An orbit tick draws only the rows that hold the orbit (`orbitFrameOf`): `live tui` keeps its one paint and adds no
  timer, a tick costs about 0.03 ms against 0.4-2 ms for the whole frame it drew before, and a terminal that has not
  drained skips a tick, never a line. `test/perf/live-orbit.bench.mjs` measures it; `live tui` itself spent about
  0.35% of a core more with the orbit turning than still.
- The screen is a table of REGIONS (`src/live/tui/regions.mjs`): top, body, bottom. Beside an AI CLI on bands the rules
  under the header and over the footer give way to the bands, as Orbit Live's look draws them.
- The pane, closer to its look: the badge has edges, peach while the task orbits and the indicator's colour otherwise;
  the tabs are each key over its label with the view's words over two rows, one row where everything fits, and two rows
  of three in a pane of 40 to 55 columns so no label is cut; NOW's labels share one column; a header names a task's
  kind (`engineering`, `workflow`); below 60 columns the header keeps the badge whole and the footer is compact.
- `live pane`'s `orbit` is `{ moving, revMs, variant, rings }`: Claude Code's docked pane turns the header's two
  orbits at one angle, in every state, on its own clock, with a border round the badge in the state's colour.
- Tests in a real pseudo-terminal: left alone the viewer draws many header frames with one clear of the screen, and
  `q`, Ctrl+C and SIGTERM each give the terminal back and end the process.

## 0.0.2

- Orbit Live's pane as drawn (ADR 0028): a bordered badge on the header (the orbit, a dot, `ORBITING`) with the
  workflow's age, the views' keys over their labels with the view's words beside them, `TASK EXECUTION` with `NOW` on
  its right, the baseline as a bordered card, the step in focus in the brand's tone, a workflow's milestones under the
  step whose turn it was, progress bars on the right edge and a status bar spread across the width -- in a terminal and
  in Claude Code's docked pane alike. `live pane` adds `headerParts`, a row's `box` and a view's `hint` (version 2).
- `live tui` draws every frame of the orbit while it turns, instead of one a second.
- The release skill lists all eleven gates `ship.mjs` runs.
- Found by running a consumer-style project end to end (six cases, ui · api · sql): a pretty-printed `eval` result is
  read whole; a `${PARAM}` in an api match stands for the map's templated segment; an exclusion may name the
  `technique` that settles a security obligation (plan schema, optional); effect coverage asks only controls that
  commit; a log or report outside the checkout prints whole; `init`, `draft write` and `qa-plan` say what is next.
- Antigravity CLI 1.4.2's file tools (`read_file`, `write_file`, `edit_file`) are observed, with captures; a command
  whose result a host did not report shows `not reported` in the trail, never failed; a host session's missing browser
  names its own run directory.
- Windows: one checkout is one id whatever way its path is spelled (the file system's own real path, so a short 8.3
  name and its long form agree); text checks out with LF and frontmatter is read across CRLF; the anchor git reads an
  empty config file of its own instead of the null device; process ancestry is asked the way a cold machine answers.
- A hook Claude Code delivers twice is one call: its `tool_use_id` is now the call's delivery key, as Codex's and
  Grok's are.
- CI runs `ship.mjs --ci`: native host acceptance is awaited there (`wait`), never failed; a release still requires it.
  The pane's own test runner is `skills/orbit-release/pane-check.mjs`, so `node --test` leaves it alone.

## 0.0.1

Orbit's first open-source release, under the MIT License ([LICENSE](LICENSE)): plugin `orbit`, skills `orbit-*`, CLI `orbit`, store `~/.orbit`, configuration `ORBIT_*`. Repository: [cuongngoht/orbit](https://github.com/cuongngoht/orbit).

- Goal orchestration (`orbit`, `src/goal/`, API `orbit.goal/v1`).
- Orbit Help (`orbit-help`) for navigation and bounded coordination.
- Direct extension API `orbit.extension/v2` and capability API `orbit.capability/v1`.
- Fresh-install-only layout 3 storage, MCP state schema 3 and automation settings schema 3.
- Unsupported state and contracts are refused unchanged; no automatic conversion or aliases.
- Orbit Live's terminal look (ADR 0027): a palette at 256 or 24-bit colour with bands (none on a light background), tabs under the header, an orbit that circles only while the task moves, and `ORBITING` as the moving state's word. The starship lane and `pane.starship` are gone.
- `/orbit` opens Orbit Live as `/orbit-help` does.
