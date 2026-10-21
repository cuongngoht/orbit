# ADR 0031 — A test obligation rests on an accepted oracle, and authority is derived

## Status

Proposed (0.1.0). Extends ADR 0007 (requirement authority) and ADR 0005 (the loop); nothing they hold is weakened.

## Context

0.1.0 generates tests from requirements. Four things in the engine at `d0cbbcf` stood between a generated test and a
verdict anybody could trust:

1. **An accepted requirement created no obligation.** Obligations are derived from the journal and stored nowhere
   (`src/investigation/obligations.mjs`), and their authority comes from plan sources only. A frozen requirement
   snapshot's authority lands on the investigation's input record and nowhere else (`src/investigation/input.mjs:65-68`).
2. **A run's worth was chosen by whoever ran it.** `authority: has("draft") ? "draft" : "accepted"`
   (`cli/autonomous-qa.mjs:286`) and `authority: a.draft ? "draft" : "accepted"` (`src/investigation/dispatch.mjs:67`):
   a flag, not a fact.
3. **A generator that decides what the product should do** turns an implementation into a requirement and a model's
   reading into a passing oracle. ADR 0007 already says a draft criterion "prepares tests and never confirms a
   finding", and the run rows honour it (`src/investigation/findings.mjs:184-188`). Nothing yet said how a generated
   assertion earns the right to confirm anything.
4. **One word for three questions.** Storing a test, running it and accepting the contract it is held to were not kept
   apart. A PASS of a draft could read as coverage, and an executed draft could read as accepted.

## Decision

- **Three axes, never one.** These are independent questions:
  - storing a test: draft, version;
  - running it: authorised, executed, observed;
  - accepting the contract it is held to.

  A generated case stays a draft whatever its evidence. A confirmed assessment promotes nothing and raises no accepted
  suite's coverage.
- **`sourceAuthority` is derived, never accepted as input.** `src/qa/obligations/authority.mjs` is an ordered
  `AUTHORITY` table over what the owners answer: the sources store, the requirement snapshot (`authorityOf`), the plan,
  the security catalog, the graph. The composition root hands these in (`cli/autonomous-qa.mjs`). The rows, in order;
  the last always matches:

  | Row | When |
  |---|---|
  | `unknown` | the owner has no answer |
  | `stale` | the revision moved |
  | `anomaly` | the digest moved without a new revision |
  | `implementation` | code, a commit, a runtime or graph observation: never authority-bearing |
  | `hint` | memory or a model's proposal |
  | `conflict` | two accepted bindings disagree on one slot |
  | `accepted` | the owner says accepted and an acceptance receipt exists |
  | `draft` | anything else |

  A field a host sends that names an authority, an acceptance or a revision is refused by name.
- **A binding pins revision AND digest.** "Latest" is never fetched while a result is reproduced. A moved revision makes
  every obligation resting on it STALE; a conflict makes it REQUIRES_REQUIREMENT.
- **The kinds of source are the plan document's table.**
  - Oracles once accepted at a pinned revision: a work item or business rule, an API contract, a QA plan, a security
    control catalog or policy, an event or messaging contract, a schedule or job policy, a workflow or data contract.
  - Only what was BUILT: source and runtime observations. They serve discovery, locators and hypotheses.
  - Hints: memory and a model's proposal.

  A contract in an open format (OpenAPI, AsyncAPI, a schedule policy) is read into structured `expects` by a reader
  under `skills/`, only after a person accepted the source (`sources accept --human`).
- **A generated assertion confirms only through a deterministic mapping.** All of these must hold:
  - an approved template at its version;
  - a slot in an accepted binding of the obligation;
  - an exact meaning, operator and value;
  - a recompile that reproduces the step's text and digest.

  A free-form interpretation can be FLAGGED by an independent review and never accepted by one. What it lacks is a
  person's or an accepted contract's to supply. Obligations that do not depend on it go on.
- **A run's authority is derived.** It is accepted only when its `case_digest` equals the digest of the case in the data
  home. A run bound to a frozen version takes the weakest authority of its bindings. The two flags above go.

## Consequences

- `cli/autonomous-qa.mjs` hands owner ports in. `src/qa/` imports none of requirements, sources or architecture, and a
  test greps for it.
- An investigation that relied on a flag-chosen authority now shows the derived one.
- A project whose contract lives only in somebody's head gets REQUIRES_REQUIREMENT and a question, never a default.
