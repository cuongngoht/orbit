// LOANS: a copy lent to a member until its due date, renewed, and brought back -- at the desk, or through the drop box
// (dropbox.mjs). A late return is fined and the fine charged to the member; the copy then goes to whoever is waiting
// for its title, or back on the shelf.
import { addDays } from "./dates.mjs";
import { created, put } from "./store.mjs";
import { allMine, mine } from "./tenancy.mjs";
import { loanDaysOf, titleOfCopy } from "./catalog.mjs";
import { charged, LOAN_LIMIT } from "./members.mjs";
import { fineFor } from "./fines.mjs";
import { collectedBy, heldForAnother, holdWaiting, servedOrShelved } from "./holds.mjs";

export const RENEWALS = 2;

const openLoansOf = (store, tenant, member) => allMine(store, tenant, "loans").filter((l) => l.member === member.id && !l.returned);

// Why a copy may not be lent to a member now, asked in order; none, and it may.
const LEND_REFUSALS = [
  { error: "not-available", when: (c) => c.copy.status === "loan" },
  { error: "held-for-another", when: (c) => heldForAnother(c.store, c.copy, c.member) },
  { error: "limit", when: (c) => openLoansOf(c.store, c.tenant, c.member).length >= LOAN_LIMIT },
];

export const lendRefusal = (store, tenant, copy, member) => LEND_REFUSALS.find((r) => r.when({ store, tenant, copy, member }))?.error ?? null;

const dueOf = (store, copy, day) => addDays(day, loanDaysOf(titleOfCopy(store, copy)));

export function lent(store, tenant, copy, member, day) {
  collectedBy(store, copy, member);
  put(store, "copies", { ...copy, status: "loan" });
  return created(store, "loans", "loan", { tenant, copy: copy.id, member: member.id, out: day, due: dueOf(store, copy, day), renewals: 0, returned: null, fineCents: 0 });
}

// A loan brought back on a day: fined for the days it is late and the fine charged to its member, and its copy set
// aside for the member who has waited longest for the title -- or shelved.
export function returned(store, tenant, loan, day) {
  const copy = mine(store, tenant, "copies", loan.copy);
  const fineCents = fineFor(titleOfCopy(store, copy), copy, loan.due, day);
  charged(store, mine(store, tenant, "members", loan.member), fineCents);
  servedOrShelved(store, copy, day);
  return put(store, "loans", { ...loan, returned: day, fineCents });
}

export const openLoanOfCopy = (store, tenant, copy) => allMine(store, tenant, "loans").find((l) => l.copy === copy.id && !l.returned) ?? null;

// Why a loan may not be renewed on a day, asked in order; none, and it may.
const RENEW_REFUSALS = [
  { error: "returned", when: (r) => r.loan.returned !== null },
  { error: "overdue", when: (r) => r.day > r.loan.due },
  { error: "renewal-limit", when: (r) => r.loan.renewals >= RENEWALS },
  { error: "hold-waiting", when: (r) => holdWaiting(r.store, r.copy) },
];

const copyOfLoan = (store, tenant, loan) => mine(store, tenant, "copies", loan.copy);

export const renewRefusal = (store, tenant, loan, day) => RENEW_REFUSALS.find((r) => r.when({ store, loan, day, copy: copyOfLoan(store, tenant, loan) }))?.error ?? null;

// A renewal moves the due date on by the title's loan period, counted from the due date it had.
export const renewed = (store, tenant, loan) => put(store, "loans", { ...loan, due: addDays(loan.due, loanDaysOf(titleOfCopy(store, copyOfLoan(store, tenant, loan)))), renewals: loan.renewals + 1 });

export const loanView = (l) => ({ id: l.id, copy: l.copy, member: l.member, out: l.out, due: l.due, renewals: l.renewals, returned: l.returned, fineCents: l.fineCents });
