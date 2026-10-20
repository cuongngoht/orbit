// Switch which signed-in browser the remaining steps drive. No credential
// moves and nothing is re-authenticated: a human opened that session once.
import { Refused } from "../errors.mjs";
import { enterIdentity } from "../identity.mjs";

export default {
  name: "as",
  label: (s) => s.identity,
  act: (ctx, run, s) => enterIdentity(ctx, run, wanted(run, s), s.i).as,
  tail: (s, r) => `now driving ${r.result}`,
};

// An identity the case never declared states nothing verifiable, and
// identityProblems returns [] for a want with no roles, notRoles or upn -- so
// the switch "succeeded" while proving nothing about who was driving.
function wanted(run, s) {
  const declared = run.c.identities?.[s.identity];
  if (!declared) throw new Refused(`step ${s.i} (as): "${s.identity}" is not one of the identities this case declares`);
  return { as: s.identity, ...declared };
}
