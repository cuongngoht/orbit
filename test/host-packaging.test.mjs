import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
const json = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
test('native package pins its own hook path and shares skills', () => {
  const manifest = json('.codex-plugin/plugin.json');
  assert.equal(manifest.version, json('package.json').version);
  assert.equal(manifest.skills, './skills/');
  assert.equal(manifest.hooks, './hooks/codex.json');
  for (const [event, rows] of Object.entries(json('hooks/codex.json').hooks)) {
    assert.notEqual(event, 'PostToolUseFailure');
    for (const row of rows) for (const hook of row.hooks) {
      assert.match(hook.command, /--host=codex --protocol=2/);
      assert.doesNotMatch(hook.command, /CLAUDE_PLUGIN_ROOT/);
    }
  }
  assert.equal(existsSync(new URL('../.agents/hooks.json', import.meta.url)), false);
  assert.equal(json('.agents/plugins/marketplace.json').plugins[0].source.path, '.');
});
test('the Antigravity plugin hooks are generated, protocol v2, and name no machine path', async () => {
  const { pluginHooks } = await import('../skills/orbit-learn/hosts/setup.mjs');
  const { lstatSync } = await import('node:fs');
  assert.ok(lstatSync(new URL('../hooks.json', import.meta.url)).isFile(), 'a real file: an archive refuses a symlink');
  assert.deepEqual(json('hooks.json'), pluginHooks());
  const commands = JSON.stringify(json('hooks.json')).match(/"command":"[^"]*"/g);
  assert.equal(commands.length, 4);
  for (const c of commands) {
    assert.match(c, /"command":"node cli\/learn-hook\.mjs --host=antigravity --protocol=2 --event=\w+"/);
    assert.doesNotMatch(c, /\/Users\/|\/home\/|[A-Z]:\\\\|\$\{/);
  }
});
// Grok Build (1.8.9) runs a plugin's hooks from hooks.json-shaped files, expands ${GROK_PLUGIN_ROOT} itself, and SKIPS a
// handler that carries `if` or `args` (and runs an `async` one in the foreground) -- so its file names every hook
// explicitly, as protocol 2, and carries none of Claude Code's handler fields.
test('the Grok hooks file is protocol v2, rooted at GROK_PLUGIN_ROOT, and carries no field Grok skips', () => {
  const events = json('hooks/grok.json').hooks;
  assert.deepEqual(Object.keys(events).sort(), ['PostToolUse', 'PostToolUseFailure', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  for (const [event, rows] of Object.entries(events)) for (const row of rows) for (const hook of row.hooks) {
    assert.match(hook.command, /^node "\$\{GROK_PLUGIN_ROOT\}\/cli\/(learn|router)-hook\.mjs" --host=grok --protocol=2$/, event);
    assert.deepEqual(Object.keys(hook).sort(), ['command', 'timeout', 'type'], `${event}: only the fields Grok reads`);
    assert.ok(hook.timeout <= 15, event);
  }
  assert.ok(events.SessionEnd[0].hooks[0].timeout <= 2, 'a plugin SessionEnd hook gets about 1.5 seconds: it only checkpoints');
});

// Grok Build reads the ROOT plugin.json before .grok-plugin/ or .claude-plugin/ (measured on grok 1.0.62), and that file
// is Antigravity's manifest too: it names Grok's hooks file -- without it Grok falls back to hooks/hooks.json, Claude's
// -- and no agents. Antigravity ignores both keys and keeps its own root hooks.json.
test('the root manifest points Grok at its own hooks and no agents, and leaves Antigravity its hooks.json', () => {
  const root = json('plugin.json');
  assert.equal(root.hooks, './hooks/grok.json');
  assert.deepEqual(root.agents, []);
  assert.ok(existsSync(new URL('../hooks/grok.json', import.meta.url)));
  assert.deepEqual(Object.keys(json('hooks.json')), ['orbit-learn'], 'Antigravity still loads its own generated hooks');
  assert.match(root.description, /Grok Build/);
});
