import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptanceOf } from '../skills/orbit-release/hosts.mjs';
test('native acceptance cannot be inferred from package validity, and source changes invalidate it', () => {
  assert.equal(acceptanceOf({}, 'current').ok, false);
  const record = { schema: 1, sourceDigest: 'current', hosts: ['claude', 'codex', 'antigravity', 'grok'].map((id) => ({ id, version: 'fixture-version', nativeDispatch: true, controlStopped: true, uninstallPreservedStore: true, sanitizedFixtures: true })) };
  assert.equal(acceptanceOf(record, 'current').ok, true);
  assert.equal(acceptanceOf(record, 'changed').ok, false);
  const withoutGrok = { ...record, hosts: record.hosts.filter((h) => h.id !== 'grok') };
  assert.match(acceptanceOf(withoutGrok, 'current').detail, /grok/, 'Grok Build (1.8.9) is accepted by a live dispatch of its own, like every host');
  record.hosts[2].nativeDispatch = false;
  assert.equal(acceptanceOf(record, 'current').ok, false);
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostSourceDigest } from '../skills/orbit-release/hosts.mjs';

// 1.8.6: what a host LOADS that is not JavaScript -- Claude Code's pane module and its type contract -- is part of the
// source a native acceptance names, so a change to the pane is a change the hosts must accept again.
test('the acceptance digest moves with the pane module and its types, as with any engine file', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-digest-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['hooks', 'types', 'src']) mkdirSync(join(root, dir), { recursive: true });
  for (const file of ['package.json', 'plugin.json', 'hooks.json', '.gitattributes']) writeFileSync(join(root, file), '{}\n');
  writeFileSync(join(root, 'hooks', 'live-pane.tsx'), 'export const a = 1\n');
  writeFileSync(join(root, 'types', 'index.d.ts'), 'export type A = 1\n');
  writeFileSync(join(root, 'src', 'x.mjs'), 'export const x = 1;\n');
  const before = hostSourceDigest(root);
  writeFileSync(join(root, 'hooks', 'live-pane.tsx'), 'export const a = 2\n');
  const pane = hostSourceDigest(root);
  assert.notEqual(pane, before);
  writeFileSync(join(root, 'types', 'index.d.ts'), 'export type A = 2\n');
  const lf = hostSourceDigest(root);
  assert.notEqual(lf, pane);
  writeFileSync(join(root, 'types', 'index.d.ts'), 'export type A = 2\r\n');
  assert.equal(hostSourceDigest(root), lf, 'line endings never move it (a Windows checkout names the macOS digest)');
  mkdirSync(join(root, '.claude-plugin', 'types', 'claude-code'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'types', 'claude-code', 'index.d.ts'), 'export type Api = 1\n');
  assert.equal(hostSourceDigest(root), lf, 'the types Claude Code writes into a plugin folder it loaded are the host\'s, never the source');
});
