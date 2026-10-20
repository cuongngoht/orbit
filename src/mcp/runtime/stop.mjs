// How an MCP conversation can end early, said by whoever noticed it -- in
// Orbit's own words: a server's error text, a response body and a header value
// are never repeated in a reason.
//
//   needs-auth    the server answered 401/403: credentials missing or refused
//   unreachable   it could not be started, reached or heard from in time, or
//                 went away mid-conversation
//   rpc-error     it answered, and the answer was a JSON-RPC error
//   unsupported   a transport this runtime does not speak
//
// Translating one into a typed stop (Blocked, Refused) or a check verdict is
// the caller's business: the same `rpc-error` is a server that is broken when
// it refuses `initialize`, and a request that was wrong when it refuses one call.
export class McpStop extends Error {
  constructor(kind, reason, detail = {}) {
    super(reason);
    Object.assign(this, { kind, ...detail });
  }
}

export const stopped = (kind, reason, detail) => new McpStop(kind, reason, detail);
