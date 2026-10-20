// THE Orbit LIVE COMPANION for VS Code (Orbit 1.8.5): Orbit Live in a terminal split BESIDE the terminal an AI CLI runs
// in -- Claude Code, Codex, any -- when Orbit asks, through VS Code's own Terminal API: a split of the asking terminal
// (`location: { parentTerminal }`), and the keyboard handed back to it. Orbit never drives VS Code: `live ensure` and
// `live open`, run inside a VS Code terminal, only LEAVE A REQUEST in the Orbit store's live room
// (`<store>/control/live/requests/<name>.json`); this companion, which a person installed, picks it up.
//
// WHY IT TRUSTS SO LITTLE: an AI agent runs as you, so from inside its sandbox it can write files you own -- a request,
// a `node`, a `cli/live.mjs`, a whole copy of Orbit -- and this companion runs OUTSIDE that sandbox. So nothing a request
// supplies is ever run, and ownership alone never proves who wrote a file:
// WHAT IT RUNS: `node <Orbit>/cli/live.mjs tui [<task>] [--lease=… | --until-done]` and nothing else. `node` is the one
// you named in `orbit.live.nodePath` -- no PATH is searched; unset, nothing opens and you are told once. `<Orbit>` is a
// Orbit install (`plugin.json` names `orbit`) inside a host's own plugin folder in your home -- Claude Code's, Codex's,
// Antigravity's, written by their plugin managers and never by an agent's tools -- and the whole install, every file
// and folder, and every folder above it up to that plugin folder, is yours (or root's) and writable by nobody else. A
// request only says WHICH install; Orbit run from anywhere else (a checkout, say) is never run from here.
// WHAT A REQUEST MAY SAY: a task, a lease or `--until-done`; the working directory; Orbit's own variables, its store
// only the one the request was left in; the asking process's ancestry (at most 32 pids, Orbit's own bound); the share
// and the focus; written within the last minute and never in the future. Anything else is refused and removed.
// WHERE REQUESTS COME FROM: your stores only -- the default one, VS Code's own ORBIT_STORE_DIR and `orbit.live.storeDirs`.
// Every setting is machine-scoped and read from your User (or Remote) settings alone: a repository you open cannot
// set one. The live room (`control/live/requests` below the store) must be real folders of yours nobody else may
// write; a request file must be yours and writable by nobody else, opened without following a link, then checked and
// read through one descriptor; another person's, in a shared store, is left alone. Windows keeps no owner or mode
// bits (`uid` undefined): there those checks are skipped, and a request still runs nothing but the above.
// WHICH TERMINAL: the one whose shell is among the asking process's ancestors; none found in this window, nothing
// opens here -- another window's companion may own it. Two windows never open one request: whoever renames the file
// first claims it.
// IT SAYS IT IS THERE by a heartbeat file in the live room (`companions/vscode-<pid>.json`), so Orbit asks it only while
// it runs; the file is removed when the window closes.
//
//   createCompanion({ vscode, fs, path, os, env, pid, uid, now, every }) -> { dispose(), tick(), heartbeat() }
//     env                         VS Code's own environment (its ORBIT_STORE_DIR is a store)
//     uid                         whose files are trusted (process.getuid(); undefined on Windows)
//     every(ms, fn) -> stop()     a timer (setInterval in VS Code, a fake in a test)
'use strict'

const VERSION = '1.8.5'
const HEARTBEAT_MS = 10_000
const POLL_MS = 1_000
const REQUEST_MAX_AGE_MS = 60_000
const MAX_ANCESTRY = 32
const MAX_INSTALL_ENTRIES = 20_000

const PASSED = ['ORBIT_STORE_DIR', 'ORBIT_SESSION', 'ORBIT_HOST', 'ORBIT_HOST_PROTOCOL', 'NO_COLOR']
const TASK = /^tsk-[a-f0-9]{12}$/
const LEASE = /^--lease=[a-f0-9]{16}\.[a-f0-9]{16}$/
const LIVE_CLI = /[\\/]cli[\\/]live\.mjs$/
const NODE = /^node(js)?(\.exe)?$/i
const PRINTABLE = /^[^\u0000-\u001f\u007f]*$/
const ROOM = ['control', 'live', 'requests']

