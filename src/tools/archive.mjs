// The `archive` installer: a release archive PINNED in the catalog -- version,
// and per platform its URL, SHA-256 and the binary inside -- installed into
//
//   <storeBase>/runtimes/tools/<tool>/<version>-<platform>-<arch>/
//
// and nowhere else: not the plugin, not a project, not PATH.
//
//   reuse     that directory already holds a binary that answers with the
//             pinned version -> nothing is downloaded
//   install   src/store/archive.mjs placeArchive: download, check the SHA-256
//             against the PIN, stage beside the final directory, verify, promote
//   verify    run the staged binary; it must start and name the pinned version
//
// So there is no moment at which a half-unpacked runtime sits where detection
// looks. Every effect is `ctx.io` (src/tools/real.mjs), faked in the suite.
import { join } from "node:path";
import { contained } from "../project/boundary.mjs";
import { placeArchive } from "../store/archive.mjs";
import { assetFor } from "./catalog.mjs";
import { versionIn } from "./detect.mjs";
import { ask, launcherOf } from "./launch.mjs";

export const archiveInstaller = {
  strategy: "archive",
  supports: (entry, platform, arch) => (assetFor(entry, platform, arch) ? null : `no verified build of ${entry.name} is pinned for ${platform}-${arch}`),
  install: (entry, ctx) => installed(entry, assetFor(entry, ctx.platform, ctx.arch), ctx),
};

async function installed(entry, asset, ctx) {
  const dir = join(entry.id, `${entry.install.version}-${ctx.platform}-${ctx.arch}`);
  const final = contained(ctx.rooms.toolRuntimes, join(ctx.rooms.toolRuntimes, dir));
  const placed = { version: entry.install.version, home: "toolRuntimes", dir, bin: asset.bin, checksum: `sha256:${asset.sha256}`, source: asset.url };
  if (answers(join(final, asset.bin), entry, asset, ctx)) return { ...placed, reused: true };
  return (await placeArchive({ asset, final, io: ctx.io, verify: (unpacked) => answers(contained(unpacked, join(unpacked, asset.bin)), entry, asset, ctx), unverified: `the unpacked ${entry.name} did not answer as ${entry.install.version} on this machine` }), placed);
}

// It starts, exits 0, and -- when the row says how to read one -- names the
// pinned version. A binary that merely exists proves nothing. It is asked the way
// it will be run (src/tools/launch.mjs): the arguments the build says go before
// the tool's own, and -- for a tool with a profile -- an environment and a
// scratch directory of its own.
export function answers(bin, entry, asset, ctx) {
  if (!ctx.exists(bin)) return false;
  const launcher = launcherOf(entry, { launch: { file: bin, args: asset.launch?.args ?? [] } }, ctx, "probe", asset);
  try { return named(ask(ctx, entry, launcher), entry); }
  finally { launcher.release(); }
}

export const named = (r, entry) => !r?.error && r?.status === 0 && (!entry.detection.versionPattern || versionIn(`${r.stdout ?? ""}\n${r.stderr ?? ""}`, entry.detection.versionPattern) === entry.install.version);
