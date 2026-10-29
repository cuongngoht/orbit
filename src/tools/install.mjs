// Installing a CLI tool PRIVATELY for Orbit: the one mutating thing the tool
// manager does, and only ever because a person asked (Control's Install button,
// or a command run with an explicit flag). The router never reaches this file.
//
// An INSTALLER is a strategy chosen by the catalog row's `install.strategy`:
//
//   { strategy, supports?(entry, platform, arch) -> reason | null,
//     install(entry, ctx) -> Promise<{ version, home, dir, bin, checksum, source, reused? }> }
//
// `home` + `dir` + `bin` is WHERE it went, relative to a room of the store
// (src/store/control.mjs `stateRooms`), never an absolute path, so a store that
// moves takes its runtimes with it. The installer must never leave a half
// install where detection looks: it stages, verifies, then renames into place.
//
// What this adds on top of every installer: refuse one that cannot serve this
// platform, and write the RECEIPT -- after the runtime is in place, never
// before, so a receipt always describes something that was actually verified.
import { join } from "node:path";
import { Refused } from "../errors.mjs";

// Under the tool's own install lock (src/tools/state.mjs `installing`), so two
// installers of one tool never promote into the same directory at once.
export async function installTool(entry, ctx) {
  const installer = installerFor(entry, ctx);
  return ctx.state.installing(entry.id, () => receipted(entry, installer, ctx));
}

async function receipted(entry, installer, ctx) {
  if (ctx.rooms?.toolRuntimes) ctx.io?.sweepStaging?.(join(ctx.rooms.toolRuntimes, entry.id));
  const placed = await installer.install(entry, ctx);
  const receipt = { tool: entry.id, version: placed.version, platform: ctx.platform, arch: ctx.arch, home: placed.home, dir: placed.dir, bin: placed.bin, installedAt: ctx.now(), source: placed.source ?? null, checksum: placed.checksum ?? null };
  ctx.state.saveReceipt(receipt);
  return { ...receipt, reused: placed.reused === true };
}

function installerFor(entry, ctx) {
  const installer = ctx.installers?.[entry.install.strategy];
  const why = installer ? installer.supports?.(entry, ctx.platform, ctx.arch) : entry.install.instructions ?? "Orbit has no private installer for it";
  if (why) throw new Refused(`${entry.name} is not installed by Orbit on this machine: ${why}`);
  return installer;
}
