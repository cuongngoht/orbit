// This stack's transport: NATS JetStream, through this application's own client (nats.mjs).
//
//   stream    BILLING        subjects billing.reminder.requested · limits retention, file storage,
//                            a two-minute duplicate window (Nats-Msg-Id)
//   consumer  reminders      durable PULL consumer on BILLING, explicit ack, ack wait 10 s (what a
//                            delivery whose consumer died waits before it is delivered again),
//                            max_deliver 5 (a backstop above the worker's own limit)
//   stream    BILLING_DEAD   subjects billing.reminder.dead -- where the worker dead-letters
//
// The stream keeps limits retention so another durable consumer -- an observer -- can read it
// beside the worker's without taking anything from it. Every publication carries Nats-Msg-Id (the
// logical message id), Correlation-Id (the business key) and Causation-Id (the execution that
// asked), and is held to its stream by Nats-Expected-Stream. JetStream has no dead-letter queue:
// the worker publishes what it gives up on to billing.reminder.dead, with the reason, and then
// terminates the delivery.
//
// The app speaks to this module only through open() and what it returns, so app/ names no
// broker: publish({ channel, messageId, correlationId, causationId, payload }) -> { outcome },
// consume(onDelivery) -> { stop }, close(), ended.
import { connect } from "./nats.mjs";

const env = (name, fallback) => process.env[name] || fallback;
const NS = 1_000_000;

export const TOPOLOGY = {
  stream: env("BILLING_STREAM", "BILLING"),
  subject: "billing.reminder.requested",
  deadStream: env("BILLING_DEAD_STREAM", "BILLING_DEAD"),
  deadSubject: "billing.reminder.dead",
  consumer: env("BILLING_CONSUMER", "reminders"),
  maxDeliver: 5,
  ackWaitMs: Number(env("BILLING_ACK_WAIT_MS", "10000")),
  duplicateWindowMs: 120000,
};

const json = (m) => JSON.parse(m.data.toString("utf8") || "{}");

async function api(nc, subject, body) {
  const reply = await nc.request(subject, Buffer.from(JSON.stringify(body ?? {})), { timeoutMs: 5000 });
  if (reply.status === 503) throw new Error(`JetStream is not answering ${subject}`);
  return json(reply);
}

// Created when missing, brought to this configuration when it differs.
async function stream(nc, config) {
  const made = await api(nc, `$JS.API.STREAM.CREATE.${config.name}`, config);
  if (!made.error) return made;
  const updated = await api(nc, `$JS.API.STREAM.UPDATE.${config.name}`, config);
  if (updated.error) throw new Error(`stream ${config.name}: ${updated.error.description}`);
  return updated;
}

async function declared(nc) {
  const t = TOPOLOGY;
  await stream(nc, { name: t.stream, subjects: [t.subject], retention: "limits", storage: "file", duplicate_window: t.duplicateWindowMs * NS, discard: "old" });
  await stream(nc, { name: t.deadStream, subjects: [t.deadSubject], retention: "limits", storage: "file", duplicate_window: t.duplicateWindowMs * NS, discard: "old" });
  const consumer = { durable_name: t.consumer, name: t.consumer, ack_policy: "explicit", ack_wait: t.ackWaitMs * NS, max_deliver: t.maxDeliver, filter_subject: t.subject, deliver_policy: "all", max_ack_pending: 100 };
  const made = await api(nc, `$JS.API.CONSUMER.CREATE.${t.stream}.${t.consumer}`, { stream_name: t.stream, config: consumer });
  if (made.error) throw new Error(`consumer ${t.consumer}: ${made.error.description}`);
}

