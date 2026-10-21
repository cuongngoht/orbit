// Everything a TABLE already declares, enforced over the whole document.
//
// Type, enum, pattern, minimum, maximum and required live in qa/fields.mjs and
// are enforced by src/constraints.mjs -- exactly as a case's are. This family
// only WALKS: it finds every record the definitions reach and holds each one to
// its own table, so a new nested block needs no rule written for it. The walk
// itself is src/walk.mjs, the one a QA sidecar and an adapter declaration are
// held by too, so the three cannot disagree about what an unknown field is.
import { DEFINITIONS, PLAN_FIELDS, PLAN_REQUIRED } from "../fields.mjs";
import { ERROR, fromStrings } from "../finding.mjs";
import { walkFindings } from "../../walk.mjs";

// What the LOADER adds, never the author: where it was found, why it would not
// parse, and whether it came from the machine store's drafts room.
const OWN = new Set(["_file", "_broken", "_draft"]);

export const declaredFindings = (p) => fromStrings(ERROR, idOf(p), walkFindings(DEFINITIONS, PLAN_FIELDS, PLAN_REQUIRED, p, idOf(p), OWN));

const idOf = (p) => (typeof p?.id === "string" ? p.id : "plan");
