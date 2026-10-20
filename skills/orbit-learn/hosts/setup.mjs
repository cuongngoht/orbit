// Native configuration only. Shared setup owns revisions, backups and rollback.
import { isAbsolute, join } from 'node:path';
import { Refused } from '../../../src/errors.mjs';
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const EVENTS = (command) => ({ PreInvocation: [command('PreInvocation', 15)], PreToolUse: [{ matcher: '*', hooks: [command('PreToolUse', 10)] }], PostToolUse: [{ matcher: '*', hooks: [command('PostToolUse', 10)] }], Stop: [command('Stop', 3)] });
const commandAt = (script) => (event, timeout) => ({ type: 'command', command: `node ${script} --host=antigravity --protocol=2 --event=${event}`, timeout });
export function renderHooks(host, root) {
  if (host !== 'antigravity' || !isAbsolute(root)) throw new Refused('render requires antigravity and an absolute installation root');
  return EVENTS(commandAt(quote(join(root, 'cli/learn-hook.mjs'))));
}
// AGY runs a hook with its working directory set to the folder holding
// hooks.json, so the plugin's own root hooks.json names the script RELATIVELY:
// the same file works on every machine, with no installation path in it.
export const pluginHooks = () => ({ 'orbit-learn': EVENTS(commandAt('cli/learn-hook.mjs')) });
export const setupOwnership = { key: 'orbit-learn', conflicts: (doc) => Object.entries(doc).filter(([key, entry]) => key !== 'orbit-learn' && entry?.enabled !== false && JSON.stringify(entry).includes('cli/learn-hook.mjs')).map(([key]) => key) };
