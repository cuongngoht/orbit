import { JOURNAL_VERSION } from "../memory/journal.mjs";
// Journal-version dispatch is explicit. A newer writer never looks like an
// empty history.
import { Refused } from '../errors.mjs';
import { reconcile } from './reconcile.mjs';
export function replayed(lines) {
  return [...lines].sort(order).reduce(applied, new Map());
}
const order = (a, b) => a.sequence - b.sequence;
function applied(claims, line) {
  if (line.v !== JOURNAL_VERSION) throw new Refused('unsupported knowledge journal version');
  const result = reconcile({ ...line.candidate, seenBy: line.seenBy }, claims.get(line.claimId) ?? null, { human: line.human, evidence: line.evidence });
  if (result.claim) claims.set(line.claimId, { ...result.claim, id: line.claimId });
  return claims;
}
