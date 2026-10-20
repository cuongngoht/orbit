// Putting a managed MCP server's RUNTIME on this machine -- the one mutating
// thing about a runtime, and only ever because a person asked (Control's
// Install button). The router never reaches this file.
//
// Not every managed server has a runtime. An installer is a STRATEGY named by
// the catalog row's `install.strategy`, the way CLI tools choose theirs:
//
//   remote-http   an http server: there is nothing to install. It is connected
//                 to on demand, and nothing pretends it has a binary
//   archive       a release PINNED in the catalog (version, and per platform a
//                 URL, a SHA-256 and the entrypoint inside), placed into
//                   <storeBase>/runtimes/mcp/<id>/<version>-<platform>-<arch>/
//                 by the one stage-verify-promote transaction the tool installer
//                 uses too (src/store/archive.mjs)
//
//   { strategy, supports(entry, platform, arch) -> reason | null,
//     install(entry, ctx) -> Promise<placement | null> }
//
// A placement is RELATIVE -- a room of the store, a directory, an entrypoint --
// so a store that moves takes its runtimes along. The RECEIPT is written last,
// after the runtime is in place and verified, so a receipt always describes
// something that was checked; a failed install leaves none. Removing a runtime
// is a separate, explicit act, and only ever inside <storeBase>/runtimes/mcp/.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";
import { placeArchive } from "../store/archive.mjs";
import { mcpAssetFor } from "./catalog.mjs";

export const remoteHttpInstaller = {
  strategy: "remote-http",
  supports: (entry) => (entry.definition?.transport === "http" ? null : "only an http server needs nothing installed"),
  install: async () => null,
};

export const mcpArchiveInstaller = {
  strategy: "archive",
  supports: (entry, platform, arch) => (mcpAssetFor(entry, platform, arch) ? null : `no verified build of ${entry.name} is pinned for ${platform}-${arch}`),
  install: (entry, ctx) => placed(entry, mcpAssetFor(entry, ctx.platform, ctx.arch), ctx),
};

export const MCP_INSTALLERS = [remoteHttpInstaller, mcpArchiveInstaller];

async function placed(entry, asset, ctx) {
  const dir = join(entry.id, `${entry.install.version}-${ctx.platform}-${ctx.arch}`);
  const final = contained(ctx.rooms.mcpRuntimes, join(ctx.rooms.mcpRuntimes, dir));
  const placement = { version: entry.install.version, home: "mcpRuntimes", dir, entrypoint: asset.entrypoint, checksum: `sha256:${asset.sha256}`, source: asset.url };
  if (ctx.exists(join(final, asset.entrypoint))) return { ...placement, reused: true };
  return (await placeArchive({ asset, final, io: ctx.io, verify: (unpacked) => ctx.exists(contained(unpacked, join(unpacked, asset.entrypoint))), unverified: `the unpacked ${entry.name} has no ${asset.entrypoint}` }), placement);
}

// ctx: { installers, platform, arch, rooms, state (src/mcp/state.mjs), io, exists, now }
export async function installMcp(entry, ctx) {
  const installer = installerFor(entry, ctx);
  const placement = await installer.install(entry, ctx);
  if (!placement) return null;
  return receipted(entry, placement, ctx);
}

function receipted(entry, placement, ctx) {
  const receipt = { mcp: entry.id, version: placement.version, platform: ctx.platform, arch: ctx.arch, home: placement.home, dir: placement.dir, entrypoint: placement.entrypoint, installedAt: ctx.now(), source: placement.source ?? null, checksum: placement.checksum ?? null };
  ctx.state.saveReceipt(receipt);
  return { ...receipt, reused: placement.reused === true };
}

function installerFor(entry, ctx) {
  const installer = ctx.installers?.[entry.install?.strategy];
  const why = installer ? installer.supports?.(entry, ctx.platform, ctx.arch) : entry.install?.instructions ?? "Orbit has no private installer for it";
  if (why) throw new Refused(`${entry.name} is not installed by Orbit on this machine: ${why}`);
  return installer;
}

// Delete what Orbit installed for one server -- every version, and any copy an
// update set aside -- and its receipts. The path is re-derived and checked to
// be INSIDE the runtimes room (symlinks included) before anything is removed.
export function removeRuntime(id, ctx) {
  const dir = contained(ctx.rooms.mcpRuntimes, join(ctx.rooms.mcpRuntimes, id));
  const existed = ctx.io.exists(dir);
  ctx.io.remove(dir);
  return { removed: existed, receipts: ctx.state.dropReceipts(id) };
}
