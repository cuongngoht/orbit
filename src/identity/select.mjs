// WHICH token speaks for this app is the project's fact, not something to guess.
//
// A profile holds several tokens for the same person: the app's own id token
// carries the roles, a token for some other API carries none. The old rule was
// "most roles wins" -- a heuristic wearing the clothes of an answer. It picks
// confidently every time, including when it is wrong, and what it decides is
// whose authority a permission case believes it observed.
//
// So a project declares what its tokens look like (project.json `identity`:
// audience, issuer, and the claim names its provider uses). Where nothing is
// declared the engine uses the only token there is, and REFUSES when there are
// several -- naming them, so the fix is one line of project.json. No identity
// provider is named in this file: a project supplies its own words.
export function selectClaims(candidates, declared = {}, nowSec = Math.floor(Date.now() / 1000)) {
  if (!Array.isArray(candidates)) return { problem: "no id token could be read from that session — is it signed in to the app itself, and not only to the identity provider?" };
  const live = candidates.filter((c) => !expired(c, nowSec));
  return pick(live.filter((c) => matches(c, declared)), declared, candidates.length, live.length);
}

// A token past its `exp` is not who the session is now, whatever it claims.
const expired = (c, nowSec) => Boolean(c.exp) && c.exp <= nowSec;

const matches = (c, d) => audienceOk(c.aud, d.audience) && (!d.issuer || c.iss === d.issuer);

// `aud` may be a list; a declared audience has to be one of them.
const audienceOk = (aud, want) => !want || (aud ?? []).includes(want);

function pick(hits, declared, found, live) {
  if (hits.length === 1) return { claims: hits[0] };
  if (hits.length) return { problem: several(hits, declared) };
  return { problem: none(declared, found, live) };
}

function several(hits, declared) {
  const auds = hits.map((c) => (c.aud ?? []).join("/") || "(no audience)").join(", ");
  if (declared.audience) return `${hits.length} tokens match audience ${declared.audience} (${auds}) — narrow it with identity.issuer in ui-tests/project.json`;
  return `${hits.length} id tokens are in that session (audiences: ${auds}) and nothing says which one speaks for this app — declare identity.audience in ui-tests/project.json`;
}

function none(declared, found, live) {
  if (!found) return "no id token could be read from that session — is it signed in to the app itself, and not only to the identity provider?";
  if (!live) return `all ${found} id token(s) in that session have expired — sign in again`;
  return `none of the ${live} id token(s) in that session matches ${wanted(declared)}`;
}

const wanted = (d) => [d.audience && `audience ${d.audience}`, d.issuer && `issuer ${d.issuer}`].filter(Boolean).join(" and ");
