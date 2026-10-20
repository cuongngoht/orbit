#!/usr/bin/env node
// Orbit Control: the composition root, and nothing but.
//
//   node control-server/src/main.mjs [--port=<n> | --port <n>]
//
// `--port <n>` as two words is how a task's sandbox tells it the port it leased
// (an argument override, README: Sandboxes); port.mjs reads both spellings.
//
// It resolves the plugin root from its own location (control-server/src/ sits
// two levels below it), binds the skills directory, the built page and the
// backup room, mints the mutation token, starts the server and prints the one
// URL that carries that token. Every decision lives in the modules it wires.
//
// Exit 1: this Node is older than control-server/package.json allows.
// Exit 2: bad usage, or nowhere a backup could safely go.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { engineVersion, loadProject, physical, projectCapabilities, projectKnowledge, realWorld, storeBase } from "./core.mjs";
import { newToken } from "./security.mjs";
import { liveOf } from "./live/index.mjs";
import { createControlServer, listen } from "./server.mjs";
import { portOf } from "./port.mjs";
import { required, supported } from "./runtime.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, "..", "..");

async function main(argv, env) {
  if (!supported(process.versions.node)) return stop(1, `Orbit Control needs Node ${required()}; this is ${process.version}. The Orbit engine itself still runs on Node >= 20.`);
  const ctx = contextOf(PLUGIN_ROOT, env);
  const server = createControlServer(ctx);
  announce(ctx, await listen(server, portOf(argv)));
  stopOn(ctx, server);
}

// Backups resolve through core's storeBase, so ORBIT_STORE_DIR relocates them
// with everything else the plugin keeps, and a path inside a repository is
// refused at start-up rather than discovered at the first delete.
//
// The resource manager's WORLD is bound here too: the host whose MCP
// configuration is read and changed, the detectors and installers, the store
// rooms -- and the directory Control was started in, which is the project whose
// local and project-scoped servers, project tools and capabilities it shows.
function contextOf(root, env) {
  const skillsRoot = physical(join(root, "skills"));
  if (!existsSync(skillsRoot)) throw new Error(`no skills directory at ${skillsRoot}`);
  const backupRoot = join(storeBase(env), "control-backups", "skills");
  const log = (line) => console.log(line);
  return { skillsRoot, backupRoot, publicRoot: physical(join(HERE, "..", "public")), token: newToken(), now: () => new Date(), node: process.versions.node, engine: engineVersion(), log, world: realWorld({ pluginRoot: root, projectRoot: process.cwd(), env, log }), capabilities: () => capabilitiesIn(process.cwd(), env), knowledge: () => knowledgeIn(root, process.cwd(), env) };
}

// Read when asked, never cached: a QC tool registered while Control is open is
// there on the next page load. No project here is no capabilities, not an error.
async function capabilitiesIn(cwd, env) {
  try { return await projectCapabilities(loadProject(env, cwd), env); }
  catch { return []; }
}

// The same for what project knowledge holds: the engine's own read-only summary,
// and no project here is "nothing to show", never an error page.
async function knowledgeIn(root, cwd, env) {
  try { return await projectKnowledge({ project: loadProject(env, cwd), env, pluginRoot: root, storeBase: storeBase(env) }); }
  catch { return { version: 1, available: false, why: "no Orbit project in the directory Control was started from" }; }
}

// The token rides in the #fragment: a browser never sends a fragment to a
// server, so it reaches the page and no log, proxy or Referer on the way.
function announce(ctx, port) {
  const lines = ["Orbit Control is running", `  open     http://127.0.0.1:${port}/#token=${ctx.token}`, `  skills   ${ctx.skillsRoot}`, `  backups  ${ctx.backupRoot}`, `  project  ${ctx.world.projectRoot}`, "  stop     Ctrl+C"];
  console.log(lines.join("\n"));
}

function stopOn(ctx, server) {
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => closed(ctx, server));
}

// Open live streams are ended first: a page's stream is a connection that never finishes on its own.
function closed(ctx, server) {
  liveOf(ctx).streams.closeAll();
  server.close(() => process.exit(0));
  server.closeAllConnections();
}

function stop(code, message) {
  console.error(message);
  process.exit(code);
}

main(process.argv.slice(2), process.env).catch((e) => stop(2, e.message));
