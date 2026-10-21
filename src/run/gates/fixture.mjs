import { Refused } from "../errors.mjs";
import { capabilityMutates } from "../../dsl/rules/head.mjs";

// A case that `creates` through capabilities that write runs only in a FRESH fixture namespace
// (ADR 0037): a namespace minted for this run is what makes a re-run safe where no skip-if guard
// stands (src/dsl/rules/head.mjs createsOf). A person's destructive case is the destructive
// gate's to allow, as before. Asked before anything is resolved or driven.
export function fixtureGate(ctx, run) {
  if (!run.c.creates || run.c.destructive) return;
  const writes = (run.c.steps ?? []).some((st) => capabilityMutates((id) => (ctx.capabilities?.has?.(id) ? ctx.capabilities.resolve(id) : null), st));
  if (writes && ctx.fixture?.fresh !== true) throw new Refused(`${run.c.id} creates through a capability that writes, and this run has no fresh fixture namespace — its repeat safety is its fixture's, so it runs only where a task's sandbox minted one`);
}
