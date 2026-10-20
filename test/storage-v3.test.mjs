import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject } from '../src/project/index.mjs';
import { repositoryPaths, remoteIdentity } from '../src/project/repository.mjs';
import { machineContext } from '../src/store/context.mjs';
import { createContext } from '../src/run/context.mjs';
import { createDrafts } from '../src/draft/index.mjs';
import { fakeIo } from './fakes/io.mjs';
import { fakeContext } from './fakes/context.mjs';
import { runCase } from '../src/run/run-case.mjs';
import { outDir } from '../src/run/result.mjs';
import { publishRun } from '../src/report/publish.mjs';
import { editData } from '../src/store/edit.mjs';
import { contained } from '../src/project/boundary.mjs';
import { Refused } from '../src/errors.mjs';
import { sealed } from './home.mjs';

const engine = fileURLToPath(new URL('..', import.meta.url));
// native: on Windows the temp directory may be an 8.3 short name, and Git answers
// with the long one -- a path is compared the way the machine spells it.
const temp = realpathSync.native(mkdtempSync(join(tmpdir(), 'orbit-storage-v3-')));
after(() => rmSync(temp, { recursive: true, force: true }));
const env = sealed({ ORBIT_STORE_DIR: join(temp, 'store') });
function repo(name, remote = 'https://example.test/team/shared.git') {
  const root = join(temp, name);
  mkdirSync(root);
  execFileSync('git', ['init', '-q', root]);
  if (remote) execFileSync('git', ['-C', root, 'remote', 'add', 'origin', remote]);
  return root;
}
function cli(root, name, args = [], extra = {}) {
  return spawnSync(process.execPath, [join(engine, 'cli', `${name}.mjs`), ...args], { cwd: root, env, encoding: 'utf8', ...extra });
}
// The test data of these projects is in the checkout -- a person's choice since
// 1.8.9 (`init --in-checkout`), and every project's layout before it -- and a team
// commits it: an untracked ui-tests/ is a dirty tree, which freshness rightly
// calls unknown. test/storage-home.test.mjs holds the default, the store.
function committed(root) {
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture']);
}
function initialized(name, remote) {
  const root = repo(name, remote);
  const result = cli(root, 'init', [root, '--in-checkout', '--origin=https://app.example.test']);
  assert.equal(result.status, 0, result.stderr);
  return root;
}

test('init --in-checkout writes the test data into the checkout, by screen, and a copy into the store', () => {
  const root = initialized('new');
  assert.deepEqual(readdirSync(root), ['.git', 'ui-tests']);
  const p = loadProject(env, root);
  assert.equal(p.layout, 3);
  assert.equal(p.dataRoot, join(root, 'ui-tests'));
  assert.equal(p.dataHome, 'checkout');
  assert.equal(JSON.parse(readFileSync(join(p.storeRoot, 'store.json'))).layout, 3);
  assert.equal(JSON.parse(readFileSync(join(p.storeRoot, 'store.json'))).dataHome, 'checkout', "the person's choice is stamped, so a branch without the tree still reads the checkout");
  assert.equal(p.config.reports, join(p.storeRoot, 'reports'), 'reports default to the store, never the checkout');
  assert.equal(cli(root, 'schema', ['--write']).status, 0);
  const plan = cli(root, 'qa-plan', ['new', 'sample', '--screen=home']);
  assert.equal(plan.status, 0, plan.stderr);
  const draft = { id: 'sample', name: 'Sample', start: 'home', seen: 'src', steps: [{ do: 'report', js: 'true', expect: 'it === true' }] };
  assert.equal(cli(root, 'draft', ['write'], { input: JSON.stringify(draft) }).status, 0);
  const promote = cli(root, 'draft', ['promote', 'sample']);
  assert.equal(promote.status, 0, promote.stderr);
  for (const rel of [['screens', 'home', 'cases', 'sample.json'], ['screens', 'home', 'sample.plan.json'], ['schema', 'case.schema.json']]) {
    assert.ok(existsSync(join(p.dataRoot, ...rel)), `the checkout has ${rel.join('/')}`);
  }
  const storage = JSON.parse(cli(root, 'query', ['storage', '--json']).stdout);
  assert.equal(storage.dataHome, 'checkout');
  assert.equal(storage.dataRoot, p.dataRoot);
  assert.equal(storage.screensDir, join(p.dataRoot, 'screens'));
});

