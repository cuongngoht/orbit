// ONE way a pinned archive becomes a runtime in the machine store -- the part
// the two private installers genuinely share, and nothing more. CLI tools
// (src/tools/archive.mjs) and managed MCP runtimes (src/mcp/install.mjs) each
// keep their own catalog rows, receipts, registries and reconciliation; what
// they have in common is this transaction:
//
//   download  the pinned URL, then its SHA-256 against the PIN: a mismatch
//             installs nothing (Blocked -- the network or the mirror is wrong,
//             not the person who asked)
//   stage     unpack into a temporary directory BESIDE the final one
//   verify    the caller says what proves the staged copy works
//   promote   an earlier copy is set aside, never deleted, then one rename puts
//             the staged one in place; the temporary directory always goes
//
// `promote` is the part ANY installer that stages a runtime beside its final directory shares
// (src/tools/pylock.mjs builds its environment in a staged directory and promotes it the same way).
//
// So there is no moment at which a half-unpacked runtime sits where anything
// looks, and a caller writes its receipt only after this returns. Every effect
// is `io` (src/tools/real.mjs realInstallIo), faked in the suite.
import { basename, dirname } from "node:path";
import { Blocked } from "../errors.mjs";
import { relativeInside } from "../project/boundary.mjs";

export const ARCHIVE_FORMATS = ["tar.gz", "tar.bz2", "tar.xz", "zip"];
const SHA256 = /^[a-f0-9]{64}$/;

// https only, a real digest, a known format, and the named file (`bin`,
// `entrypoint`) a path that stays inside the archive on either platform.
export const pinnedArchive = (asset, inside) => /^https:\/\//.test(String(asset?.url ?? "")) && SHA256.test(String(asset?.sha256 ?? "")) && ARCHIVE_FORMATS.includes(asset?.format) && relativeInside(asset?.[inside]);

// { asset, final, verify(unpackedDir) -> boolean, unverified: sentence, io }
export async function placeArchive(p) {
  const bytes = await p.io.download(p.asset.url);
  if (p.io.sha256(bytes) !== p.asset.sha256) throw new Blocked(`${basename(p.asset.url)} does not match the SHA-256 the catalog pins for it; nothing was installed`);
  const tmp = p.io.tempDir(dirname(p.final));
  try { promote({ ...p, staged: p.io.unpack(bytes, p.asset, tmp) }); }
  finally { p.io.remove(tmp); }
}

// { staged, final, verify(stagedDir) -> boolean, unverified: sentence, io }: nothing is put in place that did not answer.
export function promote(p) {
  if (!p.verify(p.staged)) throw new Blocked(`${p.unverified}; nothing was installed`);
  p.io.setAside(p.final);
  p.io.rename(p.staged, p.final);
}
