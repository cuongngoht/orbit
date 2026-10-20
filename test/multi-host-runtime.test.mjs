import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sealed } from './home.mjs';
import { affinityPaths } from '../src/project/affinity.mjs';
import { runtimePath } from '../src/project/runtime.mjs';
import { hostSession } from '../src/memory/session.mjs';
import { traceLog } from '../src/trace/log.mjs';
import { stateRooms } from '../src/store/control.mjs';
import { realIo } from '../src/store/io.mjs';
import { fakeIo } from './fakes/io.mjs';
import { withLock } from '../src/store/lock.mjs';
import { observeExternal, externalObservations, qualifiedServers } from '../src/mcp/external-store.mjs';
// Built the way src/store/lock.mjs builds them, so a Windows run asks the same keys.
const LOCK_DIR = join('/room', '.lock');
const OWNER_FILE = join(LOCK_DIR, 'owner.json');
const repo = resolve(import.meta.dirname, '..');
const session = (host) => hostSession(host, 'native-private-session');
test('three runtime affinities differ; missing or another host session is refused', () => {
  const base = { root: '/checkout', layout: 3, sessionDir: '/store/runtime/checkout', runtime: '/store/runtime' };
  const paths = ['claude', 'codex', 'antigravity'].map((host) => affinityPaths(base, { ORBIT_HOST: host, ORBIT_HOST_PROTOCOL: '2', ORBIT_SESSION: session(host) }));
  assert.equal(new Set(paths.map((p) => p.sessionDir)).size, 3);
  assert.throws(() => runtimePath(paths[0], paths[1].sessionDir));
  assert.throws(() => affinityPaths(base, { ORBIT_HOST: 'codex', ORBIT_HOST_PROTOCOL: '2' }));
  assert.throws(() => affinityPaths(base, { ORBIT_HOST: 'codex', ORBIT_HOST_PROTOCOL: '2', ORBIT_SESSION: session('claude') }));
  assert.equal(affinityPaths(base, {}), base);
});
test('expired owner cannot release a replacement lock', () => {
  const io = fakeIo();
  withLock('/room', () => io.write(OWNER_FILE, JSON.stringify({ token: 'replacement' })), io);
  assert.ok(io.dirs.has(LOCK_DIR));
});
test('native external observations retain each host and scope without credentials', () => {
  const io = fakeIo();
  const rooms = stateRooms('/store');
  for (const host of ['claude', 'codex', 'antigravity']) observeExternal(rooms, io, host, '/checkout', [{ id: 'same', name: 'same', password: 'SENTINEL', args: ['SENTINEL'] }]);
  observeExternal(rooms, io, 'codex', '/other', []);
  const all = externalObservations(rooms, io);
  assert.equal(all.length, 4);
  assert.equal(new Set(qualifiedServers(all).map((s) => s.id)).size, 3);
  assert.doesNotMatch(JSON.stringify(all), /SENTINEL/);
});
function hook(args, input, env) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [join(repo, 'cli/learn-hook.mjs'), ...args], { cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (b) => { output += b; });
    child.on('error', reject);
    child.on('close', (code) => done({ code, output }));
    child.stdin.end(JSON.stringify(input));
  });
}
const contents = (root) => readdirSync(root, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? contents(join(root, e.name)) : [readFileSync(join(root, e.name), 'utf8')]).join('\n');
test('three real hook processes share a trace store, dedupe new delivery and retain no raw payload', async (t) => {
  const store = mkdtempSync(join(tmpdir(), 'orbit-three-host-'));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const env = sealed({ ORBIT_STORE_DIR: store, ORBIT_WORKING_SET: 'off' });
  const common = { hook_event_name: 'PostToolUse', cwd: repo, session_id: 'native-private-session', tool_name: 'Bash', tool_use_id: 'delivery-private', turn_id: 'turn-private', tool_input: { command: 'node --test SECRET-SENTINEL' } };
  const jobs = [hook([], common, env), hook(['--host=codex', '--protocol=2'], common, env), hook(['--host=antigravity', '--protocol=2', '--event=PostToolUse'], { conversationId: 'native-private-session', workspacePaths: [repo], executionNum: 1, toolCall: { name: 'run_command', args: { CommandLine: 'node --test SECRET-SENTINEL' } } }, env)];
  assert.ok((await Promise.all(jobs)).every((r) => r.code === 0));
  const before = traceLog(stateRooms(store), realIo()).read();
  await hook(['--host=codex', '--protocol=2'], common, env);
  const after = traceLog(stateRooms(store), realIo()).read();
  assert.equal(after.length, before.length);
  assert.deepEqual(new Set(after.map((e) => e.session?.split(':')[0])), new Set(['claude', 'codex', 'antigravity']));
  assert.doesNotMatch(contents(store), /native-private-session|delivery-private|turn-private|SECRET-SENTINEL/);
});
test('a waiter that judged a lock stale never removes the lock taken after it', () => {
  const io = fakeIo({ nowMs: 120000, mtimes: { [LOCK_DIR]: 1 }, backoff: [0] });
  const owner = OWNER_FILE;
  io.dirs.add(LOCK_DIR);
  io.write(owner, JSON.stringify({ host: 'gone', pid: 1, token: 'dead' }));
  const read = io.read;
  io.read = (p) => {
    const seen = read(p);
    if (p === owner && seen?.includes('dead')) io.write(owner, JSON.stringify({ host: 'live', pid: 2, token: 'replacement' }));
    return seen;
  };
  assert.throws(() => withLock('/room', () => assert.fail('the live lock was broken'), io), /another session/);
  assert.match(io.read(owner), /replacement/);
  assert.deepEqual([...io.dirs].filter((d) => d.startsWith(LOCK_DIR)), [LOCK_DIR]);
});
test('a lock whose owner is gone is broken, recorded, and leaves nothing aside', () => {
  const io = fakeIo({ nowMs: 120000, mtimes: { [LOCK_DIR]: 1 }, backoff: [0] });
  io.dirs.add(LOCK_DIR);
  io.write(OWNER_FILE, JSON.stringify({ host: 'gone', pid: 1, token: 'dead' }));
  assert.equal(withLock('/room', () => 'ran', io), 'ran');
  assert.equal(io.notes[0].kind, 'lock-broken');
  assert.deepEqual([...io.dirs].filter((d) => d.startsWith(LOCK_DIR)), []);
  assert.deepEqual([...io.files.keys()].filter((f) => f.startsWith(LOCK_DIR)), []);
});
test('a bound Codex or AGY session reads the checkout identity map Claude reads, while its browser state stays its own', async () => {
  const { createIdentity } = await import('../src/identity/index.mjs');
  const project = { layout: 3, root: '/store/repo', runtime: join('/store', 'repo', 'runtime', 'host') };
  for (const host of ['codex', 'antigravity']) {
    const bound = affinityPaths({ ...project, sessionDir: join(project.runtime, 'sessions', 's1') }, { ORBIT_HOST: host, ORBIT_HOST_PROTOCOL: '2', ORBIT_SESSION: session(host) });
    assert.equal(createIdentity({}, {}, {}, bound).mapFile, createIdentity({}, {}, {}, project).mapFile, host);
    assert.throws(() => runtimePath(bound, join(project.runtime, 'browser')), /must stay inside/, host);
  }
});
// AGY runs a plugin hook in the PLUGIN's directory, so the fold must find the
// project from the event's workspace, never from the hook's working directory.
test('an AGY hook run outside the checkout still folds a watched command into lessons', async (t) => {
  const { cpSync, existsSync, mkdirSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const base = mkdtempSync(join(tmpdir(), 'orbit-agy-fold-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const checkout = join(base, 'repo');
  const store = join(base, 'store');
  cpSync(join(repo, 'test', 'fixtures', 'ui-tests'), join(checkout, 'ui-tests'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: checkout });
  spawnSync('git', ['-c', 'user.email=fixture@example.test', '-c', 'user.name=fixture', 'commit', '-q', '--allow-empty', '-m', 'fixture'], { cwd: checkout });
  const env = sealed({ ORBIT_STORE_DIR: store, ORBIT_WORKING_SET: 'off', ORBIT_TRACE: 'off' });
  const where = spawnSync(process.execPath, [join(repo, 'cli/learn.mjs'), 'where'], { cwd: checkout, env, encoding: 'utf8' }).stdout;
  const room = where.match(/^store\s+(\S+)/m)[1];
  mkdirSync(room, { recursive: true });
  cpSync(join(repo, 'test', 'fixtures', 'ledger', 'main'), room, { recursive: true });
  const input = { conversationId: 'fold-session', workspacePaths: [checkout], stepIdx: 3, error: '', toolCall: { name: 'run_command', args: { CommandLine: 'node cli/note.mjs home/Add "seen" "again"', Cwd: checkout } } };
  const run = spawnSync(process.execPath, [join(repo, 'cli/learn-hook.mjs'), '--host=antigravity', '--protocol=2', '--event=PostToolUse'], { cwd: base, env, input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.ok(existsSync(join(room, 'memory', 'lessons')), 'the fold wrote the lessons room');
});
