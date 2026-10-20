// The REVISION RULE every person-edited document keeps: a write names the
// revision it was made against, and a stale one is refused -- a session must
// not overwrite a change somebody made a minute ago with a copy it read an
// hour ago.
//
// The rule was written out three times (autonomous QA settings, report
// settings, source bindings) and a fourth document -- a checkout's runtime
// settings -- needs it too. What the copies SHARE is here: the revision is a
// hash of the content with the fields that record the write itself taken out,
// and a stale write is a Refused carrying its own code, so a page can say
// "somebody changed these" rather than "wrong". What they do NOT share stays
// with each document: its defaults, its rules, who may write it.
//
// A LEAF over src/hash.mjs and src/errors.mjs, as src/freshness.mjs is: the
// documents that need it sit in different branches and may not import each
// other.
import { Refused } from "../errors.mjs";
import { canonicalJson, sha } from "../hash.mjs";

export const STALE_REVISION = "STALE_REVISION";

// The fields that describe a WRITE, never the document: taking them out is what
// makes the revision change exactly when the content does.
export const STAMPS = ["revision", "updatedAt", "updatedBy", "schema", "unreadable"];

export const contentOf = (doc, stamps = STAMPS) => Object.fromEntries(Object.entries(doc ?? {}).filter(([k]) => !stamps.includes(k)));

export const revisionFor = (content) => sha(canonicalJson(content)).slice(0, 16);

// `noun` is what the page calls the document: "report settings", "runtime
// settings". `now` is the revision that is there, `read` the one the writer had.
export const staleRefusal = (noun, now, read) => Object.assign(new Refused(`the ${noun} changed since they were read (revision ${now}, not ${read ?? "none"}); read them again and apply the change to what is there now`), { code: STALE_REVISION });

// Whether a write may go ahead over what is kept: nothing kept yet is always
// writable; otherwise the writer must have read exactly what is there.
export function checkRevision(kept, writer, noun) {
  if (kept.exists && writer.revision !== kept.revision) throw staleRefusal(noun, kept.revision, writer.revision);
}
