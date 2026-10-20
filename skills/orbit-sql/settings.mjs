// WHERE the connection comes from, and why there are two places for it.
//
// An `export` the user runs in their terminal does not reach an agent that is
// ALREADY RUNNING: that process inherited its environment when it started, and
// nothing a shell does afterwards can reach into it. So the environment fixes
// the NEXT session and a file fixes THIS one -- and being told "not configured"
// five seconds after setting the variable is how an afternoon goes.
//
// The file is ~/.orbit/sql.env, mode 600, in the HOME directory and never in a
// repository: a credential that CAN be committed eventually is. Nothing here
// writes it -- `setup-hint` prints the commands and the user runs them, so the
// password is typed into their own terminal and never into a transcript.
import { Refused } from "../../src/errors.mjs";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { PREFIX } from "./args.mjs";
import { adapterProject, runtimePath } from "../../src/project/runtime.mjs";

export const CONFIG_DIR = join(homedir(), ".orbit");
export const CONFIG_FILE = join(CONFIG_DIR, "sql.env");
export const KEYS = ["SERVER", "DATABASE", "USER", "PASSWORD", "TIMEOUT", "TRUST_CERT", "BIN"];
export const SECRET = PREFIX + "PASSWORD";

export function configFile(env = process.env, cwd = process.cwd()) {
  const project = adapterProject(env, cwd);
  return project?.layout === 3 ? runtimePath(project, join(project.runtime, "adapters", "sql.env")) : CONFIG_FILE;
}

export const canonical = (key) => KEYS.find((k) => key === PREFIX + k) ?? null;

export function parseEnvFile(text) {
  const found = {};
  for (const line of String(text ?? "").split(/\r?\n/)) assign(found, line.trim());
  return found;
}

// Values may contain '='. Unsupported file syntax or keys are refused before use.
function assign(found, line) {
  if (!line || line.startsWith("#")) return;
  const at = line.indexOf("=");
  const key = at < 1 ? null : canonical(line.slice(0, at).trim());
  if (!key) throw new Refused("Unsupported SQL configuration: use only ORBIT_SQL_* KEY=VALUE lines");
  found[PREFIX + key] = line.slice(at + 1).trim();
}

// The environment WINS. A machine that exports its own credentials keeps them,
// CI never depends on a file in somebody's home directory, and the file fills
// only what was left unset.
export function resolveSettings(env, fileText, path = CONFIG_FILE) {
  const file = parseEnvFile(fileText);
  const filled = Object.fromEntries(Object.entries(file).filter(([k]) => !env[k]));
  return { settings: { ...env, ...filled }, sources: sourcesOf(env, file, path) };
}

// Which of the two actually supplied each value -- the first thing to know when
// the answer is not the one expected.
const sourcesOf = (env, file, path) => Object.fromEntries(KEYS.map((k) => [k, env[PREFIX + k] ? "environment" : file[PREFIX + k] ? path : null]));

// Read HERE and injected everywhere else, so no test depends on what happens to
// be in the home directory of whoever runs it.
export function readConfig(file = CONFIG_FILE) {
  if (existsSync(file)) return readFileSync(file, "utf8");
  return "";
}

// A password in a world-readable file is a password on the office noticeboard.
// Windows has no mode bits worth reading here, so it is not asked.
export function modeWarning(file = CONFIG_FILE, os = platform()) {
  if (os === "win32" || !existsSync(file)) return null;
  const mode = statSync(file).mode & 0o777;
  return mode === 0o600 ? null : `${file} is mode ${mode.toString(8)} but holds a password — chmod 600 ${file}`;
}

// Belt and braces on the way OUT: the password goes to the child through its
// environment and can never appear in argv, but a tool's error text is echoed
// here verbatim and this is the last place to look at it before a human does.
export const redact = (text, secret) => (secret ? String(text ?? "").split(secret).join("***") : String(text ?? ""));
