// A Reach port that opens nothing. `dns[host]` is how many addresses a name has, `false` (it does
// not resolve) or "timeout"; a name nobody set resolves to one address. `tcp["host:port"]` is `true`
// (accepted), `false` (refused), "timeout", or an ARRAY consumed one answer per ask, the last one
// repeating -- a server that comes up on the third try is the case a retry exists for. Every ask is
// recorded, because what a check ASKED is as much of the contract as what it concluded.
export function fakeReach(world = {}) {
  const state = { dns: { ...(world.dns ?? {}) }, tcp: { ...(world.tcp ?? {}) } };
  const calls = [];
  return { state, calls, resolve: async (host, opts = {}) => resolveAnswer(state, calls, host, opts), tcp: async (host, port, opts = {}) => tcpAnswer(state, calls, host, port, opts), answer: (host, port, value) => void (state.tcp[`${host}:${port}`] = value), named: (host, value) => void (state.dns[host] = value) };
}

function resolveAnswer(state, calls, host, opts) {
  calls.push({ kind: "resolve", host, opts });
  const said = state.dns[host] ?? 1;
  if (said === "timeout") return { ok: false, timedOut: true, error: `${host} did not resolve within ${(opts.timeoutMs ?? 3000) / 1000}s` };
  return said === false ? { ok: false, error: `${host} did not resolve (ENOTFOUND)` } : { ok: true, addresses: said };
}

function tcpAnswer(state, calls, host, port, opts) {
  calls.push({ kind: "tcp", host, port, opts });
  const said = next(state.tcp, `${host}:${port}`);
  if (said === "timeout") return { ok: false, timedOut: true, error: `nothing answered on ${host}:${port} within ${(opts.timeoutMs ?? 3000) / 1000}s` };
  return said === true ? { ok: true } : { ok: false, error: `${host}:${port} could not be reached (ECONNREFUSED)` };
}

// An array answers once per ask, and its last answer stands.
function next(table, key) {
  const said = table[key];
  if (!Array.isArray(said)) return said ?? false;
  return said.length > 1 ? said.shift() : said[0];
}
