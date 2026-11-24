# 0062 — Orbit Web: CEO Chat, the owner's conversation with the AI CEO

## Status

Accepted (2026-11-24), for Orbit Web 0.8.0-rc02. Builds on ADR 0061 §8 (the virtual office, its appointments and roles).

## Context

A company in Orbit Web runs as a tree of AI employees: the CEO plans and gives the work to departments, managers run
them, members do the work (ADR 0061 §8). Until now its owner reached that tree only through forms: give a mission,
review a hand-in, answer *Needs me*. The owner asked to operate the company through CONVERSATION with its CEO -- a chat
as simple as a modern AI chat -- without a second execution system, a second mission system, a bypass of governance,
admission or the one-run-per-employee rule, and without a model's words ever authorizing anything.

## Decision

1. **A bounded context of its own, `contexts/executive/`,** in the office module. It owns conversations, messages, turns
   and mission links; it references the employee, the appointment and the mission by id and duplicates none of them.
   CEO Chat is a COMPANY's: `GET /api/executive` answers without a company (`no_company`) and every other route answers
   409 `office_not_set_up`; nothing is created by opening it. States: no company, no CEO (the Office's own hire and
   appointment dialogs; nobody is appointed automatically), a CEO who answers (now, or once its run ends: *busy*), a CEO
   who cannot (said why: a suspended appointment, an employee that cannot work, a runtime CEO Chat cannot hold to
   answering without tools).
2. **The CEO is the actual appointee.** A turn pins the appointment and its revision it was asked of; before it runs,
   the CEO in office is read again, and an answer asked of a CEO replaced since fails `ceo_changed` -- never another
   employee's answer. "Ask again" asks the new CEO, explicitly. Each CEO message keeps its author (employee,
   appointment, revision, name, model): a former CEO's answers stay theirs. Nothing of a former CEO's desk or memory is
   read.
3. **An answer is a conversation run, admitted like any run of the CEO** (`workforce.conversation_runs`, Execution).
   The admission pass takes attempts and conversation runs as candidates under the same locks, the same decision and
   the same budget counters (a conversation run's demand: its runtime's model plane); ONE RUN OF AN EMPLOYEE AT A TIME,
   both ways: an answer waits while an attempt of the CEO runs (said why), an attempt waits while an answer runs, and one
   pass admits at most one run of an employee. While the CEO only waits for its departments it answers at once. One
   that can never start as configured fails with the numbers -- never a *Needs me* item. The worker leases, recovers and
   releases it; the executive context runs it (`CONVERSATION_DISPATCH`).
4. **No tool, on the CEO's own execution.** The Claude CLI runs in a session sandbox of its own (its connection's home
   alone) with `--tools ""`, `--restricted --strict-mcp-config`, no slash command and nothing persisted, on the CEO's
   resolved connection, model and effort (the existing precedence; the model checked against its connection's catalog).
   One that starts with a tool or tries one is stopped (`tool_refused`). Governance decides it as the employee (run kind
   `executive`, scope `ACCOUNT_EMPLOYEE`, the employees' model allow-list); its token opens the egress proxy alone. Claude
   only: a Codex CEO cannot be held to "no tools", so its chat is unavailable, saying so (work still goes to it).
5. **Three kinds of interaction, no mode switch.** The composer talks to the CEO. A quick action asks ORBIT'S RECORDS:
   a deterministic report (company status, missions, departments, resources, decisions) labelled as Orbit's, never a
   model's, available while the CEO is busy or unavailable; the same records, compacted, are what each answer is given to
   stand on (names, states and counts only -- no desk, hand-in file, connector or credential). Work: the CEO may
   PROPOSE a mission in a fenced `orbit-mission` block; the server reads it, checks it as a mission, takes it out of the
   words shown -- and it is INERT until the owner gives it in one click: the existing mission creation (`target: { kind:
   "ceo" }`, the responsible the owner saw, `work.assign`, its idempotency, `whenBusy: "enqueue"`), linked to the
   conversation and the message it came from. The owner may also give work in their own words.
6. **What a conversation is told is Orbit's.** A consumer of the office's events turns those of a mission given from a
   conversation (the root's hand-in, acceptance, block, failure or cancellation; a question that waits for the owner;
   work that cannot start) into one system message each -- deterministic, never in the CEO's voice, once per event.
7. **Events.** Each conversation has its own stream (`GET /api/executive/conversations/:id/events`): durable events
   numbered by the conversation and replayed after Last-Event-ID (`executive.message.created|changed`,
   `executive.turn.waiting`, `executive.response.started|completed|failed`, `executive.mission.linked`) and the answer's
   transient deltas. The app stream carries `executive.conversation.created` with ids only; the outbox carries
   `ExecutiveMissionLinked` (the mission's timeline says "Given to the CEO from CEO Chat").
8. **Memory.** Conversations and their messages are kept with stable order and cursor pages; a turn is given the last
   messages and the records. Nothing is promoted to company knowledge on its own and no vector store is added; the turn's
   context is the seam for retrieval later.

## Consequences

- An owner talks to the company's CEO and gives it work without leaving the conversation, and every work request is
  still a mission held to every rule a mission is held to.
- Execution has a second kind of run. It is small (no assignment, fence, workspace, tool plane or bridge) and shares the
  admission, the budget and the recovery of attempts; anything that counts what runs counts it.
- Limits: no attachments in CEO Chat, no sources or repositories on work given from it (the Office's form has them), no
  semantic recall, and no answer from a Codex CEO. A real model was not run for the acceptance (no connection the owner
  allowed for tests): scripted CLIs only.
