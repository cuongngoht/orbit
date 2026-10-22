// How a NATS or JetStream conversation ended badly, as DATA: a helper maps `kind` -- and a
// JetStream error's own code -- onto the orbit.helper/v1 error classes without reading a
// message string it did not have to. The kinds are the AMQP client's (transport, protocol,
// timeout, closed, ambiguous) plus three NATS has words for: `refused` (a request this client
// will not or the server cannot make as asked), `denied` (the server's permissions refused it;
// the connection lives on) and `api` (a JetStream API error, judged by its code).
//
// A publish whose ack never came back is AMBIGUOUS -- never failed and never retried here:
// whether the stream kept it is a read-back's question, asked by whoever owns the effect.
export class NatsError extends Error {
  constructor(kind, message, details = {}) {
    super(message);
    this.name = "NatsError";
    this.kind = kind;
    Object.assign(this, details);
  }
}

export const transportError = (message, cause) => new NatsError("transport", message, cause ? { cause } : {});
export const protocolError = (message) => new NatsError("protocol", message);
export const timeoutError = (message) => new NatsError("timeout", message);
export const closedError = (message) => new NatsError("closed", message);
export const refusedError = (message, details = {}) => new NatsError("refused", message, details);
export const ambiguousError = (e, cause) => new NatsError("ambiguous", `publish to ${e.subject}${e.msgId ? ` (message ${e.msgId})` : ""} was sent and its ack never arrived: ${cause?.message ?? "the connection ended"}`, { subject: e.subject, msgId: e.msgId ?? null, cause });

// What a server's -ERR says, in the words the server uses (NATS has no codes for these): which
// kind of failure it is, and whether the server closes the connection after it. The protocol
// keeps three open -- a permissions violation, an invalid subject, too many subscriptions -- and
// closes on every other. A permissions violation names the subject; it is DENIED, and what it was
// about is the one refused.
export const ERR_ROWS = [
  { re: /^permissions violation/i, kind: "denied", fatal: false },
  { re: /^maximum subscriptions exceeded/i, kind: "refused", fatal: false },
  { re: /^invalid subject/i, kind: "protocol", fatal: false },
  { re: /^(authorization violation|(user|account) authentication (expired|revoked)|attempted to connect to route port|maximum payload violation)/i, kind: "refused", fatal: true },
  { re: /^(stale connection|slow consumer|authorization timeout|maximum connections exceeded)/i, kind: "transport", fatal: true },
  { re: /^/, kind: "protocol", fatal: true },
];

const subjectIn = (text) => /"([^"]+)"/.exec(String(text))?.[1] ?? null;

export function serverError(text) {
  const row = ERR_ROWS.find((r) => r.re.test(String(text)));
  return new NatsError(row.kind, `the server said -ERR '${String(text).slice(0, 200)}'`, { text: String(text), fatal: row.fatal, subject: subjectIn(text) });
}

export const apiError = (error, verb) => new NatsError("api", `${verb} answered ${error?.code ?? "?"} ${error?.err_code ?? ""} ${error?.description ?? ""}`.trim(), { code: error?.code ?? null, errCode: error?.err_code ?? null, description: error?.description ?? "", verb });

// JetStream API errors (nats-server errors.json), by err_code: a request that names what is not
// there, conflicts with what is, or is malformed is REFUSED -- the case's or the binding's
// mistake. JetStream not enabled or out of resources is the machine's: transport. A code not
// listed falls back on its HTTP-like status, and then on protocol, so a row here only ever makes
// a class more exact than the status alone.
export const API_ERRORS = [
  { errCode: 10003, says: "bad request", is: "refused" },
  { errCode: 10014, says: "consumer not found", is: "refused" },
  { errCode: 10023, says: "insufficient resources", is: "transport" },
  { errCode: 10025, says: "invalid JSON", is: "refused" },
  { errCode: 10037, says: "no message found", is: "refused" },
  { errCode: 10039, says: "JetStream not enabled for account", is: "transport" },
  { errCode: 10058, says: "stream name already in use with a different configuration", is: "refused" },
  { errCode: 10059, says: "stream not found", is: "refused" },
  { errCode: 10060, says: "expected stream does not match", is: "refused" },
  { errCode: 10070, says: "wrong last msg ID", is: "refused" },
  { errCode: 10071, says: "wrong last sequence", is: "refused" },
  { errCode: 10076, says: "JetStream not enabled", is: "transport" },
  { errCode: 10148, says: "consumer already exists", is: "refused" },
];

const BY_STATUS = [
  { when: (code) => code === 400 || code === 404 || code === 409, is: "refused" },
  { when: (code) => code === 503, is: "transport" },
  { when: () => true, is: "protocol" },
];

const apiClass = (e) => API_ERRORS.find((row) => row.errCode === e.errCode)?.is ?? BY_STATUS.find((row) => row.when(e.code)).is;

const CLASSES = {
  transport: () => "transport",
  protocol: () => "protocol",
  timeout: () => "timeout",
  ambiguous: () => "ambiguous",
  closed: () => "transport",
  refused: () => "refused",
  denied: () => "refused",
  api: (e) => apiClass(e),
};

// An error this module did not make is not news about the server: it is called `protocol`, so
// a helper reports an execution error rather than blaming the environment.
export const helperClassOf = (error) => (CLASSES[error?.kind] ?? CLASSES.protocol)(error);