// Where the hosts install plugins, under your home: written by their own plugin managers, never by an agent's tools.
const HOST_PLUGIN_FOLDERS = [['.claude', 'plugins', 'cache'], ['.claude', 'plugins', 'synced'], ['.codex', 'plugins', 'cache'], ['.gemini', 'config', 'plugins']]

const NO_NODE = 'Orbit Live companion: set orbit.live.nodePath in your User settings to the node Orbit runs with (`command -v node` prints it). Until then it opens nothing.'

// ---- your own settings ----------------------------------------------------------------------------------------------

// The value in your User (or Remote) settings, and nothing a workspace says -- even where a VS Code would still apply
// a workspace's value to a machine-scoped setting.
function userSetting(deps, key, fallback) {
  const seen = deps.vscode.workspace.getConfiguration('orbit.live').inspect(key)
  return seen && seen.globalValue !== undefined && typeof seen.globalValue === typeof fallback ? seen.globalValue : fallback
}

const absolutes = (deps, list) => (Array.isArray(list) ? list : []).filter((d) => typeof d === 'string' && deps.path.isAbsolute(d))

// ---- where Orbit keeps its live room ---------------------------------------------------------------------------------

function storeBasesOf(deps) {
  const fromEnv = typeof deps.env.ORBIT_STORE_DIR === 'string' ? [deps.env.ORBIT_STORE_DIR] : []
  const home = deps.path.join(deps.os.homedir(), '.orbit', 'projects')
  return [...new Set(absolutes(deps, [...userSetting(deps, 'storeDirs', []), ...fromEnv, home]))]
}

const liveRoomOf = (deps, base) => deps.path.join(base, 'control', 'live')

// ---- who could have written it --------------------------------------------------------------------------------------

// Nobody but you: yours (or root's, for an installed program) and writable by nobody else. Windows keeps no such bits.
const ownOnly = (deps, s, rootToo) => deps.uid === undefined || ((s.uid === deps.uid || (rootToo && s.uid === 0)) && (s.mode & 0o022) === 0)

// A link's own mode bits mean nothing: it is held to its owner, and never followed.
const entryOk = (deps, s) => (s.isSymbolicLink() ? deps.uid === undefined || s.uid === deps.uid || s.uid === 0 : ownOnly(deps, s, true))

const quietly = (fn) => {
  try {
    return fn()
  } catch {
    return null
  }
}

const realOf = (deps, p) => quietly(() => deps.fs.realpathSync(p))
const statOf = (deps, p) => quietly(() => deps.fs.statSync(p))
const lstatOf = (deps, p) => quietly(() => deps.fs.lstatSync(p))

const folderOk = (deps, p, rootToo) => {
  const s = lstatOf(deps, p)
  return Boolean(s) && s.isDirectory() && ownOnly(deps, s, rootToo)
}

// ---- what the viewer runs: the companion's choice ---------------------------------------------------------------------

// `node`: the one you named in `orbit.live.nodePath` -- never a path a request names, never a search of a PATH.
function nodeOf(deps) {
  const named = userSetting(deps, 'nodePath', '')
  const node = deps.path.isAbsolute(named) ? realOf(deps, named) : null
  const s = node && statOf(deps, node)
  return s && s.isFile() && NODE.test(deps.path.basename(node)) && ownOnly(deps, s, true) ? node : null
}

const hostFoldersOf = (deps) => HOST_PLUGIN_FOLDERS.map((p) => realOf(deps, deps.path.join(deps.os.homedir(), ...p))).filter(Boolean)

const inside = (deps, root, file) => {
  const rel = deps.path.relative(root, file)
  return rel !== '' && !rel.startsWith('..') && !deps.path.isAbsolute(rel)
}

const manifestOk = (deps, install) => quietly(() => JSON.parse(deps.fs.readFileSync(deps.path.join(install, 'plugin.json'), 'utf8')).name === 'orbit') === true

// The folders from the host's plugin folder down to the install: real folders, yours (or root's), nobody else's to write.
function chainOk(deps, root, install) {
  const folders = [root]
  for (let at = deps.path.dirname(install); inside(deps, root, at); at = deps.path.dirname(at)) folders.push(at)
  return folders.every((d) => folderOk(deps, d, true))
}

