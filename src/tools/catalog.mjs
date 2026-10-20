// The plugin's TOOL CATALOG (catalog/tools.json), read as data.
//
// A row says what a tool provides, where to look for it (`detection`), and how
// -- if at all -- Orbit may install it privately (`install.strategy`). Nothing
// here branches on a row's id: a detector and an installer are chosen by the
// strategy NAME, from registries the composition root fills.
//
// An `archive` install is PINNED in the row: version, and per platform a URL, a
// SHA-256 and the binary's path inside the archive. A pin that is not well
// formed is dropped here, so a typo in the catalog can make a platform
// uninstallable but never makes an unverified download installable.
import { rowsOf } from "../catalog.mjs";
import { pinnedArchive } from "../store/archive.mjs";

export { relativeInside } from "../project/boundary.mjs";

export const platformKey = (platform, arch) => `${platform}-${arch}`;

export function toolCatalog(data) {
  return rowsOf(data?.tools).map(entryOf);
}

// `observe` (1.7.1): `demand` marks a tool the general observation must NOT look at -- one a concrete
// need asks about (src/tools/observe.mjs `observeSome`) -- because its probe can be slow (a CLI that
// starts an interpreter takes seconds) and the general observation runs inside a session's start.
const entryOf = (row) => ({ observe: row.observe === "demand" ? "demand" : "always", id: row.id, name: String(row.name ?? row.id), summary: String(row.summary ?? ""), provides: list(row.provides), detection: detectionOf(row.detection ?? {}), install: installOf(row.install ?? {}) });

// `minimum` (1.6.0): the oldest version that can do the job. A candidate below
// it is found and not usable, so detection keeps looking (src/tools/detect.mjs).
const detectionOf = (d) => ({ strategy: typeof d.strategy === "string" ? d.strategy : "commands", commands: list(d.commands), project: d.project === true, versionArgs: list(d.versionArgs).length ? list(d.versionArgs) : ["--version"], versionPattern: typeof d.versionPattern === "string" ? d.versionPattern : null, minimum: typeof d.minimum === "string" ? d.minimum : null });

const installOf = (i) => ({ strategy: typeof i.strategy === "string" ? i.strategy : "manual", version: typeof i.version === "string" ? i.version : null, source: typeof i.source === "string" ? i.source : null, instructions: typeof i.instructions === "string" ? i.instructions : null, assets: assetsOf(i.assets) });

// https only, a real digest, a known format, and a binary path that stays
// inside the archive on either platform's rules (src/store/archive.mjs).
const assetsOf = (assets) => Object.fromEntries(Object.entries(assets && typeof assets === "object" ? assets : {}).filter(([, a]) => pinnedArchive(a, "bin")));

export const assetFor = (entry, platform, arch) => entry.install.assets[platformKey(platform, arch)] ?? null;

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : []);
