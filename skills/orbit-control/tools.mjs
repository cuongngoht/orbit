// Orbit Control's own Node, as a tool the tool manager can see and install --
// the `control-node` detector and the `node-dist` installer the catalog row
// `node-control` names. Concrete (nodejs.org, nvm), so it lives here with the
// rest of Control's runtime knowledge and is registered by a composition root.
//
// Neither changes what 1.5.2 did. The detector asks node.mjs's `candidates` in
// node.mjs's order -- ORBIT_CONTROL_NODE, the running Node, the private runtime,
// nvm -- and the first that is new enough wins, exactly as start.mjs picks. The
// installer IS install.mjs's `installRuntime`, into the same
// <storeBase>/control-runtime/ it always used, so a runtime installed by
// `start.mjs --install-runtime` is found and reused, receipt or not.
import { basename, dirname, join } from "node:path";
import { fromEnv } from "../../src/project/env.mjs";
import { DIST, installRuntime, targetOf } from "./install.mjs";
import { candidates } from "./node.mjs";

const PROBED = 8;

// deps: { home, list(dir), supported(version), required() }
export const controlNodeDetector = (deps) => (entry, ctx) => probed(labelled(ctx, deps), ctx, deps);

function labelled(ctx, deps) {
  const target = targetOf(ctx.platform, ctx.arch);
  const runtime = target ? { root: ctx.rooms.controlRuntime, bin: target.bin } : undefined;
  const typed = fromEnv(ctx.env, "CONTROL_NODE");
  return candidates({ env: ctx.env, home: deps.home, execPath: ctx.node, list: deps.list, runtime }).map((path) => ({ path, source: sourceOf(path, typed, ctx) }));
}

function sourceOf(path, typed, ctx) {
  if (path === typed) return "override";
  if (path === ctx.node) return "running";
  return path.startsWith(ctx.rooms.controlRuntime) ? "orbit-managed" : "nvm";
}

// Asked in order, and stopping at the first that will do: every ask may be a
// process, and the answer after that one changes nothing.
function probed(labelled, ctx, deps) {
  const out = [];
  for (const c of labelled.slice(0, PROBED)) if (asked(out, c, ctx, deps).ok) break;
  return out;
}

function asked(out, c, ctx, deps) {
  const version = ctx.exists(c.path) ? versionOf(c.path, ctx) : null;
  const ok = Boolean(version) && deps.supported(version);
  out.push({ source: c.source, found: Boolean(version), ok, path: c.path, version, reason: version && !ok ? `Node ${version} is older than Orbit Control needs (${deps.required()})` : null });
  return { ok };
}

function versionOf(node, ctx) {
  const r = ctx.run(node, ["--version"]);
  return !r?.error && r?.status === 0 ? String(r.stdout).trim().replace(/^v/, "") : null;
}

// deps: { supported, fetchJson, fetchText, fetchBytes, io (src/tools/real.mjs realInstallIo), log }
export function nodeDistInstaller(deps) {
  return {
    strategy: "node-dist",
    supports: (entry, platform, arch) => (targetOf(platform, arch) ? null : `nodejs.org publishes no build Orbit installs for ${platform}-${arch}`),
    install: (entry, ctx) => installed(targetOf(ctx.platform, ctx.arch), ctx, deps),
  };
}

async function installed(target, ctx, deps) {
  const seen = { digest: null };
  const dir = await installRuntime({ root: ctx.rooms.controlRuntime, target, supported: deps.supported, getJson: deps.fetchJson, getText: deps.fetchText, getBytes: deps.fetchBytes, sha256: deps.io.sha256, exists: ctx.exists, unpack: unpacker(deps.io), log: deps.log, verifiedAs: (d) => { seen.digest = d; } });
  const name = basename(dir);
  return { version: name.split("-")[0].replace(/^v/, ""), home: "controlRuntime", dir: name, bin: target.bin, checksum: seen.digest ? `sha256:${seen.digest}` : null, source: DIST, reused: seen.digest === null };
}

// install.mjs hands over the archive, its name, the one folder inside it and
// where that folder must end up; staging and the final rename are the same
// pattern the archive installer uses.
const unpacker = (io) => (bytes, asset, folder, dir) => {
  const tmp = io.tempDir(dirname(dir));
  try { io.rename(join(io.unpack(bytes, { format: asset.endsWith(".zip") ? "zip" : "tar.gz" }, tmp), folder), dir); }
  finally { io.remove(tmp); }
  return dir;
};