// Every entry of the install, read without following a link. An install larger than any Orbit install is refused.
function treeOk(deps, install) {
  const todo = [install]
  for (let seen = 0; todo.length > 0; seen += 1) {
    const at = todo.pop()
    const s = lstatOf(deps, at)
    if (!s || !entryOk(deps, s) || seen >= MAX_INSTALL_ENTRIES) return false
    const children = s.isDirectory() ? quietly(() => deps.fs.readdirSync(at).map((n) => deps.path.join(at, n))) : []
    if (!children) return false
    todo.push(...children)
  }
  return true
}

// The script a request names, if it is the cli/live.mjs of a Orbit install inside a host's plugin folder, whole and
// nobody else's to write.
function scriptOf(deps, named) {
  const script = realOf(deps, named)
  const install = script && LIVE_CLI.test(script) ? deps.path.dirname(deps.path.dirname(script)) : null
  const root = install ? hostFoldersOf(deps).find((r) => inside(deps, r, install)) : null
  return root && manifestOk(deps, install) && chainOk(deps, root, install) && treeOk(deps, install) ? script : null
}

// What the viewer runs, as resolved now: your node, the trusted script, the request's checked arguments.
function programOf(deps, argv) {
  const node = nodeOf(deps)
  const script = node ? scriptOf(deps, argv[1]) : null
  return script ? [node, script, ...argv.slice(2)] : null
}

// ---- what a request may ask -------------------------------------------------------------------------------------------

const argsOk = (rest) => rest.length <= 2 && rest.every((a) => TASK.test(a) || LEASE.test(a) || a === '--until-done')

const argvOk = (argv) => Array.isArray(argv) && argv.length >= 3 && argv.every((a) => typeof a === 'string' && PRINTABLE.test(a)) && LIVE_CLI.test(argv[1]) && argv[2] === 'tui' && argsOk(argv.slice(3))

const envOk = (env) => env && typeof env === 'object' && Object.entries(env).every(([k, v]) => PASSED.includes(k) && typeof v === 'string' && PRINTABLE.test(v))

// A request speaks for the store it was left in, and for no other.
const storeOk = (deps, env, base) => env.ORBIT_STORE_DIR === undefined || (realOf(deps, env.ORBIT_STORE_DIR) !== null && realOf(deps, env.ORBIT_STORE_DIR) === realOf(deps, base))

// Written within the last minute, and never in the future: a request is a moment, not a standing order.
function fresh(deps, at) {
  const age = deps.now() - Date.parse(at)
  return Number.isFinite(age) && age >= 0 && age <= REQUEST_MAX_AGE_MS
}

// The asking process and its parents, as Orbit's own process port reads them: at most 32 pids.
const ancestryOk = (a) => Array.isArray(a) && a.length > 0 && a.length <= MAX_ANCESTRY && a.every((p) => Number.isInteger(p) && p > 0)

const cwdOk = (deps, cwd) => typeof cwd === 'string' && PRINTABLE.test(cwd) && deps.path.isAbsolute(cwd) && Boolean(statOf(deps, cwd)?.isDirectory())

// The one shape this companion acts on, for Orbit's own program, from the store it was left in; anything else is
// refused whole.
function requestOk(deps, r, base) {
  if (!r || r.version !== 1 || r.kind !== 'open-viewer') return false
  if (!argvOk(r.argv) || !envOk(r.env || {}) || !storeOk(deps, r.env || {}, base)) return false
  if (!fresh(deps, r.at) || !ancestryOk(r.ancestry) || !cwdOk(deps, r.cwd)) return false
  return programOf(deps, r.argv) !== null
}

// ---- the terminal it splits ---------------------------------------------------------------------------------------

async function parentOf(deps, ancestry) {
  for (const t of deps.vscode.window.terminals) if (ancestry.includes(await Promise.resolve(t.processId).catch(() => null))) return t
  return null
}

// The viewer in a split of the asking terminal's group -- the program as resolved now -- and the asking terminal
// given the keyboard back. Nothing opens when what it resolved no longer holds.
function opened(deps, r, parent) {
  const program = programOf(deps, r.argv)
  if (!program) return null
  const viewer = deps.vscode.window.createTerminal({ name: 'Orbit Live', shellPath: program[0], shellArgs: program.slice(1), cwd: r.cwd, env: r.env || {}, location: { parentTerminal: parent }, isTransient: true })
  viewer.show(true)
  if (r.focusCli !== false) parent.show(false)
  return viewer
}

