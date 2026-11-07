// THE DROP BOX: the return box outside each library scans what is dropped into it and sends one message per item, which
// this consumer checks in -- the same check-in as at the desk, on the day the box scanned it. Every message is
// acknowledged once it is done with, and one delivered again is acknowledged and changes nothing.
//
//   consume(store, { id, tenant, copy, at }) -> { ack: true, outcome }
//   outcome: returned · not-on-loan · unknown-copy · duplicate · rejected (a message this consumer cannot read)
import { isDay } from "./dates.mjs";
import { get, isKey, put } from "./store.mjs";
import { isTenant, mine } from "./tenancy.mjs";
import { openLoanOfCopy, returned } from "./loans.mjs";

const wellFormed = (m) => Boolean(m) && isKey(m.id) && isTenant(m.tenant) && isKey(m.copy) && isDay(m.at);

const done = (store, m, outcome) => (put(store, "deliveries", { id: m.id, seq: 0, tenant: m.tenant, outcome }), { ack: true, outcome });

function checkedIn(store, m) {
  const copy = mine(store, m.tenant, "copies", m.copy);
  const loan = copy ? openLoanOfCopy(store, copy.tenant, copy) : null;
  if (!loan) return done(store, m, copy ? "not-on-loan" : "unknown-copy");
  returned(store, copy.tenant, loan, m.at);
  return done(store, m, "returned");
}

export function consume(store, message) {
  if (!wellFormed(message)) return { ack: true, outcome: "rejected" };
  if (get(store, "deliveries", message.id)) return { ack: true, outcome: "duplicate" };
  return checkedIn(store, message);
}
