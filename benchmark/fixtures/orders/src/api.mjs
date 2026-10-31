// The HTTP-shaped API: a pure function of a store and a request -- { method, path, body } -> { status, body }.
import { formatted } from "./money.mjs";
import { cancelOrder, createOrder, getOrder, invalidOf, shipOrder } from "./orders.mjs";

const viewOf = (order) => ({ ...order, total: formatted(order.totalMinor, order.currency) });

const ANSWERS = [
  { when: (r) => !r || r.error === "NOT_FOUND", answer: () => ({ status: 404, body: { error: "no such order" } }) },
  { when: (r) => r.error === "CONFLICT", answer: (r) => ({ status: 409, body: { error: `the order is ${r.state}` } }) },
  { when: () => true, answer: (r, ok) => ({ status: ok, body: viewOf(r) }) },
];

const answered = (r, ok = 200) => ANSWERS.find((a) => a.when(r)).answer(r, ok);

const created = (store, body) => ((why) => (why ? { status: 400, body: { error: `invalid ${why}` } } : answered(createOrder(store, body), 201)))(invalidOf(body));

const ORDER = "(ord-\\d{4})";

export const ROUTES = [
  { method: "POST", path: new RegExp("^/orders$"), run: (store, m, body) => created(store, body ?? {}) },
  { method: "GET", path: new RegExp(`^/orders/${ORDER}$`), run: (store, m) => answered(getOrder(store, m[1])) },
  { method: "POST", path: new RegExp(`^/orders/${ORDER}/ship$`), run: (store, m) => answered(shipOrder(store, m[1])) },
  { method: "POST", path: new RegExp(`^/orders/${ORDER}/cancel$`), run: (store, m) => answered(cancelOrder(store, m[1])) },
];

export function handle(store, request) {
  const route = ROUTES.find((r) => r.method === request?.method && r.path.test(String(request?.path ?? "")));
  return route ? route.run(store, route.path.exec(request.path), request.body) : { status: 404, body: { error: "no such route" } };
}
