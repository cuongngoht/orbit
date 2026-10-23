// The PROJECTION: journal lines into events, through the very fold the engine decides with (src/mission/fold.mjs).
// One code path -- `push` folds a line and names it -- so projecting a whole journal and projecting it line by line as
// a viewer follows it are the same events at every cursor, by construction (test/projection.test.mjs proves it
// against a hand-written journal anyway).
import { emptyModel, foldInto } from "../mission/fold.mjs";
import { eventOf } from "./event.mjs";

export function createProjection() {
  const state = { model: emptyModel(), events: [] };
  const push = (record) => ((n) => (foldInto(state.model, record), state.events.push(eventOf(state.model, record, n)), state.events.at(-1)))(state.model.position);
  return { push, model: () => state.model, events: () => state.events };
}

export const eventsOf = (records) => ((p) => ((records ?? []).forEach((r) => p.push(r)), p.events()))(createProjection());
