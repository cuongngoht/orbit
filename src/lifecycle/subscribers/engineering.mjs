// The engineering observer, run from the hooks -- but only at a MILESTONE.
//
// After every tool the working-set subscriber has already appended its line
// (it runs first, in cli/learn-hook.mjs's table). This one folds the session,
// asks src/engineering/observe/milestone.mjs whether now is worth observing, and
// almost always hears no. When it hears yes, it runs the deterministic analysers with an idempotent operation identity,
// then marks the working set after ingestion succeeds. A crash can retry
// without losing the observation or counting its support twice.
//
// It is ON by default (1.8.9) and bounded exactly as before -- a milestone only, a
// budget per session, a debounce, and nothing stronger than "observed"; a person
// turns it off (ORBIT_ENGINEERING_OBSERVE=off, or the engineering_observe setting).
// A protocol-2 host's session is observed from its checkpoint queue instead
// (src/lifecycle/subscribers/finalizer.mjs). And it is supporting intelligence:
// `records` is set, so anything it throws becomes a finding in the store and
// nothing else -- never a failed turn, never a product verdict.
import { sha } from "../../hash.mjs";
import { fold } from "../../engineering/working-set/fold.mjs";
import { due } from "../../engineering/observe/milestone.mjs";
import { observed } from "../../engineering/observe/index.mjs";
import { sessionOf } from "./working-set.mjs";

export const engineering = {
  name: "engineering",
  on: ["post-tool", "post-tool-failure", "session-end"],
  records: true,
  run: (event, world) => considered(event, world, world.workingSet?.()),
};

function considered(event, world, ws) {
  if (!ws || event.protocol === 2) return null;
  const summary = fold(ws.read(sessionOf(event, ws.host, ws.now())));
  const milestone = due(summary, { enabled: Boolean(world.observing?.()), nowMs: Date.parse(ws.now()) });
  if (milestone.run) ran(event, world, ws, { summary, milestone });
  return null;
}

function ran(event, world, ws, { summary, milestone }) {
  const session = sessionOf(event, ws.host, ws.now());
  const ctx = world.engineering?.();
  if (!ctx) return;
  observed(ctx, { scopes: summary.since.scopes, commands: summary.commands, gates: ctx.gates() }, { host: ctx.eng.host, at: ctx.now(), session: event.session ?? undefined }, { operation: sha(JSON.stringify([session, ws.read(session)])), milestone: milestone.name });
  ws.append(session, { t: ws.now(), ev: "observe", milestone: milestone.name });
}
