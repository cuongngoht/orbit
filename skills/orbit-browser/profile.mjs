// What a signed-in browser profile must carry into a test copy, where that copy
// lives, and how the launcher's own flags are read. Pure, so the two details
// that decide whether the copy opens signed IN are held by a test rather than
// discovered on a Tuesday against a real product.
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PREFIX } from "./browsers.mjs";
import { profileName, runtimePath } from "../../src/project/runtime.mjs";

const ENGINE = "ORBIT_";

// Beside identities.json, which the engine already keeps here: outside every
// repository, because this directory holds cookies.
export const PROFILE_HOME = join(homedir(), ".claude", "playwright-profiles");

// Everything that carries a signed-in session and nothing that does not:
// Cache/, Code Cache/ and Service Worker/ are gigabytes of nothing. Cookies has
// lived inside Network/ since Chromium 96, so the directory is copied, not a
// file called Cookies that is no longer there.
export const COPY_ITEMS = ["Network", "Local Storage", "Session Storage", "IndexedDB", "Login Data", "Preferences", "Secure Preferences", "Web Data"];

// The two details that decide everything:
//   1. the chosen profile becomes `Default` -- a persistent context opens the
//      Default profile of its user data directory, so a copy that keeps the
//      name `Profile 2` opens a window nobody has ever signed into;
//   2. `Local State` comes along, from the PARENT directory -- on Windows the
//      key that decrypts the cookies lives in it, so a copy without it holds
//      every cookie and can read none of them.
export function copyPlan(dataDir, profileDir, target) {
  const items = COPY_ITEMS.map((item) => ({ from: join(dataDir, profileDir, item), to: join(target, "Default", item) }));
  return [...items, { from: join(dataDir, "Local State"), to: join(target, "Local State") }];
}

export const profilePath = (name, project = null) => runtimePath(project, join(profileHome(project), profileName(name)));

export const profileHome = (project) => (project?.layout === 3 || project?.isolated) ? runtimePath(project, join(project.sessionDir, "profiles")) : PROFILE_HOME;

export const choiceFile = (uiTests, project = null) => (project?.layout === 3 || project?.isolated) ? runtimePath(project, join(project.sessionDir, "browser.json")) : join(uiTests, ".local", "browser.json");

const FLAGS = { "--channel": "channel", "--env": "env", "--profile": "profile", "--run-dir": "runDir", "--url": "url" };

// The engine spawns the launcher with exactly this shape (src/awake/launcher.mjs).
// Reading it back here, rather than assuming it, is what a test can pin so the
// two halves cannot drift apart silently.
export function parseFlags(argv) {
  const named = argv.reduce((o, a, i) => (FLAGS[a] ? { ...o, [FLAGS[a]]: argv[i + 1] } : o), {});
  return { ...named, mode: argv.includes("--headed") ? "headed" : "headless", ...(argv.includes("--blank") ? { blank: true } : {}) };
}

export const runDirFor = (flags, env, project = null) => runtimePath(project, flags.runDir || env[ENGINE + "RUN_DIR"] || project?.config?.runDir || join(tmpdir(), `pw-${flags.profile || "default"}`));

// The url is a per-project VALUE, never a word in this repository: one variable
// per deployment name, with the engine's own origin as the fallback so a
// single-environment project sets nothing extra.
export const targetUrl = (env, name) => env[`${PREFIX}URL_${envKey(name)}`] || env[ENGINE + "ORIGIN"] || null;

const envKey = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "_");

// What playwright-cli reads from the run directory (.playwright/cli.config.json),
// and what the engine reads back out of it to report which profile a session is
// driving (src/browser/state.mjs anchors on browser.userDataDir).
export const cliConfig = (channel, userDataDir, mode) => ({ browser: { browserName: "chromium", userDataDir, launchOptions: { channel, headless: mode !== "headed" } } });

export const choiceOf = (channel, as, source, when) => ({ channel, profile: as, source, copiedAt: new Date(when).toISOString() });
