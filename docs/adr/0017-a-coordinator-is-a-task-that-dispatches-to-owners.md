# ADR 0017 — A coordinator is a task that dispatches to owners; a playbook is generated only on a workflow gap

**Status:** accepted, 1.8.1 (automation)

## Context
Every Orbit workflow already exists as its own owner: a requirement is settled by orbit-requirements, a change is
made, built, tested and reviewed by autonomous engineering, a running application is investigated by autonomous QA.
A person who hands `/orbit-help` a task still has to carry it from one owner to the next by hand. They asked for
one entry point that plans the workflow a task needs, runs it step by step, generates a missing workflow when one
is really missing, and shows all of it live -- without a second task journal, a second policy engine, a second
registry or a second live feed, and without any of it being able to raise its own permissions.

What the code forced (each verified before deciding):

- A new shipped skill is impossible: every `skills/*/SKILL.md` needs a `skill_*` switch in the hash-frozen
  `.claude-plugin/plugin.json`. Hosts discover skills only from the plugin's own tree, so a store-resident skill is
  never a native command on any host.
- The engineering orchestrator treats any open action that is not `implement` in its own task as unsettled, so a
  coordinator's facts cannot live in that task's journal.
- A skill row's policy is never read by the resolver (only MCP's is); its levers are `selection` and `eligible`.
- AGENTS.md: a gap is an opportunity only a person decides, with ONE scoped exception (report parts).

## Decision
1. **`orbit-help` is the entry point and nothing more.** With Automation off -- the default -- it is the navigator it
   always was, and a manual `orbit-*` skill never starts a workflow. With it on, a named task whose objective a
   workflow fits goes to `cli/automation.mjs start`; planning mode only plans.
2. **A coordinated workflow is a TASK of its own** (provider `automation`), written only through the task's one door.
   Its plan is an artifact beside the journal, named by a `plan:` receipt and written before it. Every step's state is
   DERIVED from its `step:` receipt, rewritten as it moves; nothing mutable is kept beside the journal. Five receipt
   domains were added (step, plan, task, requirement, skill) and a decision keeps the host's own `ref`: additive,
   older readers ignore them.
3. **A step is an owner's, and it is settled on the owner's record.** The engine runs a step itself only through an
   owner's port (a frozen requirement read back, project context, runtime understanding, the engineering task's
   completion); a host runs a skill or an agent and SETTLES with the evidence it names, which the engine reads back --
   and only evidence this workflow started counts. The host's `executionState` is a report; a word the engine derives
   is refused by name. A step whose process died is reconciled from its owner, never sent again.
4. **The engineering task is started through autonomous engineering's own `start`** and driven by its own loop; the
   coordinator links it by id and reads its view. It never writes that journal and never cancels that task.
5. **Generated playbooks are a second scoped exception**, guarded by `test/skill-factory-boundary.test.mjs`: only on a
   WORKFLOW gap (nothing provides the capability), only under the skill factory's mode, instruction-only,
   project-scoped, drafted under `orbit-help`, held to the same SKILL.md rules a shipped skill is held to plus an
   allow-list of the read-only Orbit commands it may name, never on a need nothing here provides, never replacing or
   sharing identity with a shipped component. A capability or policy gap is never a reason to generate.
6. **Same-session use without native skills**: a registered playbook joins the existing skills family as
   `project:<id>`, the resolver offers it like any other row, and the host is handed its text (`skill-factory show
   <pin>`). A task pins the version it used; a later version never changes it.
7. **How autonomous Orbit may be is a person's, set only through Orbit Control's door** -- two revisioned documents
   (machine, project), narrowed field by field with provenance, every field naming its reader -- and a policy matrix
   that combines with a resource's own verdict through `strictest`, so nothing is ever widened.
8. **Live shows it from the same journals**: a `dispatch` activity (skill, agent or engine, and the provider), a
   milestone console in the terminal, a workflow strip, the engineering task as one line, and a session's viewer that
   follows the coordinator before the task it started.

## Consequences
- The engine calls no model. A workflow advances only while a host session drives it; `resume` and `context` read
  everything from the store, so a closed session picks up where it stopped. There is no detached executor.
- On a host with no proven native agents (Codex, Antigravity), each step's skill runs in the main session, one step at
  a time, inside one context window.
- A playbook is natural-language guidance to a model. The validator refuses the mechanical risks (executable files,
  scripts and runners, commands off the allow-list, a person's decisions, hidden characters, known override patterns,
  secret shapes, frontmatter a YAML reader would read differently); what a sentence of prose tells a host is past any
  pattern, and `skillFactory.mode: approval` puts a person in front of it.
- Following a playbook is `reported`, never proven, unless its evidence names a record an owner keeps.
- A child task's individual lines are not merged into the coordinator's feed; a viewer shows the child as one line and
  moves to its own console on request. Control's page shows the coordinator's activity and links the child's page.
