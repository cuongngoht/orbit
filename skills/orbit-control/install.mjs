// Install a PRIVATE Node for Orbit Control -- the official build, verified, in
// the plugin's own store -- and change nothing else on this machine.
//
// The system Node, nvm, PATH and every shell profile are left exactly as they
// were: the runtime lands in <store>/control-runtime/<version>-<platform>/ and
// is used only by skills/orbit-control/start.mjs. Removing it is deleting that
// directory.
//
//   which      the newest LTS release the server accepts that has a build for
//              this OS and CPU, read off nodejs.org's own index
//   verify     the archive's SHA-256 against the SHASUMS256.txt published beside
//              it; a mismatch installs nothing
//   unpack     into a temporary directory, then renamed into place, so a half
//              extracted runtime is never where start.mjs looks
//   prove      start.mjs asks the installed binary its version before using it
//
// Every effect is injected (`io`), so the whole sequence is tested with no
// network and no archive.
import { join } from "node:path";

export const DIST = "https://nodejs.org/dist";

// One row per build nodejs.org publishes that this can install. `file` is the
// key its index.json lists for a release; `archive` is how the asset is named.
export const PLATFORMS = {
  "darwin-arm64": { name: "darwin-arm64", file: "osx-arm64-tar", archive: "tar.gz", bin: join("bin", "node") },
  "darwin-x64": { name: "darwin-x64", file: "osx-x64-tar", archive: "tar.gz", bin: join("bin", "node") },
  "linux-x64": { name: "linux-x64", file: "linux-x64", archive: "tar.gz", bin: join("bin", "node") },
  "linux-arm64": { name: "linux-arm64", file: "linux-arm64", archive: "tar.gz", bin: join("bin", "node") },
  "win32-x64": { name: "win-x64", file: "win-x64-zip", archive: "zip", bin: "node.exe" },
  "win32-arm64": { name: "win-arm64", file: "win-arm64-zip", archive: "zip", bin: "node.exe" },
};

export const targetOf = (platform, arch) => PLATFORMS[`${platform}-${arch}`] ?? null;

// `node-v24.21.0-darwin-arm64`: the asset without its extension, which is also
// the one top-level directory the archive holds.
export const folderOf = (version, target) => `node-${version}-${target.name}`;
export const assetOf = (version, target) => `${folderOf(version, target)}.${target.archive}`;

// The index is newest first, so the first match is the newest that fits.
export const chooseRelease = (index, target, supported) => index.find((r) => r.lts && supported(r.version) && r.files.includes(target.file)) ?? null;

export function expectedDigest(shasums, asset) {
  const line = String(shasums).split("\n").map((l) => l.trim()).find((l) => l.endsWith(`  ${asset}`));
  return line ? line.split(/\s+/)[0] : null;
}

export class RuntimeError extends Error {}

// The directory the runtime is (now) in. An already installed one is reused
// without a single download.
export async function installRuntime(io) {
  const release = chooseRelease(await io.getJson(`${DIST}/index.json`), io.target, io.supported);
  if (!release) throw new RuntimeError(`nodejs.org lists no LTS release the server accepts for ${io.target.name}`);
  const dir = join(io.root, `${release.version}-${io.target.name}`);
  if (io.exists(join(dir, io.target.bin))) return dir;
  return fetched(io, release.version, dir);
}

async function fetched(io, version, dir) {
  const asset = assetOf(version, io.target);
  io.log(`downloading ${asset} from nodejs.org…`);
  const [bytes, sums] = await Promise.all([io.getBytes(`${DIST}/${version}/${asset}`), io.getText(`${DIST}/${version}/SHASUMS256.txt`)]);
  checked(io, bytes, sums, asset);
  return io.unpack(bytes, asset, folderOf(version, io.target), dir);
}

// Verified FIRST, as its own statement: `io.verifiedAs?.(verified(…))` would
// skip the verification itself whenever nobody asked for the digest, because
// an optional call does not evaluate its arguments. Then the digest is handed
// to whoever keeps a receipt.
function checked(io, bytes, sums, asset) {
  const digest = verified(bytes, expectedDigest(sums, asset), io.sha256, asset);
  io.verifiedAs?.(digest);
}

function verified(bytes, want, sha256, asset) {
  if (!want) throw new RuntimeError(`SHASUMS256.txt does not list ${asset}; nothing was installed`);
  if (sha256(bytes) !== want) throw new RuntimeError(`${asset} does not match the SHA-256 nodejs.org published for it; nothing was installed`);
  return want;
}
