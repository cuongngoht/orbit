// Claude Code's STATUS LINE, as a host adapter for Orbit Live (cli/live.mjs statusline, cli/host.mjs --kind=statusline).
// Everything here is Claude Code knowledge, so it lives with the other Claude adapters and never in src/:
//
//   sessionOf(json, env) -> { sessionId, cwd, columns, mark } | null    the session JSON Claude hands a status line
//   room(columns) -> columns Orbit may use: the row is shared with the host's own notifications
//   enabled(env, io, base) -> the host's `live` switch (src/host/config.mjs), ORBIT_LIVE first
//   target(env, home) / entryOf(shim) / shimSource / installShim(io, rooms) / keep...  what setup writes, and where
//   doctor({ env, io, base, home, platform }) -> [{ name, says }]   why the row would be blank, read-only
//
// Only `session_id` (hashed at once into the mark a task of this session carries), the working directory and the
// terminal width are read from the session JSON. Nothing of it is stored: not the transcript path, not the model,
// not the cost.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha } from "../../../src/hash.mjs";
import { effectiveSettings } from "../../../src/host/config.mjs";
import { hostStore } from "../../../src/host/store.mjs";
import { hostSession, taskSessionMark } from "../../../src/memory/session.mjs";
import { Refused } from "../../../src/errors.mjs";
import { writeAtomic } from "../../../src/store/atomic.mjs";
import { stateRooms } from "../../../src/store/control.mjs";

export const name = "claude";

// Room the host keeps for itself on the status row (notifications, the padding it adds).
export const RESERVED = 16;
export const REFRESH_SECONDS = 1;

const str = (v) => (typeof v === "string" && v.length > 0 ? v : null);

export function sessionOf(json, env = {}) {
  if (!json || typeof json !== "object") return null;
  const sessionId = str(json.session_id);
  return { sessionId, cwd: str(json.workspace?.current_dir) ?? str(json.cwd), columns: Number(env.COLUMNS) || null, mark: taskSessionMark(hostSession(name, sessionId)) };
}

export const room = (columns) => Math.max(20, (columns ?? 100) - RESERVED);

export const enabled = (env, io, base) => effectiveSettings(env, hostStore(stateRooms(base), io, name).read().settings ?? {}).live !== false;

// ---- setup: one owned key in the user's settings, and a shim Orbit keeps ----------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
export const shimSource = join(HERE, "claude-statusline-shim.mjs");
export const shimPath = (rooms) => join(rooms.hosts, name, "statusline.mjs");
export const keepPath = (rooms) => join(rooms.hosts, name, "keep.json");

// The user's own settings (user scope only: a project's .claude/ is inside a repository Orbit does not write).
export const target = (env = process.env, home = homedir()) => join(str(env.CLAUDE_CONFIG_DIR) ?? join(home, ".claude"), "settings.json");

const slashed = (path) => path.replace(/\\/g, "/");

export const entryOf = (shim) => ({ type: "command", command: `node "${slashed(shim)}"`, refreshInterval: REFRESH_SECONDS });

export const OWNED_KEY = "statusLine";

// What Orbit Live's docked pane (hooks/live-pane.tsx) says of where Claude Code seated it (1.8.5) -- the host's facts, so
// they are said here and never in the engine: a pane docks beside the transcript only in Claude Code's fullscreen
// layout, from 110 columns; on the main screen it sits above the prompt.
export const PANE_HINTS = Object.freeze({
  inline: "docks on the right in Claude Code's fullscreen layout (CLAUDE_CODE_NO_FLICKER=1, from 110 columns); here it sits above the prompt",
});

export const owns = (value, rooms) => Boolean(value && typeof value === "object" && String(value.command ?? "").includes(slashed(shimPath(rooms))));

// The shim, copied byte for byte; its hash is how `doctor` tells an old copy from the one this plugin ships.
export function installShim(io, rooms) {
  const text = readFileSync(shimSource, "utf8");
  io.ensureDir(dirname(shimPath(rooms)));
  writeAtomic(shimPath(rooms), text, io, false);
  return sha(text);
}

// Keeping a person's own status line: their command, exactly as it was, run first by the shim -- never on Windows,
// where the host may run a status line through one shell or another and Orbit cannot know which.
export function keptCommand(previous, platform = process.platform) {
  if (platform === "win32") throw new Refused("--keep-existing is not offered on Windows: replace the status line (--replace), or add the shim's command to your own script");
  if (!previous || typeof previous.command !== "string") throw new Refused("there is no status line command to keep");
  return previous.command;
}

// ---- doctor: why the row would be blank -----------------------------------------------------------

const MANAGED = { darwin: "/Library/Application Support/ClaudeCode/managed-settings.json", linux: "/etc/claude-code/managed-settings.json", win32: "C:/Program Files/ClaudeCode/managed-settings.json" };

const json = (file) => {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null; }
  catch { return { unreadable: true }; }
};

const POLICY = [
  { when: (m) => m?.disableAllHooks === true, says: "managed settings disable hooks and every custom status line" },
  { when: (m) => m?.allowManagedHooksOnly === true, says: "managed settings allow only their own hooks and status line: Orbit's row will not show" },
  { when: (m) => Boolean(m?.statusLine), says: "managed settings set a status line of their own, which wins" },
  { when: () => true, says: "no managed setting found that silences it" },
];

const userPolicy = (s) => (s?.disableAllHooks === true ? "your settings set disableAllHooks: no custom status line runs" : null);

const ownedWords = (s, rooms) => (owns(s?.statusLine, rooms) ? `Orbit's (refresh ${s.statusLine.refreshInterval ?? "-"}s)` : s?.statusLine ? "another command -- Orbit's is not installed" : "none set");

const shimWords = (io, rooms) => (!existsSync(shimPath(rooms)) ? "not installed" : sha(readFileSync(shimPath(rooms), "utf8")) === sha(readFileSync(shimSource, "utf8")) ? "current" : "an older copy: apply again to update it");

const rootWords = (status) => (!status.root ? "no session has started since Orbit Live was installed" : existsSync(join(status.root, "cli", "live.mjs")) ? `the engine at ${status.root}` : `${status.root} holds no engine any more: start a session to refresh it`);

export function doctor({ env, io, base, home = homedir(), platform = process.platform }) {
  const rooms = stateRooms(base);
  const settings = json(target(env, home));
  const store = hostStore(rooms, io, name);
  return [
    { name: "statusLine", says: `${target(env, home)}: ${ownedWords(settings, rooms)}` },
    { name: "shim", says: shimWords(io, rooms) },
    { name: "engine", says: rootWords(store.status()) },
    { name: "live", says: enabled(env, io, base) ? "on for Claude Code" : "switched off (host setting `live`, or ORBIT_LIVE)" },
    { name: "policy", says: userPolicy(settings) ?? POLICY.find((r) => r.when(json(MANAGED[platform] ?? ""))).says },
    { name: "trust", says: "a status line stays blank in a folder whose workspace trust was not accepted" },
  ];
}
