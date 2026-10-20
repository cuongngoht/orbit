// Which Chromium-family browsers this machine actually has, and which profiles
// each one holds. Pure: the platform, the environment and "does this path
// exist" all arrive as arguments, so the table is tested on a machine with no
// browser installed at all.
//
// A profile's DIRECTORY and its DISPLAY NAME are different strings, and they
// drift apart the moment anyone renames a profile -- on a real machine the
// directory `Profile 1` shows as "Profile 2" and `Profile 2` as "qs sol".
// Neither may be guessed from the other, which is the whole reason a human
// picks from a list instead of typing a name.
import { join } from "node:path";

export const PREFIX = "ORBIT_BROWSER_";

// Where a Chromium-family browser keeps its user data, per platform, and the
// process name that means it is running. Firefox is deliberately absent:
// profiles.ini is a different shape and no case needs it today.
export const CHANNELS = [
  { channel: "chrome", name: "Google Chrome", under: { win32: "Google/Chrome/User Data", darwin: "Google/Chrome", linux: "google-chrome" }, proc: { win32: "chrome.exe", darwin: "Google Chrome", linux: "chrome" } },
  { channel: "msedge", name: "Microsoft Edge", under: { win32: "Microsoft/Edge/User Data", darwin: "Microsoft Edge", linux: "microsoft-edge" }, proc: { win32: "msedge.exe", darwin: "Microsoft Edge", linux: "msedge" } },
  { channel: "chromium", name: "Chromium", under: { win32: "Chromium/User Data", darwin: "Chromium", linux: "chromium" }, proc: { win32: "chrome.exe", darwin: "Chromium", linux: "chromium" } },
];

const BASE = { win32: { from: "LOCALAPPDATA", under: "" }, darwin: { from: "HOME", under: "Library/Application Support" }, linux: { from: "HOME", under: ".config" } };

export function dataDir(row, platform, env) {
  const base = BASE[platform];
  if (!base || !env[base.from]) return null;
  if (!row.under[platform]) return null;
  return join(env[base.from], base.under, row.under[platform]);
}

// Only the browsers whose user data is actually on this disk. A channel that is
// not installed must never be offered: picking it fails three steps later, in
// the launcher, where the message is about playwright rather than about Chrome.
export function installed(platform, env, exists) {
  const rows = CHANNELS.map((row) => ({ channel: row.channel, name: row.name, dataDir: dataDir(row, platform, env) }));
  return rows.filter((r) => r.dataDir && exists(r.dataDir));
}

export const processName = (channel, platform) => CHANNELS.find((r) => r.channel === channel)?.proc[platform] ?? null;

export const isRunning = (processList, name) => Boolean(name) && processList.toLowerCase().includes(name.toLowerCase());

// `Local State` lists every profile the browser knows, keyed by DIRECTORY, with
// the display name the human recognises. A file that cannot be parsed means "no
// profiles here", never a crash: a browser we cannot read is one we do not offer.
export function profilesIn(localStateText, emailOf = () => "") {
  const cache = parsed(localStateText)?.profile?.info_cache ?? {};
  return Object.entries(cache).map(([dir, v]) => ({ dir, name: v.name || dir, email: v.user_name || emailOf(dir) }));
}

function parsed(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// `user_name` is empty for a profile signed in through a work identity
// provider; there the account shows up only in that profile's own Preferences,
// so the picker can still print something the human recognises.
export function emailIn(prefsText) {
  const account = parsed(prefsText)?.account_info?.find((a) => a.email);
  return account?.email ?? "";
}
