// A Probe port that opens no socket. `tcp` maps a port to whether something is
// listening there; `http` maps a URL to the status it answers (or false for
// "nothing answers"). Every probe is recorded, because what a readiness check
// ASKED is as much of the contract as what it concluded.
//
// `listen(port)` and `answer(url, status)` change the world mid-test: a server
// that comes up after the first poll is the case a readiness loop exists for.
export function fakeProbe(world = {}) {
  const state = { tcp: { ...(world.tcp ?? {}) }, http: { ...(world.http ?? {}) } };
  const calls = [];
  return { state, calls, tcp: async (port, opts = {}) => tcpAnswer(state, calls, port, opts), http: async (url, opts = {}) => httpAnswer(state, calls, url, opts), listen: (port) => void (state.tcp[port] = true), close: (port) => void (state.tcp[port] = false), answer: (url, status) => void (state.http[url] = status) };
}

function tcpAnswer(state, calls, port, opts) {
  calls.push({ kind: "tcp", port, opts });
  return state.tcp[port] ? { ok: true } : { ok: false, error: `127.0.0.1:${port} refused the connection (ECONNREFUSED)` };
}

function httpAnswer(state, calls, url, opts) {
  calls.push({ kind: "http", url, opts });
  const status = state.http[url];
  return status ? { ok: true, status } : { ok: false, error: `${url} could not be reached (ECONNREFUSED)` };
}
