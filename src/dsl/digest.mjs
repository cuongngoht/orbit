// A case's identity as EVIDENCE: the sha of the case as written.
//
// A PASS is a statement about three things at once -- the case that ran, the
// build it ran against, the environment it ran in -- and the ledger kept only
// the last two. So a case edited after its PASS (a step removed, an expect
// loosened, a query pointed at another table) inherited the old verdict, and
// coverage called it verified. The digest is what lets freshness ask the third
// question (src/qa/states.mjs): is the case in hand the case that passed?
//
// "As written" is every key the loader did not add. The loader's own fields
// are `_`-prefixed (`_file`, a parse error), and they say where a case was
// found, not what it asks -- a case moved to another folder is the same case.
import { sha } from "../hash.mjs";

export const asWritten = (c) => Object.fromEntries(Object.entries(c ?? {}).filter(([k]) => !k.startsWith("_")));

export const caseDigest = (c) => sha(JSON.stringify(asWritten(c)));
