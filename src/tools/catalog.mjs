// The plugin's TOOL CATALOG (catalog/tools.json), read as data.
//
// A row says what a tool provides, where to look for it (`detection`), and how
// -- if at all -- Orbit may install it privately (`install.strategy`). Nothing
// here branches on a row's id: a detector and an installer are chosen by the
// strategy NAME, from registries the composition root fills.
//
// An `archive` install is PINNED in the row: version, and per platform a URL, a
// SHA-256 and the binary's path inside the archive. A `python-lock` install is
// pinned the same way, by a LOCK file shipped beside the catalog that names every
// distribution and every SHA-256 pip may accept. A pin that is not well formed is
// dropped here, so a typo in the catalog can make a platform uninstallable but
// never makes an unverified download installable.
import { rowsOf } from "../catalog.mjs";
import { relativeInside } from "../project/boundary.mjs";
import { pinnedArchive } from "../store/archive.mjs";
import { launchOf, profileOf, wrapperOf } from "./launch.mjs";

export { relativeInside } from "../project/boundary.mjs";

export const platformKey = (platform, arch) => `${platform}-${arch}`;

export function toolCatalog(data) {
  return rowsOf(data?.tools).map(entryOf);
}

// `observe` (1.7.1): `demand` marks a tool the general observation must NOT look at -- one a concrete
// need asks about (src/tools/observe.mjs `observeSome`) -- because its probe can be slow (a CLI that
// starts an interpreter takes seconds) and the general observation runs inside a session's start.
// `profile` and `launch` (0.2.1): how a tool that keeps identity state is started (src/tools/launch.mjs).
const entryOf = (row) => withLaunch(row, { observe: row.observe === "demand" ? "demand" : "always", id: row.id, name: String(row.name ?? row.id), summary: String(row.summary ?? ""), provides: list(row.provides), detection: detectionOf(row.detection ?? {}), install: installOf(row.install ?? {}) });

const withLaunch = (row, entry) => ({ ...entry, profile: profileOf(row.profile), launch: launchOf(row.launch, profileOf(row.profile)) });

// The places a tool may be looked for, by the names detection knows them (src/tools/detect.mjs SOURCES).
export const SOURCE_NAMES = ["project", "orbit-managed", "system"];

// `minimum` (1.6.0): the oldest version that can do the job. A candidate below
// it is found and not usable, so detection keeps looking (src/tools/detect.mjs).
// `sources` (0.2.1): only these places are looked at -- a private tool never looks at PATH.
// `timeoutMs`: a tool that starts an interpreter may need longer than the default probe deadline.
// `native`: a candidate must be a program of THIS operating system (a Windows program reached through WSL is not).
// `wrapper`: a Windows `.cmd` that only forwards to an interpreter beside it (src/tools/launch.mjs).
const detectionOf = (d) => ({ strategy: typeof d.strategy === "string" ? d.strategy : "commands", commands: list(d.commands), project: d.project === true, versionArgs: list(d.versionArgs).length ? list(d.versionArgs) : ["--version"], versionPattern: typeof d.versionPattern === "string" ? d.versionPattern : null, minimum: typeof d.minimum === "string" ? d.minimum : null, sources: sourcesOf(d.sources), timeoutMs: deadlineOf(d.timeoutMs), native: d.native === true, wrapper: wrapperOf(d.wrapper) });

const sourcesOf = (v) => {
  const named = list(v).filter((s) => SOURCE_NAMES.includes(s));
  return named.length ? named : null;
};

const deadlineOf = (v) => (Number.isInteger(v) && v >= 1000 && v <= 120_000 ? v : null);

// `autonomous` (0.2.1): Orbit may install this row by itself when a need asks for it (src/tools/ensure.mjs) -- only
// ever a pinned `archive` or `python-lock`, never a package manager. `python`: the tool row whose private
// interpreter a `python-lock` install builds its environment from; `package`: the distribution its lock must pin to
// the row's own version.
const installOf = (i) => ({ strategy: strategyOf(i), version: typeof i.version === "string" ? i.version : null, source: typeof i.source === "string" ? i.source : null, instructions: typeof i.instructions === "string" ? i.instructions : null, autonomous: i.autonomous === true, python: typeof i.python === "string" ? i.python : null, package: typeof i.package === "string" ? i.package : null, assets: assetsOf(i.assets, strategyOf(i)) });

const strategyOf = (i) => (typeof i.strategy === "string" ? i.strategy : "manual");

// A lock is a file shipped beside the catalog, named relative to it, and the binary a relative path inside what the
// install makes.
export const pinnedLock = (asset) => relativeInside(asset?.lock) && relativeInside(asset?.bin);

const PINNED = { "python-lock": pinnedLock };

const pinned = (strategy) => PINNED[strategy] ?? ((a) => pinnedArchive(a, "bin"));

// https only, a real digest, a known format, and a binary path that stays
// inside the archive on either platform's rules (src/store/archive.mjs). An
// asset may carry its own `launch` (what goes between the binary and the tool's arguments).
const assetsOf = (assets, strategy) => Object.fromEntries(Object.entries(assets && typeof assets === "object" ? assets : {}).filter(([, a]) => pinned(strategy)(a)).map(([k, a]) => [k, { ...a, launch: launchOf(a.launch) }]));

export const assetFor = (entry, platform, arch) => entry.install.assets[platformKey(platform, arch)] ?? null;

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : []);
