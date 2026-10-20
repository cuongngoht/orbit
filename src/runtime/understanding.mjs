// UNDERSTANDING: what a checkout needs in order to run, remembered, and read
// again only when something it rests on has moved.
//
// The one command every other part of the runtime subject calls first. Whether it
// reads the evidence, and how much, is the decision table's answer
// (src/runtime/ensure.mjs) -- a caller asking what a checkout needs must not have
// to work out whether what is stored is good enough, because that is the judgement
// this exists to make once and keep. It prints nothing and decides in the open:
// the decision is part of what it returns, so a view can say it first.
import { Blocked } from "../errors.mjs";
import { decide, stateOf } from "./ensure.mjs";
import { ensureFacts } from "./facts.mjs";
import { componentsOf } from "./components.mjs";
import { record, scan } from "./scan.mjs";

// Decide, read when the table says to, and record what was read (unless --dry).
// -> { decision, state, facts, read }, `read` being the scan or null.
export function ensure(ctx, args = {}) {
  const before = ensureFacts(ctx, args);
  const decision = decide(before, { dry: args.dry });
  if (decision.stops) throw new Blocked(decision.say);
  const read = performed(ctx, decision);
  return { decision, ...after(ctx, before, read, decision), read };
}

function performed(ctx, decision) {
  if (decision.scan === "none") return null;
  const read = scan(ctx);
  if (decision.writes) record(ctx, read);
  return read;
}

// The state AFTER: what a recorded read now says, or -- for a read nobody was
// allowed to record, or none at all -- what was there before it.
function after(ctx, before, read, decision) {
  if (!read || !decision.writes) return { state: stateOf(before), facts: read && decision.dry ? read.facts : before.facts };
  const now = ensureFacts(ctx, {});
  return { state: stateOf(now), facts: now.facts };
}

// A LOOK, which writes nothing and reads no file: the stored understanding as it
// stands, with the state it is in. -> { state, facts, model, view }
export function look(ctx) {
  const facts = ensureFacts(ctx, {});
  return { state: stateOf(facts), facts: facts.facts, model: facts.model, stale: facts.stale, dirty: facts.dirty, added: facts.added, removed: facts.removed, view: componentsOf(facts.facts) };
}
