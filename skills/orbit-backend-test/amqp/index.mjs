// An AMQP 0-9-1 client with no dependency: what a messaging adapter's helper
// speaks to a broker of this protocol. It knows the protocol and nothing about
// any one project -- which exchange, queue or key to use arrives as a binding.
export { CLIENT_PROPERTIES, connect } from "./session.mjs";
export { AmqpError, helperClassOf } from "./errors.mjs";
export { typed } from "./table.mjs";
export { PROTOCOL_HEADER } from "./wire.mjs";
