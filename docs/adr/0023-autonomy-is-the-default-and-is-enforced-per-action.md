# ADR 0023 — Coordination is governed per action

**Status:** accepted; automation settings schema 3.

A named task whose objective fits a workflow is coordinated directly. Settings describe only current
budgets, retries, instruction-playbook bounds and Live presentation. Unknown fields and unsupported
schemas are refused before mutation. There is no mode, activation switch, historical restriction,
conversion or lift operation.

Action classes and resource policies determine each step. Engineering owns code changes in task-owned
workspaces; QA and check receipts own verification. Control's authenticated mutation door owns approvals,
resume and cancellation. An approval is bound to one action fingerprint and spent once.

The instruction factory may generate only bounded, verified, project-scoped playbooks. Executable
scripts, dependency installation, secrets, external writes, production mutation, push, merge and deploy
remain denied by the action table. Capability gaps remain a person's decision.

Each child records its parent and each parent reads its child's evidence. Mission Control projects
those journals, pending approvals, blocked tasks and resource readiness without probing or running work.
