import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostEnvironment } from '../skills/orbit-learn/hosts/settings.mjs';
import { switchOf } from '../src/project/env.mjs';
import { sealed } from './home.mjs';
test('legacy options keep Orbit/PT precedence including invalid Orbit suppressing PT', () => {
  const env = sealed({ ORBIT_TRACE: 'invalid', PT_TRACE: 'off', CLAUDE_PLUGIN_OPTION_TRACE: 'true' });
  assert.equal(hostEnvironment(env, { name: 'claude' }), env);
  assert.equal(switchOf(env, 'TRACE', 'trace', false), true);
});
test('new protocols ignore native options from another host and expose unavailable hints', () => {
  for (const name of ['codex', 'antigravity', 'grok']) {
    const env = hostEnvironment(sealed({ CLAUDE_PLUGIN_OPTION_TRACE: 'false', PT_TRACE: 'off', ORBIT_TRACE: 'invalid' }), { name, protocol: 2 });
    assert.equal(env.ORBIT_TRACE, 'on');
    assert.equal(env.CLAUDE_PLUGIN_OPTION_TRACE, undefined);
    assert.equal(env.ORBIT_HOST_MEMORY, 'off');
    assert.equal(env.ORBIT_ENGINEERING_OBSERVE, 'on', 'learning is on by default for every host (1.8.9)');
  }
});
test('a host whose person turned learning off keeps it off, and an exported value still wins', () => {
  for (const name of ['codex', 'antigravity', 'grok']) {
    assert.equal(hostEnvironment(sealed({ ORBIT_ENGINEERING_OBSERVE: 'off' }), { name, protocol: 2 }).ORBIT_ENGINEERING_OBSERVE, 'off');
    assert.equal(hostEnvironment(sealed({ CLAUDE_PLUGIN_OPTION_ENGINEERING_OBSERVE: 'false' }), { name, protocol: 2 }).ORBIT_ENGINEERING_OBSERVE, 'on', "another host's option never reaches it");
  }
});
