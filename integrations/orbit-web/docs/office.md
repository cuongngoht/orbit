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
    runs["runs · admission · the worker<br/>artifacts · tool endpoint · desk publisher"]
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
```

- **Shared** (`contexts/shared`): the outbox (`workforce.events`), the per-consumer inbox, idempotency keys, the
  office version and `office.changed` on the app stream. Every table carries `account_id` (the OrbitId).
- **Domain purity**: `contexts/*/domain/` imports no framework, database, file system or HTTP (`boundaries.spec.ts`).
- **Ports**: `SANDBOX_PROVIDER` (container or development `process`), `CONNECTION_SECRETS` (the credential store),
  `RUN_OUTCOMES` (Execution → Work).
- **The CEO belongs to no department**: an employee appointed CEO from a department leaves it in the same transaction
  (`EmployeeDepartmentChanged`), a move of the CEO into one is refused (`appointed_ceo`), and the database's
  `appointment_matches()` holds it at commit -- so the CEO's work is the company's: its policy, its room, its defaults.
- **Pure rules of Work** (`contexts/work/domain/`): `authority.ts` (whom a lead may give work to: its appointment in force
  and its grants), `target.ts` (who a mission goes to), `team.ts` (a plan's rules, `leadNext`: review, answer or wait),
  `data-authorization.ts` (what one attempt may read), `assignment.ts` (the state machine). Workforce keeps
  `appointment.ts` and `execution-precedence.ts` (mission > employee > department > company).
- **Synchronous edges** stay inside one transaction (eligibility at a claim, the reservation, the run intent);
  everything else crosses as a durable event or a stop request on the run row.

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
| `SandboxReady`, `SandboxFailed` | the sandbox provisioner | `work.scheduler` (on ready) |
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
| `AssignmentAccepted` | Work (a person's or a lead's acceptance) | `execution.desk` (publish to the desk), `work.delivery` (deliveries) |
| `DeskPublished` | Execution (the desk publisher) | `execution.workspace-cleanup` |
| `AssignmentBlocked`, `AssignmentPaused`, `AssignmentResumed` | Work | the pages; Needs me |
| `AssignmentCancelling`, `AssignmentCancelled`, `AssignmentFailed` | Work | `work.team`, `work.cascade` (a lead's open parts end with it; its question is withdrawn), `execution.workspace-cleanup` |
| `EmployeeDepartmentChanged` | Workforce | `execution.access` (an attempt holding another department's room is stopped) |
| `ReservationReleased` | Work (the employee is free) | `work.scheduler` (its next queued work) |
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

A part asks its LEAD; the root asks the person who gave the work (Needs me). `open` → `answered` (a compare-and-set:
two answers at once resume the asker exactly once) or `withdrawn` (its asker ended). A lead may move it one level up --
to its own lead, or from the root to the person, only for `human_decision`, `beyond_authority`, `deadline` or
`unanswered`; each hop is appended to its route (`workforce.clarification_routes`, never changed). The person's answer to
a question asked of a lead is refused (409 `asked_of_lead`).

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
