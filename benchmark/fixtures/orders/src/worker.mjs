// The payments consumer: an `order.paid` message writes that order's invoice -- once per message, however many times
// the message is delivered -- and the message is acknowledged only once the invoice is written.
import { getOrder } from "./orders.mjs";

const nextInvoice = (store) => `inv-${String(store.list("invoices").length + 1).padStart(4, "0")}`;

function invoiced(store, message, order) {
  const id = nextInvoice(store);
  store.put("invoices", id, { id, orderId: order.id, amountMinor: order.totalMinor, currency: order.currency, messageId: message.id });
  store.put("processed", message.id, { messageId: message.id, invoice: id });
  return { ack: true, invoice: id };
}

const paid = (store, message) => ((order) => (order ? invoiced(store, message, order) : { ack: false, error: "no such order" }))(getOrder(store, message.orderId));

export function consume(store, message) {
  if (message?.type !== "order.paid") return { ack: true, skipped: "not a payment" };
  if (store.get("processed", message.id)) return { ack: true, duplicate: true };
  return paid(store, message);
}
