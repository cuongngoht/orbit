// The Identity PORT: who the current browser session is signed in as, and how
// this machine maps a logical identity to a profile.
import { claimsScript } from "./claims-script.mjs";
import { IDENTITY_MAP, envKey, resolveIdentity, sessionFor } from "./mapping.mjs";
import { selectClaims } from "./select.mjs";
import { join } from "node:path";
import { runtimePath, sharedRuntimePath } from "../project/runtime.mjs";

export { identityProblems } from "./check.mjs";
export { selectClaims } from "./select.mjs";
export { IDENTITY_MAP, envKey, resolveIdentity, sessionFor };

// claims() answers {claims} or {problem}: WHICH token speaks for this app can
// fail, and it must fail with a sentence rather than by picking one.
export function createIdentity(browser, env = process.env, declared = {}, project = null) {
  const claims = () => selectClaims(claimsFrom(browser.ev(claimsScript(declared))), declared);
  const mapFile = project?.layout === 3 ? sharedRuntimePath(project, join(project.runtime, "identities.json")) : IDENTITY_MAP;
  return { claims, resolve: (as) => resolveIdentity(as, env, mapFile), sessionFor: (as) => checkedSession(project, sessionFor(as, env)), mapFile };
}

const checkedSession = (project, dir) => dir ? runtimePath(project, dir) : null;

function claimsFrom(raw) {
  if (typeof raw !== "string" || raw.startsWith("ERROR")) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
