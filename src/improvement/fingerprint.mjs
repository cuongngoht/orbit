// An opportunity's IDENTITY is what it is about -- the subject, the exact version, the signal and the steps it showed
// on -- never the wording of anything: the same problem seen again is the same opportunity, updated in place, and a
// different version's problem is a different one.
import { canonicalJson, sha } from "../hash.mjs";

export const fingerprintOf = (g) => sha(canonicalJson({ subject: `${g.subject.kind}:${g.subject.id}`, pin: g.pin, signal: g.signal, signature: [...(g.signature ?? [])].sort() }));

export const opportunityIdOf = (fingerprint) => `opp-${fingerprint.slice(0, 16)}`;
