// An order as HTML: every value a customer typed is escaped before it is drawn.
import { formatted } from "./money.mjs";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escaped = (text) => String(text ?? "").replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

const noteOf = (order) => (order.note ? [`  <p class="note">${escaped(order.note)}</p>`] : []);

export const renderOrder = (order) => [`<article class="order" id="${escaped(order.id)}">`, `  <h2>${escaped(order.customer)}</h2>`, `  <p class="total">${escaped(formatted(order.totalMinor, order.currency))}</p>`, `  <p class="state">${escaped(order.state)}</p>`, ...noteOf(order), "</article>"].join("\n");
