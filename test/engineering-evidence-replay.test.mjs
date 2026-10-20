import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { ingest } from '../src/knowledge/ingest.mjs';
import { replayed } from '../src/knowledge/replay.mjs';
import { candidate, knowledgeWorld } from './fakes/knowledge.mjs';
import { hostSession } from '../src/memory/session.mjs';
const seen = (host, id) => ({ host: 'machine', at: '2026-09-27T00:00:00Z', session: hostSession(host, id) });
test('knowledge recovers a journaled result after save failure, then applies the next domain without false support', () => {
  const ctx = knowledgeWorld();
  const save = ctx.know.save;
  ctx.know.save = () => { throw new Error('injected crash after journal'); };
  assert.throws(() => ingest(ctx, [candidate()], { seenBy: seen('codex', 'a') }), /injected crash/);
  assert.equal(ctx.know.all().length, 0);
  ctx.know.save = save;
  ingest(ctx, [candidate()], { seenBy: seen('antigravity', 'b') });
  const fact = ctx.know.all()[0];
  assert.equal(fact.support.sessions, 1);
  assert.deepEqual(replayed(ctx.know.journalLines()).get(fact.id).support, fact.support);
  assert.equal(ctx.io.exists(join('/store', 'knowledge', 'backups')), false);
  assert.deepEqual(ctx.know.journalLines().map((l) => l.sequence), [1, 2]);
});
test('a shell record without trusted provenance cannot bypass an activated credit policy', () => {
  const ctx = knowledgeWorld();
  ingest(ctx, [candidate()], { seenBy: seen('codex', 'a') });
  ingest(ctx, [candidate()], { seenBy: { host: 'another-machine', at: '2026-09-28T00:00:00Z' } });
  assert.equal(ctx.know.all()[0].support.sessions, 1);
});
