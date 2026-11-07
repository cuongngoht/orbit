// THE CATALOGUE: the titles a library system lends and the copies it holds of each. A title's format says how long a
// copy may stay out -- three weeks for a book, one week for a DVD -- and a copy is on the shelf, on loan, or held for a
// member who is coming to collect it.
import { created, put } from "./store.mjs";
import { mine } from "./tenancy.mjs";

export const LOAN_DAYS = { book: 21, dvd: 7 };

export const isFormat = (v) => typeof v === "string" && Object.hasOwn(LOAN_DAYS, v);

export const newTitle = (store, tenant, b) => created(store, "titles", "title", { tenant, name: b.name, format: b.format });

export const newCopy = (store, tenant, title, b) => created(store, "copies", "copy", { tenant, title: title.id, replacementCents: b.replacementCents, status: "shelf" });

// The title a copy is of: always one of the copy's own library system.
export const titleOfCopy = (store, copy) => mine(store, copy.tenant, "titles", copy.title);

export const loanDaysOf = (title) => LOAN_DAYS[title.format];

export const shelved = (store, copy) => put(store, "copies", { ...copy, status: "shelf" });

export const titleView = (t) => ({ id: t.id, name: t.name, format: t.format, loanDays: loanDaysOf(t) });

export const copyView = (c) => ({ id: c.id, title: c.title, replacementCents: c.replacementCents, status: c.status });
