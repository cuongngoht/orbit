# The Office: contexts, events and states

How Orbit Web's virtual office (ADR 0067) is put together: the bounded contexts and who depends on whom, the durable
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
    office["office · departments · employees<br/>profile & resource revisions · sandboxes"]
  end
  subgraph work["Work (contexts/work)"]
    missions["missions · assignments · reservations<br/>handoffs · decisions (Needs me)<br/>team rooms · schedules · deliveries"]
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
  sources -->|"pinned revisions (read-only)"| runs
  office -->|"eligibility (sync, in the claim's transaction)"| missions
  missions -->|"run intents · stop requests"| runs
  runs -->|"RunOutcomes port: handoff · ended · delegate · review"| missions
  runs -->|"SandboxProvider port (signed HTTP)"| allocator
```

- **Shared** (`contexts/shared`): the outbox (`workforce.events`), the per-consumer inbox, idempotency keys, the
  office version and `office.changed` on the app stream. Every table carries `account_id` (the OrbitId).
- **Domain purity**: `contexts/*/domain/` imports no framework, database, file system or HTTP (`boundaries.spec.ts`).
- **Ports**: `SANDBOX_PROVIDER` (container or development `process`), `CONNECTION_SECRETS` (the credential store),
  `RUN_OUTCOMES` (Execution → Work).
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
| `AssignmentDelegated`, `AssignmentReviewing` | Work (a lead's plan, its review) | the pages |
| `RunRequested`, `RunStarted`, `RunFinished`, `StaleResultRejected` | Work / Execution | the worker (polls `requested`, woken by the outbox) |
| `ResourcesReserved`, `RunWaitingForResources`, `RunUnschedulable`, `ResourcesReleased` | Execution (admission, release) | the admission pass; the mission's timeline |
| `HandoffSubmitted` | Work (a hand-in) | `work.team` (wakes a waiting lead) |
| `RevisionRequested`, `InformationProvided` | Work (a person's review, an answer) | the worker (a new attempt) |
| `AssignmentAccepted` | Work (a person's or a lead's acceptance) | `execution.desk` (publish to the desk), `work.delivery` (deliveries) |
| `DeskPublished` | Execution (the desk publisher) | `execution.workspace-cleanup` |
| `AssignmentBlocked`, `AssignmentPaused`, `AssignmentResumed` | Work | the pages; Needs me |
| `AssignmentCancelling`, `AssignmentCancelled`, `AssignmentFailed` | Work | `work.team`, `execution.workspace-cleanup` |
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
  RUNNING --> WAITING_FOR_SUBORDINATES: delegate
  ASSIGNED --> WAITING_FOR_SUBORDINATES: delegate
  REVIEWING --> WAITING_FOR_SUBORDINATES: delegate / wait for revisions
  WAITING_FOR_SUBORDINATES --> REVIEWING: parts handed in
  RUNNING --> BLOCKED: question · failure · isolation
  ASSIGNED --> BLOCKED
  REVIEWING --> BLOCKED
  RECOVERING --> BLOCKED
  BLOCKED --> ASSIGNED: answer · retry
  RUNNING --> RECOVERING: worker lost
  ASSIGNED --> RECOVERING
  REVIEWING --> RECOVERING
  RECOVERING --> ASSIGNED: reconciled
  ASSIGNED --> PAUSED: pause
  RUNNING --> PAUSED: pause
  PAUSED --> ASSIGNED: resume
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
from an older fence is refused (`StaleResultRejected`). Commands name the version they were made against (If-Match →
412); a review names the handoff digest it read (→ 409).

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
