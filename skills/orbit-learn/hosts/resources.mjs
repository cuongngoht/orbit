// Native adapters load only after an explicit protocol selection.
export async function resourceFactory(env) {
  if (env.ORBIT_HOST_PROTOCOL !== '2') return () => ({});
  const create = await creator(env.ORBIT_HOST);
  return (process, projectRoot) => ({ hostPort: create({ process, env, projectRoot }), observationScope: projectRoot, agentHost: env.ORBIT_HOST, componentReady: (c) => c.kind === 'skill' });
}
const unknownHost = (name) => ({ name, listServers: () => { throw new Error('native external inventory unavailable'); }, getServer: () => null, testServer: () => ({ status: 'unknown' }) });

async function creator(host) {
  try { return host === 'codex' ? (await import('./codex-mcp.mjs')).createCodexMcpHost : () => unknownHost(host); }
  catch { return () => unknownHost(host); }
}
