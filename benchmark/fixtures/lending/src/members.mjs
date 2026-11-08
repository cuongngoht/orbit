// MEMBERS of a library system: who may borrow, and what they owe -- the fines their late returns were charged, added up.
// A member may have five items out at once.
import { created, put } from "./store.mjs";

export const LOAN_LIMIT = 5;

export const newMember = (store, tenant, b) => created(store, "members", "member", { tenant, name: b.name, balanceCents: 0 });

export const charged = (store, member, cents) => put(store, "members", { ...member, balanceCents: member.balanceCents + cents });

export const memberView = (m) => ({ id: m.id, name: m.name, balanceCents: m.balanceCents });