function publisher(nc) {
  return async ({ channel, messageId, correlationId, causationId, payload }) => {
    const headers = { "Nats-Msg-Id": messageId, "Nats-Expected-Stream": TOPOLOGY.stream, "Correlation-Id": correlationId, "Content-Type": "application/json", ...(causationId ? { "Causation-Id": causationId } : {}) };
    const reply = await nc.request(channel, Buffer.from(JSON.stringify(payload)), { headers, timeoutMs: 5000 }).catch((e) => ({ timedOut: e.message }));
    if (reply.timedOut) return { outcome: "unconfirmed", detail: reply.timedOut };
    if (reply.status === 503) return { outcome: "unroutable", detail: "no stream captures the subject" };
    const ack = json(reply);
    if (ack.error) return { outcome: "rejected", detail: ack.error.description };
    return { outcome: "confirmed", duplicate: ack.duplicate === true, sequence: ack.seq };
  };
}

// $JS.ACK.<stream>.<consumer>.<delivered>.<sseq>.<cseq>.<ts>.<pending>, or the same after a
// domain and an account hash: the delivered count is the fifth token from the end.
const deliveredOf = (reply) => Number(String(reply ?? "").split(".").at(-5)) || 1;

function deliveryOf(nc, m) {
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
  const h = m.headers ?? {};
  const answer = (text) => nc.publish(m.reply, Buffer.from(text));
  return {
    messageId: h["Nats-Msg-Id"] ?? null,
    correlationId: h["Correlation-Id"] ?? null,
    causationId: h["Causation-Id"] ?? null,
    body: m.data,
    redelivered: deliveredOf(m.reply) > 1,
    settled: () => settled,
    ack: once(async () => answer("+ACK")),
    retry: once(async ({ delayMs = 0 } = {}) => answer(`-NAK ${JSON.stringify({ delay: delayMs * NS })}`)),
    deadLetter: once(async ({ reason } = {}) => {
      const headers = { "Nats-Msg-Id": h["Nats-Msg-Id"] ?? `dead-${Date.now()}`, "Nats-Expected-Stream": TOPOLOGY.deadStream, "Correlation-Id": h["Correlation-Id"] ?? "", "Content-Type": h["Content-Type"] ?? "application/octet-stream", "Terminal-Reason": reason ?? "unknown", "Original-Subject": m.subject, ...(h["Causation-Id"] ? { "Causation-Id": h["Causation-Id"] } : {}) };
      const parked = await nc.request(TOPOLOGY.deadSubject, m.data, { headers, timeoutMs: 5000 });
      if (parked.status === 503 || json(parked).error) throw new Error("the dead-letter stream did not take the message");
      answer("+TERM");
    }),
  };
}

// A pull loop: one message at a time, each handled to the end before the next is asked for.
async function consumer(nc, onDelivery) {
  const t = TOPOLOGY;
  const st = { running: true, inFlight: Promise.resolve() };
  const pull = async () => {
    while (st.running) {
      const got = await new Promise((resolve) => {
        const inbox = `${nc.inbox}-pull-${(st.pulls = (st.pulls ?? 0) + 1)}`;
        let timer = null;
        const sid = nc.subscribe(inbox, (m) => {
          clearTimeout(timer);
          nc.unsubscribe(sid);
          resolve(m);
        });
        nc.publish(`$JS.API.CONSUMER.MSG.NEXT.${t.stream}.${t.consumer}`, Buffer.from(JSON.stringify({ batch: 1, expires: 5000 * NS })), { reply: inbox });
        timer = setTimeout(() => {
          nc.unsubscribe(sid);
          resolve(null);
        }, 6000);
      });
      if (!got || got.status) continue;
      st.inFlight = onDelivery(deliveryOf(nc, got));
      await st.inFlight;
    }
  };
  pull().catch(() => {});
  return {
    stop: async () => {
      st.running = false;
      await st.inFlight;
    },
  };
}

export async function open() {
  const nc = await connect({ host: env("NATS_HOST", "127.0.0.1"), port: Number(env("NATS_PORT", "4222")), user: process.env.NATS_USER, password: process.env.NATS_PASSWORD, name: "invoice-app" });
  await declared(nc);
  let closing = false;
  return {
    publish: publisher(nc),
    consume: (onDelivery) => consumer(nc, onDelivery),
    close: async () => {
      closing = true;
      nc.close();
    },
    ended: nc.ended.then((why) => (closing || why === null ? new Promise(() => {}) : why)),
  };
}
