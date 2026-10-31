# ORBIT-GOV-004 — a policy holds a call to its strictest verdict

`src/policy.mjs` is the one answer to whether Orbit may use a resource for one capability -- `allow`, `approval` or
`deny` -- given by the same functions to the resolver deciding what the prompt router may select and to the gate every
call to a managed MCP server passes, so what the router says it would do and what a call is then allowed to do cannot
disagree. A policy, as a resource carries it:

```
{ default, capabilities: { "<capability>": verdict },
  operations: { read?: verdict, write?: verdict },
  workflows: { "<skill>": { "<capability>": verdict } } }
```

The behaviour this source must have:

- `strictest(verdicts)` is the strictest verdict among them: `deny` is stricter than `approval`, which is stricter than
  `allow`. Anything that is not one of the three counts for nothing, and with no verdict at all the answer is `allow`.
- `capabilityVerdict(policy, capability, workflow)` asks, in order: the workflow's own exception for that capability
  (the most specific rule there is, whether it is looser or stricter than the rest), then the resource's rule for the
  capability, then its default, then `allow`. A rule or a default that is not a verdict is no rule, and the next one
  decides.
- `undeclaredVerdict(policy, provides, workflow)`: a call that does not say which capability it is for is held to the
  STRICTEST verdict over everything the resource provides -- never the loosest -- and, when the resource provides
  nothing, to its default.
- `operationOf(tool)` is `read` only when the server says the tool is read-only (MCP's `annotations.readOnlyHint` is
  `true`); anything it does not vouch for is a `write`.
- `operationVerdict(policy, operation)` is the policy's rule for that operation, or `allow` when it has none that is a
  verdict.
- A call is held to the strictest of its capability verdict (or its undeclared verdict) and its operation's rule, so an
  operation rule can only ever make a call stricter.

Make the smallest change in `src/policy.mjs` that gives this behaviour, and add a regression test under `test/` that
fails before your change and passes after it. Do not change or delete an existing test.
