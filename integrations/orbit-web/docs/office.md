# The Office: contexts, events and states

How Orbit Web's virtual office (ADR 0061) is put together: the bounded contexts and who depends on whom, the durable
events between them, and the state machines each one owns. The code is the reference -- `apps/api/src/contexts/` and
`packages/contracts/src/workforce.ts` -- and this page says where each part lives.

## Context map

```mermaid
flowchart LR
  subgraph identity["Identity (modules/auth)"]
    accounts["accounts · users · sessions<br/>setup codes · trial"]
  end
  subgraph connections["Connections (modules/connections)"]
    conn["AI connections · homes<br/>credential store · plugin grants"]
  end
  subgraph governance["Governance (modules/governance, governance-core)"]
    policy["policy · decisions · run bindings<br/>egress proxies · audit chain"]
  end
  subgraph research["Knowledge (modules/research)"]
    sources["sources · immutable revisions<br/>frozen passages"]
  end
  subgraph workforce["Workforce (contexts/workforce)"]
    office["office · departments · employees<br/>profile & resource revisions · sandboxes<br/>appointments · delegation grants · defaults"]
  end
  subgraph work["Work (contexts/work)"]
    missions["missions · targets · assignments · reservations<br/>handoffs · decisions (Needs me) · questions<br/>data shares · team rooms · schedules · deliveries"]
  end
  subgraph execution["Execution (contexts/execution)"]
    runs["runs · conversation runs · admission · the worker<br/>artifacts · tool endpoint · desk publisher"]
  end
  subgraph executive["Executive (contexts/executive): CEO Chat"]
    chat["conversations · messages · turns<br/>mission links · the conversation's stream"]
  end
  allocator[["orbit-allocator<br/>(Docker socket)"]]

  accounts --> office
  conn -->|"connection facts (read)"| office
  conn -->|"ConnectionHooks: disconnected / removed"| runs
  policy -->|"decide · bind · egress"| runs
  policy -->|"decide office actions"| missions
  policy -->|"AccessHooks: a policy published, an access changed"| runs
  sources -->|"pinned revisions (read-only)"| runs
  office -->|"eligibility (sync, in the claim's transaction)"| missions
  office -->|"authority, slots (read: OrgReader)"| missions
  missions -->|"run intents · stop requests"| runs
  runs -->|"RunOutcomes port: handoff · ended · delegate · review · question · answer · data · room"| missions
  runs -->|"SandboxProvider port (signed HTTP)"| allocator
  chat -->|"the CEO in office · eligibility · records (read)"| office
  chat -->|"missions.create (target: CEO) · records (read)"| missions
  chat -->|"conversation runs (requested)"| runs
  runs -->|"CONVERSATION_DISPATCH: admitted · held · interrupted"| chat
```

- **Shared** (`contexts/shared`): the outbox (`workforce.events`), the per-consumer inbox, idempotency keys, the
  office version and `office.changed` on the app stream. Every table carries `account_id` (the OrbitId).
- **Domain purity**: `contexts/*/domain/` imports no framework, database, file system or HTTP (`boundaries.spec.ts`).
- **Ports**: `SANDBOX_PROVIDER` (container or development `process`), `CONNECTION_SECRETS` (the credential store),
  `RUN_OUTCOMES` (Execution → Work), `CONVERSATION_DISPATCH` (Execution → Executive: a conversation run the pass
  admitted, held or found interrupted).
- **Roles** (`contexts/work/domain/roles.ts`): the CEO, a manager with or without a team, an employee -- from the
  appointment in force and the department's working members. One place feeds what an attempt is told, the tools it is
  offered and the tool door (`AttemptContext.team.denied`, `connectorsDenied`) and whether its hand-in is taken.
