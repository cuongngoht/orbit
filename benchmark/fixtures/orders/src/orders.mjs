// Orders: created open with their total computed once, shipped once, and cancelled only while they are still open.
import { CURRENCIES, orderTotal } from "./money.mjs";

const nextId = (store) => `ord-${String(store.list("orders").length + 1).padStart(4, "0")}`;

const validLine = (l) => Number.isInteger(l?.qty) && l.qty > 0 && Number.isInteger(l?.unitMinor) && l.unitMinor >= 0;

const validPercent = (p) => Number.isInteger(p) && p >= 0 && p <= 100;

// Why an order cannot be made of what was sent, or null.
export const invalidOf = (input) => (!Array.isArray(input?.lines) || !input.lines.length || !input.lines.every(validLine) ? "lines" : !validPercent(input.percent ?? 0) ? "percent" : !Object.hasOwn(CURRENCIES, input.currency ?? "USD") ? "currency" : null);

export function createOrder(store, input) {
  const order = { id: nextId(store), customer: String(input.customer ?? ""), lines: input.lines, percent: input.percent ?? 0, currency: input.currency ?? "USD", note: String(input.note ?? ""), state: "open" };
  return store.put("orders", order.id, { ...order, totalMinor: orderTotal(order.lines, order.percent) });
}

export const getOrder = (store, id) => store.get("orders", id);

function moved(store, id, from, to) {
  const order = getOrder(store, id);
  if (!order) return { error: "NOT_FOUND" };
  return order.state === from ? store.put("orders", id, { ...order, state: to }) : { error: "CONFLICT", state: order.state };
}

export const shipOrder = (store, id) => moved(store, id, "open", "shipped");

export const cancelOrder = (store, id) => moved(store, id, "open", "cancelled");
