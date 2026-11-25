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
4. **No tool, on the CEO's own execution -- one STRATEGY per AI CLI, in one REGISTRY.** What the CEO is asked (an
   answer, a hiring request's plan, a profile draft) is runtime-free; how a CLI is started, held to no tool and read is
   a strategy of `EXECUTIVE_RUNTIMES` (`executive-runtimes.ts`), so the turn's lifecycle (ready → sandbox → start →
   stream → finalize) never names a runtime, and a third runtime is one row. Each strategy says what refuses a turn on
   it, PROVES the tool-less answer (never assumed from switches), maps its CLI's JSON lines onto the chat's own events (an
   adapter: one outcome rule for both), and fails closed on a line that shows a tool. The CLI runs in a session sandbox
   of its own (its connection's home alone) on the CEO's resolved connection, model and effort (the existing
   precedence; the model checked against its connection's catalog). Governance decides it as the employee (run kind
   `executive`, scope `ACCOUNT_EMPLOYEE`, the employees' model allow-list as `<runtime>:<model>`); its token opens the
   egress proxy alone.
   - **Claude Code**: `--tools ""`, `--restricted --strict-mcp-config`, no slash command, nothing persisted, the fixed
     system prompt; its start line must list no tool and no MCP server, and a tool it tries stops the turn.
   - **OpenAI Codex**: `codex exec --json --ephemeral --sandbox read-only`, every local executor off (the employees'
     list), `mcp_servers={}`, `web_search="disabled"`, `project_doc_max_bytes=0`, Orbit's neutralized entry for the
     model (written into the connection's home, the one place its sandbox holds) and the fixed system prompt as developer
     instructions. It answers only once the installed binary was OBSERVED, against a stand-in provider on the loopback,
     answering with that model with no tool that acts (the MCP readers and a refusing image viewer alone), the fixed
     prompt reaching the model and a project's `AGENTS.md` not read -- once per version and entry. Codex reads its own
     home's global instructions whatever it is told (seen on 0.169.0), so a home holding `AGENTS.override.md` or
     `AGENTS.md` refuses the turn. Any `item.*` but a message, reasoning or a warning stops it (`tool_refused`), a kind
     never seen included. A spending cap (`ORBIT_WEB_MAX_BUDGET_USD`) refuses it: Codex takes none.
   - **Antigravity** has no strategy: its CEO's chat is unavailable, saying so (work still goes to it).
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
9. **What a turn asks beyond an answer is its KIND, handled by one registry.** A turn is an `answer`, a hiring request's
   plan (`staffing`) or a profile draft (`profile`); `TurnTasks` holds one handler per kind that adds its section to the
   CEO's stdin (nonce-fenced like the rest), settles the turn once it ends (in the turn's own transaction, in a
   savepoint: what cannot be settled never takes the turn's end with it) and ends with the turn however it ends. A block
   of one kind written in a turn of another (`orbit-staffing`, `orbit-profile`) is taken out of the words shown and
   ignored, saying so. Only an answer is asked again; a hiring request or a draft is sent again.
10. **Staffing: the owner's hiring request, carried out on the owner's authority.** `POST /api/executive/staffing`
   (Idempotency-Key): the owner's words, a scope (one department, or the whole company), and what every hire runs on and
   holds -- the owner's choice of connection, model, effort and resources; the CEO never picks one. Refused before the
   CEO spends anything: no company, a CEO that cannot answer, a department that is not live, an execution a hire would
   refuse, no room in the storage budget. The CEO plans in a turn of its own (its section: the departments, their
   managers, the bounds) and writes ONE `orbit-staffing` block (people's own fields only: name, department, role,
   title, duties, instructions, skills, languages). When the turn ends Orbit holds the plan to the request and the
   company as it is then -- at most 10 hires and never more than the storage budget holds, at most 3 new departments
   (whole company only), unique names, a department the plan makes gets exactly one manager, an existing one at most
   one and none while its manager is in office, never a CEO -- and carries it out AT ONCE as the person who asked
   (`deferredOwnerActor`: their user as it is now -- existing, enabled, of the account; the session they asked from
   named, never needed alive), each department, hire (on probation) and appointment through its own command and the
   policy, as their own click would be. All or nothing: a plan that breaks a rule creates nothing, every problem listed;
   one command refused rolls the others back. `employee.hire` stays people-only: it is the owner's act, deferred, never
   the model's. A request is carried out once (its state leaves `planning` once, in the turn's transaction); Orbit
   reports what it did in the conversation (a report of its own, never in the CEO's voice).
11. **Profile drafts: the CEO drafts, the owner decides.** `POST /api/executive/drafts` (Idempotency-Key): a few words
   about the job, for a form being filled (Hire's *Department & role*, an employee's profile). The CEO drafts in a turn
   of its own (its section: the role, its department and the people there) and writes ONE `orbit-profile` block; Orbit
   keeps a profile's descriptive fields alone (title, duties, instructions, skills, languages, handoff standard), within
   the profile's bounds. It hires nobody and sets no runtime, model, resources, delegation or probation; the form fills
   empty fields at once, replaces what the owner wrote only when asked, and can undo.

## Consequences

- An owner talks to the company's CEO and gives it work without leaving the conversation, and every work request is
  still a mission held to every rule a mission is held to.
- Execution has a second kind of run. It is small (no assignment, fence, workspace, tool plane or bridge) and shares the
  admission, the budget and the recovery of attempts; anything that counts what runs counts it.
- The owner staffs the company in one request and reviews the people afterwards; the CEO drafts profiles on request.
  Neither gives a model any authority: the owner's request (or form) is the act, and the policy decides each command.
- Limits: no attachments in CEO Chat, no sources or repositories on work given from it (the Office's form has them), no
  semantic recall, no answer from an Antigravity CEO. A real model was not run for the acceptance (no connection the
  owner allowed for tests): scripted CLIs only; the Codex observation itself was run on the installed codex-cli 0.169.0.
