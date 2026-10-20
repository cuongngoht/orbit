<!-- GENERATED from things.plan.json — edit the JSON, then: node <engine>/cli/qa-plan.mjs render things --write -->

# Things — create, resubmit, archive — test plan

**Feature:** Things   ·   **Revision:** 2   ·   **Written:** 2026-09-18   ·   **Author:** the fixture   ·   **Map:** frontend abc1234, captured 2026-01-01   ·   **Environments:** test   ·   **Budget:** 20 min (smoke) — the slot between the build finishing and the standup

## Sources

- **REQ1** requirement THING-1 @ 3 — A thing can be created, a duplicate name is refused, and only an administrator may archive.
- **SRC1** code y.cs:9 @ abc1234 — What the save path does today. Implementation: it describes the product as built, so it can confirm a criterion but never be one.

## Scope

- in: creating a thing from the home screen
- in: submitting the same thing twice
- in: archiving a thing
- in: who may archive
- out: bulk operations
- out: anything the cleanup consumer does after the message is queued

## Acceptance criteria

| id | must be true | source | coverage |
|---|---|---|---|
| AC1 | A thing created from the home screen is there after a reload. | REQ1 | S1 |
| AC2 | Submitting the same name twice leaves exactly one thing. | REQ1 | S3 |
| AC3 | A viewer cannot archive a thing. | REQ1 | S2 |
| AC4 | An archived thing no longer appears in the list. | REQ1 | S4 |
| AC5 | Archiving a thing tells the cleanup consumer about it. | REQ1 | M1 |

## Scenarios

| id | scenario | pri | covers | technique | layers | readiness | cases |
|---|---|---|---|---|---|---|---|
| S1 | An administrator creates a thing | P1 | AC1 | crud | ui+api+sql | ready | create-thing |
| S2 | A viewer cannot archive another tenant's thing | P1 | AC3 | permission | ui | blocked |  |
| S3 | Submitting the same thing twice leaves one thing | P1 | AC2 | idempotency | ui+api+sql | ready | resubmit-thing |
| S4 | An administrator archives a thing | P2 | AC4 | state-transition | ui | ready | archive-thing |

### S1 — An administrator creates a thing  [P1]  MUST
- **Why it matters:** if this breaks there is no feature; it is also the path every other scenario starts from
- **Risk:** 13/15 from impact, likelihood, usage (not scored: blast, history) — three factors scored; nobody has the defect history for this area yet
- **Actor:** admin; holds App.Admin; resource owner: the actor; state: no thing by this name exists
- **Preconditions:** signed in as an administrator; no thing named ${NAME} exists
- **Data:** per-run; key a TC- prefixed name, unique to the run; scope the actor's own tenant; cleanup: the archive case removes it; otherwise it is left and the TC- prefix makes it findable; on failure: a half-created thing keeps the TC- name and is archived by hand; the name carries the run, so two machines never meet
- **Intent:** open the add dialog → give it the name → save → read the list back
- **UI:** the list on home contains ${NAME}
- **API:** POST api/things answers 201
- **SQL:** exactly one row in Things named ${NAME}, read after a reload
- **Mutation:** create; before: no row in Things named ${NAME}; action: the administrator saves the add dialog; after: exactly one row in Things named ${NAME}; unchanged: every other row in Things; the things belonging to any other tenant; if refused: no row is written and the dialog stays open with the message; map: dlg-thing/Save
- **Estimate:** 4 min — the ledger records it at 12s plus the browser opening

### S2 — A viewer cannot archive another tenant's thing  [P1]
- **Why it matters:** the bug we would be embarrassed to ship: a hidden control over an endpoint that still accepts the call
- **Risk:** 7/10 from impact, likelihood (not scored: usage, blast, history) — high cost, low chance — which is exactly the shape of a bug that ships
- **Actor:** viewer; holds App.Viewer; must NOT hold App.Admin; resource owner: another user; tenant: another tenant; state: the thing is active
- **Preconditions:** a thing exists that belongs to another tenant
- **Data:** fixture; key the seeded thing TC-OTHER; scope a tenant the actor does not belong to; cleanup: nothing is changed, so there is nothing to put back; on failure: if the archive DID happen, the seeded thing has to be restored by hand before the next run; read-only against a fixture nobody else writes
- **Intent:** open the other tenant's thing → look for the archive control → attempt the archive if it is there
- **UI:** the Archive control is not rendered on the detail screen for a viewer
- **API:** unverifiable — the map records no effect for detail/Archive, so nothing here knows which call to attempt past the UI
- **SQL:** unverifiable — this project declares no sql.command, so no row can be read to show it is untouched
- **Mutation:** transition; before: the thing is active and owned by another tenant; action: a viewer attempts to archive it; after: the thing is still active — the attempt changes nothing; unchanged: the thing's status; the thing's owner; every other thing in either tenant; if refused: the list is unchanged and no message is queued
- **Denial:** lacks App.Admin; attempts archive a thing belonging to another tenant; screen: the Archive control is absent; if it is somehow reached, the attempt shows a refusal rather than succeeding quietly; server: unverifiable — no effect record names the call, so there is no request to replay past the screen — a capability gap, not a lowered bar; unchanged: the thing is still active and still belongs to the other tenant
- **Blockers:** B1 (map) the map records no viewer view of the detail screen and no effect for detail/Archive. Record them with record-edge.mjs and this becomes automatable — until then it is a blocker on AUTOMATION, not a reason to drop the scenario
- **Estimate:** 6 min — a person signing in as a viewer and looking

