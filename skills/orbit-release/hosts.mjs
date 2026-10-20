// Native acceptance is recorded after live host dispatch, never inferred from
// adapter unit tests, binary presence, package validation or a green UI build.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
// Every host Orbit ships an integration for (Grok Build since 1.8.9), each accepted by a live dispatch of its own.
export const TARGETS = Object.freeze(['claude', 'codex', 'antigravity', 'grok']);
// The same source on any checkout: '/' separators and LF, so a Windows
// checkout (autocrlf, `\\`) names the digest a macOS smoke recorded. Since 1.8.6 it also covers what a host LOADS
// that is not JavaScript: Claude Code's pane module (hooks/*.tsx) and its type contract (types/), so a change to the
// pane is a change the hosts must accept again.
// What Claude Code writes into a plugin folder it loads -- `.claude-plugin/types/**`, the API's types for an editor --
// is the host's, never the plugin's source: hashed, a folder a host had loaded would name another digest (1.8.6).
const HOST_WRITTEN = ['.claude-plugin/types/'];
const ours = (root) => (file) => !HOST_WRITTEN.some((p) => relative(root, file).split(sep).join('/').startsWith(p));
export function hostSourceDigest(root) {
  const paths = [...['src', 'cli', 'skills', 'hooks', '.codex-plugin', '.claude-plugin', '.agents', 'catalog', 'types'].flatMap((dir) => files(join(root, dir))), ...['package.json', 'plugin.json', 'hooks.json', '.gitattributes'].map((file) => join(root, file))].filter(ours(root)).sort();
  return createHash('sha256').update(paths.map((file) => `${relative(root, file).split(sep).join('/')}\n${readFileSync(file, 'utf8').replaceAll('\r\n', '\n')}`).join('\n')).digest('hex');
}
const files = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(dir, e.name)) : e.isFile() && /\.(mjs|json|md|tsx|ts)$/.test(e.name) ? [join(dir, e.name)] : []) : []);
export function nativeAcceptance(root) {
  const file = join(root, 'docs', 'host-acceptance.json');
  if (!existsSync(file)) return { name: 'native host acceptance', ok: false, detail: 'live smoke evidence not recorded; see docs/hosts.md', sourceDigest: hostSourceDigest(root) };
  return acceptanceOf(JSON.parse(readFileSync(file, 'utf8')), hostSourceDigest(root));
}
export function acceptanceOf(record, digest) {
  const missing = TARGETS.filter((id) => !record?.hosts?.some((h) => h.id === id && typeof h.version === 'string' && h.version && h.nativeDispatch === true && h.controlStopped === true && h.uninstallPreservedStore === true && h.sanitizedFixtures === true));
  const ok = record?.schema === 1 && record.sourceDigest === digest && missing.length === 0;
  return { name: 'native host acceptance', ok, detail: ok ? `${TARGETS.length} live host integrations accepted for this source digest` : `native evidence absent/stale (${missing.join(', ') || 'source digest changed'}); do not release`, sourceDigest: digest };
}
