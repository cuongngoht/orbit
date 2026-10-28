// Which steps cross a PROTECTED BOUNDARY -- asked of src/protected/ for EVERY step, never a list of gated kinds.
//
// Orbit is autonomous by default (0.2.0). Every action a step may take says what it IS -- its row's `semantic`
// (src/orchestration/dispatch.mjs): a task workspace write, a check, a capability call as its declaration describes it,
// a push of one commit -- and the leaf decides. AUTO runs. DENY is refused before anything is written
// (decision.mjs PROTECTED_DENIED). An approve-once is asked for with `request-approval` -- its type the protected kind,
// its params hashed into the fingerprint and never kept -- and runs only once a person granted exactly that fingerprint
// in Orbit Control, spent as the action starts (src/task/approvals.mjs). Nothing here can grant one, and no step kind
// is gated by name: a capability that changes state outside the workspace is autonomous unless what it DECLARES it does
// lands on a protected boundary.
import { authorize, needsApproval, requestOf } from "../protected/authorize.mjs";

// A WORD the task accepts as an environment: where the action lands.
export const word = (s) => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "-").replace(/^[^A-Za-z]+/, "").slice(0, 40) || "local";

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9.-]/g, "-").replace(/^[^a-z]+/, "").slice(0, 64) || "action";

// -> the leaf's verdict for one step: `{ decision: "auto" }` for nearly everything.
export const verdictOf = (row, a, lw) => authorize(row.semantic(a, lw));

const baseOf = (row, a, lw, v) => ({ tool: slug(row.tool(a, lw) ?? row.type(a, lw)), environment: word(row.where?.(a, lw) ?? v.environment) });

// -> what the step asks a person for (request-approval's fields, the boundary riding along), or null when the
// verdict needs no approval -- AUTO, or a DENY nobody may ask to cross.
export const gateOf = (row, a, lw, v = verdictOf(row, a, lw)) => (needsApproval(v) ? requestOf(v, baseOf(row, a, lw, v)) : null);
