// This stack's transport: AMQP 0-9-1, through the client vendored under vendor/amqp/.
//
//   exchange  billing                  topic, durable -- the outbox relay publishes here, with a
//                                      publisher confirm, routing key billing.reminder.requested
//   queue     billing.reminders        quorum, bound by billing.reminder.requested; the worker's
//   dlx       billing.dlx              topic, durable -- where the queue dead-letters
//   dlq       billing.reminders.dead   quorum, bound to billing.dlx by #
//
// Any other queue may bind to `billing` beside the worker's (an observer does), because routing
// is by topic and nothing here consumes what it did not declare. Every publication carries
// message_id, correlation_id (the business key) and x-causation-id (the execution that asked).
// A delivery the worker gives up on is nacked without requeue: the BROKER routes it to the dlx
// and stamps x-death. A retry is a nack WITH requeue, which RabbitMQ 4 does not count against
// the queue's x-delivery-limit -- so the worker counts deliveries itself, and the limit is only a
// backstop against a message that keeps killing its consumer.
//
// The app speaks to this module only through open() and what it returns, so app/ names no
// broker: publish({ channel, messageId, correlationId, causationId, payload }) -> { outcome },
// consume(onDelivery) -> { stop }, close(), ended.
import { connect } from "./vendor/amqp/index.mjs";

const env = (name, fallback) => process.env[name] || fallback;

export const TOPOLOGY = {
  exchange: env("BILLING_EXCHANGE", "billing"),
  deadLetterExchange: env("BILLING_DLX", "billing.dlx"),
  queue: env("BILLING_QUEUE", "billing.reminders"),
  deadLetterQueue: env("BILLING_DLQ", "billing.reminders.dead"),
  bindingKey: "billing.reminder.requested",
  deadLetterKey: "billing.reminder.dead",
  deliveryLimit: 5,
};

const OUTCOMES = { ack: "confirmed", nack: "rejected", returned: "unroutable", unconfirmed: "unconfirmed" };

async function declared(ch) {
  const t = TOPOLOGY;
  await ch.declareExchange({ name: t.exchange, type: "topic", durable: true });
  await ch.declareExchange({ name: t.deadLetterExchange, type: "topic", durable: true });
  await ch.declareQueue({ name: t.deadLetterQueue, durable: true, arguments: { "x-queue-type": "quorum" } });
  await ch.bindQueue({ queue: t.deadLetterQueue, exchange: t.deadLetterExchange, routingKey: "#" });
  await ch.declareQueue({ name: t.queue, durable: true, arguments: { "x-queue-type": "quorum", "x-dead-letter-exchange": t.deadLetterExchange, "x-dead-letter-routing-key": t.deadLetterKey, "x-delivery-limit": t.deliveryLimit } });
  await ch.bindQueue({ queue: t.queue, exchange: t.exchange, routingKey: t.bindingKey });
}

function publisher(ch) {
  return async ({ channel, messageId, correlationId, causationId, payload }) => {
    const settled = await ch.publish({
      exchange: TOPOLOGY.exchange,
      routingKey: channel,
      mandatory: true,
      body: Buffer.from(JSON.stringify(payload)),
      properties: { messageId, correlationId, contentType: "application/json", deliveryMode: 2, headers: causationId ? { "x-causation-id": causationId } : {} },
    });
    return { outcome: OUTCOMES[settled.outcome] ?? "unconfirmed", detail: settled.replyText };
  };
}

function deliveryOf(ch, m) {
  let settled = false;
  // Settled once; a settlement that failed leaves the delivery unsettled, so it can be handed back.
  const once = (fn) => async (...args) => {
    if (settled) return;
    settled = true;
    try {
      await fn(...args);
    } catch (e) {
      settled = false;
      throw e;
    }
  };
  return {
    messageId: m.properties?.messageId ?? null,
    correlationId: m.properties?.correlationId ?? null,
    causationId: typeof m.headers?.["x-causation-id"] === "string" ? m.headers["x-causation-id"] : null,
    body: m.message,
    redelivered: Boolean(m.redelivered),
    settled: () => settled,
    ack: once(async () => ch.ack(m.deliveryTag)),
    retry: once(async ({ delayMs = 0 } = {}) => {
      await new Promise((r) => setTimeout(r, delayMs));
      ch.nack(m.deliveryTag, { requeue: true });
    }),
    deadLetter: once(async () => ch.nack(m.deliveryTag, { requeue: false })),
  };
}

// One delivery at a time (prefetch 1), each handled to the end before the next is taken.
async function consumer(ch, onDelivery) {
  await ch.qos({ prefetchCount: 1 });
  let inFlight = Promise.resolve();
  const { consumerTag } = await ch.consume({ queue: TOPOLOGY.queue, onMessage: (m) => { inFlight = inFlight.then(() => onDelivery(deliveryOf(ch, m))); } });
  return {
    stop: async () => {
      await ch.cancel(consumerTag).catch(() => {});
      await inFlight;
    },
  };
}

export async function open() {
  const conn = await connect({ host: env("AMQP_HOST", "127.0.0.1"), port: Number(env("AMQP_PORT", "5672")), vhost: env("AMQP_VHOST", "/"), user: process.env.AMQP_USER, password: process.env.AMQP_PASSWORD, heartbeatSec: 30 });
  const ch = await conn.channel();
  await declared(ch);
  await ch.confirmSelect();
  let closing = false;
  return {
    publish: publisher(ch),
    consume: (onDelivery) => consumer(ch, onDelivery),
    close: async () => {
      closing = true;
      await conn.close().catch(() => {});
    },
    ended: conn.done.then(({ error } = {}) => (closing ? new Promise(() => {}) : error?.message ?? "closed")),
  };
}
