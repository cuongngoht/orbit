// Where Claude Code keeps its own memory for this project -- DISCOVERED, never
// computed.
//
// The host resolves that directory itself and stamps the path into the session's
// system prompt; it exposes no API, no environment variable and no command that
// would tell a child process where it landed. What a hook DOES get is
// `transcript_path`, and the transcript sits inside the same project directory,
// so the directory is a walk-up away.
//
// It must be a walk-up and not a dirname(): a subagent's transcript lives two
// levels deeper, in <project>/<sessionId>/subagents/agent-*.jsonl, and dirname()
// would hand back a directory that is not the project's.
//
// We do NOT reimplement the host's own encoding of <project>. It maps every
// non-alphanumeric character to a dash and truncates with a hash, it is lossy,
// it is not a published contract, and a plugin that reproduced it would be wrong
// the first time it changed. Discovered and validated, or not used at all.
//
// A settings-level `autoMemoryDirectory` beats the walk-up outright, because in
// that case the memory moved and the transcript did not -- the walk-up is then
// not stale, it is wrong.
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const PROJECTS_DIR = "projects";
export const MEMORY_DIR = "memory";
export const MAX_CLIMB = 8;
export const REFRESH_MS = 12 * 60 * 60 * 1000;

export function projectDirOf(transcriptPath) {
  if (!transcriptPath) return null;
  const climb = ancestors(dirname(resolve(transcriptPath)), MAX_CLIMB);
  return climb.find((d) => basename(dirname(d)) === PROJECTS_DIR) ?? null;
}

export const memoryDirOf = (transcriptPath) => wrap(projectDirOf(transcriptPath));

const wrap = (projectDir) => (projectDir ? join(projectDir, MEMORY_DIR) : null);

function ancestors(dir, max) {
  const climb = [];
  let at = dir;
  while (climb.length < max && dirname(at) !== at) {
    climb.push(at);
    at = dirname(at);
  }
  return climb;
}

// local beats project beats user, the host's own precedence. A project-scope
// value is carried with `untrusted: true` rather than dropped: a child process
// cannot see the workspace trust state, and silently ignoring a setting the user
// can see in their own file would be worse than saying we are unsure.
export function settingsLayers(home, cwd, read) {
  const files = [
    { scope: "local", file: join(cwd, ".claude", "settings.local.json"), untrusted: true },
    { scope: "project", file: join(cwd, ".claude", "settings.json"), untrusted: true },
    { scope: "user", file: home ? join(home, ".claude", "settings.json") : null, untrusted: false },
  ];
  return files.map((l) => ({ ...l, json: parsed(l.file, read) }));
}

function parsed(file, read) {
  const text = file && read(file);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function settingsMemoryDir(layers, home) {
  const found = layers.find((l) => typeof l.json?.autoMemoryDirectory === "string");
  if (!found) return null;
  return { dir: expandHome(found.json.autoMemoryDirectory, home), scope: found.scope, untrusted: found.untrusted };
}

const expandHome = (p, home) => (p.startsWith("~/") && home ? join(home, p.slice(2)) : p);

export function autoMemoryOff(env, layers) {
  if (env.CLAUDE_CODE_DISABLE_AUTO_MEMORY) return "CLAUDE_CODE_DISABLE_AUTO_MEMORY is set";
  const off = layers.find((l) => l.json?.autoMemoryEnabled === false);
  return off ? `autoMemoryEnabled is false in the ${off.scope} settings` : null;
}

export function discover(input) {
  const layers = settingsLayers(input.home, input.cwd, input.read);
  const moved = settingsMemoryDir(layers, input.home);
  const walked = memoryDirOf(input.transcriptPath);
  return stamped(input, moved, walked, autoMemoryOff(input.env, layers));
}

function stamped(input, moved, walked, off) {
  const dir = usableDir(moved?.dir ?? walked);
  return { v: 1, dir, how: moved ? "settings" : walked ? "transcript" : "none", from: input.transcriptPath ?? null, host: input.host, cwd: input.cwd, at: input.now(), scope: moved?.scope ?? null, untrusted: Boolean(moved?.untrusted), off };
}

// A relative autoMemoryDirectory is not something to guess a base for.
const usableDir = (dir) => (dir && isAbsolute(dir) ? dir : null);

// What of a discovery may be KEPT between a hook and a later command: never the
// transcript path (its file name IS the host's raw session id) and never the
// working directory -- and never a directory a repository's own settings chose,
// because a checkout could point that anywhere on the machine.
export function kept(record) {
  const { from: _from, cwd: _cwd, ...rest } = record ?? {};
  return rest.untrusted ? { ...rest, dir: null, how: "untrusted" } : rest;
}

// Age alone never invalidates a record. The path is a function of the project,
// and it changes when the repo moves or a setting relocates it -- both of which
// show up as "the directory is gone", not as "the record is old". An expiry that
// fired for no reason would make the projection target flap, which is exactly
// what discovering-and-validating is meant to avoid.
const CACHE_RULES = [
  { when: (r) => !r, why: () => "no session has cached a memory directory here yet — start a session with the plugin enabled" },
  { when: (r) => r.v !== 1, why: () => "cached by a different version of this plugin" },
  { when: (r, o) => r.host !== o.host, why: (r) => `cached on ${r.host}, not on this machine` },
  { when: (r) => r.off, why: (r) => `auto memory is off — ${r.off}` },
  { when: (r) => !r.dir, why: () => "no memory directory could be discovered from this session's transcript" },
  { when: (r, o) => !o.exists(r.dir), why: (r) => `${r.dir} is gone — a new session will re-discover it` },
];

export function cacheVerdict(record, opts) {
  const broken = CACHE_RULES.find((rule) => rule.when(record, opts));
  if (broken) return { usable: false, dir: null, why: broken.why(record, opts) };
  return { usable: true, dir: record.dir, why: `discovered from the ${record.how} and still there` };
}

// Whether the hook bothers rewriting the file -- a write-rate control, not a
// validity rule, so it is deliberately a separate question.
export const refreshDue = (record, nowMs) => !record || nowMs - Date.parse(record.at ?? 0) > REFRESH_MS;