test('same repo shares data across checkouts, different repo isolates it and bindings survive remote changes', () => {
  const a = initialized('clone-a', 'git@example.test:team/multi.git');
  const b = initialized('clone-b', 'https://user:secret@example.test/team/multi.git');
  const c = initialized('other-repo', 'https://example.test/team/other.git');
  const p = loadProject(env, a);
  const q = loadProject(env, b);
  assert.equal(p.storeRoot, q.storeRoot);
  assert.notEqual(p.config.runDir, q.config.runDir);
  assert.equal(p.config.reports, q.config.reports, 'reports are shared the way the ledger they cite is');
  assert.notEqual(p.storeRoot, loadProject(env, c).storeRoot);
  execFileSync('git', ['-C', a, 'remote', 'set-url', 'origin', 'https://example.test/renamed.git']);
  assert.equal(loadProject(env, a).storeRoot, p.storeRoot);
  assert.equal(remoteIdentity('ssh://git@example.test/team/multi.git', a), 'example.test/team/multi');
});

test('report-only ui-tests is not legacy: the checkout is a project whose test data lives in the store, and reading creates nothing', () => {
  const root = repo('reports-only', 'https://example.test/team/read.git');
  mkdirSync(join(root, 'ui-tests', 'reports'), { recursive: true });
  const p = repositoryPaths(root, env);
  assert.ok(!existsSync(p.storeRoot));
  const read = loadProject(env, root);
  assert.equal(read.layout, 3);
  assert.equal(read.dataHome, 'store');
  assert.equal(read.dataRoot, join(p.storeRoot, 'ui-tests'));
  assert.ok(!existsSync(p.storeRoot), 'resolving it created nothing');
  assert.equal(cli(root, 'init', [root]).status, 0);
  assert.ok(existsSync(join(p.storeRoot, 'ui-tests', 'project.json')), 'init seats the store');
  assert.ok(!existsSync(join(root, 'ui-tests', 'project.json')), 'and writes nothing into the checkout');
});

test('an existing ui-tests in a checkout is that repository\'s project, and init moves nothing', () => {
  const root = repo('existing', null);
  cpSync(join(engine, 'test', 'fixtures', 'ui-tests'), join(root, 'ui-tests'), { recursive: true });
  const p = loadProject(env, root);
  assert.equal(p.layout, 3);
  assert.equal(p.dataHome, 'store');
  assert.equal(p.dataHomeBy, 'store');
  assert.equal(p.screensDir, join(p.storeRoot, 'ui-tests', 'screens'));
  const kept = cli(root, 'init', [root]);
  assert.equal(kept.status, 0, kept.stderr);
  assert.match(kept.stdout, /home: store/);
  assert.equal(cli(root, 'init', [root, '--in-checkout']).status, 2, 'a tree already there is never written over');
  assert.ok(existsSync(join(root, 'ui-tests', 'project.json')));
  assert.ok(existsSync(join(p.storeRoot, 'ui-tests')), 'the current project is seated in its store');
});

test('draft traversal is refused by every ID-based writer, with no escaped files', () => {
  const io = fakeIo();
  const drafts = createDrafts(join(temp, 'draft-store'), io);
  for (const id of ['../../../escaped', '..', '/absolute', 'x/y', 'x\\y']) {
    assert.throws(() => drafts.save({ id }), Refused);
    assert.throws(() => drafts.remove(id), Refused);
    assert.throws(() => drafts.promote(id, join(temp, 'cases'), io), Refused);
  }
  assert.equal(io.files.size, 0);
});

test('modern evidence and runtime reject paths outside their rooms and child symlinks', () => {
  const root = initialized('guard', 'https://example.test/team/guard.git');
  const p = loadProject(env, root);
  const ctx = createContext({}, env, root);
  assert.throws(() => outDir(ctx, { id: 'sample' }, join(temp, 'elsewhere')), Refused);
  assert.throws(() => loadProject({ ...env, ORBIT_RUN_DIR: join(root, 'hidden') }, root), Refused);
  const outside = join(temp, 'escape');
  mkdirSync(outside);
  symlinkSync(outside, join(p.storeRoot, 'evidence'), 'dir');
  assert.throws(() => outDir(ctx, { id: 'sample' }), Refused);
  const machine = machineContext({ project: p, config: p.config }, env);
  assert.throws(() => machine.io.write(join(p.storeRoot, 'evidence', 'leak'), 'bad'), Refused);
  assert.deepEqual(readdirSync(outside), []);
  assert.throws(() => contained(p.storeRoot, join(p.storeRoot, '../bad')), Refused);
});

test('shared editing refuses stale input rather than overwriting it', () => {
  const root = initialized('edit', 'https://example.test/team/edit.git');
  const p = loadProject(env, root);
  const file = join(p.dataRoot, 'project.json');
  const before = readFileSync(file, 'utf8');
  writeFileSync(file, before + '\n');
  let wrote = false;
  assert.throws(() => editData(p, [{ file, before }], () => { wrote = true; }), Refused);
  assert.equal(wrote, false);
});

