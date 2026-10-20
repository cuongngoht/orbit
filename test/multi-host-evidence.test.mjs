import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcile } from '../src/engineering/reconcile.mjs';
import { evidenceOf } from '../src/memory/evidence.mjs';
import { hostSession } from '../src/memory/session.mjs';
import { replayed } from '../src/engineering/replay.mjs';
import { ingest } from '../src/engineering/ingest.mjs';
import { createEngineering } from '../src/engineering/store.mjs';
import { fakeIo } from './fakes/io.mjs';
const candidate = { kind: 'pattern', key: 'port-boundary', statement: 'Use a port', strength: 'observed', scope: ['src/ports'], evidence: ['src/ports/index.mjs'], source: 'source' };
const seen = (domain, id) => ({ host: 'machine', at: '2026-09-27T00:00:00Z', session: hostSession(domain, id) });
function step(fact, domain, id, hash = 'same') {
  const c = { ...candidate, seenBy: seen(domain, id) };
  return reconcile(c, fact, { evidence: evidenceOf(c, { status: 'fresh', fingerprint: hash }, c.seenBy) }).fact;
}
const permutations = (xs) => xs.length ? xs.flatMap((x, i) => permutations(xs.filter((_, n) => n !== i)).map((rest) => [x, ...rest])) : [[]];
test('all writer orders: identical evidence across three domains credits one session', () => {
  for (const order of permutations(['claude', 'codex', 'antigravity'])) {
    const fact = order.reduce((f, d) => step(f, d, 'a'), null);
    assert.equal(fact.support.sessions, 1);
    assert.equal(fact.confidence, 'possible');
  }
});
test('same-domain sessions keep baseline semantics; one session cannot multiply groups', () => {
  let fact = step(null, 'claude', 'a');
  fact = step(fact, 'claude', 'a', 'changed');
  assert.equal(fact.support.sessions, 1);
  fact = step(fact, 'claude', 'b');
  assert.equal(fact.support.sessions, 2);
  fact = step(fact, 'codex', 'a');
  assert.equal(fact.support.sessions, 2);
});
test('unversioned support is refused rather than reconstructed', () => {
  const old = { ...candidate, confidence: 'certain', support: { sessions: 2, against: 0, seen: [] } };
  assert.throws(() => step(old, 'codex', 'a'), /unsupported.*support/i);
  assert.equal(old.support.sessions, 2);
});
test('journal replay matches live credit; interrupted operation repairs without adding support', () => {
  const io = fakeIo();
  const eng = createEngineering('/store', io);
  const ctx = { eng, now: io.now, source: { commit: () => 'commit', fingerprints: (scopes) => Object.fromEntries(scopes.map((s) => [s, { hash: 'same', dirty: 0 }])) } };
  const opts = { seenBy: seen('codex', 'a'), operation: 'operation-a' };
  const [first] = ingest(ctx, [candidate], opts);
  eng.remove(first.fact.id);
  const [retried] = ingest(ctx, [candidate], opts);
  assert.equal(retried.recovered, true);
  assert.equal(eng.observations().length, 1);
  ingest(ctx, [candidate], { seenBy: seen('antigravity', 'a'), operation: 'operation-b' });
  assert.equal(eng.all()[0].support.sessions, 1);
  assert.deepEqual(replayed(eng.observations()).get(first.fact.id).support, eng.all()[0].support);
});
test('a batch reads the journal once and still numbers every line it appends', () => {
  const io = fakeIo();
  const eng = createEngineering('/store', io);
  let reads = 0;
  const counted = { ...eng, observations: () => (reads += 1, eng.observations()) };
  const ctx = { eng: counted, now: io.now, source: { commit: () => 'commit', fingerprints: (scopes) => Object.fromEntries(scopes.map((s) => [s, { hash: 'same', dirty: 0 }])) } };
  const batch = ['a', 'b', 'c'].map((key) => ({ ...candidate, key }));
  ingest(ctx, batch, { seenBy: seen('codex', 'a'), operation: 'operation-once' });
  assert.equal(reads, 1);
  assert.deepEqual(eng.observations().map((l) => l.sequence), [1, 2, 3]);
});
