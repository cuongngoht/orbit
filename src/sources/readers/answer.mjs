// Holding what a reader answered to the contract, whichever kind of reader it was.
//
// A reader that answers wrongly is the READER failing -- a generated adapter with a
// bug, a mapping that drifted from a server's tool -- and that is BLOCKED, never a
// requirement fact and never a finding about the product: nothing about the work
// item was learned, so nothing about it may be recorded. The words of the finding
// come from an external system's answer, so they pass through `quote(scrub())`
// before anybody reads them.
import { Blocked } from "../../errors.mjs";
import { quote } from "../../quote.mjs";
import { scrub } from "../../scrub.mjs";
import { WORKITEM_REQUIRED } from "../fields.mjs";
import { coercedItem, workitemFindings } from "../model.mjs";

// `workitem.read` returns the item; the others return the part they are about, so
// only the first is held to the item's required fields.
export const REQUIRED_BY = { "workitem.read": WORKITEM_REQUIRED };

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// The reader knows WHICH item it asked about, so the answer need not say so: it
// supplies the provider and the ref when the answer has none, and refuses an answer
// that names a DIFFERENT item -- another item's text attached to this one is exactly
// how a requirement would come to say something nobody wrote about it.
function aboutAsked(item, identity, who) {
  if (isObject(item) && item.ref !== undefined && String(item.ref) !== String(identity.id)) throw new Blocked(quote(scrub(`${who} answered about item ${String(item.ref).slice(0, 40)}, and item ${identity.id} was asked for`), 300));
  return isObject(item) ? { ref: identity.id, provider: identity.provider, ...item } : item;
}

export function answered(raw, capability, who, identity) {
  const item = aboutAsked(coercedItem(raw), identity, who);
  const found = workitemFindings(item, capability, REQUIRED_BY[capability] ?? []);
  if (found.length) throw new Blocked(quote(scrub(`${who} answered ${capability} with something that is not a work item, which is the reader failing and not a requirement: ${found.slice(0, 5).join("; ")}`), 600));
  return item;
}