test('a run stores its evidence and its report in the store, and leaves the checkout alone', () => {
  const root = initialized('run', 'https://example.test/team/run.git');
  const p = loadProject(env, root);
  cpSync(join(engine, 'test', 'fixtures', 'ui-tests', 'graph'), p.graphDir, { recursive: true });
  cpSync(join(engine, 'test', 'fixtures', 'ui-tests', 'screens'), p.screensDir, { recursive: true });
  const fake = fakeContext();
  const ctx = createContext({ browser: fake.browser, db: fake.db, identity: fake.identity, frontend: fake.frontend }, env, root);
  const result = runCase(ctx, ['create-thing', 'NAME=TC-1', '--json']);
  assert.equal(result.status, 'PASS');
  assert.ok(result.run.out.startsWith(p.storeRoot));
  const report = publishRun(ctx, result);
  assert.ok(report, 'report is published');
  assert.ok(report.startsWith(join(p.config.reports, 'home', 'create-thing')), 'under its screen and its case');
  assert.ok(readdirSync(p.config.reports, { recursive: true }).filter((f) => f.includes('.')).every((file) => file.endsWith('.html')), 'no evidence beside it');
  assert.ok(report.startsWith(p.storeRoot), 'the report is in the store');
  assert.ok(!existsSync(join(p.dataRoot, 'reports')), 'the checkout gains no reports directory');
  assert.match(readFileSync(report, 'utf8'), /orbit-case/);
});

test('explicit identity shares remote-less clones without writing checkout stubs', () => {
  const a = repo('no-remote-a', null);
  const b = repo('no-remote-b', null);
  for (const root of [a, b]) assert.equal(cli(root, 'init', [root, '--project-id=shared-local']).status, 0);
  assert.equal(loadProject(env, a).storeRoot, loadProject(env, b).storeRoot);
  assert.equal(cli(a, 'init', [a, '--project-id=another']).status, 2);
  assert.deepEqual(readdirSync(a), ['.git'], 'nothing at all in the checkout: the test data lives in the store');
});

test('plan IDs and schema destination symlinks are refused before escaping the store', () => {
  const root = initialized('author-guard', 'https://example.test/team/author-guard.git');
  const p = loadProject(env, root);
  assert.equal(cli(root, 'qa-plan', ['new', '../../../escape']).status, 2);
  const destination = join(temp, 'untouched-schema.json');
  writeFileSync(destination, 'untouched');
  rmSync(join(p.schemaDir, 'case.schema.json'));
  symlinkSync(destination, join(p.schemaDir, 'case.schema.json'));
  assert.equal(cli(root, 'schema', ['--write']).status, 2);
  assert.equal(readFileSync(destination, 'utf8'), 'untouched');
  assert.deepEqual(readdirSync(root), ['.git', 'ui-tests']);
});

test('a modern SessionStart recalls without writing native host memory', () => {
  const root = initialized('recall', 'https://example.test/team/recall.git');
  const hostMemory = join(temp, 'host', 'projects', 'sample', 'memory');
  mkdirSync(hostMemory, { recursive: true });
  writeFileSync(join(hostMemory, 'MEMORY.md'), 'user text');
  assert.equal(cli(root, 'learn', ['remember', 'project', 'Use the stored plan']).status, 0);
  const event = { hook_event_name: 'SessionStart', cwd: root, transcript_path: join(hostMemory, '..', 'session.jsonl') };
  const hook = cli(root, 'learn-hook', [], { input: JSON.stringify(event) });
  assert.equal(hook.status, 0, hook.stderr);
  assert.match(hook.stdout, /Use the stored plan/);
  assert.deepEqual(readdirSync(hostMemory), ['MEMORY.md']);
  assert.equal(readFileSync(join(hostMemory, 'MEMORY.md'), 'utf8'), 'user text');
});

test('stored config freshness settles to CURRENT and detects a changed declaration', () => {
  const root = initialized('architecture', 'https://example.test/team/architecture.git');
  writeFileSync(join(root, 'example.txt'), 'sample');
  committed(root);
  const first = cli(root, 'architecture', ['ensure', '--capability=widget']);
  assert.equal(first.status, 0, first.stderr);
  const next = cli(root, 'architecture', ['ensure', '--capability=widget']);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stdout, /ARCHITECTURE CURRENT/);
  const p = loadProject(env, root);
  const configFile = join(p.dataRoot, 'project.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  writeFileSync(configFile, JSON.stringify({ ...config, name: 'widget' }));
  committed(root);
  const changed = cli(root, 'architecture', ['ensure']);
  assert.equal(changed.status, 0, changed.stderr);
  assert.match(changed.stdout, /ARCHITECTURE INCREMENTAL/);
  assert.match(changed.stdout, /widget appears in this project's own configuration/);
  assert.match(cli(root, 'architecture', ['ensure']).stdout, /ARCHITECTURE CURRENT/);
});
