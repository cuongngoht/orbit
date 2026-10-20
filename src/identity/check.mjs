// Is this session the user the case is about? Pure: claims in, problems out.
export function identityProblems(want, claims) {
  const has = (r) => (claims.roles ?? []).includes(r);
  const missing = (want.roles ?? []).filter((r) => !has(r));
  const forbidden = (want.notRoles ?? []).filter(has);
  const wrongUpn = Boolean(want.upn) && claims.upn?.toLowerCase() !== want.upn.toLowerCase();
  return describe(missing, forbidden, wrongUpn, claims, want);
}

function describe(missing, forbidden, wrongUpn, claims, want) {
  const out = [];
  if (missing.length) out.push(`missing role(s): ${missing.join(", ")}`);
  if (forbidden.length) out.push(`holds role(s) it must NOT: ${forbidden.join(", ")}`);
  if (wrongUpn) out.push(`signed in as ${claims.upn}, case requires ${want.upn}`);
  return out;
}
