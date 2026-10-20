# The module map

What every directory and module of this engine is FOR, one entry each. It is reference: read it before you add,
move or split a module, and when a name in the code needs its context. The rules that bind every change -- the
dependency direction, who owns what, the rules that are enforced -- stay in [AGENTS.md](../../AGENTS.md), which every
agent has loaded; this map does not repeat them and they win where the two seem to disagree.

```
cli/           composition roots: argv → build a ctx → call src → exit code. No logic.
src/errors.mjs the three typed stops, as a LEAF -- the ports throw them too
src/constraints.mjs  a field table's JSON-Schema fragment, ENFORCED (dsl and project both use it)
src/scrub.mjs  masking by SHAPE, as a LEAF -- the committed corpus and the lessons both pass
               through it, and neither may import the other
src/project/   resolve repoRoot, dataRoot and storeRoot; Git identity + checkout bindings; explicitly named data directories.
               data-home.mjs: one explicit home stamp, else the store; read, never written; `knownCheckout` in
               repository.mjs is what the hooks ask before they observe a checkout
src/tests-tree.mjs  a LEAF: where a case, a plan and a report sit -- one folder per SCREEN, the
               two-level scan, `folderOf` (a case's `start`, `_no-screen`, never an unsafe id)
src/seat.mjs   (1.8.9) a project's SEAT in the store: `ensureProject` -- bind the checkout, and write if absent
               a project.json naming it and the generated schemas; never a screen, a case or a guess, never a
               byte in a checkout. What /orbit-help, init and a workflow's start call. Root-level
               because it knows a seat's CONTENTS (the dsl's and the plan vocabulary's schemas)
src/version.mjs  which engine this IS, read once from package.json -- a LEAF, because an
               extension declares which engines it was tested against and the registry of what a
               project generated records which engine generated it
src/dsl/       the DSL as DATA (core/fields.mjs, core/verbs.mjs) → registry.mjs is the ONE
               derivation over them plus whatever a project registered; verbs.mjs and fields.mjs
               are views of it taken over CORE, for everything that reasons about the ENGINE's
               own grammar rather than one project's · validators.mjs the extension rule chain
               → generated schema; rules/ one family per file
               escape.mjs (a value is encoded for the language it lands in), sql-text.mjs,
               bindings.mjs (which names a step may use, step by step) · page.mjs (does a case
               need a browser page at all: by its verbs for validation, by its capabilities'
               `page: false` for a run) · digest.mjs (a case's identity as evidence: the sha of
               the case as written, which a run records and coverage compares)
src/graph/     the UI map: load, walks (surface, route), integrity findings, record-edge
src/extensions/ what a PROJECT taught this engine, from OUTSIDE every repository.
               contract.mjs is the current published shape · manifest.mjs validates it · loader.mjs
               reads the store room and registers, recording every refusal and never throwing ·
               context-v1.mjs is the PUBLIC surface generated code gets (a Facade: seven
               things, and the absences are the security argument) · lifecycle.mjs is
               scaffold → verify → register → status, where verify loads a candidate through the
               REAL loader into a throwaway context · engine-range.mjs a documented semver
               SUBSET that says "cannot tell" rather than guessing · loader validates the one current
               API directly, without conversion · knowledge-v1.mjs the published shape of a
               relation ROW (id · role · cardinality) and an INTERPRETER (understands · interpret),
               and the four ROLES a derivation walks as columns · knowledge-parts.mjs the registry
               both register into: all or nothing from an extension, row by row from data, a
               differing duplicate refused · registries.mjs the ONE recipe for an empty set of
               registries (a throwaway context, Control's summary, `query extensions`)
src/capability/  one named thing the engine can ask of the world outside the browser.
               contract-v1.mjs · registry.mjs (namespaced ids, duplicates REFUSED) ·
               invoke.mjs the ordered gate table every invocation passes: input · mutation ·
               tools · invoke. There is no second route, and a capability NEVER decides a verdict
src/browser/ database/ identity/ frontend/ process/ memory/   PORTS with one real adapter each; fakes in test/fakes/
               process/ is the one door to a child process for generated code: argv only, never
               a shell, so a value containing `;` is an argument and not a second command.
               `runObserved` (1.8.5) is run()'s answer with the output handed to an observer as it
               arrives, one process group per run on POSIX, an observer that throws let go. On
               Windows a command a PATH names through an npm `.cmd` shim is started as the script
               the shim forwards to (shim.mjs, which tool detection reads too), never through cmd
               frontend/ is the SOURCE TREE port: commit, files, read, fingerprints, search,
               changed -- all through git, and there is exactly one commit() in this engine.
               composite.mjs puts SEVERAL checkouts behind the same six methods -- and, for
               runtime only (`submodules: true`), a checkout's initialised git submodules under
               their own paths, because that is where a start launches what they hold: the primary
               keeps plain paths, every other declared checkout is namespaced `<alias>::`
src/memory/    the run ledger + the notes + a run's EVIDENCE: three rooms in the machine store
               (store.mjs names them). None of them ever lives in a consuming repo.
               support.mjs is the confidence rule engineering and knowledge SHARE (two
               independent sessions, nothing against = certain; contested stays possible)
src/hash.mjs · src/quote.mjs · src/freshness.mjs · src/tokens.mjs   four more LEAVES: the one
               hash, the one door free text comes through, the one answer to "has the tree moved
               under this fact" (fresh · stale · unknown, scoped), and the one reduction of a task
               to the tokens it asks about. All here because two branches need them and neither may
               import the other
src/store/     WHERE everything this plugin keeps lives -- OUTSIDE every repo (~/.orbit,
               or ORBIT_STORE_DIR, ONE variable for the WHOLE store). resolve.mjs is the table ·
               context.mjs binds it and stamps LAYOUT · io/atomic/lock. Six rooms, resolved once:
               lessons · architecture · drafts · state · the ledger and notes · evidence.
               1.8.9: tree.mjs (a LEAF: a tree's files and their digests, what publication
               share) · bootstrap.mjs (a seat's store half: prepare, then write each absent file under the
               lock) · publish.mjs (a PERSON's import and export between the store and a checkout: SELECTIONS,
               STATES SAME·CREATE·MODIFY·CONFLICT, AUTHORIZE -- Control's door or a person typing at a
               terminal -- re-planned under the authoring lock, records in imports/ and exports/, written last) ·
               repository.mjs `restamp` (the one rewrite of store.json: a person's `dataHome`)
src/learn/     LESSONS across sessions. store.mjs is their room · lessons.mjs is the port ·
               families/ one analysis per file · confidence.mjs the ladder as a table ·
               projection.mjs is their SECTION of the shared region
src/architecture/  what this project IS, as evidence-backed facts kept beside the lessons.
               MEMORY FIRST: ensure.mjs is an ordered table deciding whether the repository has to
               be read AT ALL -- the normal answer is CURRENT and costs a few git calls. vocab +
               fields as data, enforced by constraints.mjs · one file per fact (lose the smallest
               thing it is safe to lose) · freshness is SCOPED, so an unrelated commit leaves a
               fact alone · analyzers/ four pure (input) => {facts, unknowns} · capability.mjs
               GRADES a token search and holds NO list of capability names -- one arrives as
               tokens off a task, and a row here naming one would be a product learned
src/engineering/  how this project TENDS or is REQUIRED to build code, evidence-backed and kept
               beside the architecture facts, never duplicating what architecture already owns.
               A second axis architecture does not have -- `strength` (enforced · adopted ·
               observed · suggested), orthogonal to confidence, because architecture never tells
               anyone what to do and an engineering fact can · candidate.mjs is what a PROPOSAL may
               say: never id/confidence/support/status/fingerprint/commit, and cross-field rules
               as SPECS rows (an invariant is only enforced; enforced needs `enforcedBy` naming a
               gate the engine can see, so a person's word buys adopted, not enforced) ·
               ingest.mjs is the ONE write door: stamp session/commit/fingerprint, journal the
               observation (observations/, append-only, `replay` re-derives every fact from it),
               then reconcile.mjs, the ordered table (contradict · new · adopt · confirm · extend)
               that DERIVES confidence (two independent sessions, nothing against = certain),
               counts sessions as a set of src/memory/session.mjs marks, moves strength only on
               `adopt` for an explicit `--human` record, and never overwrites on a contradiction
               · ensure.mjs + freshen.mjs RE-MEASURE, never re-derive: the one write is `status`
               · recall.mjs + vocab ROUTING: the few facts a task touches, each with how far it may
               steer the work (only a gate or a person binds) · working-set/ what a session
               TOUCHED, metadata only (collect · fold · store) · observe/ milestone.mjs decides
               WHEN (a commit, the end of a session, a check passing after an edit -- never every
               tool) and analyzers/ propose from file NAMES and checks, never contents; every
               candidate goes through the same contract and reconciliation, untrusted. 1.8.9:
               observe/task.mjs turns a FINISHED task's view (handed in by cli/, never imported) into the
               observer's input -- a completed task's changed places and the declared checks a succeeded
               receipt satisfies -- with analyzers/verified.mjs proposing from them; views/doctor.mjs is
               `engineering doctor`, the first reader of the observer's findings
src/ecosystems/  a LEAF: what a manifest FORMAT is. contract.mjs the canonical manifest record
               and RELATIONSHIPS (direct · imported · managed · transitive -- only a row that
               `declares` is a dependency, so a centrally managed version never is) · registry.mjs
               { id, detects(path), parseManifest(path, text) }, duplicates refused, fail-soft,
               an adapter never sees `<alias>::` · reach.mjs which units a subtree manifest
               (a shared build file, a central list) reaches: the NEAREST file of its name above a
               unit, in its checkout and the unit's own ecosystem -- asked by intelligence and by
               runtime understanding, so there is one answer · node.mjs, dotnet.mjs (+ msbuild.mjs,
               a tolerant reader) and builtin.mjs, the one place the shipped adapters are bound.
               Architecture's manifest analysis and project intelligence both read through it
src/intelligence/  PROJECT INTELLIGENCE: which technologies are here and what the code uses each
               FOR. It names no ecosystem, format, product or idiom (a test greps it): three
               registries -- ecosystem adapters, technology DESCRIPTORS (data, matched as a
               Specification), usage ANALYSERS (pure over one file, canonical usage/wiring out) --
               and stages that each replace only what they own: manifests/ (every dependency
               kept, recognised or not) · technology/ (match + the maturity ladder: declared ·
               used · configured · used-for · architectural-pattern CANDIDATE) · usage/ (one
               search, bounded reads, facts scoped to the files that showed them; links.mjs
               traces a registration to the technology its implementation uses, computed never
               stored) · integration/ (keyed by system AND operation, so one system reached two
               ways is two facts) · resolution/ the CapabilityResolver: reuse · build · unknown ·
               blocked, two ordered tables, and it never generates, registers or writes ·
               bridge.mjs observed engineering CANDIDATES, pure. ensure.mjs is a memory-first
               decision table over two stages; context.mjs takes the registry and the source port
               handed IN by cli/intelligence.mjs, the one composition root
src/knowledge/ PROJECT KNOWLEDGE: what this project's concepts have to do with one another, in
               which CONTEXT, on what evidence -- and what a change would have to prove. It names
               no technology, product, domain or host (a test greps it). A claim is
               {subject, relation, object, context}; the id hashes the canonical context, so two
               contexts are two claims and nothing collapses into a global rule. vocab.mjs the
               tables (SOURCES + host-memory, LAYERS orbit·organization·project·session, PURPOSES,
               AUTHORITY -- rule · adopted · source · confirmed · host-memory · inference, DERIVED
               on every read and never stored) · model.mjs + fields.mjs + candidate.mjs what a
               claim and a candidate may say · applies.mjs excluded · holds · conditional, and
               specificity is NESTING only · vocabulary.mjs relation rows offered layer by layer
               (an extension, catalog/knowledge.json, the organisation's room, the project's) --
               a relation no row declares is kept, recalled and shown, and derives NOTHING ·
               record.mjs + reconcile.mjs + ingest.mjs the one write door (contradict · unfounded ·
               new · adopt · confirm · extend; ingest is the only caller of `know.save`) ·
               query.mjs rivals settled at READ time by the WINNER table, never overwritten ·
               derive.mjs consequence → implementation → observation → capability, bounded,
               cycles recorded · interpreters.mjs an extension's code, guarded, on frozen input ·
               verify.mjs every capability need through the EXISTING requirement graph and
               resolver, never around it · opportunities.mjs a gap remembered as ONE opportunity
               per capability, the engine's moves and a PERSON's in one TRANSITIONS table ·
               surface.mjs whether to interrupt anybody, as an ordered table with a sentence per
               row · host-memory.mjs the provider contract, and a hint is a SESSION claim, never
               stored · declared.mjs an organisation's claims, read live · summary.mjs Control's
               read. cli/knowledge.mjs is the one composition root
src/trace/     the SESSION TRAIL, event-driven: events.mjs every event type as a row with an
               ALLOW-LIST of fields (a field nobody declared never reaches the disk) · log.mjs the
               append-only port (a shard per day and host, 4 MB cap then one `trace.dropped`, 90
               days, fail-open, a tolerant reader) · emit.mjs the producer side · prompt.mjs a
               prompt as a SALTED fingerprint and a length, never its text · commands.mjs a Orbit
               command's subcommand only when that script's own usage header documents it ·
               projections/ pure folds rebuilt on every read (turns: the decision trace, one turn
               per prompt, followed · diverged · worked directly; usage: counts with their
               denominators, flows, least privilege) · views.mjs `cli/trace.mjs`. Written by the
               router's hook and the lifecycle subscriber, read by cli/trace.mjs and Control
src/lifecycle/ ONE lifecycle event for any host (event.mjs: the adapter's `normalize`, the host
               session hashed), and dispatch.mjs: every subscriber that listens, each isolated,
               at most one speaking to the host. subscribers/ switches · learning · working-set ·
               engineering · trace (a PRODUCER: one trail event per moment, `records: false`, never
               speaks) -- and router.mjs hands the trail its decision and the prompt's
               fingerprint, never the prompt. A composition-layer caller like src/help/: cli/learn-hook.mjs builds
               the table and the lazily bound contexts, so nothing here reads process.env
src/resources/ the EFFECTIVE RESOURCE REGISTRY: what Orbit can use HERE, one provider per family --
               skills · agents · mcp · tools · capabilities -- each isolated, so one that throws
               empties only its own family. model.mjs the small common shape: FOUR answers kept
               apart (enabled is wanted, runtimeReady could run now, available is both, eligible
               is what the resolver may consider) + key (unique: managed:x ≠ external:x),
               ownership, selection, priority, policy, routing (provides · optional · signals ·
               needs) · registry.mjs · providers/ (capabilities = the engine's BUILT-INS from
               catalog/components.json + the project's registry) · plugin.mjs (what ships, read
               off the tree) · compose.mjs the ONE recipe the prompt router's hook, Orbit Control
               and cli/mcp.mjs build it (and the MCP invocation context) with · observe.mjs
src/routing/   the PROMPT ROUTER, a PLANNER: intents.mjs (twelve broad intents as a table, generic
               words only) · classify.mjs (each requirement with its level) · graph.mjs (the
               REQUIREMENT GRAPH: required · conditional · optional · transitive, expanded through
               chosen providers' needs/optional, bounded, cycles recorded) · select.mjs (ONE
               provider per requirement: an ordered table of comparisons, deterministic; an
               optional need resolved only when the task names its provider) · resolve.mjs
               (RouteDecision v2: graph, selected, approval, blocked, missing, plan) · explain.mjs
               (DERIVED views for Control: a skill's resolved needs, a resource's potential
               consumers) · format.mjs (≤ 2 KB, or nothing). It connects, starts, installs and
               writes nothing, and the prompt never leaves its memory
src/mcp/       MCP as a MANAGED RESOURCE, not a feature of the host. identity.mjs (owners and the
               compound key: orbit-managed · external · catalog) · managed.mjs (what a
               managed definition may say: secrets NAMED by the variable that supplies them,
               never held) · definition.mjs (the HOST shape, and what of it may be SHOWN) ·
               catalog.mjs (known, never installed) · state.mjs (current MCP state, schema 3:
               managed · external · checks · policies · approvals · receipts, schema 3 only) · effective.mjs
               (managed | external | catalog, runtime looked for on the disk) ·
               policy.mjs (what a policy document may hold) · manage.mjs (a PERSON's operations:
               add, update, remove, enable, selection, policy, approve, adopt) · install.mjs
               (runtime strategies: remote-http installs nothing, archive stage-verify-promote,
               receipt LAST) · connect.mjs (resolve secrets from the port and a runtime from its
               receipt; BASE_ENV for a managed child) · runtime/ (the BROKER: session, http,
               stdio -- one protocol session, a deadline per request, McpStop) · invoke.mjs (the
               ONE gate table every managed call passes) · activity.mjs (one allow-listed,
               scrubbed JSONL line per event, fail-open) · secrets.mjs (the secret PORT, env
               today) · port.mjs (the host port: OBSERVATION ONLY) · probe.mjs (one handshake)
src/project-report/  a PROJECT REPORT for a product owner, generic: it names no provider, product or
               host (a test greps it). window.mjs the window and the local calendar (Node's Intl,
               so parts need no zone data) · settings.mjs the project's settings, every write
               naming the revision it read · collect.mjs the one collection -- the credential read
               at the moment of use and handed to the provider's collector and nothing else ·
               snapshot.mjs written ONCE, after a scan for the credential in every spelling ·
               compose.mjs which parts run, as ordered tables (admit · replacement · dependencies ·
               order), every exclusion a sentence · stage.mjs a run COPIES and hashes the
               extensions it uses and runs the copy · envelope.mjs + execute.mjs + outputs.mjs one
               part as its own process: envelope in, one result out, logs apart, no credential,
               exit 2 a data gap and 3 the part's own failure · compute.mjs · assemble.mjs · runs.mjs
               · baseline.mjs (only a comparable run) · retention.mjs · index.mjs (run · render ·
               plan · status). cli/project-report.mjs is the composition root; the pack binds it
src/connections/  a CONNECTION: provider, host, organization and a credential REFERENCE, never the
               credential. model · store (machine-wide, control/connections) · manage (a person's
               create, change, delete, set or clear the credential, test -- masked, kept as lastTest)
src/secrets.mjs  a LEAF: the ONE secret port -- an environment variable's name, or {vault: id} in
               the OS secret store a composition root binds; read at the moment of use, never
               returned; no store bound is BLOCKED, never a plaintext fallback. src/secrets.mjs
               re-exports its environment half
src/process/env.mjs  a LEAF: the few variables a child needs to START, and nothing else of ours
src/policy.mjs a LEAF: allow · approval · deny, capability-first with workflow exceptions and
               read/write operation rules -- the one answer the resolver and the MCP gate share
src/context/   PROJECT CONTEXT as a table of what composes it (architecture ensure, intelligence
               ensure, engineering recall, the working set, the resolver), clipped per section;
               cli/context.mjs runs it -- the engine's built-in `project.context`. status.mjs (1.8.9): ONE word
               for how much of it rests on evidence (NOT_INITIALIZED · BLOCKED · BOOTSTRAPPED · STALE · PARTIAL ·
               READY), a pure table the context command, help and the context steps all read
src/tools/     index.mjs the doctor's port, plus the tool manager: catalog · detect (project ->
               orbit-managed -> system, each ASKED its version) · effective (desired vs observed) ·
               install (receipts) · archive (a PINNED SHA-256, via src/store/archive.mjs) ·
               observe · real (the effects) · context (the one detection context a composition root builds)
src/catalog.mjs  a LEAF: read one of the plugin's catalogs, versioned
src/store/control.mjs  the control rooms under storeBase -- configuration (control/) apart from
               installations (runtimes/): mcp, mcpReceipts, mcpRuntimes, tools, toolReceipts,
               toolRuntimes, controlRuntime, activity. Documents say their schema, are atomic, a
               newer schema refused rather than overwritten, a corrupt one copied aside
src/store/archive.mjs  the ONE stage -> SHA-256 -> unpack -> verify -> promote transaction both
               private installers share (tools, managed MCP runtimes) -- and nothing else
catalog/       the plugin's IMMUTABLE product data: components.json (what each skill and agent is
               FOR -- provides, needs, optional -- and the engine's builtins), mcp.json (servers
               it knows: Microsoft Learn recommended, others recognised; how each installs),
               tools.json (pinned installs), knowledge.json (exactly one GENERIC relation per
               derivation role -- a starting vocabulary, never an ontology). This is where product
               words live, so src/ never needs them
src/help/      orbit-help's one view: architecture + engineering + the QA plans + the lessons,
               gathered read-only, and -- with `--for` -- the task's intent (a table word, the text
               dropped); exactly one recommended `orbit-*` workflow with why -- a data table
               (vocab.mjs) the first matching row decides, never a model's guess
src/network/   a request as an investigation may KEEP it, pure: canonical.mjs (variable path segments
               by SHAPE, query keys only) · redact.mjs (headers as an ALLOW-list: names, a few safe
               values, correlation and idempotency keys as fingerprints) · fingerprint.mjs (salted
               per investigation) · observe.mjs (what one request shows, and NEVER_OBSERVED: what
               the adapter cannot show for any) · duplicates.mjs (groups, then EXPLANATIONS, an
               ordered table: every legitimate explanation before any suspicion). It names no
               endpoint, framework or product
src/investigation/  AUTONOMOUS QA's engine half -- Claude reasons, this acts inside the gates and keeps
               what it saw. vocab.mjs (MODES, LAYERS, STATES, OUTCOMES, ORACLES, and KINDS: the
               journal's per-kind field ALLOW-list) · settings.mjs (a PERSON's approvals, revisioned;
               a session cannot write them) · tenancy.mjs (the declared authorisation contract, pure)
               · store.mjs (one room, an append-only journal, nothing pruned) · model.mjs (the one
               fold) · gates.mjs (ONE ordered table: blockers() for a plan, gate() before every
               action) · plan.mjs · surfaces.mjs (what the map says a control does; unknown means
               "may write") · act.mjs (the observation boundary) · explore.mjs · data.mjs (read-only,
               map tables only, a declared consistency window, counts never rows) · security.mjs
               (the tenant matrix through enterIdentity; a status and a yes/no, never data) ·
               findings.mjs (five ordered tables; CONFIRMED only on an oracle that confirms) ·
               reproduce.mjs · drafts.mjs (a DRAFT only on an accepted oracle, through validate()) ·
               activity.mjs (ACTIVITY: an investigation's lines as LIVE QA activity, an allow-list per kind; SILENT
               names what a page is not shown, and every kind chooses; never a header, a body, a query or a nested
               object) · discover.mjs (which investigations were begun against a task: by the id's time, then the
               first line, read once each, bounded; read-only, and a task id arrives as a string) ·
               input.mjs (the ways in: screen · pbi · hybrid, derived; a snapshot keeps ref,
               revision, digest and authority, never text) · THE LOOP: obligations.mjs (what is
               still owed, derived on every read: seven kinds, a frontier in rank order) ·
               decision.mjs (a host's decision judged before anything runs: ordered rules, the
               forbidden fields refused by name, a duplicate replayed or AMBIGUOUS) · dispatch.mjs
               (ACTIONS: every step a decision may take, each the SAME gated operation the CLI
               calls) · stop.mjs (STOPS: why to stop now, or null) · loop.mjs (context writes
               nothing; step = record the decision, run it, settle it; the journal lock never held
               across a step) · receipts.mjs (what a settled obligation came to, scoped to the
               tracked files it rests on) · memory.mjs (receipts against an accepted oracle into
               project knowledge, through the stamped door) · runs.mjs (a run linked as execution).
               It reads browser, graph, dsl, run's poll and identity, store, network, capability's
               invoke (a read-only data check `via` a capability), qa's commit (what a scenario
               committed to) and knowledge's stamped judge and ingest (receipts into claims);
               nothing reads it back but cli/autonomous-qa.mjs, src/report/investigation.mjs and Control
src/sources/   ACQUISITION of a work item, provider-neutral -- it names no product, vendor, host or tool
               (a test greps it). contract-v1.mjs (the acquisition capabilities, the SOURCE_KINDS with
               their `authorityBearing` column, the reader port) · fields.mjs + model.mjs (identity, ids,
               the normalized work item, and a record that keeps ref, revision, digest and whose word,
               NEVER text) · store.mjs (records, the project's binding: a person's outranks the engine's,
               and a stale revision is refused) · readers/ (a capability, an MCP tool mapped by data) ·
               descriptors.mjs + resolve.mjs (the LADDER: explicit · work · binding · registry · tool ·
               gap, ordered, the last always answers; it asks the resolver knowledge already has and
               writes only the one opportunity per capability) · acquire.mjs (a bounded walk of
               relations, an untrusted envelope for the text, an engine binding after the first read) ·
               envelope.mjs · index.mjs the COMMANDS table. Provider knowledge is DATA in the pack
               skills/orbit-requirements/, never here
src/requirements/  WHAT A REQUIREMENT SAYS, kept apart from how anything is built: imports no
               frontend, architecture, intelligence, run or report (a test greps the imports). vocab.mjs
               (STATUS read by columns, CLARITY, AUTHORITY_ORDER, the journal's KINDS) · fields.mjs +
               model.mjs + candidate.mjs (a fact is a slot -- subject · aspect -- with a bounded, masked
               `says`; a candidate may not bring what the engine stamps or claim `decided`) · store.mjs
               (a journal written BEFORE the file it describes, torn-tail repair, write-once decisions and
               snapshots, superseded versions kept) · reconcile.mjs (RULES: refused · decided · confirm ·
               restated · held · changed · rival · new) · ingest.mjs (the ONE writer; recover heals a crash
               between journal and file) · questions.mjs (one per set of slots, the engine never answers,
               REOPEN only when a later revision contradicts) · roundtable/ the CLARIFICATION round:
               vocab (perspectives, verdicts, limits) · digest (which state a round reviewed) · model (a
               round as a FOLD over two journal kinds, and the STOPS table) · review + critique (what a
               hand-in may say, judged whole) · clarify (the three stages, the one place it touches the
               room) · progress (the board). The engine calls no model: a host reviews, this keeps the
               state and decides nothing · record.mjs (the judge: all or nothing, only
               authority-bearing sources) · snapshot.mjs (immutable, its id a function of its content) ·
               replay.mjs · views/ · index.mjs the COMMANDS table
src/goal/      ORBIT GOAL: full-text specifications, analysis, work-unit planning, execution links to
               automation tasks, acceptance verification and resume. store.mjs the room beside work
               and tasks · spec.mjs user-submitted text (orbit.goal/v1) · model.mjs fold · plan.mjs
               DAG · execute.mjs coordinator ports · verification.mjs completion gate · live.mjs
               projection. Imports leaves and store only; cli/orbit.mjs is the composition root.
src/work/      WORK: what is being done about a requirement, resumable by another session. vocab.mjs
               (NEED_TYPES with a rank, the journal's KINDS) · store.mjs (one journal per requirement) ·
               model.mjs (a fold; NEED_STATES an ordered table; the frontier) · needs.mjs (what a need may
               say: a CAPABILITY, never a provider) · bind.mjs (bindings through knowledge/verify's
               `resolved`, never a second selector; a provider is identified by kind AND key, a fingerprint
               says when it moved) · freshness.mjs (INVALIDATE: a fact, a binding, a scope -- dependents
               only, once per `from`) · resume.mjs · invoke.mjs (INVOKERS: the MCP broker or the
               capability pipeline, no third route; a receipt keeps digests and references) · refs.mjs ·
               memory.mjs (`work-receipt` claims through the stamped door) · actions.mjs · requirement.mjs
               (its ONE read-only look into requirements/) · summary.mjs · views/ · index.mjs the COMMANDS
               table. It never names a provider
src/work/track/  UNIFIED WORK TRACKING (1.8.8, README §4.18): identity, links and a REPORTED lifecycle in the
               work journal, and the ONE read model over them -- never a second journal and never the
               doing. vocab.mjs (LIFECYCLE, EVIDENCE, LINKS, LIMITS as tables) · fold.mjs (the fold over
               `created`/`bound`/`handoff`/`linked`/`state`/`report`: an `eid` is folded once, a closed
               work moves only on an explicit reopening) · ids.mjs (which work a request is: --continue,
               --ref, or session x checkout x digest x generation -- never a title) · write.mjs (the five
               moments, each one locked write, each safe to repeat) · resolve.mjs (a session's CURRENT work
               is its latest binding in the checkout; the bounded scan; list rows) · observe.mjs (a
               session's working-set lines attributed ONLY inside the intervals it was bound; files from
               edit tools, `shared` when another session wrote the path; a check named by its words) ·
               coverage.mjs (what each host lets tracking see, as data) · view.mjs (`workViewOf`, the one
               view Live, the terminal and Control serve) · read.mjs (assembles it over ports the roots hand
               in) · tail.mjs (the working-set port; `workingSetRoom`) · auto.mjs (a task that starts beside
               a tracked work joins it; nothing is created) · say.mjs · index.mjs the COMMANDS table.
               cli/track.mjs is the composition root. It imports no task, no live core and no host
src/task/      TASK EXECUTION: what happened while something autonomous tried to do a work -- never what the
               work needs (that is src/work/), and never the doing (nothing here runs, stops or writes
               anything but a task's journal). vocab.mjs (STAGES with `preparing`/`verifying` columns, STOP_REASONS
               with `writable`, the journal's KINDS with a `material` column, CODES) · fields.mjs (each input
               field as a JSON-Schema fragment, enforced by src/constraints.mjs) · store.mjs (one journal per
               task, the work store's discipline: allow-list, scrub, torn tail, a lock per task and one on the
               tasks room for create) · model.mjs (the ONE fold and `stateOf(model, now)`: APPROVAL_STATES and
               LIFECYCLE as ordered tables, stop reason, repeats, spend) · load.mjs (a task as its checkout
               sees it: another checkout's id is unknown) · rules.mjs (refusal rows in decision.mjs's shape;
               PHASES start · note · record · govern; STALE on a MATERIAL line after the revision a person read)
               · approvals.mjs (fingerprint of type, tool, environment and params -- the params never kept;
               decide once, spend once, consumed BEFORE the action) · ops.mjs (the ONE write door: `apply`
               and `createTask`, TASK_ACTIVE under the room lock) · views.mjs (the one JSON a CLI, Control and
               the page read; readiness from the journal and the registry, never probed) · summary.mjs ·
               machine.mjs (the MACHINE VIEW: registry × tasks rooms, a projection, no index, `rootOf` and
               `since` handed in) · live.mjs (a task as a LIVE page reads it: the same fold and view over a follower, and
               FINGERPRINT, what a person watching cares about, so a view is resent only when it moved -- an expiry
               included) · governance.mjs (OPERATIONS; NOT_TASK names what no task command is) ·
               index.mjs the COMMANDS table. cli/task.mjs is the composition root; Control reads and decides
               through the same table
src/orchestration/  AUTONOMOUS ENGINEERING: what engineering step comes NEXT for a task, and nothing an owner
               already decides. It keeps no lifecycle: every write goes through the task's one door, handed in
               as a port, and every state is read off the task's view and events (journal.mjs). It imports no
               subject -- not task, runtime, work, requirements, investigation or capability (a test greps the
               imports, the side effects, product words and shell words). vocab.mjs (the TASK's stage, stop,
               need, cause and receipt words, asserted equal; DECISION_FORBIDDEN; FAILURE_CLASSES) · stages.mjs
               (STAGES: what each stage allows; MOVES: what a settled action moves, first row, the last always
               matching; CLEARS: what may run while blocked) · decision.mjs (FORM + FRESH rows over a host's
               decision; STALE on the task's revision) · dispatch.mjs (ACTIONS: every step a decision may take,
               each an owner's operation through a port, with `readBack` for reconcile) · readiness.mjs
               (REQUIREMENT and ENVIRONMENT rows over what the owners answer) · checks.mjs (a declared build or
               test command, `safe` only, run argv-only in the workspace through the Process port it is handed;
               with an observer bound, through `runObserved`, its answer unchanged) · activity/ (1.8.5, ADR 0020:
               what a running check is OBSERVED doing, beside the task and never in it -- vocab.mjs KINDS (an
               allow-list per line), LIMITS, the authority `observation` · text.mjs (bytes split before decoding,
               a line bounded by bytes, sequences and controls out, masked) · observe.mjs (one observation: an
               adapter claimed by argv or sniffed from a line, the budget, one append per chunk, the end always
               written) · fold.mjs (the ONE projection every reader shares: counts by a case's last word, no total
               nobody said, gaps said) · tap.mjs (a protocol: leaves only) · generic.mjs (lifecycle only) ·
               source.mjs (the file's path and ACTIVITY_SOURCE, handed to the live core by a composition root);
               a stack's runner lives in skills/orbit-engineer/observers/)
               · failure.mjs (CLASSES over facts; `signatureOf` a TRANSFORMS table) · progress.mjs (NO_PROGRESS
               rows) · review.mjs (scope drift) · verification.mjs (COMPLETION rows) · stop.mjs (STOPS in order
               of urgency; STOP_EVIDENCE for a host's own stop) · impact.mjs (which components a set of changed
               paths REACHES and why: MODIFIED · SHARED · DEPENDENT · UNRESOLVED, over the component graph the
               composition root hands in) · obligations.mjs (the VERIFICATION PLAN: required, excluded, missing,
               each check's state against its baseline, the verification rows and impact receipt it publishes) ·
               policy.mjs (GATED: what needs a person) ·
               workspace.mjs (the WORKSPACE OWNER: owner first, a local clone, refuse what is not this
               task's) · loop.mjs (context · step · finish · reconcile · cleanup · start · resume; the
               orchestrator's own lock is never held across a run) · governance.mjs (OPERATIONS +
               NOT_ORCHESTRATION) · index.mjs the COMMANDS table. cli/autonomous-engineering.mjs is the composition
               root
src/runtime/   RUNTIME UNDERSTANDING: what a CHECKOUT needs to run, whether this machine can run it, and how.
               A fact that differs per checkout, so its own subject over the shared infrastructure and never in
               a project-scoped store. It names no stack, product or vendor (a test greps it) and imports only
               leaves, ports and itself. vocab.mjs + fields.mjs + model.mjs (what a fact may say; STAMPED are the
               engine's) · store.mjs + rooms.mjs (one file per fact under checkouts/<checkoutId>/understanding;
               the live room per host) · ensure.mjs DECISIONS (memory first, ordered: BLOCKED_SOURCE · RESCAN ·
               BOOTSTRAP · UNREADABLE_STATE · READERS_CHANGED · EVIDENCE_CHANGED · CURRENT, scoped to the evidence
               files themselves) · discover/ (readers/ a static table over the EXISTING ecosystem registry and the
               generic file formats; assemble.mjs joins observations to the nearest component; commands.mjs the
               shell-free tokenizer; yaml-lite.mjs) · record.mjs (an agent's inferences: possible, never launched,
               key-prefixed) · components.mjs + requirements.mjs · machine.mjs (tools asked on demand) · resolve/
               (compat · select · plan · os, the matrix per component: pure; a preference narrows and never widens) · providers/ (contract-v1,
               native, devcontainer: rows, not branches; sandbox DELEGATES to them: it is asked only in a sandbox's
               world, answers one candidate per way it could place a component, and adds no way to run a process) ·
               sandbox/ (a TASK-OWNED environment: context.mjs derives it from a person's context, re-rooted on the
               workspace; model.mjs STALE derived on every read; prepare.mjs the ordered steps, each a row naming who
               must act; restore.mjs + trust.mjs what a person trusted BY FINGERPRINT; ports.mjs MACHINE-GLOBAL leases;
               binding.mjs how a component is told a port, as data; launch.mjs · release.mjs · reconcile.mjs ·
               operations.mjs the journal written BEFORE each step; view.mjs the one read; commands.mjs the table) · lifecycle/ (start writes the receipt FIRST; stop only
               what ownership.mjs proves; status; prepare) · sessions.mjs + ownership.mjs (OWNERSHIP, ordered) ·
               readiness.mjs (a port or a URL on this machine, both loopbacks; never a command) + ports.mjs · exclusive.mjs (one start at a time per checkout) · design/ (gap · create · patch · designer) + jsonc.mjs · proposal.mjs +
               writer.mjs (the ONLY module that writes the repository, grep-tested) · validate.mjs + instances.mjs ·
               settings.mjs (revisioned, a block per host, never a command or a secret) · verification.mjs (a
               projection, never a verdict) + origin.mjs (the one question an investigation asks) · governance.mjs
               (OPERATIONS) · connectivity/ (whether a server a component needs and Orbit does not run can be
               REACHED, per location: targets.mjs a person's targets as data, `targetPrint` what an answer is
               about · states.mjs the FOLD, ordered · observations.mjs what each location last answered, per
               host, its own lock, scrubbed, STALE past five minutes · retry.mjs the one bounded runner, stopped
               at an answer that settles it · check.mjs the one operation behind check, retry, Control and the
               before-start gate -- a target named by ID, never a host handed in) · index.mjs the COMMANDS table.
               cli/runtime.mjs and skills/orbit-runtime/bind.mjs are the composition roots
src/probe/     the PROBE port: one loopback connection or GET, a deadline, `{ok}` as data; never throws, and a host
               that is not this machine is refused. src/runtime opens no socket itself. reach.mjs is a SECOND
               port with its own boundary: a name lookup and one TCP connect to a host and port a person
               configured (src/runtime/connectivity/), nothing sent and nothing read -- the loopback one is
               never widened to do it
src/store/follow.mjs  a LEAF: follow a file by lines from a byte offset through `io.readFrom` -- only what was appended
               since the last look, numbered with the store's OWN keep-rule (`journalLine` in src/task/store.mjs and
               src/investigation/store.mjs), so a live page and a reload agree on every line's index. An unended
               line is held, a file that shrank is a reset; it owns no timer (Orbit Live, ADR 0015) -- a viewer's
               lease in src/live/followers.mjs does
src/live/      Orbit LIVE's CORE, every viewer's (ADR 0016): delivery, never state. It imports only leaves, the store
               primitives and itself -- what a task, an investigation or a sandbox is arrives as a SOURCE its owner
               declares (src/task/live.mjs TASK_SOURCE, src/investigation/live.mjs QA_SOURCE), handed in by a
               composition root (cli/live.mjs, control-server/src/core.mjs); a test greps the imports, the effects,
               product words and journal writes (test/live-core.test.mjs). cursor.mjs (the ONE cursor) ·
               followers.mjs (one poll per followed file, refcounted -- the one timer in the core, held only while a
               viewer holds a lease) · subjects.mjs (task · investigation · activity, the last folded, never kept) ·
               feed.mjs (`openFeed`: replay from a cursor merged by time, then what is new, to an abstract sink, and
               an `activity-view` projection per observed check, replaced whole; `collectFeed`: the same collected
               once -- what Control's `/activity`, a terminal and the status line read) · activity.mjs (1.8.5: one
               ACTIVITY per action -- what, why, where, how, progress, result, next -- from the journal and the
               observations, never a guess) · lease.mjs + ensure.mjs (1.8.5, ADR 0020: the one viewer Orbit opens by
               itself per host · session · checkout -- its record, owner-only writes, liveness by heartbeat and
               process identity; POLICY, RULES and STATUS words) · logs.mjs (whose sandbox a viewer may read: the journal's claim,
               the checkout's witness, refusals as data) · association.mjs (WHICH task a viewer shows: explicit · pin
               · this session's own (`created.session`) · the one running in the checkout · AMBIGUOUS · finished ·
               none -- never the newest on the machine) · presentation.mjs (the VIEWER's state, CONNECTING ... LIVE,
               IDLE, never the task's lifecycle; a tick is never progress; 1.8.6: EVIDENCE rows, the pulse's phase
               the newest evidence's) · indicator.mjs (1.8.6, ADR 0022: INDICATOR, the viewer's state and the task's
               lifecycle in one word, only ACTIVE pulsing; shown as ORBITING since 0.0.1) · orbit.mjs (0.0.3, ADR 0029:
               the header's orbits and a waiting viewer's, turning the whole time a viewer is open, in every
               state, on the viewer's own clock and never on evidence; MOTION is only the satellite's tone by
               indicator state, SPEEDS a revolution by `pane.orbitSpeed`, `orbitFrameAt` pure, still for
               `pane.animation: off`, parked with no clock; `orbitTrackOf` the rings a pane turns on its own
               clock) · orbit/ (0.0.3: geometry.mjs SIZES and each size's ring, sampled from an ellipse a dot at a
               time · raster.mjs every frame of a size as Braille or ASCII segments, made once) · plan.mjs (1.8.6: a workflow's plan as a viewer reads it
               -- steps and their states, progress on each step's own contract, revisions, the skill factory per
               capability, the receipts when no projection came) · timeline.mjs (1.8.6: one normalized fold of every
               source, provenance per event, deduplicated) · current.mjs (what it is doing now, the
               page's order) · snapshot.mjs · words.mjs · pin.mjs (a person's viewer preference, never an execution
               event) · settings.mjs (how Live looks, revisioned) · governance.mjs (OPERATIONS, NOT_LIVE) ·
               render/ (pure strings: ansi.mjs the ONE emitter of escape sequences, data through printable() first;
               theme.mjs Orbit Live's look as data, 0.0.1: PALETTE, LOOK per tone, BANDS, depthOf/bandsOf over an
               environment the caller hands in; width · lines · compact (the status line) · plain · jsonl (the SSE
               frames) · screen) · tui/ (the
               FULL-SCREEN viewer, ADR 0018, pure like the rest: model.mjs the one ephemeral state and what it
               `wanted` open · reducer.mjs TRANSITIONS · keys.mjs KEY_SEQUENCES + KEYMAP + HELP · layout.mjs TIERS,
               ROOM, PRIORITY · derive.mjs a snapshot per followed task per second · sections/ (STAGE, ACTIVITY,
               WORKFLOW, ENGINEER, VERIFY, QA, SANDBOX, RECENT, NOTICES as rows of segments) · overlays/ (picker,
               activity (`i`), evidence, diagnostics, help) · frame.mjs the ONE caller of `drawn` for it (0.0.3:
               which rows hold the orbit, and `orbitFrameOf` drawing those alone) · regions.mjs (0.0.3, ADR 0029:
               REGIONS, the screen's top, body and bottom as rows of a table, each with its `when`; ORBIT_PARTS) ·
               diff.mjs the rows that changed · events-view.mjs (0.0.2, ADR 0028: a pane's Events view, a workflow's milestones under
               the step whose turn it was -- a read of times, never written -- and the view's hint) · pane.mjs (1.8.5) the same sections laid out for a pane a HOST docks: a
               header line, the overview, NOW pinned last, as segments a host's drawer adds no word to ·
               workspace.mjs (1.8.5, ADR 0021) the pane's own model: the TASK EXECUTION checklist (a workflow's
               plan, or an engineering task's steps as its journal recorded them; 0.0.2, ADR 0028: the baseline a
               card by its rows' `box`, the step in focus in the brand's tone), NOW, the status bar, the views,
               seven status words and the pane's own tiers · progress.mjs (1.8.6: task and test progress over a
               recorded denominator, or indeterminate) · plan-view.mjs (1.8.6: the Plan view) · timeline-view.mjs
               (1.8.6: the Timeline view) · pane-frame.mjs (1.8.6: the pane's parts as the terminal's pane layout,
               `v`, keys 1-6; 0.0.3: TABS, how the tabs are laid out by the room, and the waiting viewer's
               expanded orbit) · lifecycle-view.mjs (1.8.9: Context · Memory · Engineering · Learning, one row each,
               off the context command's word, the task's lifecycle and its `learning` receipt; none in a narrow
               pane)). A plan reaches the feed through PLAN_SOURCE (src/automation/source.mjs), handed in
               like the activity source. cli/live-open.mjs (1.8.3) is the OPENERS table (a tmux pane, a Windows
               Terminal pane, a macOS Terminal window through a `.command` file in the store, else the command
               printed), argv only but for that one fixed, quoted line, starting nothing but Orbit's own viewer
               (`live tui --until-done` for `live open`, `--lease=…` for a viewer it opened by itself).
               cli/live-ensure.mjs (1.8.5) is `live ensure`, the ONE launcher of that viewer: decide, reserve the
               lease under its lock, open, and wait a bounded time for the viewer's own `ready`. `live pane`
               (cli/live.mjs, 1.8.5) answers a docked pane ONE JSON object per ask and holds the same lease while
               the host draws it; `--auto` reads the person's switches and writes nothing.
               Its terminal adapter is cli/live-tui.mjs: the alternate screen, raw keys, timers, signals, feeds,
               the sandbox console and a leased viewer's ready, beat and leaving, and one idempotent teardown
src/automation/  a COORDINATED WORKFLOW (ADR 0017): one objective taken through several owners' workflows -- requirement,
               context, runtime, an engineering task, QA, regression, review, or a project playbook -- one host-decided
               step at a time, in a TASK of its own (provider "automation"). It keeps no lifecycle of its own: every
               write goes through the task's one door, handed in as a port, and step state is DERIVED from `step:`
               receipts. It imports no subject (test/automation-vocab.test.mjs greps the imports, the effects and the
               product words). vocab.mjs (the task's words, asserted equal; FORBIDDEN) · steps.mjs (STEP_KINDS: what each
               provides, its stage, its owner's skill and agent, strict or not, the evidence it accepts, where a failure
               sends it back) · workflows.mjs (WORKFLOWS: which steps an objective gets, from every intent it hit) ·
               graph.mjs (1.8.6, ADR 0022: DEPENDS -- what each kind waits for -- a step per named capability, the draft
               and register steps a closable gap needs, ids, BECAUSE, Kahn's order) · plan.mjs (a plan ARTIFACT named by
               a receipt, schema 2 a graph, acyclic by construction; RULES; replan after a failure, revisions with
               `prev` and `replans`) · replan.mjs (1.8.6: TRIGGERS by moment and RESPONSES, bounded by
               execution.maxReplans) · source.mjs (1.8.6: PLAN_SOURCE, the active plan read by digest for a viewer) ·
               intelligence.mjs (what a plan is planned FROM: every capability resolved, MISSING) · select.mjs (SELECTION:
               who runs a step, from the resolver's outcome; a switched-off provider blocks, never generates) ·
               decision.mjs (FORM · AGAIN by decisionId · FRESH · SETTLE) · evidence.mjs (READ_BACK: a step is settled on
               its OWNER's record, and only on this workflow's own) · outcome.mjs (SETTLED rows) · stop.mjs · dispatch.mjs
               (ENGINE, BEFORE_HOST, how a host is told) · settings.mjs (machine and project documents, narrowed with
               provenance, written only through Control's door; schema 2, ADR 0023: autonomous by default, RETIRED
               current settings schema 3 only) · policy.mjs (ACTION_CLASSES, never wider than a
               resource's verdict) · loop.mjs · governance.mjs · index.mjs. cli/automation.mjs is the composition root
src/skill-factory/  instruction-only PLAYBOOKS a coordinated workflow may draft for the current project (the second scoped
               exception above): gap.mjs (GAP_KINDS, exactly one generates; 1.8.6 a WORD per row and SHAPES, the
               shape a playbook for a workflow gap takes) · policy.mjs (mode, reuse first, scope,
               budgets) · frontmatter.mjs + instruction.mjs (the ONE SKILL.md parse and rules, which Control's editor
               uses too) · manifest.mjs (what a draft may say; STAMPED refused by name) · validate.mjs (RULES: tools,
               files, fences read as CommonMark reads them, documented commands only, hidden characters, injection
               patterns, secret shapes, every need provided) · store.mjs (one room per project, never a repository or the
               plugin) · lifecycle.mjs (scaffold · put · verify · register · status · pinned · rollback · archive; the
               engine never deletes a playbook; 1.8.6 the contract a scaffold writes, registration under one hold of
               the lock, phases on read) · vocab.mjs (STATUSES, MOVES; 1.8.6 PHASES, derived) · register.mjs (rows of the existing skills family, `project:` keys) ·
               index.mjs (what a terminal may run: list, show, put, verify -- never register or activate).
               skills/orbit-help/factory.mjs is the one real binding
src/printable.mjs  a LEAF: text a terminal may be handed -- control characters and reordering marks removed, so a
               manifest's text cannot drive the terminal it is printed to
src/store/registry.mjs  the PROJECT REGISTRY: membership is the binding files (state/checkouts), a one-line summary
               per checkout beside them (state/projects) -- never a scan; a person forgets one whose directory is gone · fact-room.mjs one file per fact, a model
               and findings, which architecture's store and runtime's are two uses of · revisioned.mjs the
               compare-and-refuse line every revision-protected settings document shares
src/frontend/worktree.mjs  the working-tree reader: contained, symlink-refusing, bounded. Design and adopt read through
               it because an environment file is edited uncommitted during a review
src/frontend/local-clones.mjs  LOCAL CLONES of one checkout, through the Process port (argv only): head, dirty, listed,
               add (`clone --local --no-checkout`, then a detached checkout: objects hard-linked, the
               checkout's `.git` only READ, no branch), remove (a clone of its own, never the checkout),
               changes (stage the clone's OWN index, then name-status + numstat against a revision or a tree
               id, and `write-tree`). No hook runs: `core.hooksPath` points where nothing is. A failure says
               git's `fatal:`/`error:` line. The one owner that calls it is src/orchestration/workspace.mjs
control-server/src/mission-control/  MISSION CONTROL's reads: read.mjs (the machine's tasks and approval queue, the task
               fold's machine view) · health.mjs (ADR 0023: Health, an ordered table of AREAS -- automation restrictions
               tasks waiting, blocked, stalled or orphaned, tools and managed MCP servers
               enabled but not ready, hosts -- each answering at least one row, read off what Orbit keeps, no probe)
control-server/src/works/  tracked WORKS in Control (1.8.8): project.mjs (a checkout's works, named in the path;
               a work is a checkout's only when it was tracked there) · read.mjs (the list and one work as
               `workViewOf` -- the SAME view cli/track.mjs and Live read). Reads only: there is no row that
               writes, resumes or approves a work
control-server/src/live/  Orbit LIVE in Control: the TRANSPORT of the live core (src/live/, ADR 0015 and 0016). sse.mjs
               (framing; a heartbeat EVENT, because a comment never reaches a page's script; a client that stops
               reading is cut, never queued) · cursor.mjs (re-exports the core's) · task-stream.mjs (the task named by
               the path, then the core's `openFeed` / `collectFeed`) + log-stream.mjs · index.mjs (`createLive`: the
               core's follower registry and the open-stream set a shutdown ends). A row with `stream: true` opens
               before any header; every refusal is the ordinary JSON one, and nothing here writes
src/run/       the interpreter: gates/ → step.mjs → verbs/<verb>.mjs; loop, evidence, log, printer, result
               budget.mjs + poll.mjs the ONE wait loop; watermark.mjs; status.mjs the final verdict
src/report/    one run's evidence -> ONE self-contained report.html, pictures embedded AND the
               case's own JSON, so the report is enough to run it again when the file is gone
               screen.mjs + screen.html: ONE SCREEN, every case that has touched it -- who drove
               it with which rights, every query asked of the data underneath, each case's verdict
               and pictures, what a person still has to check. Selected off the ledger's `screens`
               column, so it needs no plan and no session, and it re-judges nothing
               report.html + report.css are the MOCKUP: markup and theme as files you open;
               template.mjs renders them (escape by DEFAULT), view.mjs shapes the data
               review.mjs + review.html: one SESSION, read off the ledger -- what ran, and
               what a PERSON still has to check (a run decides PASS; a review never re-judges)
               explore.mjs + explore.html: one EXPLORATION, read off what a session observed --
               a surface, every layer per action, the contradictions, the open questions
               coverage.mjs + coverage.html: one PLAN, read off the plan and the ledger --
               criterion -> scenario -> case -> run -> evidence, every ratio with its denominator
src/qa/        the TEST PLAN as DATA: vocab.mjs (tables with columns a rule asks) + fields.mjs
               → generated plans/schema.json; rules/ one family per file, findings carry a LEVEL
               (error = demonstrable, advice = heuristic, and `unknown` is neither)
               states.mjs the FOUR axes · coverage.mjs the chain and its denominators
               risk.mjs scoring + budget selection · impact.mjs what moved · suggest.mjs what a
               lesson may propose · markdown.mjs renders the .md nobody edits by hand
src/query/ plan/ awake/   views and workflows over the above
               dsl.mjs  INTROSPECTION: `dsl` `verb <n>` `field <n>`, printed FROM the tables --
                        a third generated artefact, so no playbook carries a copy of the grammar
               classify.mjs  the nine causes as an ordered table, pure over facts. `high` settles
                        it, `low` never routes anywhere. It decides a CAUSE, never a verdict
               triage.mjs one run's evidence: shown · consistent with · cannot tell, + a class
src/lint/      the Five Lines checker the engine applies to itself
schemas/ templates/   what a consuming project copies (init.mjs, schema.mjs --write)
skills/orbit-qc-builder/  the QC SELF-EXTENSION playbook: recall architecture and lessons,
               reuse before generating, build the SMALLEST project-local tool an already-agreed
               verification needs, verify it against the real contract, register it outside every
               repository. QA decides what to test; this only decides how to execute it
skills/orbit-ui-test/     the agent-facing playbook: run and author a case
               references/  the two docs every other playbook defers to instead of restating:
               tools.md (which host tool does which QA job, and the ladder when one is absent)
               dsl.md (where each DSL answer lives -- it copies no grammar, it points at `query dsl`)
skills/orbit-help/         the NAVIGATOR playbook: one bounded, read-only look at what architecture,
                          engineering memory, the map, the plans and the lessons already say, and
                          exactly one recommended `orbit-*` workflow to run next, with why
skills/orbit-develop/    the DEVELOPER playbook: provides `development.implementation`, needs
                          `project.context` + `repository.read` (capabilities, never a server);
                          project context first, resources as the resolver decides, the smallest
                          verified change, review. It never installs or enables anything
skills/orbit-test-suite/    the TESTER playbook: pick browser+profile, drive the agreed set,
                          write one review, hand over what a browser cannot check
skills/orbit-test-plan/      the QC playbook: read first, ask only what changes the design, derive
                          scenarios with a technique, write ONE checkable plan per feature
skills/orbit-ui-map/       the mapping playbook: fill graph/ from source (src) then confirm it live
skills/orbit-qa/  the INVESTIGATION playbook: context first, a bounded plan, actions inside
                          the gates, data below the screen, the tenant matrix on a declared contract,
                          findings with alternatives and reproduction, one redacted report; a
                          verification nothing can perform goes to orbit-qc-builder
skills/orbit-engineer/  the AUTONOMOUS ENGINEERING playbook + protocol.md: a requirement (or an
                          objective) to a verified change, one decided step at a time -- the requirement
                          read back, context, environment, the task's own workspace, a plan, the change,
                          the project's declared build and tests, diagnose and fix, regression, review;
                          Orbit run from the checkout, every edit in the workspace, never a command line
skills/orbit-requirements/  the REQUIREMENT playbook: resolve the item, read it once, record atomic facts
                          with their source and revision, ask only what blocks, freeze ONE snapshot, then
                          start or resume the work on it. providers.json (descriptors as data) ·
                          sources/ (the github and azure-devops HTTP readers over the reporter's
                          http.mjs) · bind.mjs (the ONE real binding of readers, connections and tools
                          for cli/requirements.mjs, cli/work.mjs, Control and the router's hook).
                          A thin skill: identity, reader choice, revisions, rules, snapshots, bindings
                          and invalidation are the engine's
skills/orbit-runtime/  the RUNTIME playbook + bind.mjs, the ONE real binding of the runtime subject (the
                          Process port, the probe, the machine, the source and working trees) for cli/runtime.mjs, Orbit
                          Control and cli/autonomous-qa.mjs. A thin skill: read once, keep what prose implies as a
                          hypothesis, say how each component would run here, design only on request, adopt only for a
                          person
skills/orbit-ui-explore/   the EXPLORATION playbook: drive a live surface when the map is thin and
                          nobody can be interviewed -- map records, cases that RAN, one sheet
skills/orbit-learn/     the LEARNING playbook + native.mjs, which knows how Claude Code lays out
                          its memory dir (concrete host knowledge, so it lives here, not in src/)
skills/orbit-architecture/ the ARCHITECTURE playbook: recall first, scan last. `ensure --for=…`
                          before any Grep over the project, and a gap is a blocker never a
                          deleted check
hooks/hooks.json          SessionStart (direct Orbit recall, and ONE line when no architecture
                          snapshot exists -- no scan, no git, no write; plus an ASYNC observer that
                          re-reads the host's MCP configuration and detects tools, only when the
                          prompt router is on; plus an ASYNC `knowledge locate --hook` that notes
                          where the host keeps its memory for this checkout), UserPromptSubmit
                          (cli/router-hook.mjs: at most 2 KB of routing context, fail-open, prompt
                          never stored -- its one write is the trail's `prompt.submitted`),
                          PreToolUse (Skill|Agent: refused when its `skill_*`/`agent_*` switch in
                          userConfig is off; unset is on; the trail records started or refused),
                          PostToolUse, EVERY tool, async (fold in after a run; one working-set
                          line per tool that touched the checkout; one trail event; the
                          engineering observer at a milestone, if opted in), PostToolUseFailure,
                          every tool (context only -- it records no lesson and no engineering
                          truth, only the working-set line `ok:false` and the trail's failed
                          step), Stop, async (the trail's turn boundary) and SessionEnd (flush the
                          last milestone). Beside them, `modules` names hooks/live-pane.tsx
hooks/grok.json           (1.8.9) Grok Build's hooks: the same learn and router hooks, every one named
                          `--host=grok --protocol=2` and rooted at ${GROK_PLUGIN_ROOT}, with only the
                          handler fields Grok reads (it skips a handler carrying `if` or `args`)
hooks/live-pane.tsx       Claude Code's Orbit Live pane (1.8.5), a Claude Code MOD -- a hooks module in
                          TypeScript the HOST runs, with no Node and no fs of its own -- that docks
                          Orbit Live beside the session: it asks `node <plugin>/cli/live.mjs pane` and
                          draws the answer, nothing more. Its state is declared in types/index.d.ts
                          (the manifest's `types`), typed by tsconfig.json, and tested by the host's
                          own runner (hooks/tests/*.test.tsx, because a bare `node --test` would run
                          a *.test.ts) through skills/orbit-release/pane-check.mjs, which stages it
                          away from Orbit Control's vitest files; the Five Lines check and this suite
                          read it only through test/live-pane.test.mjs. 1.8.6: it reads every answer
                          version it names (VERSION: 2), draws the progress rows above the status
                          bar, and writes no picture that is the same as the one drawn
skills/orbit-learn/hosts/drain.mjs  (1.8.9) the background drain of a protocol-2 session's engineering
                          checkpoints: `cli/finalize.mjs --hook`, detached, bound to the same session --
                          started by the hook that queued them and by the session's own help or finish
skills/orbit-learn/hosts/live-surfaces.mjs  where each host can SHOW Orbit Live (1.8.6, ADR 0022): five
                          surfaces per host -- docked pane, companion, terminal split, window, CLI --
                          true of the host and never assumed; `live doctor --host=<name>` prints them
skills/orbit-learn/hosts/live-host.mjs  Orbit Live for a host with no status line and no pane API
                          (Codex, Antigravity, Grok Build): the session's mark from its bound
                          ORBIT_SESSION, the `live` switch, the surfaces; codex-statusline.mjs,
                          antigravity-statusline.mjs and grok-statusline.mjs are its uses, what
                          `live --host=<name>` loads
skills/orbit-learn/hosts/grok.mjs  (1.8.9) the Grok Build adapter, protocol 2: normalize() over the
                          payloads measured on grok 1.0.62 (test/fixtures/hooks/grok-v2/) -- the five
                          tools seen, a command's exit code as its outcome, a turn as `promptId`, the
                          teardown Stop as no turn; hooks/grok.json is what runs it. A Grok tool's
                          shell binds itself from GROK_SESSION_ID (settings.mjs `nativeShell`)
skills/orbit-dotnet/  the .NET PACK: the product knowledge src/intelligence/ must not
                          hold -- catalog.json (technology descriptors, as data) and analyzers/
                          (Graph, CSOM, EF Core/Dapper/ADO.NET, Redis, messaging, the DI
                          container), each pure over one C# file with comments and literals
                          emptied first. Registered by cli/intelligence.mjs, never imported by src/
skills/orbit-learn/hosts/claude-account.mjs  who is signed in to Claude Code on THIS machine, for
                          Control's top bar: the PROFILE only (name, email, organization, role)
                          out of <config>/.claude.json -- never a token, the keychain, the
                          credentials file or an API key, and no network
skills/orbit-learn/hosts/claude-memory.mjs  Claude Code's memory as a HOST-MEMORY PROVIDER for
                          project knowledge: `recall({tokens, context, limit})` over at most 20
                          topic files of this checkout's memory directory (located from the record
                          the async SessionStart hook kept, or user-scope settings), frontmatter,
                          comments, Orbit's retired projection region, URLs and absolute paths
                          stripped. Hints only -- src/knowledge/ never stores one and never names it
skills/orbit-learn/hosts/claude-mcp.mjs  the Claude Code MCP HOST adapter: reads every scope's
                          configuration from files (no network, no `claude mcp list` health checks)
                          and tests one as the host configured it. It NEVER writes: a host's
                          servers are external to Orbit
skills/orbit-control/      starts Orbit Control (control-server/) on a Node >= 24.15 found on this machine
                          -- node.mjs picks it, pure; install.mjs installs a PRIVATE one (official LTS,
                          SHA-256 checked, into the store; system Node/nvm/PATH untouched), effects
                          injected; start.mjs binds them and spawns the server, adding nothing.
                          tools.mjs is Control's Node as a TOOL (the `control-node` detector, the
                          `node-dist` installer); world.mjs binds the real host (read-only), the
                          Process port, two probes (the host's servers with the host's environment,
                          managed ones with BASE_ENV), detectors and installers once, for
                          control-server, cli/resources.mjs, cli/mcp.mjs and cli/context.mjs
skills/orbit-control/vault.mjs  the OS SECRET STORE behind src/secrets.mjs: macOS Keychain through
                          /usr/bin/security (the value on stdin, never argv), Windows DPAPI through
                          the system PowerShell by path (a fixed encoded script, the value on stdin,
                          the blob in the store); none on Linux. What the OS says on failure never
                          reaches an error. Bound in world.mjs and the report binding
skills/orbit-report/  the PO REPORT pack -- the product words src/project-report/ must not
                          hold: providers.json (what a connection and a scope ask for, read-only
                          permissions, token shapes) · parts.json (the standard parts and sections,
                          as data) · sources/ (the GitHub and Azure DevOps collectors and probes, in
                          Node, over http.mjs: one origin, no auth across a redirect, bounded, typed
                          stops) · python/ (the kit the parts run on: the shim, the SDK, the guard,
                          the standard metrics, forecast and documents collector; check_part.py the
                          static look at a project's part) · render.mjs + assets/ (one offline page,
                          vendored and pinned) · extend.mjs (scaffold, and the checks registration
                          adds: the autonomy boundary, the static look, the part RUN) · bind.mjs (the
                          one real binding CLI and Control share) · samples.mjs (synthetic snapshots)
skills/orbit-sql/  OPTIONAL adapter: SQL Server via sqlcmd, opted into by sql.command
skills/orbit-browser/ OPTIONAL adapter: pick a local browser+profile, opted into by launcher
skills/orbit-release/  release + adoption: the DoD as gates, the version rule, the install routes;
                          frontmatter.mjs (1.8.9) holds every SKILL.md and agent to the frontmatter shape a
                          host parses, by line -- a gate, and a suite test
agents/                   subagents the skills delegate to (no conversation, one job each)
                          map-recorder · qa-case-writer · failure-analyst (CLASSIFIES, mutates
                          nothing) · dsl-doctor (repairs how a case is WRITTEN) ·
                          map-healer (proposes ONE locator patch, never applies one) ·
                          architecture-scanner (OBSERVES one bounded question; it has no Write,
                          and the parent pipes its report to `architecture record`) ·
                          engineering-observer (PROPOSES observed/suggested candidates from what a
                          session touched; no Write, the parent pipes them to `engineering record`) ·
                          autonomous-engineering (drives ONE task's loop; edits only its workspace,
                          never approves, resumes or passes --human)
test/          node:test; fixtures/ui-tests is a complete tiny project; fakes/ implement every port
integrations/  what ANOTHER program installs, never part of this plugin's archive. vscode-orbit-live/ (1.8.5, ADR 0021)
               is the Orbit Live companion for VS Code: plain CommonJS with no dependency and no build step, a
               person installs it; companion.js (what it does: a heartbeat in the store's live room, a request
               picked up, the asking terminal split through VS Code's Terminal API, only Orbit's viewer ever run)
               and extension.js (VS Code's API handed in). test/vscode-companion.test.mjs drives it with a fake of
               that API, end to end from `live open`
```
