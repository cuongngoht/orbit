// The project's answers to the questions the engine cannot answer itself.
//
// Everything specific to one product is a VALUE here, never code in the
// engine: where the app is (origin), how to run read-only SQL (a command),
// which script opens a signed-in browser (launcher), which browser channel it
// opens, which hosts mean "an identity provider is asking for credentials",
// where the frontend checkout is (for fe_commit), where reports go. A team
// adopts the plugin by writing ui-tests/project.json, not by forking it.
//
// Every path is resolved against the project root; `~` and `${ENV}` expand;
// an entry whose ${ENV} is unset is dropped rather than kept as a literal.
//
// `reports` is where the ONE artefact meant for a person lands. Everything else
// a run produces -- its screenshots, its network dumps, its log -- goes into the
// machine store with the ledger, and is not configurable here at all: there is
// one variable for the whole store (ORBIT_STORE_DIR) and a second would be a
// second way to split it in half.
//
// New repositories export reports to the store, <store>/reports/, never the checkout.
// Relative source paths always use
// the checkout root, never the parent of the stored configuration directory.
//
// `retention` is how many evidence directories a case keeps. A memory that only
// ever grows is one people delete wholesale; 0 means keep everything.

import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { fromEnv } from "./env.mjs";
import { HOME_DIR, REPORTS_DIR, safeName } from "./paths.mjs";
import { contained, outsideRepositories } from "./boundary.mjs";

export const CONFIG_FILE = "project.json";

// What a project.json key IS, declared the way a case field is -- so a mistyped
// one becomes a sentence instead of a TypeError six frames into createContext.
// "sql": {"command": "sqlcmd"} (a string, not a list) used to crash on .map.
const KEYS = {
  $schema: { type: "string" },
  name: { type: "string" },
  origin: { type: "string" },
  runDir: { type: "string" },
  launcher: { type: "string" },
  reports: { type: "string" },
  retention: { type: "integer", minimum: 0 },
  sql: { type: "object" },
  frontend: { type: "object" },
  signIn: { type: "object" },
  launch: { type: "object" },
  identity: { type: "object" },
};

const NESTED_KEYS = {
  sql: { command: { type: "array", items: { type: "string" } }, timeoutSec: { type: "integer", minimum: 1 } },
  frontend: { roots: { type: "array", items: { type: "string" } }, srcDir: { type: "string" } },
  signIn: { hosts: { type: "array", items: { type: "string" } } },
  launch: { channel: { type: "string" }, env: { type: "string" } },
  identity: { audience: { type: "string" }, issuer: { type: "string" }, rolesClaim: { type: "string" }, upnClaim: { type: "string" } },
};

// Findings, never a throw: `query check` reports a broken project.json and the
// composition root turns the same list into a Refused.
export function configFindings(raw, where = CONFIG_FILE) {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const own = [...unknown(raw, KEYS, where), ...constraintFindings(KEYS, raw, where)];
  return [...own, ...Object.keys(NESTED_KEYS).flatMap((k) => nestedFindings(raw[k], k, where))];
}

function nestedFindings(v, k, where) {
  if (!isObject(v)) return [];
  return [...unknown(v, NESTED_KEYS[k], `${where} ${k}`), ...constraintFindings(NESTED_KEYS[k], v, `${where} ${k}`)];
}

const unknown = (o, known, where) => Object.keys(o).filter((k) => !(k in known)).map((k) => `${where}: unknown key "${k}"`);

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const DEFAULTS = {
  name: null,
  origin: null,
  runDir: null,
  launcher: null,
  reports: null,
  retention: 10,
  sql: { command: null, timeoutSec: null },
  frontend: { roots: [] },
  signIn: { hosts: [] },
  launch: { channel: "chromium", env: "test" },
  identity: {},
};

const NESTED = ["sql", "frontend", "signIn", "launch", "identity"];

// `findings` rides along with the config: src/project has no opinion about what
// to do with a broken project.json, and must not -- the composition root turns
// the list into a Refused, and `query check` prints it. A file with findings
// yields the DEFAULTS, so nothing downstream reads a value nobody validated.
export function loadConfig(paths, env = process.env) {
  const { raw, problem } = readRaw(join(paths.uiTests, CONFIG_FILE));
  const findings = problem ? [problem] : configFindings(raw);
  return { ...finish(withDefaults(findings.length ? {} : raw), paths, env), findings };
}

const withDefaults = (raw) => NESTED.reduce((c, k) => ({ ...c, [k]: { ...DEFAULTS[k], ...raw[k] } }), { ...DEFAULTS, ...raw });

function readRaw(file) {
  if (!existsSync(file)) return { raw: {}, problem: null };
  try { return { raw: JSON.parse(readFileSync(file, "utf8")), problem: null }; }
  catch (e) { return { raw: {}, problem: `${CONFIG_FILE} is not valid JSON: ${e.message}` }; }
}

function finish(c, paths, env) {
  const name = c.name ?? basenameOf(paths.root);
  return {
    ...c,
    name,
    origin: fromEnv(env, "ORIGIN") || c.origin,
    runDir: runDirectory(c, paths, env, name),
    launcher: expandPath(c.launcher, paths.root, env),
    reports: expandPath(c.reports, paths.root, env) || paths.reportsDir,
    sql: { ...c.sql, command: c.sql.command ? c.sql.command.map((a) => expand(a, env)) : null },
    frontend: { ...c.frontend, roots: frontendRoots(c.frontend.roots, paths.root, env) },
    signIn: { hosts: c.signIn.hosts ?? [] },
    launch: { channel: fromEnv(env, "CHANNEL") || c.launch.channel, env: fromEnv(env, "ENV") || c.launch.env },
    identity: { ...c.identity },
  };
}

function runDirectory(c, paths, env, name) {
  if (paths.isolated) return paths.sessionDir;
  const given = fromEnv(env, "RUN_DIR") || expandPath(c.runDir, paths.root, env);
  return outsideRepositories(contained(paths.runtime, given || paths.sessionDir));
}

// node:path, never a hand-rolled split on "/": on Windows a project root
// arrives separated by backslashes, so the split returned the WHOLE path as the
// project name -- and the default run directory became <tmp>/pw-C:\Users\…,
// which no platform can create. A default that only works on one OS is the kind
// of bug a plugin shipped to every team must not have.
const basenameOf = (p) => basename(p);

// ORBIT_FRONTEND_ROOT always wins, then the configured candidates in order;
// the first that exists is the frontend. Kept as a list because one repo can
// hold a pinned submodule AND a working copy, and which one is "the frontend"
// is a per-machine fact.
function frontendRoots(roots, base, env) {
  const all = [fromEnv(env, "FRONTEND_ROOT"), ...roots].map((r) => expandPath(r, base, env)).filter(Boolean);
  return [...new Set(all)];
}

export function expandPath(p, base, env) {
  if (!p) return null;
  const s = expand(p, env);
  if (s === null) return null;
  return isAbsolute(s) ? s : resolve(base, s);
}

// `~/x` and `${VAR}` in a configured string; null when a referenced variable
// is unset, so the caller can drop the entry instead of using a wrong literal.
export function expand(s, env) {
  if (typeof s !== "string") return s;
  let missing = false;
  const out = s.replace(/^~(?=$|[\/])/, homedir()).replace(/\$\{(\w+)\}/g, (_, k) => env[k] ?? (missing = true, ""));
  return missing ? null : out;
}
