// Where a requirement stands, right now: how clear it is, whose word, what is still asked,
// which of its sources have moved since it was read, and the snapshot it last froze.
//
// Read-only, and it never fetches: which revision a source stands at NOW is what the
// composition root's `world.source` says from what was already read, so asking does not
// cost a request. Without it, authority is not claimed rather than guessed.
import { authorityOf, citesOf } from "../model.mjs";
import { clarityOf, isCurrent, isOpen } from "../vocab.mjs";

const count = (list, key) => list.reduce((acc, item) => ({ ...acc, [item[key]]: (acc[item[key]] ?? 0) + 1 }), {});

// A cited source, and whether the source has moved on since.
function sourceRows(facts, ctx) {
  const cites = facts.flatMap((f) => citesOf(f.sources));
  const unique = cites.filter((c, at) => cites.findIndex((x) => x.sid === c.sid && x.revision === c.revision) === at);
  return unique.map((c) => ({ id: c.sid, cited: c.revision, now: ctx.world?.source?.(c.sid)?.revision ?? null, stale: Boolean(ctx.world?.source?.(c.sid)) && ctx.world.source(c.sid).revision !== c.revision }));
}

const questionRow = (q) => ({ id: q.id, state: q.state, blocking: q.blocking, asks: q.asks, slots: q.slots });

function authorityFor(facts, ctx) {
  if (!ctx.world?.source) return null;
  const byId = new Map(facts.map((f) => [f.id, f]));
  return authorityOf(facts, { sourceAuthority: (sid) => ctx.world.source(sid)?.authority, fact: (id) => byId.get(id) ?? null });
}

export function status(ctx, root) {
  const port = ctx.requirements.open(root);
  const facts = port.facts().filter((f) => isCurrent(f.status));
  const questions = port.questions();
  const state = port.state();
  return { root, clarity: clarityOf(facts, questions), authority: authorityFor(facts, ctx), facts: count(facts, "status"), open: questions.filter(isOpen).map(questionRow), sources: sourceRows(facts, ctx), lastSnapshot: state.lastSnapshot ?? null, identity: state.identity ?? null };
}
