// How an AMQP conversation ended badly, as DATA: a helper maps `kind` (and a
// broker's reply code) onto the orbit.helper/v1 error classes without reading a
// message string. A publish whose confirm never came back is AMBIGUOUS -- never
// failed and never retried here: whether the broker took it is a read-back's
// question, asked by whoever owns the effect.
export class AmqpError extends Error {
  constructor(kind, message, details = {}) {
    super(message);
    this.name = "AmqpError";
    this.kind = kind;
    Object.assign(this, details);
  }
}

export const transportError = (message, cause) => new AmqpError("transport", message, cause ? { cause } : {});
export const protocolError = (message) => new AmqpError("protocol", message);
export const timeoutError = (message) => new AmqpError("timeout", message);
export const closedError = (scope, a) => new AmqpError("closed", `the broker closed the ${scope}: ${a.replyCode} ${a.replyText}`, { scope, replyCode: a.replyCode, replyText: a.replyText, classId: a.classId, methodId: a.methodId });
export const ambiguousError = (e, cause) => new AmqpError("ambiguous", `publish ${e.deliveryTag}${e.messageId ? ` (message ${e.messageId})` : ""} was sent and its confirm never arrived: ${cause?.message ?? "the connection ended"}`, { deliveryTag: e.deliveryTag, messageId: e.messageId ?? null, cause });

// Reply codes (AMQP 0-9-1 §1.9): a 4xx and not-allowed say the broker REFUSED
// what was asked; a frame, syntax or command error says the conversation broke;
// anything else (forced, internal, resource) is the machine's, not the request's.
const REFUSED = new Set([402, 403, 404, 405, 406, 530]);
const BROKEN = new Set([501, 502, 503, 504, 505, 540]);
const CLOSED = [
  { when: (e) => REFUSED.has(e.replyCode), is: "refused" },
  { when: (e) => BROKEN.has(e.replyCode), is: "protocol" },
  { when: () => true, is: "transport" },
];

const CLASSES = {
  transport: () => "transport",
  protocol: () => "protocol",
  timeout: () => "timeout",
  ambiguous: () => "ambiguous",
  closed: (e) => CLOSED.find((row) => row.when(e)).is,
};

// An error this module did not make is not news about the broker: it is called
// `protocol`, so a helper reports an execution error rather than blaming the
// environment.
export const helperClassOf = (error) => (CLASSES[error?.kind] ?? CLASSES.protocol)(error);
