// A spawned test inherits this machine's HOME, and four modules read it:
// ~/.orbit/sql.env, ~/.claude/playwright-profiles. So a developer who had
// configured the SQL tool ran a DIFFERENT suite from CI's -- and that one
// reached a real database, on a suite whose contract is "no network". CI
// stayed green because CI has no home directory to read.
//
// A child gets this home instead: a real directory, empty, empty everywhere.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const EMPTY_HOME = mkdtempSync(join(tmpdir(), "orbit-home-"));

// The temp directory is sealed the same way: a legacy project keeps its working
// set (src/engineering/working-set/) under os.tmpdir(), and two test files
// sharing the machine's would see each other's sessions.
export const EMPTY_TMP = mkdtempSync(join(tmpdir(), "orbit-tmp-"));

// A plugin setting reaches a hook as CLAUDE_PLUGIN_OPTION_*, and a suite run
// from inside a hooked session must not inherit somebody's toggles either --
// nor, run by Grok Build's agent, its session (GROK_SESSION_ID binds a Orbit
// command to Grok since 1.8.9).
const withoutInheritedOrbit = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("ORBIT_") && !k.startsWith("CLAUDE_PLUGIN_OPTION_") && !k.startsWith("GROK_")));

// USERPROFILE is what os.homedir() reads on Windows, HOME everywhere else. An
// exported ORBIT_* a shell would smuggle in goes too: a test says what it
// configures, in `extra`, or it is not configured.
export const sealed = (extra = {}) => ({ ...withoutInheritedOrbit(process.env), HOME: EMPTY_HOME, USERPROFILE: EMPTY_HOME, TMPDIR: EMPTY_TMP, TMP: EMPTY_TMP, TEMP: EMPTY_TMP, ...extra });