- **CEO Chat** (`contexts/executive`, ADR 0062): a conversation is the company's; an answer (a TURN) is a CONVERSATION
  RUN of the CEO in office (`workforce.conversation_runs`), admitted by the same pass as attempts and never at the same
  time as another run of the CEO (both ways); it runs the Claude CLI with no tool in a session sandbox of kind
  `executive`, decided by governance as the employee (run kind `executive`). Quick actions are Orbit's records
  (`executive/domain/records.ts`); a proposal becomes a mission only through `MissionsService.create`.
- **The CEO belongs to no department**: an employee appointed CEO from a department leaves it in the same transaction
  (`EmployeeDepartmentChanged`), a move of the CEO into one is refused (`appointed_ceo`), and the database's
  `appointment_matches()` holds it at commit -- so the CEO's work is the company's: its policy, its room, its defaults.
- **Pure rules of Work** (`contexts/work/domain/`): `authority.ts` (whom a lead may give work to: its appointment in force
  and its grants), `target.ts` (who a mission goes to), `team.ts` (a plan's rules, `leadNext`: review, answer or wait),
  `data-authorization.ts` (what one attempt may read), `assignment.ts` (the state machine). Workforce keeps
  `appointment.ts` and `execution-precedence.ts` (mission > employee > department > company).
- **Synchronous edges** stay inside one transaction (eligibility at a claim, the reservation, the run intent);
  everything else crosses as a durable event or a stop request on the run row.

## Temporary assistants

The CEO and a department's manager (an appointment in force) engage TEMPORARY ASSISTANTS for the mission at hand: a part
of their `delegate` plan may `hire` (a name, a title, duties, skills, languages) instead of naming someone.

- **Where it goes** (`work/domain/assistants.ts`): a manager's assistant joins its own department and takes the part
  itself; the CEO names a department with a manager in office -- the assistant joins it, and the part goes to that
  manager, who can then give the assistant work. A manager alone is offered `delegate` while its quota has room.
- **The quota** is the owner's, per employee (`profile.maxAssistants`, 0-5; the hire templates say 2; 0 turns it off):
  the lead's LIVE assistants (`engaged_by`, not released, not expired) and those its plan engages before this one.
- **Decided as the lead**, with the plan, in one transaction (`TeamService.delegate` → `HiringService.decideAssistant`):
  `employee.hire_assistant` with the grant the quota gives (full: `NO_GRANT`, "2 of 2 assistants engaged"), the
  department, the mission's time, the execution a hire is held to (its department's defaults for the lead's runtime,
  else the company's, else what the lead runs on) and the Lightweight resources. A plan with any problem engages
  nobody and gives nothing; its decisions stay on the record. Then `engageAssistant` makes it: `kind = assistant`,
  `mission_scope` (its mission), `expires_at` (at most 7 days, or the mission's deadline), active at once.
- **Scoped to its mission**: the `OrgReader` counts an assistant as working only on its own mission, so it changes no
  role or scope elsewhere; it takes no appointment, delegation grant, mission or another mission's work.
- **Released** (`workforce/application/assistant-releases.ts`, a system actor) when its mission's ROOT is accepted,
  cancelled or failed, when its sandbox fails, or when a sweep finds its engagement expired: its open work is cancelled
  through `HeldWorkPort.cancelOpen` (its lead is woken), it is archived and its desk deleted -- the provisioner removes
  it and only then frees its storage. Hiring a permanent employee (`employee.hire`) stays a person's.

## Recruiting and drafting with the CEO (Executive)

- **A hiring request** (*Recruit*: the Overview, a department's menu, CEO Chat; `POST /api/executive/staffing`). The
  owner's words, a scope (one department or the whole company) and what every hire runs on and holds (the owner's
  connection, model, effort and resource preset). The CEO plans it in a turn of kind `staffing` and writes one
  `orbit-staffing` block; when that turn ends, `StaffingRunner` (`executive/application/staffing.ts`) holds the plan to
  the company as it is then (`executive/domain/staffing.ts`: the scope, the room -- at most 10 hires and what the
  storage budget holds --, at most 3 new departments, unique names, the managers) and carries it out at once AS THE
  PERSON WHO ASKED (`deferredOwnerActor`): `OfficeService.createDepartment`, `HiringService.hire` (on probation),
  `AppointmentsService.appoint`, each decided by the policy as their own click would be, in one savepoint -- all or
  nothing. The request (`executive.staffing_requests`) leaves `planning` once (`hired`, `refused` or `failed`), and Orbit
  reports it in the conversation (a `staffing` report). It is sent again, never retried.
- **A profile draft** (*Draft with AI* in Hire and on a profile; `POST /api/executive/drafts`). A turn of kind `profile`
  whose answer holds one `orbit-profile` block; `ProfileDrafts` keeps a profile's descriptive fields alone
  (`executive.profile_drafts`) for the form to fill. It hires nobody.
- Both are handlers of one registry (`TurnTasks`), by the turn's kind: the turn's lifecycle names no kind, and a block
  of one kind written in a turn of another is ignored, saying so.

## Work in parallel, and what bounds it

Independent work runs at once: one admission pass admits every candidate that fits, the worker drives each attempt it
was handed without waiting for another, and a lead's parts with no wait are claimable together. A part that waits for
another starts as soon as its lead accepts that one: the lead is woken for a result a queued part waits on at once
(`work/domain/team.ts` `readyToReview`), beside parts still running. What holds work back, in the order admission says
it (`execution/domain/admission.ts`):

- **The account's concurrency** (`maxConcurrent`: by default one per usable vCPU) -- "The account already runs n of its
  n concurrent attempts."
- **The budget's CPU, memory and storage**: an attempt needs its employee's profile PLUS its runtime's model plane
  (Claude Code 0.5 vCPU / 1024 MiB, Codex 0.5 / 768, Antigravity 0.5 / 1024 by default:
  `ORBIT_WEB_MODEL_PLANE_<RUNTIME>_CPU` / `_MEMORY`, read once in their units). A Lightweight Claude attempt needs 1.5
  vCPU and 3072 MiB.
- **The host's usable capacity**: what the container runtime gives, less the control plane's limits and a reserve
  (`ORBIT_WEB_CAPACITY_*`, `ORBIT_WEB_CONTROL_PLANE_LIMITS`). On a Mac with Docker Desktop's default 8 GiB VM this is
  about 4 GiB: one Lightweight Claude attempt at a time. More memory for Docker Desktop, then *Re-check* in Settings →
  Compute & storage, raises it; the owner can lower the budget there, and the operator can set it
  (`governance.js budget set`), never above the host.
- **One run of an employee at a time** (and a lead holds itself while its team works), and the dependencies a lead
  declares.

## Events

Every durable event is a row of `INTEGRATION_EVENTS` (`packages/contracts/src/workforce.ts`), validated against its
schema version when written and when read, written in the transaction of the change that raised it. Consumers record
each event they handled in the inbox (`consumer_inbox`) in the transaction of their effect, so a replay changes nothing.

| event | raised by | handled by |
|---|---|---|
| `OfficeSetUp`, `DepartmentCreated`, `DepartmentChanged`, `DepartmentArchived` | Workforce (office, departments) | the pages (`office.changed`) |
| `EmployeeHired`, `EmployeeProfileRevised`, `EmployeeDepartmentChanged` | Workforce (hiring, an employee's revisions) | the pages |
| `EmployeeEmploymentChanged`, `EmployeeActivated` | Workforce (employment) | `work.scheduler` (queued work may start) |
| `EmployeeResourcesRevised`, `BudgetChanged`, `CapacityChanged` | Workforce, the budget, the capacity probe | the admission pass (pending runs re-read) |
| `SandboxProvisionRequested` | Workforce (hire, a retried provisioning) | the sandbox provisioner (polls `PROVISIONING`, woken by the outbox) |
| `SandboxReady`, `SandboxFailed` | the sandbox provisioner | `work.scheduler` (on ready); `workforce.assistants` (on failed: an assistant is released) |
| `MissionCreated`, `MissionPlanRevised` | Work (a new mission, a team's plan) | the pages |
| `AssignmentQueued`, `AssignmentClaimed` | Work (create, the queue) | `work.scheduler` (on queued) |
| `AssignmentDelegated`, `AssignmentReviewing`, `AssignmentAnswering` | Work (a lead's plan, its review, its team's questions) | the pages |
| `ClarificationRequested`, `ClarificationEscalated` | Work (a question asked, moved up a level) | `work.team` (wakes the lead it is asked of) |
| `ClarificationAnswered`, `ClarificationWithdrawn` | Work (answered once; withdrawn with its asker's end) | the pages |
| `AppointmentChanged`, `DelegationGrantChanged` | Workforce (appointments, grants) | the pages |
| `AssignmentHandedOver` | Work (a person's handover) | `work.scheduler`, `execution.workspace-cleanup` |
| `RunRequested`, `RunStarted`, `RunFinished`, `StaleResultRejected` | Work / Execution | the worker (polls `requested`, woken by the outbox) |
| `ResourcesReserved`, `RunWaitingForResources`, `RunUnschedulable`, `ResourcesReleased` | Execution (admission, release) | the admission pass; the mission's timeline |
| `HandoffSubmitted` | Work (a hand-in) | `work.team` (wakes a waiting lead) |
| `RevisionRequested`, `InformationProvided` | Work (a person's review, an answer) | the worker (a new attempt) |
| `AssignmentAccepted` | Work (a person's or a lead's acceptance) | `execution.desk` (publish to the desk), `work.delivery` (deliveries), `workforce.assistants` (a root's: its mission's assistants are released) |
| `DeskPublished` | Execution (the desk publisher) | `execution.workspace-cleanup` |
| `AssignmentBlocked`, `AssignmentPaused`, `AssignmentResumed` | Work | the pages; Needs me |
| `AssignmentCancelling`, `AssignmentCancelled`, `AssignmentFailed` | Work | `work.team`, `work.cascade` (a lead's open parts end with it; its question is withdrawn), `execution.workspace-cleanup`, `workforce.assistants` (a root's: its mission's assistants are released) |
| `EmployeeDepartmentChanged` | Workforce | `execution.access` (an attempt holding another department's room is stopped) |
| `ReservationReleased` | Work (the employee is free) | `work.scheduler` (its next queued work) |
| `ExecutiveMissionLinked` | Executive (a mission given from a CEO Chat conversation) | the mission's timeline ("Given to the CEO from CEO Chat") |
| `HandoffSubmitted`, `AssignmentAccepted`, `AssignmentBlocked`, `AssignmentFailed`, `AssignmentCancelled`, `ClarificationRequested`, `RunUnschedulable` | Work / Execution | also `executive.notices`: one system message in the conversation a mission was given from (its root's end, a question for the owner, work that cannot start) |
| `DecisionRequested`, `DecisionResolved` | Work (Needs me) | the pages |
| `OccurrenceCreated` | Work (a schedule's period) | the pages |
| `DeliveryRequested`, `DeliveryReconciled` | Work (deliveries) | the pages |
| `PluginGrantChanged`, `ConnectionChanged` | Connections | `work.scheduler` (on a connection change) |

## States

### An assignment (Work)

```mermaid
stateDiagram-v2
  [*] --> QUEUED: enqueue (employee busy)
  [*] --> ASSIGNED: claim now
  QUEUED --> ASSIGNED: claim (employee free)
  ASSIGNED --> RUNNING: attempt started
  RECOVERING --> RUNNING: attempt started
  RUNNING --> AWAITING_ACCEPTANCE: handoff
  ASSIGNED --> AWAITING_ACCEPTANCE: handoff
  REVIEWING --> AWAITING_ACCEPTANCE: handoff (integrated)
  AWAITING_ACCEPTANCE --> ASSIGNED: request revision
  AWAITING_ACCEPTANCE --> COMPLETED: accept
  RUNNING --> WAITING_FOR_SUBORDINATES: delegate (attempt ends by design)
  ASSIGNED --> WAITING_FOR_SUBORDINATES: delegate
  REVIEWING --> WAITING_FOR_SUBORDINATES: delegate again / wait for revisions
  ANSWERING --> WAITING_FOR_SUBORDINATES: answered · moved up (attempt ends by design)
  WAITING_FOR_SUBORDINATES --> REVIEWING: parts handed in / all ended
  WAITING_FOR_SUBORDINATES --> ANSWERING: a part asked
  RUNNING --> BLOCKED: question (attempt ends by design) · failure · isolation · access revoked
  ASSIGNED --> BLOCKED
  REVIEWING --> BLOCKED
  ANSWERING --> BLOCKED
  RECOVERING --> BLOCKED
  BLOCKED --> ASSIGNED: answered once (by its lead or the person) · retry
  BLOCKED --> REVIEWING: answered (a lead that asked while reviewing)
  RUNNING --> RECOVERING: worker lost
  ASSIGNED --> RECOVERING
  REVIEWING --> RECOVERING
  RECOVERING --> ASSIGNED: reconciled
  ASSIGNED --> PAUSED: pause
  RUNNING --> PAUSED: pause
  PAUSED --> ASSIGNED: resume (it was acting)
  PAUSED --> WAITING_FOR_SUBORDINATES: resume (it was waiting)
  RUNNING --> CANCELLING: cancel (attempt live)
  CANCELLING --> CANCELLED: attempt stopped
  ASSIGNED --> CANCELLED: cancel
  QUEUED --> CANCELLED: cancel
  RUNNING --> FAILED_FINAL: fail
  COMPLETED --> [*]
  CANCELLED --> [*]
  FAILED_FINAL --> [*]
```

An employee holds one assignment at a time: a reservation row exists exactly while its assignment is in a holding state
(a deferred constraint trigger checks it at commit). Every claim and every new attempt moves the **fence**; a result
from an older fence is refused (`StaleResultRejected`). An attempt ACTS only while its fence is current and its work is
in ASSIGNED, RUNNING, REVIEWING, ANSWERING or RECOVERING: once it delegated, asked or handed in, its tools are closed
and its run is stopped by design (a success, `Ended by design: ...`). Commands name the version they were made against
(If-Match → 412); a review names the handoff digest it read (→ 409); the person reviews a mission's root only, a lead
its parts. Bounds: 5 revisions of one hand-in (`rework_limit`), 3 plans (`replan_limit`), 3 questions
(`question_limit`) per assignment; a lead is woken at most twice for one question before it moves up by itself.

### A question (Work)

A part asks its LEAD; the root asks the person who gave the work (Needs me) -- unless it is a manager, which decides.
`open` → `answered` (a compare-and-set: two answers at once resume the asker exactly once) or `withdrawn` (its asker
ended). Managers and the CEO never move a question up; a lead who leads by a grant may, only to a lead below the CEO.
A question left unanswered after its lead's wakes, or overdue, moves up by itself to a lead below the CEO -- or, where
the next hop would be the CEO or the person, is answered for its asker by `system:clarifications` ("decide with your
best judgment and say what you assumed"). Each hop is appended to its route (`workforce.clarification_routes`, never
changed). The person's answer to a question asked of a lead is refused (409 `asked_of_lead`).

### A conversation run, and a turn (Execution, Executive)

A CONVERSATION RUN (`workforce.conversation_runs`): `requested` → `waiting` (said why: the employee's attempt runs, the
account's budget or the host is in use) → `starting` (admitted: its compute reserved, leased to this process's worker)
→ `running` → `succeeded` | `failed` | `interrupted` | `cancelled`; one that can never start as configured is `failed`
with the numbers. One live per employee (a unique index), and none while an attempt of the employee is live (and the
reverse: the admission pass holds the attempt). Released (`released_at`, the budget's counters) once its process is gone.
A TURN (`executive.turns`, of kind `answer`, `staffing` or `profile`) follows it: `queued` (behind the conversation's
running answer) → `waiting` → `running` →
`completed` | `failed` (`ceo_changed`, `ceo_unavailable`, `runtime_unsupported`, `governance`, `unschedulable`, `tool_refused`, `cli_error`) |
`interrupted` (a stop, a restart, a time limit, a connection gone) | `cancelled`; one waiting and one running per
conversation at most, and an owner's message joins the turn that has not started.

### A run, one attempt (Execution)

```mermaid
stateDiagram-v2
  [*] --> requested
  requested --> waiting_for_resources: no room now
  requested --> unschedulable: can never fit as configured
  waiting_for_resources --> starting: admitted (reservation)
  unschedulable --> waiting_for_resources: profile / budget / capacity changed
  requested --> starting: admitted
  starting --> running: CLI init line accepted
  starting --> failed: provider or isolation refused
  running --> succeeded
  running --> failed: CLI error · timeout · disconnected connection · isolation
  running --> cancelled: pause · cancel · replaced
  running --> interrupted: worker lost · shutdown
  running --> unknown: cannot be established
  succeeded --> [*]
  failed --> [*]
  cancelled --> [*]
  interrupted --> [*]
```

A run's compute reservation is held from admission until its containers are verified gone; then `ResourcesReleased`
wakes the admission pass. Recovery: a run whose worker is gone is stopped and removed through the provider (verified)
before Work hears it was interrupted, never run a second time.

**What an attempt's file tools reach.** The areas are declared once, `FILE_AREAS` in
`contexts/execution/infrastructure/sandbox/allocator-protocol.ts`:

| area | access | what it holds |
|---|---|---|
| `/work` | read and write | the assignment's working tree, seeded from the desk |
| `/output` | read and write | what is handed in |
| `/input` | read only | what was handed to this attempt: its parts' latest hand-ins for a lead's review (`unit-<key>-<file>`), what its lead shared, the mission's sources |
| `/team` | read and write | the team room |

`/toolbox` is the desk's toolbox inside `/work`.

Every layer reads that declaration:
- the tool door (`tools.service.ts` `pathOf`);
- the allocator and the program it runs in the tool plane, which is handed the declaration as data;
- the development provider;
- the integration tests' double.

A path is held to the area it names, through links too. A refusal is the tool's answer, in its own words. A version a
lead sends back is not in its next `/input`; the part keeps its `/work` and works on; the mission keeps every version.

**What the owner reads of the people's exchanges.** A mission's *Communication* tab shows two things:
- **a pipeline:** who holds which part, and its stage;
- **one thread** (`GET /api/missions/:id/messages`, `work/domain/mission-thread.ts`), built from the records the mission
  already keeps, each message from someone to someone:
  - the work given;
  - questions, their moves and their answers;
  - hand-ins, with their files;
  - reviews, with their notes;
  - Orbit's notices.

### An employee (Workforce)

```mermaid
stateDiagram-v2
  [*] --> candidate
  candidate --> probation: start probation
  candidate --> active: activate (probation skipped, with a reason)
  probation --> active: activate
  candidate --> archived: reject · archive
  probation --> archived: reject · archive
  probation --> suspended: suspend
  active --> suspended: suspend
  suspended --> active: reinstate
  active --> archived: archive
  suspended --> archived: archive
```

Availability is separate: `available`, `busy` (holds an assignment) or `ineligible` (with the reason: employment, an
expired assistant, its sandbox not READY, its connection not connected).

### A personal sandbox (Workforce)

`PROVISIONING → READY | FAILED → ARCHIVED`. READY only once its desk, cache and toolbox areas exist with their labels, a
write test passed in each, and each area's enforcement level is recorded with its evidence; no container runs.

### A delivery (Work)

`PENDING_CHANNEL` (no channel yet) · `PENDING → SENDING → SENT` (only with a receipt) · `NEEDS_RECONCILIATION` (it may or
may not have reached its receiver: a person says which) · `FAILED`.
