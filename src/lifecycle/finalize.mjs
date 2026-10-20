import { fold } from '../engineering/working-set/fold.mjs';
import { due } from '../engineering/observe/milestone.mjs';
import { observed } from '../engineering/observe/index.mjs';
export function drainFinalizer(queue, ctx, ws, enabled) {
  if (!enabled) return [];
  return queue.pending().slice(0, 4).map((job) => drained(queue, ctx, ws, job));
}
function drained(queue, ctx, ws, job) {
  const claimed = queue.claim(job.id);
  if (!claimed) return { id: job.id, state: 'busy' };
  const result = evaluated(ctx, ws, job.id, claimed);
  queue.complete(job.id, claimed.token);
  return { id: job.id, ...result };
}
function evaluated(ctx, ws, operation, job) {
  const lines = ws.read(job.session);
  const [current, summary] = [fold(lines), fold(unobserved(lines, job))];
  const milestone = due({ ...summary, observes: current.observes, lastObserve: current.lastObserve }, { enabled: true, nowMs: Date.parse(ctx.now()) });
  if (!milestone.run) return { state: 'completed', milestone: milestone.name };
  return performed(ctx, ws, operation, job, summary, milestone);
}
function performed(ctx, ws, operation, job, summary, milestone) {
  const result = observed(ctx, { scopes: summary.since.scopes, commands: summary.commands, gates: ctx.gates() }, { host: ctx.eng.host, at: job.at, session: job.session }, { operation, milestone: milestone.name });
  ws.append(job.session, { t: ctx.now(), ev: 'observe', revision: job.revision, milestone: milestone.name, delivery: operation });
  return { state: 'completed', candidates: result.candidates.length };
}

function unobserved(lines, job) {
  const revision = Math.max(0, ...lines.filter((l) => l.ev === 'observe').map((l) => l.revision ?? 0));
  return job.lines.slice(revision);
}
