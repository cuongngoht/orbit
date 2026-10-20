import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { sealed } from './home.mjs';
test('a missing new adapter cannot break legacy resolution or silently select Claude for Codex', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-loader-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const loader = join(dir, 'loader.mjs');
  writeFileSync(loader, `export async function resolve(specifier, context, next) { if (specifier.endsWith('/codex.mjs')) throw new Error('fixture: adapter absent'); return next(specifier, context); }`);
  const registry = new URL('../skills/orbit-learn/hosts/index.mjs', import.meta.url).href;
  const code = `import { resolveHookHost } from ${JSON.stringify(registry)}; const input = {hook_event_name:'SessionStart'}; console.log((await resolveHookHost(input)).name, (await resolveHookHost(input,['--host=codex','--protocol=2'])).name);`;
  const result = spawnSync(process.execPath, ['--experimental-loader', pathToFileURL(loader).href, '--input-type=module', '-e', code], { encoding: 'utf8', env: sealed(), timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'claude unknown');
});
