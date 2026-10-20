// Claude Code's own project memory, as a HOST-MEMORY PROVIDER
// (src/knowledge/host-memory.mjs): hints for one invocation -- never facts,
// never stored, and nothing here writes anything.
//
// Where the memory directory is comes from one of two places, in order:
//
//   the location the async SessionStart hook recorded (cli/knowledge.mjs
//   `locate --hook`), held to native.mjs `cacheVerdict` -- this machine, still
//   there, auto memory on -- and its SHAPE re-checked, because a location record
//   lives under a temp directory other users can write to
//   the USER's own settings (`autoMemoryDirectory`, under CLAUDE_CONFIG_DIR
//   when that is set) -- never a repository's, which a checkout could point
//   anywhere on the machine
//
// and when neither answers, the answer is an unknown, never a guess.
//
// What it reads: the topic notes (`*.md` -- not MEMORY.md's index of pointers,
// only native host pages), at most MAX_FILES of at most
// MAX_BYTES each, every path held inside the directory through symlinks. What
// it hands back per note: its `name` as a title, its description and body with
// the frontmatter, HTML comments, Orbit's own projection region, URLs and
// absolute paths stripped, and the repo-relative paths it mentions. The core
// scrubs, tokenises and clips all of it, and keeps none of it.
import { basename, dirname, isAbsolute, join } from "node:path";
import { contained } from "../../../src/project/boundary.mjs";
import { hostMemoryFile } from "../../../src/project/runtime.mjs";
import { tokens } from "../../../src/tokens.mjs";
import { cacheVerdict } from "../native.mjs";

export const MAX_FILES = 20;
export const MAX_BYTES = 64 * 1024;
export const MAX_TEXT = 4000;
export const MAX_PATHS = 8;

// deps: { project, env, io, home, host }
export function createClaudeMemory(deps) {
  return { id: "claude", doc: "Claude Code's own project memory, read as hints for this invocation", recall: (ask) => recalledFrom(deps, ask ?? {}) };
}

function recalledFrom(deps, ask) {
  const found = located(deps);
  if (!found.dir) return { hints: [], unknowns: [found.why] };
  const hints = noteFiles(deps.io, found.dir).map((name) => hintOf(deps.io, found.dir, name)).filter(Boolean);
  return { hints: ranked(hints, ask.tokens ?? []).slice(0, ask.limit ?? 8), unknowns: [] };
}

function located(deps) {
  const cached = cachedDir(deps);
  if (cached.dir) return cached;
  const user = userSettingsDir(deps);
  return user ? { dir: user } : { dir: null, why: `no Claude Code memory directory is known for this checkout — ${cached.why}` };
}

function cachedDir(deps) {
  const record = parsed(deps.io.read(hostMemoryFile(deps.project)));
  const verdict = cacheVerdict(record, { host: deps.host, exists: (p) => deps.io.exists(p) });
  if (!verdict.usable) return { dir: null, why: verdict.why };
  return shaped(record) ? { dir: verdict.dir } : { dir: null, why: "the recorded location does not look like a host memory directory, so it was ignored" };
}

// A directory discovered from a transcript is always <…>/projects/<project>/memory.
const shaped = (record) => record.how !== "transcript" || (basename(record.dir) === "memory" && basename(dirname(dirname(record.dir))) === "projects");

function userSettingsDir(deps) {
  const file = deps.env?.CLAUDE_CONFIG_DIR ? join(deps.env.CLAUDE_CONFIG_DIR, "settings.json") : deps.home ? join(deps.home, ".claude", "settings.json") : null;
  const json = file ? parsed(deps.io.read(file)) : null;
  const dir = typeof json?.autoMemoryDirectory === "string" ? json.autoMemoryDirectory.replace(/^~(?=\/)/, deps.home ?? "~") : null;
  return dir && isAbsolute(dir) && json.autoMemoryEnabled !== false && deps.io.exists(dir) ? dir : null;
}

const noteFiles = (io, dir) => io.list(dir).filter((n) => n.endsWith(".md") && n !== "MEMORY.md" && !n.startsWith("orbit-")).sort().slice(0, MAX_FILES);

function hintOf(io, dir, name) {
  const file = inside(dir, name);
  const text = file ? io.read(file) : null;
  if (!text || text.length > MAX_BYTES) return null;
  const front = frontOf(text);
  return { id: name, title: front.name || name.replace(/\.md$/, ""), text: cleaned(`${front.description ?? ""}\n${bodyOf(text)}`).slice(0, MAX_TEXT), paths: pathsIn(bodyOf(text)) };
}

function inside(dir, name) {
  try { return contained(dir, join(dir, name)); }
  catch { return null; }
}

// The two frontmatter keys a note carries that mean anything here.
function frontOf(text) {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  const value = (key) => new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, "m").exec(block)?.[1] ?? "";
  return { name: value("name"), description: value("description") };
}

const bodyOf = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, "");

// Native comments are removed before claims are extracted.
// and evidence Orbit once wrote must never come back to it as a host's hint.
const STRIPPED = [/<!--[\s\S]*?-->/g, /\bhttps?:\/\/\S+/gi, /(^|\s)(\/|~\/|[A-Za-z]:\\)\S+/g, /[#*_`>|[\]()]/g];

const cleaned = (text) => STRIPPED.reduce((t, re) => t.replace(re, " "), text).replace(/\s+/g, " ").trim();

// Repo-relative paths a note mentions: a slash inside, none in front. The core
// keeps only the ones this checkout tracks.
const pathsIn = (text) => [...new Set([...text.matchAll(/(?:^|[\s`'"(])([a-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)/gm)].map((m) => m[1].replace(/[.,;:]+$/, "")))].slice(0, MAX_PATHS);

// The notes that share the most words with the task, first.
function ranked(hints, asked) {
  const scored = hints.map((h) => ({ h, n: tokens(`${h.title} ${h.text}`).filter((t) => asked.includes(t)).length }));
  return scored.filter((s) => s.n > 0).sort((a, b) => b.n - a.n || (a.h.id < b.h.id ? -1 : 1)).map((s) => s.h);
}

function parsed(text) {
  try { return text ? JSON.parse(text) : null; }
  catch { return null; }
}
