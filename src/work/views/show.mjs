// One work, as it stands: what it is for, which requirement it rests on, every need with what
// it has come to, and where to pick it up. Read from the journal alone -- nothing is asked of a
// provider and nothing is written -- so two sessions looking at it cannot disagree.
import { load, standing } from "../resume.mjs";
import { stateOf } from "../model.mjs";

const bindingView = (b) => (b ? { status: b.status, provider: b.provider?.key ?? null } : null);

function needView(model, need) {
  const receipts = model.receipts.filter((r) => r.need === need.id);
  return { need: need.id, type: need.type, subject: need.subject, capability: need.capability ?? null, asks: need.asks, dependsOn: need.dependsOn, state: stateOf(need, model), binding: bindingView(model.bindings.get(need.id)), receipts: receipts.length, lastOutcome: receipts.at(-1)?.outcome ?? null };
}

export function showWork(w, id) {
  const model = load(w, id);
  const where = standing(w, id);
  return { ...where, root: model.meta.root ?? null, position: model.position, sessions: model.resumed.length, needs: [...model.needs.values()].map((n) => needView(model, n)), lastCheckpoint: model.checkpoints.at(-1) ? { id: model.checkpoints.at(-1).id, upto: model.checkpoints.at(-1).upto, at: model.checkpoints.at(-1).at } : null };
}
