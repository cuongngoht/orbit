// Observation only: command arguments and resolved secrets never leave here.
export function createCodexMcpHost({ process, env, projectRoot }) {
  const list = () => listed(process.run('codex', ['mcp', 'list', '--json'], { env, cwd: projectRoot, timeoutMs: 3000, maxBuffer: 1024 * 1024 }));
  return { name: 'codex', listServers: list, getServer: (id) => list().find((s) => s.id === id) ?? null, testServer: () => ({ status: 'unknown', why: 'native external probing is unavailable' }) };
}
function listed(result) {
  if (!result.ok) throw new Error('native MCP observation unavailable');
  const rows = JSON.parse(result.out);
  if (!Array.isArray(rows)) throw new Error('unsupported native MCP observation');
  return rows.filter((r) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(r.name)).map(shown);
}
const shown = (row) => ({ id: row.name, name: row.name, host: 'codex', hostEnabled: row.enabled === true, transport: ({ stdio: 'stdio', streamable_http: 'http' })[row.transport?.type] ?? 'unknown', scope: 'unknown', status: 'unknown' });