// Said once a window: why nothing opens.
function told(deps, text) {
  if (deps.told.has(text)) return
  deps.told.add(text)
  deps.vscode.window.showWarningMessage(text)
}

// ---- one request ----------------------------------------------------------------------------------------------------

// The live room is read only when its folders below the store are real folders of yours nobody else may write.
const roomOk = (deps, base) => ROOM.every((_, i) => folderOk(deps, deps.path.join(base, ...ROOM.slice(0, i + 1)), false))

// The file as ONE inode: opened without following a link, then checked and read through that descriptor, so what was
// judged is what is read. `null`: not a file of yours to judge -- in a shared store, another person's is theirs.
function ownRequest(deps, file) {
  const fd = quietly(() => deps.fs.openSync(file, deps.fs.constants.O_RDONLY | (deps.fs.constants.O_NOFOLLOW || 0)))
  if (fd === null) return null
  try {
    return judged(deps, deps.fs.fstatSync(fd), fd)
  } finally {
    deps.fs.closeSync(fd)
  }
}

// Yours: read when nobody else could have written it; `r: null` (refused, then removed) when somebody could.
const judged = (deps, s, fd) => (deps.uid !== undefined && s.uid !== deps.uid ? null : { r: s.isFile() && ownOnly(deps, s, false) ? quietly(() => JSON.parse(deps.fs.readFileSync(fd, 'utf8'))) : null })

const removed = (deps, file) => {
  quietly(() => deps.fs.unlinkSync(file))
  return null
}

// Claimed by renaming: of two windows, the second finds the file gone.
const claimed = (deps, file) => quietly(() => (deps.fs.renameSync(file, `${file}.claimed-${deps.pid}`), `${file}.claimed-${deps.pid}`))

// A file of yours that is not a request this companion acts on is removed; one another window may own stays, until it
// is older than a minute and nobody took it (requestOk refuses a stale one, which is then removed). A file that is not
// yours is left alone.
async function handled(deps, file, base) {
  const own = ownRequest(deps, file)
  if (!own) return null
  if (!nodeOf(deps)) told(deps, NO_NODE)
  if (!requestOk(deps, own.r, base)) return removed(deps, file)
  const parent = await parentOf(deps, own.r.ancestry)
  if (!parent) return null
  const mine = claimed(deps, file)
  return mine ? settled(deps, mine, opened(deps, own.r, parent)) : null
}

const settled = (deps, file, viewer) => (removed(deps, file), viewer ? 'opened' : null)

async function tick(deps) {
  const done = []
  for (const base of storeBasesOf(deps).filter((b) => roomOk(deps, b))) for (const f of listed(deps, deps.path.join(liveRoomOf(deps, base), 'requests'))) done.push(await handled(deps, f, base))
  return done.filter(Boolean)
}

const listed = (deps, dir) => quietly(() => deps.fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => deps.path.join(dir, f))) || []

// ---- being there ----------------------------------------------------------------------------------------------------

const heartbeatFile = (deps, base) => deps.path.join(liveRoomOf(deps, base), 'companions', `vscode-${deps.pid}.json`)

function heartbeat(deps) {
  for (const base of storeBasesOf(deps)) {
    deps.fs.mkdirSync(deps.path.dirname(heartbeatFile(deps, base)), { recursive: true })
    deps.fs.writeFileSync(heartbeatFile(deps, base), `${JSON.stringify({ kind: 'vscode', pid: deps.pid, version: VERSION, heartbeatAt: new Date(deps.now()).toISOString() })}\n`)
  }
}

function createCompanion(given) {
  const deps = { ...given, told: new Set() }
  const safely = (fn) => () => Promise.resolve().then(fn).catch(() => null)
  safely(() => heartbeat(deps))()
  const stops = [deps.every(HEARTBEAT_MS, safely(() => heartbeat(deps))), deps.every(POLL_MS, safely(() => tick(deps)))]
  return { tick: () => tick(deps), heartbeat: () => heartbeat(deps), dispose: () => (stops.forEach((s) => s()), storeBasesOf(deps).forEach((b) => removed(deps, heartbeatFile(deps, b)))) }
}

module.exports = { createCompanion, requestOk, VERSION, PASSED }
