# Orbit fixture

Simulated goal flow is covered by `test/orbit-e2e.test.mjs` (intake → analyze → plan → `GOAL_SOURCE` projection).

Live browser E2E is optional for 1.9.0 RC; run goal unit tests with:

```bash
node --test test/goal-*.test.mjs test/orbit-*.test.mjs
```