### S3 — Submitting the same thing twice leaves one thing  [P1]  MUST
- **Why it matters:** a double-click on a slow save is the commonest way a duplicate reaches a real database
- **Risk:** 11/15 from impact, likelihood, usage (not scored: blast, history)
- **Actor:** admin; holds App.Admin; resource owner: the actor
- **Preconditions:** no thing named ${NAME} exists
- **Data:** per-run; key a TC- prefixed name, unique to the run; scope the actor's own tenant; cleanup: archived by hand or by the archive case; on failure: two rows with the TC- name mean the bug reproduced — keep them as evidence; the name carries the run
- **Intent:** create the thing → submit the identical thing again → count the rows
- **UI:** the list still shows one ${NAME}
- **API:** the second POST api/things answers 409 — the duplicate is refused, not quietly accepted
- **SQL:** exactly one row in Things named ${NAME} after both submits
- **Mutation:** create; before: no row named ${NAME}; action: the add dialog is saved twice with the same name; after: exactly one row named ${NAME}; unchanged: the row created by the first submit — same id, same values; if refused: the second attempt leaves the first row exactly as it was; map: dlg-thing/Save
- **Repeat:** resubmit; the second submit is refused with 409 and the first thing is untouched; must not appear: a second row in Things, a second message on the queue; the case's skip-if guards the RE-RUN only
- **Estimate:** 5 min — twice the create path

### S4 — An administrator archives a thing  [P2]
- **Why it matters:** the only way a thing leaves the list, and the trigger for everything downstream
- **Risk:** 6/10 from impact, likelihood (not scored: usage, blast, history)
- **Actor:** admin; holds App.Admin; resource owner: the actor; state: the thing is active
- **Preconditions:** a thing exists and the run knows its id
- **Data:** per-run; key the id resolved from the TC- name; scope the actor's own tenant; cleanup: none — archiving IS the cleanup for this run's data; on failure: an unarchived TC- thing is left behind and archived by hand; it only ever touches the thing this run created
- **Intent:** open the thing → archive it → read the list back
- **UI:** the detail screen says Archived and the thing is gone from the list
- **API:** unverifiable — the map records no effect for detail/Archive — nothing here knows which call it makes. Trace it with query effect and this becomes required
- **SQL:** unverifiable — the map names no table for detail/Archive, and this project declares no sql.command either
- **Mutation:** transition; before: the thing is active and in the list; action: the administrator archives it; after: the thing is archived and no longer in the list; unchanged: the thing's name and id; every other thing in the list; if refused: the thing stays active and the screen says why; map: detail/Archive
- **Manual:** M1
- **Estimate:** 3 min — one navigation and one click

## Manual checks — what no browser can see

- **M1 the thing-removed message reaches the cleanup consumer** (unassigned, todo)
  - not automated because: it is a queue. No browser can see one, and a JSON case pretending to check it would assert nothing
  - step: note the id of the thing S4 archived
  - step: look for a thing-removed message carrying that id
  - step: check the cleanup consumer acknowledged it, and look at the dead letters
  - expect: one thing-removed message for that id, acknowledged, and nothing in the dead letters
  - evidence: the message body; the consumer's log line; the dead-letter count before and after

## Open questions and assumptions

- **Q1** How long may the cleanup consumer take before we would call it broken? (blocks AC5) — unassigned
- **A1** assumed: A duplicate is decided on the name alone, not on the name plus the owner. — that is what the map's single unique index implies — nobody has confirmed it

## Deliberately not covered

- **X1** Archiving several things at once. — the control is not in this release; there is nothing to drive

## Done means

- [ ] every acceptance criterion is covered or carries a disposition
- [ ] what no browser can see is a manual check with an owner
- [ ] no scenario is marked verified on evidence from an older revision
