// The identity gate: is this browser signed in as the user the case is about?
//
// For anything about permissions it is the only gate that matters. A scoping
// case run as a full admin PASSES and means nothing -- a true observation of
// the wrong person. The check is on the TOKEN's claims, which come from the
// identity provider and read the same on every machine: not the profile name
// (local), not the persona chip (rendered from memory). Claims go in the log;
// the token never.
import { identityProblems } from "../identity/index.mjs";
import { varName } from "../project/env.mjs";
import { Refused } from "./errors.mjs";

export function enterIdentity(ctx, run, want, atStep = null) {
  pointAt(ctx, run, want);
  const claims = readClaims(ctx, run, want);
  const problems = identityProblems(want, claims);
  if (problems.length) throw new Refused(mismatch(ctx, run, want, claims, problems, atStep));
  return record(ctx, run, want, claims, atStep);
}

// The token to read the claims of is a CHOICE, and one that can fail: several
// tokens and nothing declaring which speaks for this app is a refusal, not a
// pick. See identity/select.mjs.
function readClaims(ctx, run, want) {
  const got = ctx.identity.claims();
  if (got.problem) throw new Refused(`${run.c.id} needs identity "${want.as}", and in ${ctx.browser.dir()}: ${got.problem}`);
  return got.claims;
}

// Each identity a case names is a separate signed-in browser in its own run
// directory; the unattended launcher exports them as ORBIT_SESSION_<AS>.
// With a single identity the ordinary run directory is it.
function pointAt(ctx, run, want) {
  const dir = ctx.identity.sessionFor(want.as);
  if (dir) return ctx.browser.use(dir, want.as);
  if (run.c.identities) throw new Refused(`${run.c.id} switches to identity "${want.as}" but no browser was opened for it.\n  Run it through run-awake, which opens one per identity, or export ${varName(`SESSION_${want.as.toUpperCase()}`)}=<run dir>.`);
  return ctx.browser.dir();
}

function mismatch(ctx, run, want, claims, problems, atStep) {
  const where = `${run.c.id}${atStep ? ` step ${atStep}` : ""} must run as "${want.as}" and that session is not it:`;
  const facts = `  session profile: ${ctx.browser.profile() ?? "?"}   roles: ${(claims.roles ?? []).join(", ") || "(none)"}`;
  return [where, ...problems.map((p) => `  ${p}`), facts, mappingHint(ctx, want)].join("\n");
}

function mappingHint(ctx, want) {
  const local = ctx.identity.resolve(want.as);
  if (local.profile) return `  this machine maps "${want.as}" -> profile "${local.profile}" (${local.from})`;
  return `  this machine has no profile for "${want.as}". Sign one in once, then map it:\n    echo '{"${want.as}": "<profile-name>"}' > ${ctx.identity.mapFile}   (or export ${varName(`IDENTITY_${want.as.toUpperCase()}`)}=<profile-name>)`;
}

function record(ctx, run, want, claims, atStep) {
  const rec = { kind: "identity", as: want.as, atStep, profile: ctx.browser.profile(), tid: claims.tid, oid: claims.oid, roles: claims.roles, upn: claims.upn, runDir: ctx.browser.dir() };
  run.log.record(rec);
  run.identities.push(rec);
  run.print.say(`identity: ${want.as} — ${claims.upn ?? claims.name ?? "?"} · roles [${(claims.roles ?? []).join(", ")}] · profile ${ctx.browser.profile() ?? "?"}`);
  return rec;
}
