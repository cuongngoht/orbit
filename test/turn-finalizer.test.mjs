import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeIo } from './fakes/io.mjs';
import { finalizerStore, LEASE_MS } from '../src/lifecycle/finalizer-store.mjs';
import { finalizer } from '../src/lifecycle/subscribers/finalizer.mjs';
import { drainFinalizer } from '../src/lifecycle/finalize.mjs';
import { createWorkingSet } from '../src/engineering/working-set/store.mjs';
test('checkpoint retries have one identity and expired workers cannot complete another lease', () => {
  const io = fakeIo();
  const q = finalizerStore('/runtime/finalizer', io);
  const id = q.enqueue('session', [{ ev: 'edit', paths: ['src/a.mjs'] }]);
  assert.equal(q.enqueue('session', [{ ev: 'edit', paths: ['src/a.mjs'] }]), id);
  const first = q.claim(id);
  assert.equal(q.claim(id), null);
  io.state.nowMs += LEASE_MS + 1;
  const second = q.claim(id);
  assert.notEqual(first.token, second.token);
  assert.equal(q.complete(id, first.token), false);
  assert.equal(q.complete(id, second.token), true);
  assert.deepEqual(q.pending(), []);
});
test('legacy Stop does not acquire a working set or enqueue', () => {
  const fail = () => { throw new Error('unexpected work'); };
  assert.equal(finalizer.run({ event: 'turn-end', session: 'legacy' }, { workingSet: fail, finalizer: fail }), null);
});
test('unknown/background completion cannot create a verified milestone', () => {
  const io = fakeIo();
  const q = finalizerStore('/runtime/finalizer', io);
  const ws = createWorkingSet('/runtime/ws', io);
  const lines = [{ ev: 'edit', paths: ['src/a.mjs'] }, { ev: 'command', cmd: { class: 'test', ok: null } }];
  lines.forEach((line) => ws.append('session', line));
  q.enqueue('session', lines);
  const result = drainFinalizer(q, { now: io.now }, ws, true);
  assert.equal(result[0].milestone, 'NOT_YET');
  assert.deepEqual(q.pending(), []);
});
test('a late revision produces a separate checkpoint', () => {
  const io = fakeIo();
  const q = finalizerStore('/runtime/finalizer', io);
  assert.notEqual(q.enqueue('session', []), q.enqueue('session', [{ ev: 'edit', paths: ['src/a.mjs'] }]));
  assert.equal(q.pending().length, 2);
});
