// A case says WHICH KIND of user it needs ("admin"); a machine says which
// locally signed-in profile provides it. Those must not be the same string: a
// profile is per-machine by construction (signing in is a human act with MFA),
// and two people can both own a "staging" profile signed in as different
// accounts. So the binding lives outside the repo:
//
//   ~/.claude/playwright-profiles/identities.json   { "admin": "staging-admin" }
//   or, per run, ORBIT_IDENTITY_ADMIN=staging-admin
//
// and a running multi-identity case finds each identity's browser through
// ORBIT_SESSION_<AS>, which the unattended launcher exports.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fromEnv, sourceName } from "../project/env.mjs";

export const IDENTITY_MAP = join(homedir(), ".claude", "playwright-profiles", "identities.json");

export const envKey = (as) => String(as).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
export const sessionFor = (as, env = process.env) => fromEnv(env, `SESSION_${envKey(as)}`) || null;

export function resolveIdentity(as, env = process.env, mapFile = IDENTITY_MAP) {
  const suffix = `IDENTITY_${envKey(as)}`;
  const fromVar = fromEnv(env, suffix);
  if (fromVar) return { profile: fromVar, from: sourceName(env, suffix) };
  const mapped = readMap(mapFile)[as];
  return mapped ? { profile: mapped, from: mapFile } : { profile: null, from: null };
}

function readMap(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; }
}
