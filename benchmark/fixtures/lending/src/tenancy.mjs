// A LIBRARY SYSTEM's own records. One service holds every system's, and each system sees, lists and changes only its
// own: a record of another system reads exactly as one that does not exist.
import { get, list } from "./store.mjs";

const TENANT = /^[a-z][a-z0-9-]{0,31}$/;

// What a library system's name may be, as the gateway in front of the service hands it.
export const isTenant = (v) => typeof v === "string" && TENANT.test(v);

const ownedBy = (tenant) => (r) => (r && r.tenant === tenant ? r : null);

export const mine = (store, tenant, kind, id) => ownedBy(tenant)(get(store, kind, id));

export const allMine = (store, tenant, kind) => list(store, kind).filter((r) => r.tenant === tenant);
