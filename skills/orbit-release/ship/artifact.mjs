// THE RELEASE ARTIFACT: the archive a host is handed, built from a release commit the one way the release skill says it
// is built (`git archive --format=zip`, never a zip of a directory: only an archive applies export-ignore), then held to
// what a host refuses ON THE ARCHIVE ITSELF -- its central directory read here, with no dependency -- and digested two
// ways: its bytes (the file a release publishes) and its CONTENT (every entry's name and inflated bytes), so an archive a
// person builds again from a commit of the same tree can be checked against the evidence too.
//
//   built(world, room, tree, commit) -> { file, version, sha256, content, entries, bytes, refused }
//   entriesOf(buf) -> [{ name, mode, method, size, offset }]      contentDigest(buf) -> hex       ARCHIVE_RULES
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { Blocked } from "../../../src/errors.mjs";
import { sha, shaBytes } from "../../../src/hash.mjs";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

// The end of the central directory: the last signature in the trailing 64 KiB (a zip's comment is at most that long).
function eocdOf(buf) {
  const from = Math.max(0, buf.length - 65557);
  for (let at = buf.length - 22; at >= from; at -= 1) if (buf.readUInt32LE(at) === EOCD) return at;
  throw new Blocked("the archive has no end of central directory: it is not a zip");
}

const entryAt = (buf, at) => ({ name: buf.toString("utf8", at + 46, at + 46 + buf.readUInt16LE(at + 28)), mode: (buf.readUInt32LE(at + 38) >>> 16) & 0xffff, method: buf.readUInt16LE(at + 10), csize: buf.readUInt32LE(at + 20), size: buf.readUInt32LE(at + 24), offset: buf.readUInt32LE(at + 42), next: at + 46 + buf.readUInt16LE(at + 28) + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32) });

function notWhole() {
  throw new Blocked("the archive's central directory is not whole");
}

const checkedEntry = (buf, at) => (at + 46 <= buf.length && buf.readUInt32LE(at) === CENTRAL ? entryAt(buf, at) : notWhole());

function centralOf(buf, at, n) {
  const out = [];
  for (let i = 0, p = at; i < n; i += 1, p = out[i - 1].next) out.push(checkedEntry(buf, p));
  return out;
}

export const entriesOf = (buf) => ((end) => centralOf(buf, buf.readUInt32LE(end + 16), buf.readUInt16LE(end + 10)))(eocdOf(buf));

// An entry's bytes, from its local header: stored as they are, or deflated.
function bytesOf(buf, e) {
  if (buf.readUInt32LE(e.offset) !== LOCAL) throw new Blocked(`the archive's entry ${e.name} has no local header`);
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const data = buf.subarray(start, start + e.csize);
  return e.method === 8 ? inflateRawSync(data) : data;
}

const isDir = (e) => e.name.endsWith("/");

export const contentDigest = (buf) => sha(entriesOf(buf).filter((e) => !isDir(e)).map((e) => `${e.name}\u0000${shaBytes(bytesOf(buf, e))}`).sort().join("\n"));

const SYMLINK = 0o120000;

// What a host refuses in an archive (skills/orbit-release/SKILL.md §2), asked of the archive's own entries.
export const ARCHIVE_RULES = [
  { says: "no .claude-plugin/plugin.json at the archive's root -- a host finds no plugin", fails: (es) => !es.some((e) => e.name === ".claude-plugin/plugin.json") },
  { says: "a top-level bin/ -- a host refuses what would go on PATH unseen", fails: (es) => es.some((e) => e.name.startsWith("bin/")) },
  { says: "a symbolic link -- a host refuses the archive outright", fails: (es) => es.some((e) => (e.mode & 0o170000) === SYMLINK) },
  { says: "a file of development tooling that never ships (benchmark/, acceptance/, integrations/) -- export-ignore did not apply", fails: (es) => es.some((e) => !isDir(e) && /^(benchmark|acceptance|integrations)\//.test(e.name)) },
];

const versionOf = (tree) => JSON.parse(readFileSync(join(tree, "package.json"), "utf8")).version;

export function built(world, room, tree, commit) {
  const version = versionOf(tree);
  const file = room.at("artifacts", `orbit-${version}-${commit.slice(0, 12)}.zip`);
  ((r) => r.ok || failedArchive(r))((room.io.ensureDir(room.at("artifacts")), world.git(tree, ["archive", "--format=zip", "-o", file, commit])));
  const buf = readFileSync(file);
  return { file, version, sha256: shaBytes(buf), content: contentDigest(buf), entries: entriesOf(buf).length, bytes: buf.length, refused: ARCHIVE_RULES.filter((r) => r.fails(entriesOf(buf))).map((r) => r.says) };
}

function failedArchive(r) {
  throw new Blocked(`git archive could not build the release artifact: ${String(r.err ?? "").trim().split("\n").at(-1)?.slice(0, 300) ?? "no answer"}`);
}
